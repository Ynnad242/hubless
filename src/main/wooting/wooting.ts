// Wooting analog keyboards (ARM firmware: 60HE v2, 60HE+, 80HE, Two HE ARM, UwU).
// Commands are 8-byte feature reports; replies are input reports; settings are protobuf in output reports.
// Verified on a 60HE (ARM, fw 2.14.2). Protocol notes: github.com/eng1n88r/wooting (MIT). Where this firmware
// stores data differently from those notes (rapid-trigger groups, packed per-key lists), the code follows the device.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import HID from 'node-hid'
import type { AdvancedKey, KeyboardAction, KeyboardSettings, KeyboardState } from '@shared/types'
import { layoutFor } from '@shared/wooting'
import { Offline, Timeout, sleep } from '../logitech/hidpp'
import * as pb from './pb'

export const WOOTING = 0x31e3
const ARM_PAGE = 0xff55
const OUTPUT_SIZES: [number, number][] = [[1, 32], [2, 62], [3, 254], [4, 510], [5, 1022], [6, 2046]]
const OK = 0x88

const CMD = {
  PING: 0, VERSION: 1, SAVE_RGB: 8, ANALOG: 20, CURRENT_PROFILE: 11, ACTIVATE_PROFILE: 23, RELOAD_PROFILE: 38, KEYBOARD_PROFILE: 39,
  MAPPING: 48, PER_KEY: 49, RGB_CORE: 50, ADVANCED: 52, SAVE_ADVANCED: 53, PROFILE_METADATA: 55, RT_KEYS: 61,
  RGB_ROWS_1: 35, RGB_ROWS_2: 36
} as const
const REPORT = {
  RGB_ROWS_1: 0x0e, RGB_ROWS_2: 0x0f, KEYBOARD_PROFILE: 0x11, MAPPING: 0x14, PER_KEY: 0x15, RGB_CORE: 0x16, ADVANCED: 0x18,
  PROFILE_METADATA: 0x1a, RT_KEYS: 0x1d
} as const
const RAM = 0
const flagsPersist = (slot: number) => (slot << 1) | 1

// Travel distance <-> firmware code: 0x4000 | mm / 4 * 16383.
export const mmToCode = (mm: number) => 0x4000 | Math.round((Math.max(0, Math.min(4, mm)) / 4) * 16383)
export const codeToMm = (c: number) => Math.round(((c & 0x3fff) / 16383) * 4 * 100) / 100

const rgb565 = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return (((n >> 16) & 0xf8) << 8) | (((n >> 8) & 0xfc) << 3) | ((n & 0xff) >> 3)
}
const hex565 = (v: number) => {
  const r = (v >> 8) & 0xf8
  const g = (v >> 3) & 0xfc
  const b = (v << 3) & 0xf8
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

// ---------------------------------------------------------------- keyboard profile (actuation, rapid trigger)

export function settingsFromProfile(raw: Buffer): KeyboardSettings {
  const p = pb.msg(pb.decode(raw), 1)
  return {
    actuationMm: codeToMm(pb.num(p, 1, mmToCode(2))),
    rapidTrigger: pb.num(p, 3) === 1,
    rtPressMm: codeToMm(pb.num(p, 4, mmToCode(0.15))),
    rtReleaseMm: p.some((f) => f.f === 8) ? codeToMm(pb.num(p, 8)) : null,
    continuousRt: pb.num(p, 7, 1) === 0,
    tachyon: pb.num(p, 5) === 1
  }
}

/** Apply settings onto the stored KeyboardProfile, keeping fields Hubless doesn't know. Every scalar is written. */
export function profileWithSettings(raw: Buffer, s: KeyboardSettings): Buffer {
  const top = pb.decode(raw)
  let p = pb.msg(top, 1)
  p = pb.setNum(p, 1, mmToCode(s.actuationMm))
  if (!p.some((f) => f.f === 2)) p = pb.setNum(p, 2, 1)
  p = pb.setNum(p, 3, +s.rapidTrigger)
  p = pb.setNum(p, 4, mmToCode(s.rtPressMm))
  p = pb.setNum(p, 5, +s.tachyon)
  if (!p.some((f) => f.f === 6)) p = pb.setNum(p, 6, 2)
  p = pb.setNum(p, 7, s.continuousRt ? 0 : 1)
  p = s.rtReleaseMm === null ? p.filter((f) => f.f !== 8) : pb.setNum(p, 8, mmToCode(s.rtReleaseMm))
  p = pb.setNum(p, 9, +s.tachyon)
  return pb.encode(pb.setBytes(top, 1, pb.encode(p)))
}

// ---------------------------------------------------------------- transport

export class WootingTransport {
  private queue: Promise<unknown> = Promise.resolve()
  private waiting: ((d: Buffer) => boolean) | null = null
  private closed = false

  private constructor(public path: string, private dev: HID.HIDAsync) {
    dev.on('data', (d: Buffer) => this.waiting?.(d))
    dev.on('error', () => (this.closed = true))
  }

  static async open(path: string) {
    return new WootingTransport(path, await HID.HIDAsync.open(path))
  }

  close() {
    this.closed = true
    this.dev.close().catch(() => {})
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job)
    this.queue = next.catch(() => {})
    return next
  }

  /** Send a command (`params` are packet bytes 4..7; profile slots go in the first); resolve with the reply data. */
  command(id: number, params: number[] = [0, 0, 0, 0], timeoutMs = 1500): Promise<Buffer> {
    return this.serial(
      () =>
        new Promise<Buffer>((resolve, reject) => {
          if (this.closed) return reject(new Offline('keyboard disconnected'))
          const timer = setTimeout(() => {
            this.waiting = null
            reject(new Timeout(`keyboard did not answer command ${id}`))
          }, timeoutMs)
          this.waiting = (d) => {
            // [report id, 0xD1, 0xDA, command echo, status, len lo, len hi, data…]
            if (d[1] !== 0xd1 || d[2] !== 0xda || d[3] !== id) return false
            clearTimeout(timer)
            this.waiting = null
            if (d[4] !== OK) reject(new Error(`keyboard rejected command ${id} (status 0x${d[4].toString(16)})`))
            else resolve(Buffer.from(d.subarray(7, 7 + (d[5] | (d[6] << 8)))))
            return true
          }
          this.dev.sendFeatureReport([1, 0xd1, 0xda, id, ...params.slice(0, 4)]).catch((e) => reject(new Offline(String(e))))
        })
    )
  }

  /** Output report [id, 0xD1, 0xDA, …header, payload…] padded to the smallest report that fits. */
  report(header: number[], payload: ArrayLike<number>) {
    return this.serial(async () => {
      const body = [0xd1, 0xda, ...header, ...Array.from(payload)]
      const [id, size] = OUTPUT_SIZES.find(([, s]) => s >= body.length) ?? []
      if (!id) throw new Error('settings too large for one report')
      const out = new Array(size! + 1).fill(0)
      out.splice(0, body.length + 1, id, ...body)
      await this.dev.write(out)
    })
  }

  /** Structured report: [type, flags, len lo, len hi] + protobuf. */
  structured(type: number, flags: number, payload: Buffer) {
    return this.report([type, flags, payload.length & 0xff, payload.length >> 8], payload)
  }
}

export function wootingEndpoint(list: HID.Device[] = HID.devices()): { path: string; product: string; productId: number; serial: string } | null {
  const d = list.find((x) => x.vendorId === WOOTING && x.usagePage === ARM_PAGE && x.path)
  return d ? { path: d.path!, product: d.product ?? 'Wooting keyboard', productId: d.productId, serial: d.serialNumber ?? '' } : null
}

// ---------------------------------------------------------------- session

interface Raw {
  profile: Buffer
  rtKeys: Buffer
  perKey: Buffer
  layers: Buffer[]
  advanced: Buffer
  core: Buffer
  rows: [Buffer, Buffer]
  meta: Buffer
}

const DATA = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'hubless')

export class WootingSession {
  state!: KeyboardState
  private raw = new Map<number, Raw>()
  private backedUp = false

  constructor(public t: WootingTransport, public product: string, public serial: string) {}

  get name() {
    return this.product.replace(/^Wooting\s*/i, '').replace(/\s*\(ARM\)/i, '').trim() || 'Wooting'
  }

  private get slot() {
    return this.state.active
  }

  private cur(): Raw {
    const r = this.raw.get(this.slot)
    if (!r) throw new Error('Unknown keyboard profile.')
    return r
  }

  private async readRaw(slot: number, meta: Buffer): Promise<Raw> {
    const c = (id: number, extra: number[] = [slot, 0, 0, 0]) => this.t.command(id, extra)
    const layers: Buffer[] = []
    for (let layer = 0; layer < 3; layer++) layers.push(await c(CMD.MAPPING, [slot, 0, layer, 0]))
    return {
      profile: await c(CMD.KEYBOARD_PROFILE), rtKeys: await c(CMD.RT_KEYS), perKey: await c(CMD.PER_KEY), layers,
      advanced: await c(CMD.ADVANCED), core: await c(CMD.RGB_CORE), rows: [await c(CMD.RGB_ROWS_1), await c(CMD.RGB_ROWS_2)], meta
    }
  }

  async load() {
    const v = await this.t.command(CMD.VERSION)
    const active = (await this.t.command(CMD.CURRENT_PROFILE))[0]
    const profiles: KeyboardState['profiles'] = []
    this.raw.clear()
    for (let slot = 0; slot < 4; slot++) {
      const meta = await this.t.command(CMD.PROFILE_METADATA, [slot, 0, 0, 0]).catch(() => Buffer.alloc(0))
      if (!meta.length) {
        if (slot > active) break
        continue
      }
      const raw = await this.readRaw(slot, meta)
      this.raw.set(slot, raw)
      const name = pb.bytes(pb.decode(meta), 1)?.toString('utf8') || `Profile ${slot + 1}`
      profiles.push({ slot, name, settings: settingsFromProfile(raw.profile) })
    }
    this.state = {
      firmware: `${v[0]}.${v[1]}.${v[2]}`, serial: this.serial, model: this.name, active, profiles,
      layout: [], layers: [], perKeyActuation: {}, rtGroups: [], advanced: [],
      lighting: { brightness: 255, colors: [], effect: false, canRestoreEffect: false }, backups: this.backupCount()
    }
    this.derive()
  }

  /** Rebuild the UI view of the active profile from its raw blobs. */
  private derive() {
    const r = this.raw.get(this.slot)
    if (!r) return
    const layers = r.layers.map((b) => pb.all(pb.decode(b), 1).map((row) => [...(pb.bytes(pb.decode(row), 1) ?? Buffer.alloc(0))]))
    const perKey: Record<number, number> = {}
    for (const e of pb.all(pb.decode(r.perKey), 4))
      for (const v of pb.packed(pb.bytes(pb.decode(e), 1))) perKey[v % 65536 & 0xff] = codeToMm(Math.floor(v / 65536))
    const rtGroups = pb.all(pb.decode(r.rtKeys), 1).map((g) => {
      const m = pb.decode(g)
      const s = pb.msg(m, 2)
      return { keys: pb.packed(pb.bytes(m, 1)), pressMm: codeToMm(pb.num(s, 1)), releaseMm: codeToMm(pb.num(s, 2)) }
    })
    const advanced = pb.all(pb.decode(r.advanced), 1).map(describeAdvanced)
    const core = pb.decode(r.core)
    const colors: string[][] = []
    for (const part of r.rows) for (const row of pb.all(pb.decode(part), 1)) colors.push(pb.packed(pb.bytes(pb.decode(row), 1)).map(hex565))
    Object.assign(this.state, {
      layout: layoutFor(layers[0] ?? []),
      layers,
      perKeyActuation: perKey,
      rtGroups,
      advanced,
      lighting: {
        brightness: pb.num(pb.msg(core, 1), 1, 255),
        colors,
        effect: pb.all(pb.msg(core, 4), 1).length > 0,
        canRestoreEffect: existsSync(this.effectFile())
      }
    })
  }

  async ping() {
    await this.t.command(CMD.PING, [0, 0, 0, 0], 800)
  }

  /** Live key travel: rows × columns of 0..255 (0 = released, 255 = bottomed out at 4 mm). */
  async analog(): Promise<number[][]> {
    const b = await this.t.command(CMD.ANALOG, [0, 0, 0, 0], 300)
    return pb.all(pb.decode(b), 1).map((row) => [...(pb.bytes(pb.decode(row), 1) ?? Buffer.alloc(0))])
  }

  // ---------------------------------------------------------------- safety
  private backupDir() {
    const d = join(DATA, 'backups', `wooting-${this.serial || 'unknown'}`)
    mkdirSync(d, { recursive: true })
    return d
  }
  private backupCount() {
    return existsSync(this.backupDir()) ? 1 : 0
  }
  private effectFile() {
    return join(this.backupDir(), 'original-effect.hex')
  }

  private ensureBackup() {
    if (this.backedUp) return
    const r = this.cur()
    const dump = Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? v.map((b: Buffer) => b.toString('hex')) : (v as Buffer).toString('hex')])
    )
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    writeFileSync(join(this.backupDir(), `${stamp}_slot${this.slot}.json`), JSON.stringify({ hubless_wooting_backup: 1, slot: this.slot, ...dump }, null, 1))
    writeFileSync(join(this.backupDir(), 'latest.json'), JSON.stringify({ slot: this.slot, ...dump }, null, 1))
    this.backedUp = true
  }

  private async verify(cmd: number, params: number[], expect: Buffer, what: string) {
    await sleep(25)
    const back = await this.t.command(cmd, params)
    if (!back.equals(expect)) throw new Error(`The keyboard did not store the new ${what}.`)
    return back
  }

  // ---------------------------------------------------------------- actions
  async act(a: KeyboardAction) {
    if (a.type === 'activate') return this.activate(a.slot)
    if (a.type === 'reload') return this.load() // picks up changes made in Wootility
    if (a.type !== 'restore') this.ensureBackup()
    switch (a.type) {
      case 'settings':
        return this.setSettings(a.slot, a.settings)
      case 'rename':
        return this.rename(a.slot, a.name)
      case 'perKey':
        return this.setPerKey(a.keys, a.actuationMm, a.rt)
      case 'map':
        return this.setMapping(a.layer, a.keys, a.code)
      case 'advanced':
        return this.setAdvanced(a.key, a.entry)
      case 'lighting':
        return this.setLighting(a)
      case 'restore':
        return this.restoreLatest()
      default:
        return undefined
    }
  }

  /** Write settings to a profile slot; the active slot also changes live. */
  async setSettings(slot: number, s: KeyboardSettings) {
    const r = this.raw.get(slot)
    if (!r) throw new Error('Unknown keyboard profile.')
    const payload = profileWithSettings(r.profile, s)
    for (const flags of slot === this.slot ? [RAM, flagsPersist(slot)] : [flagsPersist(slot)]) {
      await this.t.structured(REPORT.RT_KEYS, flags, r.rtKeys) // Wootility sends the RT key list before every profile write
      await this.t.structured(REPORT.KEYBOARD_PROFILE, flags, payload)
    }
    r.profile = await this.verify(CMD.KEYBOARD_PROFILE, [slot, 0, 0, 0], payload, 'settings')
    this.state.profiles.find((p) => p.slot === slot)!.settings = settingsFromProfile(r.profile)
  }

  private async rename(slot: number, name: string) {
    const r = this.raw.get(slot)
    if (!r) throw new Error('Unknown keyboard profile.')
    const meta = pb.encode(pb.setBytes(pb.decode(r.meta), 1, Buffer.from(name.slice(0, 24), 'utf8')))
    await this.t.structured(REPORT.PROFILE_METADATA, flagsPersist(slot), meta)
    if (slot === this.slot) await this.t.structured(REPORT.PROFILE_METADATA, RAM, meta)
    r.meta = await this.verify(CMD.PROFILE_METADATA, [slot, 0, 0, 0], meta, 'name')
    this.state.profiles.find((p) => p.slot === slot)!.name = name
  }

  private async writeBoth(type: number, payload: Buffer) {
    await this.t.structured(type, RAM, payload)
    await this.t.structured(type, flagsPersist(this.slot), payload)
  }

  private async setPerKey(keys: number[], actuationMm?: number | null, rt?: { pressMm: number; releaseMm: number } | null) {
    const r = this.cur()
    if (actuationMm !== undefined) {
      const top = pb.decode(r.perKey)
      const values = pb.all(top, 4).flatMap((e) => pb.packed(pb.bytes(pb.decode(e), 1))).filter((v) => !keys.includes(v % 65536 & 0xff))
      if (actuationMm !== null) for (const k of keys) values.push(mmToCode(actuationMm) * 65536 + k)
      const rest = top.filter((f) => f.f !== 4)
      const next = pb.encode([...rest, ...(values.length ? [{ f: 4, b: pb.encode([{ f: 1, b: pb.pack(values) }]) }] : [])].sort((a, b) => a.f - b.f))
      await this.writeBoth(REPORT.PER_KEY, next)
      r.perKey = await this.verify(CMD.PER_KEY, [this.slot, 0, 0, 0], next, 'per-key actuation')
    }
    if (rt !== undefined) {
      const top = pb.decode(r.rtKeys)
      const groups = pb.all(top, 1).map((g) => {
        const m = pb.decode(g)
        return { keys: pb.packed(pb.bytes(m, 1)).filter((k) => !keys.includes(k)), settings: pb.bytes(m, 2) ?? Buffer.alloc(0) }
      })
      if (rt) {
        const settings = pb.encode([{ f: 1, v: mmToCode(rt.pressMm) }, { f: 2, v: mmToCode(rt.releaseMm) }, { f: 3, v: 1 }])
        const same = groups.find((g) => g.settings.equals(settings))
        if (same) same.keys.push(...keys)
        else groups.push({ keys: [...keys], settings })
      }
      const body = groups
        .filter((g) => g.keys.length)
        .map((g) => ({ f: 1, b: pb.encode([{ f: 1, b: pb.pack([...new Set(g.keys)].sort((a, b) => a - b)) }, { f: 2, b: g.settings }]) }))
      const next = pb.encode([...body, ...top.filter((f) => f.f !== 1)])
      await this.writeBoth(REPORT.RT_KEYS, next)
      r.rtKeys = await this.verify(CMD.RT_KEYS, [this.slot, 0, 0, 0], next, 'rapid trigger keys')
    }
    this.derive()
  }

  private async setMapping(layer: number, keys: number[], code: number | null) {
    const r = this.cur()
    const top = pb.decode(r.layers[layer])
    const rows = pb.all(top, 1).map((row) => [...(pb.bytes(pb.decode(row), 1) ?? Buffer.alloc(21, 0xff))])
    for (const k of keys) {
      const [row, col] = [k >> 5, k & 0x1f]
      // Base-layer default is the key's own factory code, which Hubless keeps from the first read; other layers fall through (0xFF).
      rows[row][col] = code ?? (layer === 0 ? this.factoryCode(k) : 0xff)
    }
    const next = pb.encode(rows.map((row) => ({ f: 1, b: pb.encode([{ f: 1, b: Buffer.from(row) }]) })))
    for (const flags of [RAM, flagsPersist(this.slot)])
      await this.t.report([REPORT.MAPPING, flags, layer, 0, 0, next.length & 0xff, next.length >> 8], next)
    r.layers[layer] = await this.verify(CMD.MAPPING, [this.slot, 0, layer, 0], next, 'key mapping')
    this.derive()
  }

  private factoryCode(k: number): number {
    try {
      const saved = JSON.parse(readFileSync(join(this.backupDir(), 'first-layer0.json'), 'utf8')) as number[][]
      return saved[k >> 5][k & 0x1f]
    } catch {
      return this.state.layers[0][k >> 5][k & 0x1f]
    }
  }

  private async setAdvanced(key: number, entry: AdvancedKey | null) {
    const r = this.cur()
    const top = pb.decode(r.advanced)
    const entries = pb.all(top, 1).filter((e) => pb.num(pb.decode(e), 8, -1) !== key)
    if (entry) {
      if (entries.length >= 40) throw new Error('The keyboard holds at most 40 advanced keys.')
      entries.push(encodeAdvanced({ ...entry, key }))
    }
    const next = pb.encode([...entries.map((b) => ({ f: 1, b })), { f: 2, v: 0 }, { f: 3, v: entries.length }])
    await this.t.structured(REPORT.ADVANCED, RAM, next)
    await this.t.command(CMD.SAVE_ADVANCED, [this.slot, 0, 0, 0])
    r.advanced = await this.verify(CMD.ADVANCED, [this.slot, 0, 0, 0], next, 'advanced keys')
    this.derive()
  }

  private async setLighting(a: Extract<KeyboardAction, { type: 'lighting' }>) {
    const r = this.cur()
    let core = pb.decode(r.core)
    if (!existsSync(this.effectFile())) writeFileSync(this.effectFile(), (pb.bytes(core, 4) ?? Buffer.alloc(0)).toString('hex'))
    if (a.brightness !== undefined) core = pb.setBytes(core, 1, pb.encode(pb.setNum(pb.msg(core, 1), 1, Math.round(a.brightness))))
    if (a.effect === 'static' || a.paint) core = pb.setBytes(core, 4, Buffer.alloc(0)) // effects off so the key colours show
    if (a.effect === 'original') core = pb.setBytes(core, 4, Buffer.from(readFileSync(this.effectFile(), 'utf8'), 'hex'))
    let rows = r.rows
    if (a.paint) {
      const colors = this.state.lighting.colors.map((row) => [...row])
      for (const k of a.paint.keys) if (colors[k >> 5]) colors[k >> 5][k & 0x1f] = a.paint.color
      const part = (from: number) =>
        pb.encode(colors.slice(from, from + 3).map((row) => ({ f: 1, b: pb.encode([{ f: 1, b: pb.pack(row.map(rgb565)) }]) })))
      rows = [part(0), part(3)]
    }
    const coreBytes = pb.encode(core)
    // SaveRgbProfile commits the whole RGB RAM (rows + core) into the slot, so all of it is staged first.
    await this.t.structured(REPORT.RGB_ROWS_1, RAM, rows[0])
    await this.t.structured(REPORT.RGB_ROWS_2, RAM, rows[1])
    await this.t.structured(REPORT.RGB_CORE, RAM, coreBytes)
    await this.t.command(CMD.SAVE_RGB, [this.slot, 0, 0, 0])
    r.core = await this.verify(CMD.RGB_CORE, [this.slot, 0, 0, 0], coreBytes, 'lighting')
    r.rows = [await this.t.command(CMD.RGB_ROWS_1, [this.slot, 0, 0, 0]), await this.t.command(CMD.RGB_ROWS_2, [this.slot, 0, 0, 0])]
    this.derive()
  }

  async activate(slot: number) {
    await this.t.command(CMD.ACTIVATE_PROFILE, [slot, 0, 0, 0])
    await sleep(100)
    await this.t.command(CMD.RELOAD_PROFILE, [slot, 0, 0, 0])
    await sleep(100)
    this.state.active = (await this.t.command(CMD.CURRENT_PROFILE))[0]
    this.derive()
  }

  /** Put back everything from the backup taken before Hubless's first change. */
  private async restoreLatest() {
    const file = join(this.backupDir(), 'latest.json')
    if (!existsSync(file)) throw new Error('There is no keyboard backup yet.')
    const b = JSON.parse(readFileSync(file, 'utf8'))
    const buf = (h: string) => Buffer.from(h, 'hex')
    const slot = b.slot as number
    for (const flags of [RAM, flagsPersist(slot)]) {
      await this.t.structured(REPORT.RT_KEYS, flags, buf(b.rtKeys))
      await this.t.structured(REPORT.KEYBOARD_PROFILE, flags, buf(b.profile))
      await this.t.structured(REPORT.PER_KEY, flags, buf(b.perKey))
      for (let layer = 0; layer < 3; layer++) {
        const l = buf(b.layers[layer])
        await this.t.report([REPORT.MAPPING, flags, layer, 0, 0, l.length & 0xff, l.length >> 8], l)
      }
    }
    await this.t.structured(REPORT.ADVANCED, RAM, buf(b.advanced))
    await this.t.command(CMD.SAVE_ADVANCED, [slot, 0, 0, 0])
    await this.t.structured(REPORT.RGB_ROWS_1, RAM, buf(b.rows[0]))
    await this.t.structured(REPORT.RGB_ROWS_2, RAM, buf(b.rows[1]))
    await this.t.structured(REPORT.RGB_CORE, RAM, buf(b.core))
    await this.t.command(CMD.SAVE_RGB, [slot, 0, 0, 0])
    await this.load()
  }

  /** Remember the factory base layer the first time Hubless sees the keyboard (for "reset key"). */
  rememberFactoryLayer() {
    const f = join(this.backupDir(), 'first-layer0.json')
    if (!existsSync(f) && this.state.layers[0]) writeFileSync(f, JSON.stringify(this.state.layers[0]))
  }
}

function describeAdvanced(b: Buffer): AdvancedKey {
  const m = pb.decode(b)
  const key = pb.num(m, 8)
  const has = (f: number) => m.some((x) => x.f === f)
  if (has(2)) {
    const t = pb.msg(m, 2)
    return { key, kind: 'modTap', tap: pb.num(t, 1), hold: pb.num(t, 2) }
  }
  if (has(3)) return { key, kind: 'toggle', code: pb.num(pb.msg(m, 3), 1) }
  if (has(4)) return { key, kind: 'snapTap', other: pb.num(pb.msg(m, 4), 1) }
  if (has(5)) {
    const s = pb.msg(m, 5)
    return { key, kind: 'socd', other: pb.num(s, 1), mode: pb.num(s, 3) }
  }
  if (has(1)) return { key, kind: 'dks', codes: [...(pb.bytes(pb.msg(m, 1), 1) ?? [])] }
  return { key, kind: 'other' }
}

function encodeAdvanced(a: AdvancedKey): Buffer {
  const body: pb.Msg = []
  if (a.kind === 'modTap') body.push({ f: 2, b: pb.encode([{ f: 1, v: a.tap ?? 0 }, { f: 2, v: a.hold ?? 0 }]) })
  else if (a.kind === 'toggle') body.push({ f: 3, b: pb.encode([{ f: 1, v: a.code ?? 0 }]) })
  else if (a.kind === 'snapTap') body.push({ f: 4, b: pb.encode([{ f: 1, v: a.other ?? 0 }, { f: 2, v: 0 }]) })
  else if (a.kind === 'socd') body.push({ f: 5, b: pb.encode([{ f: 1, v: a.other ?? 0 }, { f: 2, v: 0 }, { f: 3, v: a.mode ?? 0 }]) })
  else throw new Error('That advanced key type can only be kept, not created, by Hubless.')
  body.push({ f: 8, v: a.key }, { f: 9, v: 0 })
  return pb.encode(body)
}

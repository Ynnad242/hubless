// Razer mouse driver. Razer mice take 90-byte feature reports (report id 0) on interface 0 (3 on a few models):
//   status, transaction id, remaining packets (BE16), protocol 0, data size, command class, command id,
//   80 argument bytes, XOR checksum of bytes 2..87, 0
// and answer in the same report with status 2 (ok), 1 (busy; counts as ok), 3 (failed), 4 (timeout: a wireless mouse
// that is asleep or out of range) or 5 (not supported). Reads set bit 7 of the command id.
//
// The per-model facts (transaction id, which polling command, DPI stages or not, how long to wait) come from
// data/razer.json, extracted from OpenRazer's driver by tools/extract-razer.py. This driver is Hubless's own code.
// None of these models has been tested on hardware by Hubless yet, so the session reads everything before it changes
// anything, refuses to write if a read answers unexpectedly, reads every write back, and backs up first.
import HID from 'node-hid'
import type { Battery, LightEffect, LightSetting, LightZone, MouseState, ProfileData, Stage } from '@shared/types'
import { Offline, Timeout } from '../logitech/hidpp'
import { lookup } from '../catalog'
import * as storage from '../storage'
import data from '../../../data/razer.json'

export const RAZER_VID = 0x1532

type Cmd = [string, string | null, number] | null
/** One lighting zone, driven by the "extended matrix" commands (class 0x0F) with this transaction id. */
export interface RazerZone {
  zone: 'logo' | 'scroll' | 'backlight' | 'left' | 'right' | 'all'
  led: number
  tx: number
  effects: ('static' | 'none' | 'spectrum' | 'breath')[]
  brightness: boolean
}
export interface RazerModel {
  id: string
  pid: number
  interface: number
  waitMs: number
  wireless: boolean
  dpi: Cmd
  stages: Cmd
  poll: Cmd
  battery: Cmd
  charging: Cmd
  firmware: Cmd
  pollTwice: boolean
  lighting: RazerZone[]
}

/** Models this driver handles: DPI as two bytes per axis and a known polling command. */
export const MODELS = new Map<number, RazerModel>(
  (data as unknown as { models: RazerModel[] }).models.filter((m) => m.dpi?.[0] === 'get_dpi_xy' && m.poll).map((m) => [m.pid, m])
)

export function modelName(m: RazerModel) {
  return lookup(RAZER_VID, m.pid)?.name ?? m.id.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function razerEndpoint(list: HID.Device[] = HID.devices()) {
  for (const d of list) {
    const m = d.vendorId === RAZER_VID ? MODELS.get(d.productId) : undefined
    if (m && d.interface === m.interface && d.path) return { path: d.path, model: m, serial: d.serialNumber ?? '' }
  }
  return null
}

// ---------------------------------------------------------------- packets

export const STATUS = { busy: 1, ok: 2, failed: 3, timeout: 4, unsupported: 5 }
export const CMD = {
  firmware: [0x00, 0x81, 2],
  serial: [0x00, 0x82, 0x16],
  poll: [0x00, 0x85, 1],
  poll2: [0x00, 0xc0, 1],
  dpi: [0x04, 0x85, 7],
  stages: [0x04, 0x86, 0x26],
  battery: [0x07, 0x80, 2],
  charging: [0x07, 0x84, 2]
} as const

/** A 90-byte request. */
export function packet(tx: number, cls: number, id: number, size: number, args: number[] = []) {
  const p = new Uint8Array(90)
  p[1] = tx
  p[5] = size
  p[6] = cls
  p[7] = id
  args.forEach((v, i) => (p[8 + i] = v & 0xff))
  let crc = 0
  for (let i = 2; i < 88; i++) crc ^= p[i]
  p[88] = crc
  return p
}

export class Unsupported extends Error {}

/** Anything that answers Razer packets: the real mouse, or the simulator in tests. */
export interface RazerLink {
  exchange(p: Uint8Array): Promise<Uint8Array>
  close(): void
}

export class HidLink implements RazerLink {
  private chain: Promise<unknown> = Promise.resolve()
  private constructor(private dev: HID.HIDAsync, private waitMs: number) {}

  static async open(path: string, waitMs: number) {
    return new HidLink(await HID.HIDAsync.open(path), waitMs)
  }

  exchange(p: Uint8Array) {
    const job = async () => {
      try {
        await this.dev.sendFeatureReport([0, ...p])
        await new Promise((r) => setTimeout(r, this.waitMs))
        const r = Uint8Array.from(await this.dev.getFeatureReport(0, 91))
        return r.length === 91 ? r.subarray(1) : r // hidapi puts the report id first
      } catch {
        throw new Offline('unplugged')
      }
    }
    const next = this.chain.then(job, job)
    this.chain = next.catch(() => {})
    return next
  }

  close() {
    void this.dev.close().catch(() => {})
  }
}

export class RazerTransport {
  constructor(
    private link: RazerLink,
    private tx: number
  ) {}

  /** Send one command; returns all 80 argument bytes (some replies use more than their declared data size). */
  async request(cls: number, id: number, size: number, args: number[] = [], tx = this.tx): Promise<Uint8Array> {
    const req = packet(tx, cls, id, size, args)
    let last = 0
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await this.link.exchange(req)
      if (r.length < 90 || r[6] !== cls || r[7] !== id || r[2] !== 0 || r[3] !== 0) {
        await new Promise((res) => setTimeout(res, 10))
        continue // an answer to something else
      }
      last = r[0]
      if (last === STATUS.ok || last === STATUS.busy) return r.slice(8, 88)
      if (last === STATUS.unsupported) throw new Unsupported(`Command ${cls.toString(16)}:${id.toString(16)} is not supported`)
      if (last === STATUS.timeout) throw new Offline('asleep')
      await new Promise((res) => setTimeout(res, 10))
    }
    if (last === STATUS.failed) throw new Error('The mouse refused the command.')
    throw new Timeout('The mouse did not answer.')
  }

  close() {
    this.link.close()
  }
}

// ---------------------------------------------------------------- codec (pure, unit-tested)

const POLL1: [number, number][] = [[0x08, 125], [0x02, 500], [0x01, 1000]]
const POLL2: [number, number][] = [[0x40, 125], [0x20, 250], [0x10, 500], [0x08, 1000], [0x04, 2000], [0x02, 4000], [0x01, 8000]]
export const MAX_STAGES = 5

export interface Readings {
  /** Brightness of each lighting zone, 0..255 (null: the zone can't report it). */
  brightness?: (number | null)[]
  dpi?: Uint8Array // [storage, x BE16, y BE16, 0, 0]
  stages?: Uint8Array // [storage, active (1-based), count, (n, x BE16, y BE16, 0, 0) × count]
  poll?: Uint8Array // v1: [code]; v2: [arg, code]
}

export const rates = (m: RazerModel) => (m.poll![0] === 'get_polling_rate2' ? POLL2 : POLL1).map(([, hz]) => hz)
const be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]

export function readStages(r: Readings): { active: number; list: { n: number; x: number; y: number }[] } | null {
  const s = r.stages
  if (!s) return null
  const list = []
  for (let i = 0; i < Math.min(s[2], MAX_STAGES); i++) {
    const o = 3 + i * 7
    if (o + 5 > s.length) break
    list.push({ n: s[o], x: be(s, o + 1), y: be(s, o + 3) })
  }
  return { active: s[1], list }
}

export function rateOf(m: RazerModel, r: Readings) {
  const v2 = m.poll![0] === 'get_polling_rate2'
  const code = v2 ? r.poll?.[1] : r.poll?.[0]
  return (v2 ? POLL2 : POLL1).find(([c]) => c === code)?.[1] ?? 1000
}

export function decode(m: RazerModel, r: Readings, saved: LightSetting[] | null = null): ProfileData {
  const st = readStages(r)
  const live = r.dpi ? { x: be(r.dpi, 1), y: be(r.dpi, 3) } : { x: 800, y: 800 }
  const list = st && st.list.length ? st.list : [live]
  const stages: Stage[] = Array.from({ length: st ? MAX_STAGES : 1 }, (_, i) =>
    list[i] ? { x: list[i].x, y: list[i].y, lod: 0 } : { x: 0, y: 0, lod: 0 }
  )
  return {
    sector: 0, fmt: 0, enabled: true, rateHz: rateOf(m, r), rateWiredHz: null, stages,
    defaultStage: st ? Math.min(Math.max(st.active - 1, 0), list.length - 1) : 0, shiftStage: 0,
    hits: null, buttons: [], shiftButtons: [], name: '', angleSnap: false, sleepS: null, offS: null, raw: '',
    ...(m.lighting.length && { lighting: readLighting(m, r, saved) })
  }
}

export type Write = { what: 'stages' | 'dpi' | 'poll' | 'lighting'; cls: number; id: number; size: number; args: number[]; tx?: number }

// ---------------------------------------------------------------- lighting
const ZONE_LABEL: Record<RazerZone['zone'], string> = {
  logo: 'Logo', scroll: 'Scroll wheel', backlight: 'Backlight', left: 'Left side', right: 'Right side', all: 'Whole mouse'
}
const EFFECT: Record<RazerZone['effects'][number], LightEffect> = { none: 'off', static: 'static', breath: 'breathing', spectrum: 'cycle' }

export function razerZones(m: RazerModel): LightZone[] {
  const order: LightEffect[] = ['off', 'static', 'breathing', 'cycle']
  return m.lighting.map((z) => {
    const effects = order.filter((e) => z.effects.some((x) => EFFECT[x] === e))
    return { label: ZONE_LABEL[z.zone], effects, brightness: z.brightness ? effects.filter((e) => e !== 'off') : [], speed: [] }
  })
}

/** What the mouse shows: the effect Hubless last set (Razer mice can't report it) and the brightness they report. */
export function readLighting(m: RazerModel, r: Readings, saved: LightSetting[] | null): LightSetting[] {
  return m.lighting.map((_, i) => {
    const b = r.brightness?.[i]
    const s = saved?.[i]
    return {
      effect: s?.effect ?? 'other',
      color: s?.color ?? '#00ff00',
      brightness: b == null ? (s?.brightness ?? 100) : Math.round((b * 100) / 255),
      speedMs: 0
    }
  })
}

function lightWrites(m: RazerModel, cur: LightSetting[], want: LightSetting[]): Write[] {
  const out: Write[] = []
  m.lighting.forEach((z, i) => {
    const w = want[i]
    const c = cur[i]
    if (!w || w.effect === 'other') return
    const [r, g, b] = rgbOf(w.color)
    const effect = (eff: number, extra: number[]): Write => ({
      what: 'lighting', cls: 0x0f, id: 0x02, size: extra.length + 3, args: [0x01, z.led, eff, ...extra], tx: z.tx
    })
    const can = (e: RazerZone['effects'][number]) => z.effects.includes(e)
    if (w.effect !== c.effect || (w.effect !== 'off' && w.effect !== 'cycle' && w.color.toLowerCase() !== c.color.toLowerCase())) {
      if (w.effect === 'off' && can('none')) out.push(effect(0x00, [0, 0, 0]))
      else if (w.effect === 'static' && can('static')) out.push(effect(0x01, [0, 0, 1, r, g, b]))
      else if (w.effect === 'breathing' && can('breath')) out.push(effect(0x02, [1, 0, 1, r, g, b]))
      else if (w.effect === 'cycle' && can('spectrum')) out.push(effect(0x03, [0, 0, 0]))
      else throw new Error(`The ${ZONE_LABEL[z.zone].toLowerCase()} can't do that effect.`)
    }
    const level = Math.round((Math.max(0, Math.min(100, w.brightness)) * 255) / 100)
    if (z.brightness && w.effect !== 'off' && (w.brightness !== c.brightness || c.effect === 'off' || c.effect === 'other'))
      out.push({ what: 'lighting', cls: 0x0f, id: 0x04, size: 3, args: [0x01, z.led, level], tx: z.tx })
  })
  return out
}

const rgbOf = (c: string) => {
  const n = parseInt(/^#?([0-9a-f]{6})$/i.exec(c)?.[1] ?? 'ffffff', 16)
  return [n >> 16, (n >> 8) & 0xff, n & 0xff]
}

/** The writes that turn the current readings into profile p, given the DPI range. */
export function plan(m: RazerModel, r: Readings, p: ProfileData, [lo, hi, step]: [number, number, number], saved: LightSetting[] | null = null): Write[] {
  const out: Write[] = []
  const cur = decode(m, r, saved)
  const snap = (v: number) => Math.min(hi, Math.max(lo, Math.round(v / step) * step))
  const want = p.stages.filter((s) => s.x > 0).slice(0, r.stages ? MAX_STAGES : 1).map((s) => ({ x: snap(s.x), y: snap(s.y || s.x) }))
  if (!want.length) throw new Error('Keep at least one DPI stage.')
  const have = cur.stages.filter((s) => s.x > 0)
  const active = Math.min(Math.max(p.defaultStage, 0), want.length - 1)
  const st = readStages(r)
  if (st) {
    const changed = want.length !== have.length || want.some((s, i) => s.x !== have[i].x || s.y !== have[i].y) || active !== cur.defaultStage
    if (changed) {
      // Number the stages the way this mouse numbers them (from 1 in what Razer mice report; from 0 if this one does).
      const base = st.list[0]?.n === 0 ? 0 : 1
      const args = [r.stages![0], active + 1, want.length, ...want.flatMap((s, i) => [i + base, s.x >> 8, s.x & 0xff, s.y >> 8, s.y & 0xff, 0, 0])]
      out.push({ what: 'stages', cls: 0x04, id: 0x06, size: 0x26, args })
    }
  }
  // The live DPI follows the active stage.
  const target = want[active]
  const live = r.dpi ? { x: be(r.dpi, 1), y: be(r.dpi, 3) } : null
  if (!live || live.x !== target.x || live.y !== target.y)
    out.push({ what: 'dpi', cls: 0x04, id: 0x05, size: 7, args: [0x01, target.x >> 8, target.x & 0xff, target.y >> 8, target.y & 0xff, 0, 0] })

  if (p.rateHz !== cur.rateHz) {
    const v2 = m.poll![0] === 'get_polling_rate2'
    const code = (v2 ? POLL2 : POLL1).find(([, hz]) => hz === p.rateHz)?.[0]
    if (code === undefined) throw new Error(`This mouse can't poll at ${p.rateHz} Hz.`)
    if (v2) {
      out.push({ what: 'poll', cls: 0x00, id: 0x40, size: 2, args: [0x00, code] })
      if (m.pollTwice) out.push({ what: 'poll', cls: 0x00, id: 0x40, size: 2, args: [0x01, code] })
    } else out.push({ what: 'poll', cls: 0x00, id: 0x05, size: 1, args: [code] })
  }
  if (p.lighting && cur.lighting) out.push(...lightWrites(m, cur.lighting, p.lighting))
  return out
}

/** Writes that put back a backup taken with snapshot(). */
export function restorePlan(m: RazerModel, mem: Map<number, Uint8Array>): Write[] {
  const r: Readings = { dpi: mem.get(0x0485), stages: mem.get(0x0486), poll: mem.get(0x0085) ?? mem.get(0x00c0) }
  if (!r.dpi || !r.poll) throw new Error('That backup is not a Razer mouse configuration.')
  const out: Write[] = []
  if (r.stages) out.push({ what: 'stages', cls: 0x04, id: 0x06, size: 0x26, args: Array.from(r.stages.slice(0, 3 + Math.min(r.stages[2], MAX_STAGES) * 7)) })
  out.push({ what: 'dpi', cls: 0x04, id: 0x05, size: 7, args: [0x01, ...Array.from(r.dpi.slice(1, 5)), 0, 0] })
  if (m.poll![0] === 'get_polling_rate2') {
    out.push({ what: 'poll', cls: 0x00, id: 0x40, size: 2, args: [0x00, r.poll[1]] })
    if (m.pollTwice) out.push({ what: 'poll', cls: 0x00, id: 0x40, size: 2, args: [0x01, r.poll[1]] })
  } else out.push({ what: 'poll', cls: 0x00, id: 0x05, size: 1, args: [r.poll[0]] })
  return out
}

// ---------------------------------------------------------------- session

export class RazerSession {
  readings: Readings = {}
  fw = ''
  battery: Battery | null = null
  private backedUp = false

  constructor(
    public t: RazerTransport,
    public model: RazerModel,
    private usbSerial: string
  ) {}

  get name() {
    return modelName(this.model)
  }

  get backupKey() {
    return this.usbSerial || `razer-${this.model.pid.toString(16).padStart(4, '0')}`
  }

  get dpiRange(): [number, number, number] {
    return [100, lookup(RAZER_VID, this.model.pid)?.maxDpi ?? 30000, 50]
  }

  private async readAll(): Promise<Readings> {
    const m = this.model
    const r: Readings = {}
    r.dpi = await this.t.request(...CMD.dpi, [m.dpi![1] === 'VARSTORE' ? 0x01 : 0x00])
    if (m.stages) r.stages = await this.t.request(...CMD.stages, [0x01])
    const [pc, pi, ps] = m.poll![0] === 'get_polling_rate2' ? CMD.poll2 : CMD.poll
    r.poll = await this.t.request(pc, pi, ps)
    // Refuse to go on if the answers don't look like this protocol; nothing has been written yet.
    const x = be(r.dpi, 1)
    if (x < 50 || x > 50000) throw new Error('The mouse answered in an unexpected format. Hubless left it unchanged.')
    const st = readStages(r)
    if (st && (st.list.length === 0 || st.list.some((s) => s.x < 50 || s.x > 50000)))
      throw new Error('The mouse reported DPI stages in an unexpected format. Hubless left it unchanged.')
    r.brightness = []
    for (const z of m.lighting) {
      let level: number | null = null
      if (z.brightness) {
        try {
          level = (await this.t.request(0x0f, 0x84, 3, [0x01, z.led], z.tx))[2]
        } catch (e) {
          if (e instanceof Offline) throw e // asleep or unplugged; anything else: this zone just can't say
        }
      }
      r.brightness.push(level)
    }
    return r
  }

  /** The lighting Hubless last set on this mouse. */
  private get saved() {
    return this.model.lighting.length ? storage.savedLighting(this.backupKey) : null
  }

  async load() {
    if (this.model.firmware) {
      const f = await this.t.request(...CMD.firmware).catch(() => null)
      if (f) this.fw = `${f[0]}.${f[1]}`
    }
    this.readings = await this.readAll()
    await this.refreshBattery()
  }

  async refreshBattery() {
    if (!this.model.battery) return
    try {
      const b = await this.t.request(...CMD.battery)
      const c = this.model.charging ? await this.t.request(...CMD.charging) : null
      const charging = !!c?.[1]
      this.battery = { percent: Math.round((b[1] * 100) / 255), status: charging ? 'charging' : '', charging }
    } catch (e) {
      if (e instanceof Unsupported) this.battery = null
      else throw e
    }
  }

  async ping() {
    if (this.model.battery) await this.refreshBattery()
    else await this.t.request(...CMD.dpi, [this.model.dpi![1] === 'VARSTORE' ? 0x01 : 0x00])
  }

  state(): MouseState {
    const m = this.model
    return {
      profiles: [decode(m, this.readings, this.saved)], activeSector: 0, stage: -1, rates: rates(m), lighting: razerZones(m),
      grid: { values: [], ranges: [this.dpiRange] }, hitsCaps: null, hasFactory: false,
      firmware: this.fw, serial: this.usbSerial, protocol: 'Razer',
      onboard: { fmt: 0, profiles: 1, buttons: 0, sectorSize: 0 }, features: [],
      limits: {
        stages: this.readings.stages ? MAX_STAGES : 1, startStage: !!this.readings.stages, shiftStage: false, profiles: false,
        functions: [], buttons: false, angleSnap: false
      }
    }
  }

  private snapshot() {
    const r = this.readings
    const mem = new Map<number, Uint8Array>()
    if (r.dpi) mem.set(0x0485, r.dpi)
    if (r.stages) mem.set(0x0486, r.stages)
    if (r.poll) mem.set(this.model.poll![0] === 'get_polling_rate2' ? 0x00c0 : 0x0085, r.poll)
    return mem
  }

  private async ensureBackup() {
    if (this.backedUp) return
    storage.saveBackup(this.backupKey, this.name, 0, this.snapshot(), 'before-changes')
    this.backedUp = true
  }

  async backup() {
    this.readings = await this.readAll()
    return storage.saveBackup(this.backupKey, this.name, 0, this.snapshot(), 'manual')
  }

  private async apply(writes: Write[]) {
    if (!writes.length) return
    await this.ensureBackup()
    for (const w of writes) await this.t.request(w.cls, w.id, w.size, w.args, w.tx)
    const back = await this.readAll()
    const before = this.readings
    this.readings = back
    // Every change must read back as written.
    for (const w of writes) {
      if (w.what === 'lighting') {
        // Effects can't be read back; brightness can.
        const i = this.model.lighting.findIndex((z) => z.led === w.args[1])
        const got = back.brightness?.[i]
        if (w.id === 0x04 && got != null && Math.abs(got - w.args[2]) > 1) {
          this.readings = back
          throw new Error('The mouse did not keep the brightness change.')
        }
        continue
      }
      const ok =
        w.what === 'dpi'
          ? be(back.dpi!, 1) === ((w.args[1] << 8) | w.args[2]) && be(back.dpi!, 3) === ((w.args[3] << 8) | w.args[4])
          : w.what === 'stages'
            ? JSON.stringify(readStages(back)!.list.map((s) => [s.x, s.y])) ===
                JSON.stringify(readStages({ stages: Uint8Array.from(w.args) })!.list.map((s) => [s.x, s.y])) && readStages(back)!.active === w.args[1]
            : rateOf(this.model, back) === rateOf(this.model, { poll: Uint8Array.from(this.model.poll![0] === 'get_polling_rate2' ? [0, w.args[1]] : [w.args[0]]) })
      if (!ok) {
        this.readings = back.dpi ? back : before
        throw new Error(`The mouse did not keep the ${w.what === 'poll' ? 'polling rate' : w.what === 'dpi' ? 'DPI' : 'DPI stages'} change.`)
      }
    }
  }

  async saveProfile(p: ProfileData) {
    const saved = this.saved
    const writes = plan(this.model, this.readings, p, this.dpiRange, saved)
    await this.apply(writes)
    if (p.lighting && writes.some((w) => w.what === 'lighting')) {
      const cur = readLighting(this.model, this.readings, saved)
      storage.saveLighting(this.backupKey, p.lighting.map((l, i) => (l.effect === 'other' ? cur[i] : l)))
    }
  }

  async restore(mem: Map<number, Uint8Array>) {
    await this.apply(restorePlan(this.model, mem))
  }
}

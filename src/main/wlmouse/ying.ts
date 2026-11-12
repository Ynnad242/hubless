// WLmouse driver (Ying, wired 36a7:a875). The mouse talks over 64-byte feature reports (report id 0) on its vendor
// interface (usage page 0xFFFF). Every request is
//   [status 0x00, 0, target, length, page, command, args…]
// and the mouse answers in the same report with status 0xa1 (ok), 0xa2 (unsupported) or 0xa0/0xa3 (busy, ask again),
// echoing target/length/page/command, then the payload. Reads have bit 7 set in the command; the matching write is
// the same command without it and takes exactly the payload the read returned ([profile, values…]), which also makes
// backups simple: a backup is the read replies, a restore writes them back.
// Protocol facts from the OpenMouse project's notes on WLmouse/CompX firmware; this implementation is Hubless's own.
import HID from 'node-hid'
import type { MouseExtras, MouseState, ProfileData, Stage } from '@shared/types'
import { Offline, Timeout } from '../logitech/hidpp'
import * as storage from '../storage'

export const WL_VID = 0x36a7
/** Models whose protocol has been checked on hardware. */
export const MODELS: Record<number, string> = { 0xa875: 'Ying' }

const STATUS = { ok: 0xa1, unsupported: 0xa2 }
const MOUSE = 0x02 // target: the mouse itself (0x00 would be a receiver)
const PAGE = { device: 0x00, profile: 0x01 }
const MAX_STAGES = 6
export const DPI_RANGE: [number, number, number] = [50, 30000, 50]
/** Polling-rate codes. 1000 Hz has two (0x01 and 0x10); both are read, 0x01 is written. */
const RATE_CODES: [number, number][] = [
  [0x08, 125],
  [0x04, 250],
  [0x02, 500],
  [0x01, 1000],
  [0x10, 1000],
  [0x20, 2000],
  [0x40, 4000],
  [0x80, 8000]
]
/** On the cable the Ying refuses 2000–8000 Hz (checked on hardware; those are for its 8K receiver). */
export const RATES = [125, 250, 500, 1000]
/** Lift-off distance in mm ↔ code (0x80 | tenths of a mm, or whole mm). */
const LIFT_OFF: [number, number][] = [
  [0.7, 0x87],
  [1, 0x01],
  [2, 0x02]
]
const DEBOUNCE_MAX = 15

/** The settings Hubless reads and writes, as [page, read command]. */
export const SETTINGS = {
  dpi: [PAGE.profile, 0x81],
  stage: [PAGE.profile, 0x82],
  rate: [PAGE.profile, 0x80],
  angleSnap: [PAGE.profile, 0x84],
  liftOff: [PAGE.profile, 0x88],
  motionSync: [PAGE.profile, 0x89],
  ripple: [PAGE.profile, 0x8a],
  debounce: [PAGE.device, 0x88]
} as const
type Setting = keyof typeof SETTINGS
const key = ([page, cmd]: readonly [number, number]) => (page << 8) | cmd

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function wlmouseEndpoint(list: HID.Device[] = HID.devices()) {
  // The config report lives on interface 2 (usage page 0xFFFF, no report id). Interface 1 also has a 0xFFFF
  // collection (report 5), which only echoes requests back.
  const d = list.find((x) => x.vendorId === WL_VID && MODELS[x.productId] && x.usagePage === 0xffff && x.interface === 2 && x.path)
  return d ? { path: d.path!, productId: d.productId, serial: d.serialNumber ?? '' } : null
}

export class UnsupportedCommand extends Error {}

export class WlTransport {
  private chain: Promise<unknown> = Promise.resolve()
  private constructor(private dev: HID.HIDAsync) {}

  static async open(path: string) {
    return new WlTransport(await HID.HIDAsync.open(path))
  }

  /** Send one request and return its payload. One request at a time: replies come back on the same report. */
  request(page: number, command: number, args: number[] = [], length = args.length): Promise<Uint8Array> {
    const job = async () => {
      const out = new Array(65).fill(0) // report id 0 + 64 bytes
      out[3] = MOUSE
      out[4] = length
      out[5] = page
      out[6] = command
      args.forEach((v, i) => (out[7 + i] = v & 0xff))
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await this.dev.sendFeatureReport(out)
        } catch {
          throw new Offline('unplugged')
        }
        await sleep(attempt < 3 ? 30 : 200)
        let r: Uint8Array
        try {
          r = Uint8Array.from(await this.dev.getFeatureReport(0, 65))
        } catch {
          throw new Offline('unplugged')
        }
        // hidapi puts the report id first on Linux; allow for both framings.
        for (const o of [1, 0]) {
          if (r[o + 4] !== page || r[o + 5] !== command) continue
          if (r[o] === STATUS.unsupported) throw new UnsupportedCommand(`Command ${page}:${command.toString(16)} is not supported`)
          if (r[o] !== STATUS.ok) continue
          return r.slice(o + 6, o + 6 + Math.min(r[o + 3], 58))
        }
      }
      throw new Timeout('The mouse did not answer.')
    }
    const next = this.chain.then(job, job)
    this.chain = next.catch(() => {})
    return next
  }

  close() {
    void this.dev.close().catch(() => {})
  }
}

// ---------------------------------------------------------------- codec (pure, unit-tested)

export type Readings = Partial<Record<Setting, Uint8Array>>

export const liftOffMm = (code: number) => (code & 0x80 ? (code & 0x7f) / 10 : code)
export const rateHz = (code: number) => RATE_CODES.find(([c]) => c === code)?.[1] ?? 1000

/** Readings → the profile shape the mouse pages edit. */
export function decode(r: Readings): ProfileData {
  const dpi = r.dpi ?? new Uint8Array(2)
  const count = Math.min(dpi[1] || 1, MAX_STAGES)
  const stages: Stage[] = Array.from({ length: MAX_STAGES }, (_, i) => {
    if (i >= count) return { x: 0, y: 0, lod: 0 }
    const o = 2 + i * 4
    return {
      x: (dpi[o] << 8) | dpi[o + 1],
      y: (dpi[o + 2] << 8) | dpi[o + 3],
      lod: 0
    }
  })
  const flag = (s: Setting) => (r[s] ? r[s]![1] === 1 : false)
  const extras: MouseExtras = {
    liftOffMm: r.liftOff ? liftOffMm(r.liftOff[1]) : 1,
    debounceMs: r.debounce ? r.debounce[1] : 0,
    motionSync: flag('motionSync'),
    rippleControl: flag('ripple')
  }
  return {
    sector: 0,
    fmt: 0,
    enabled: true,
    rateHz: r.rate ? rateHz(r.rate[1]) : 1000,
    rateWiredHz: null,
    stages,
    defaultStage: Math.min(Math.max((r.stage?.[1] ?? 1) - 1, 0), count - 1),
    shiftStage: 0,
    hits: null,
    buttons: [],
    shiftButtons: [],
    name: '',
    angleSnap: flag('angleSnap'),
    sleepS: null,
    offS: null,
    raw: '',
    extras
  }
}

/** The writes (as [page, write command, args]) that turn the current readings into profile p. */
export function plan(r: Readings, p: ProfileData): [Setting, number, number, number[]][] {
  const profile = r.dpi?.[0] || 1
  const cur = decode(r)
  const out: [Setting, number, number, number[]][] = []
  const w = (s: Setting, args: number[]) => out.push([s, SETTINGS[s][0], SETTINGS[s][1] & 0x7f, [profile, ...args]])

  const [lo, hi, step] = DPI_RANGE
  const on = p.stages.filter((s) => s.x > 0).slice(0, MAX_STAGES)
  if (!on.length) throw new Error('Keep at least one DPI stage.')
  const snap = (v: number) => Math.min(hi, Math.max(lo, Math.round(v / step) * step))
  const want = on.map((s) => ({ x: snap(s.x), y: snap(s.y || s.x) }))
  const have = cur.stages.filter((s) => s.x > 0)
  if (want.length !== have.length || want.some((s, i) => s.x !== have[i].x || s.y !== have[i].y))
    w('dpi', [want.length, ...want.flatMap((s) => [s.x >> 8, s.x & 0xff, s.y >> 8, s.y & 0xff])])
  const stage = Math.min(Math.max(p.defaultStage, 0), want.length - 1)
  if (stage !== cur.defaultStage || want.length !== have.length) w('stage', [stage + 1])

  if (p.rateHz !== cur.rateHz) {
    // 1000 Hz has two codes; the Ying itself reports 0x01, so that's the one written.
    const code = RATE_CODES.find(([, hz]) => hz === p.rateHz)?.[0]
    if (code === undefined) throw new Error(`The mouse can't poll at ${p.rateHz} Hz.`)
    w('rate', [code])
  }
  if (p.angleSnap !== cur.angleSnap) w('angleSnap', [p.angleSnap ? 1 : 0])
  const x = p.extras
  if (x) {
    if (x.liftOffMm !== cur.extras!.liftOffMm) {
      const code = LIFT_OFF.find(([mm]) => mm === x.liftOffMm)?.[1]
      if (code === undefined) throw new Error(`The mouse has no ${x.liftOffMm} mm lift-off setting.`)
      w('liftOff', [code])
    }
    if (x.motionSync !== cur.extras!.motionSync) w('motionSync', [x.motionSync ? 1 : 0])
    if (x.rippleControl !== cur.extras!.rippleControl) w('ripple', [x.rippleControl ? 1 : 0])
    const ms = Math.max(0, Math.min(DEBOUNCE_MAX, Math.round(x.debounceMs)))
    if (ms !== cur.extras!.debounceMs) w('debounce', [ms])
  }
  return out
}

// ---------------------------------------------------------------- session

export class WlSession {
  readings: Readings = {}
  fw = ''
  private backedUp = false

  constructor(
    public t: WlTransport,
    public name: string,
    public productId: number,
    private usbSerial: string
  ) {}

  get backupKey() {
    return this.usbSerial || `wlmouse-${this.productId.toString(16)}`
  }

  private async profile() {
    const r = await this.t.request(PAGE.device, 0x85, [], 1)
    return Math.max(1, r[0])
  }

  private async read(s: Setting, profile: number) {
    const [page, cmd] = SETTINGS[s]
    return this.t.request(page, cmd, s === 'dpi' ? [profile, MAX_STAGES] : [profile], s === 'dpi' ? 0x0a : 0x02)
  }

  /** Read every setting of the active onboard profile. Settings the model doesn't have are left out. */
  private async readAll() {
    const profile = await this.profile()
    const r: Readings = {}
    for (const s of Object.keys(SETTINGS) as Setting[]) {
      try {
        r[s] = await this.read(s, profile)
      } catch (e) {
        if (!(e instanceof UnsupportedCommand)) throw e
      }
    }
    if (!r.dpi || !r.rate) throw new Error('The mouse did not report its DPI and polling rate.')
    return r
  }

  async load() {
    const f = await this.t.request(PAGE.device, 0x81, [], 0x10)
    this.fw = f.length >= 4 ? `${f[2]}.${f[3]}` : ''
    this.readings = await this.readAll()
  }

  ping() {
    return this.profile()
  }

  state(): MouseState {
    const r = this.readings
    return {
      profiles: [decode(r)],
      activeSector: 0,
      stage: -1,
      rates: RATES,
      grid: { values: [], ranges: [DPI_RANGE] },
      hitsCaps: null,
      hasFactory: false,
      firmware: this.fw,
      serial: this.usbSerial,
      protocol: 'WLmouse',
      onboard: { fmt: 0, profiles: 1, buttons: 0, sectorSize: 0 },
      features: [],
      limits: {
        stages: MAX_STAGES,
        startStage: true,
        shiftStage: false,
        profiles: false,
        functions: [],
        buttons: false,
        liftOff: r.liftOff ? LIFT_OFF.map(([mm]) => mm) : [],
        debounceMax: r.debounce ? DEBOUNCE_MAX : 0,
        filters: false,
        motionSync: !!r.motionSync,
        rippleControl: !!r.ripple
      }
    }
  }

  private snapshot() {
    return new Map(Object.entries(this.readings).map(([s, v]) => [key(SETTINGS[s as Setting]), v]))
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

  /** Write each change, then read everything back and make sure the mouse kept it. */
  private async apply(writes: [Setting, number, number, number[]][]) {
    for (const [, page, cmd, args] of writes) await this.t.request(page, cmd, args)
    const back = await this.readAll()
    for (const [s, , , args] of writes) {
      const got = back[s]
      if (!got || args.some((v, i) => got[i] !== (v & 0xff))) throw new Error(`The mouse did not keep the ${LABEL[s]} change. Other settings were saved.`)
    }
    this.readings = back
  }

  async saveProfile(p: ProfileData) {
    const writes = plan(this.readings, p)
    if (!writes.length) return
    await this.ensureBackup()
    await this.apply(writes)
  }

  async restore(mem: Map<number, Uint8Array>) {
    const writes: [Setting, number, number, number[]][] = []
    for (const s of Object.keys(SETTINGS) as Setting[]) {
      const v = mem.get(key(SETTINGS[s]))
      // Only the meaningful bytes: [profile, count, 4 per stage] for DPI, [profile, value] for the rest.
      if (v) writes.push([s, SETTINGS[s][0], SETTINGS[s][1] & 0x7f, Array.from(v.slice(0, s === 'dpi' ? 2 + Math.min(v[1], MAX_STAGES) * 4 : 2))])
    }
    if (!writes.some(([s]) => s === 'dpi')) throw new Error('That backup is not a WLmouse configuration.')
    // The DPI table goes first: the active stage must exist when it is written.
    await this.ensureBackup()
    await this.apply(writes)
  }
}

const LABEL: Record<Setting, string> = {
  dpi: 'DPI',
  stage: 'DPI stage',
  rate: 'polling rate',
  angleSnap: 'angle snapping',
  liftOff: 'lift-off distance',
  motionSync: 'motion sync',
  ripple: 'ripple control',
  debounce: 'debounce'
}

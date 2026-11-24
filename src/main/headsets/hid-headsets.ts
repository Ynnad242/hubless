// Wireless headsets from SteelSeries and HyperX, over their own HID commands. The commands and product ids follow
// HeadsetControl (github.com/Sapd/HeadsetControl, lib/devices/*.hpp); no code is copied, only the facts.
//
// Most of these headsets can't report their settings back, only take new ones. So the page shows what Hubless last
// set (kept on this PC), and nothing is sent until the user changes something. Battery is read live.
import type HID from 'node-hid'
import type { DeviceKind, DeviceSetting, PeripheralState, SettingValue } from '@shared/types'
import { checkValue, type PeripheralSession } from '../peripheral'

/** Raw HID access: first byte of a write is the report id (0 when the device has none). */
export interface HidIo {
  write(data: number[]): Promise<void>
  /** one input report, without a report id for devices that have none; empty on timeout */
  read(timeoutMs: number): Promise<number[]>
  close(): void
}

type Packet = number[]
interface SettingSpec extends Omit<DeviceSetting, 'value'> {
  initial: number | number[]
  /** packets that apply a value */
  write: (v: number | number[], pid: number) => Packet[]
}

export interface HeadsetSpec {
  vendor: string
  name: string
  vid: number
  pids: number[]
  interface: number
  usagePage?: number
  /** packets are padded with zeros to this length (report id included) */
  size: number
  /** sent after every change, if the headset needs it to keep the setting */
  save?: (pid: number) => Packet | null
  battery: (io: HidIo, pid: number) => Promise<{ percent: number; charging: boolean } | 'off' | null>
  settings: SettingSpec[]
}

const pad = (p: Packet, size: number) => [...p, ...new Array(Math.max(0, size - p.length)).fill(0)].slice(0, size)

async function ask(io: HidIo, p: Packet, size: number, timeoutMs = 1000) {
  await io.write(pad(p, size))
  return io.read(timeoutMs)
}

const AUTO_OFF: { value: number; label: string }[] = [
  { value: 0, label: 'Never' }, { value: 5, label: 'After 5 minutes' }, { value: 10, label: 'After 10 minutes' },
  { value: 15, label: 'After 15 minutes' }, { value: 30, label: 'After 30 minutes' }, { value: 60, label: 'After 1 hour' }
]

// ---------------------------------------------------------------- SteelSeries Arctis Nova 7 family
// Interface 3 (usage page 0xFFC0), 64-byte packets without a report id. Status [00 b0] → [.., .., battery, state],
// state 0 = headset off, 1/2 = charging. Older firmware reports battery as 0..4.
const NOVA7_DISCRETE = [0x2202, 0x2206, 0x220a, 0x223a, 0x227a, 0x22a4]
const NOVA7: HeadsetSpec = {
  vendor: 'SteelSeries', name: 'Arctis Nova 7', vid: 0x1038, interface: 3, usagePage: 0xffc0, size: 64,
  pids: [0x2202, 0x22a1, 0x227e, 0x2206, 0x2258, 0x229e, 0x22ad, 0x223a, 0x22a9, 0x227a, 0x22a4, 0x22a5],
  battery: async (io, pid) => {
    const r = await ask(io, [0x00, 0xb0], 64)
    if (r.length < 4) return null
    if (r[3] === 0) return 'off'
    const level = NOVA7_DISCRETE.includes(pid) ? Math.min(4, r[2]) * 25 : Math.min(100, r[2])
    return { percent: level, charging: r[3] === 1 || r[3] === 2 }
  },
  settings: [
    {
      key: 'sidetone', label: 'Sidetone', hint: 'Hear your own voice in the headset while you talk', group: 'Microphone', kind: 'choice', initial: 0,
      options: [{ value: 0, label: 'Off' }, { value: 1, label: 'Low' }, { value: 2, label: 'Medium' }, { value: 3, label: 'High' }],
      // the Gen 2 needs a save command to keep it
      write: (v, pid) => [[0x00, 0x39, v as number], ...(pid === 0x227e ? [[0x00, 0x09]] : [])]
    },
    { key: 'autoOff', label: 'Turn off when idle', group: 'Power', kind: 'choice', initial: 0, options: AUTO_OFF, write: (v) => [[0x00, 0xa3, v as number]] },
    {
      key: 'eq', label: 'Equalizer', group: 'Sound', kind: 'eq', initial: new Array(10).fill(0), min: -10, max: 10, step: 1, unit: ' dB',
      // SteelSeries GG's 10 bands, as HeadsetControl lists them for the Nova 5
      bands: [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((freq) => ({ freq, gain: 0 })),
      write: (v) => [[0x00, 0x33, ...(v as number[]).map((g) => 20 + g), 0x00]]
    }
  ]
}

// ---------------------------------------------------------------- SteelSeries Arctis 7 / Pro (2019 and earlier)
// Interface 5 (usage page 0xFF43), 31-byte packets with report id 6, each change followed by a save [06 09].
const ARCTIS7: HeadsetSpec = {
  vendor: 'SteelSeries', name: 'Arctis 7', vid: 0x1038, interface: 5, usagePage: 0xff43, size: 31, pids: [0x1260, 0x12ad, 0x1252, 0x1280],
  save: () => [0x06, 0x09],
  battery: async (io) => {
    const r = await ask(io, [0x06, 0x18], 31)
    return r.length > 2 ? { percent: Math.min(100, r[2]), charging: false } : null
  },
  settings: [
    {
      key: 'sidetone', label: 'Sidetone', hint: 'Hear your own voice in the headset while you talk', group: 'Microphone', kind: 'slider', initial: 0, min: 0, max: 18, step: 1, zeroLabel: 'Off',
      write: (v) => [(v as number) > 0 ? [0x06, 0x35, 0x01, 0x00, v as number] : [0x06, 0x35]]
    },
    { key: 'autoOff', label: 'Turn off when idle', group: 'Power', kind: 'choice', initial: 0, options: AUTO_OFF, write: (v) => [[0x06, 0x51, v as number]] }
  ]
}

// ---------------------------------------------------------------- HyperX Cloud Alpha Wireless
// 31-byte packets [21 bb <command> <value>]; replies carry the value in byte 3.
const CLOUD_ALPHA: HeadsetSpec = {
  vendor: 'HyperX', name: 'Cloud Alpha Wireless', vid: 0x03f0, pids: [0x098d], interface: 0, size: 31,
  battery: async (io) => {
    const conn = await ask(io, [0x21, 0xbb, 0x03], 31, 2000)
    if (conn.length < 4) return null
    if (conn[3] === 0x01) return 'off'
    const charge = await ask(io, [0x21, 0xbb, 0x0c], 31, 2000)
    const level = await ask(io, [0x21, 0xbb, 0x0b], 31, 2000)
    if (level.length < 4) return null
    return { percent: Math.min(100, level[3]), charging: charge[3] === 0x01 }
  },
  settings: [
    {
      key: 'sidetone', label: 'Sidetone', hint: 'Hear your own voice in the headset while you talk', group: 'Microphone', kind: 'slider', initial: 0, min: 0, max: 100, step: 1, unit: '%', zeroLabel: 'Off',
      write: (v) => ((v as number) === 0 ? [[0x21, 0xbb, 0x10, 0x00]] : [[0x21, 0xbb, 0x10, 0x01], [0x21, 0xbb, 0x11, Math.round(((v as number) * 128) / 100)]])
    },
    { key: 'autoOff', label: 'Turn off when idle', group: 'Power', kind: 'choice', initial: 0, options: AUTO_OFF, write: (v) => [[0x21, 0xbb, 0x12, v as number]] },
    { key: 'voicePrompts', label: 'Voice prompts', hint: 'The headset announces power, mute and battery', group: 'Power', kind: 'switch', initial: 1, write: (v) => [[0x21, 0xbb, 0x13, v ? 1 : 0]] }
  ]
}

export const HEADSETS: HeadsetSpec[] = [NOVA7, ARCTIS7, CLOUD_ALPHA]

/** The HID interface a supported headset is driven through. */
export function headsetEndpoints(list: HID.Device[]) {
  const out: { path: string; spec: HeadsetSpec; pid: number; serial: string }[] = []
  const seen = new Set<string>()
  for (const spec of HEADSETS)
    for (const d of list) {
      if (d.vendorId !== spec.vid || !spec.pids.includes(d.productId) || !d.path || seen.has(`${d.vendorId}:${d.productId}`)) continue
      if (d.interface !== spec.interface || (spec.usagePage && d.usagePage !== spec.usagePage)) continue
      seen.add(`${d.vendorId}:${d.productId}`)
      out.push({ path: d.path, spec, pid: d.productId, serial: d.serialNumber ?? '' })
    }
  return out
}

export interface SettingsStore {
  load(key: string): Record<string, number | number[]> | null
  save(key: string, values: Record<string, number | number[]>): void
}

/** A real headset through node-hid: one request at a time, reads with a timeout. */
export class NodeHidIo implements HidIo {
  private chain: Promise<unknown> = Promise.resolve()
  private constructor(private dev: HID.HIDAsync) {}
  static async open(path: string) {
    const { default: H } = await import('node-hid')
    return new NodeHidIo(await H.HIDAsync.open(path))
  }
  private serial<T>(job: () => Promise<T>) {
    const next = this.chain.then(job, job)
    this.chain = next.catch(() => {})
    return next
  }
  write(data: number[]) {
    return this.serial(async () => void (await this.dev.write(data)))
  }
  read(timeoutMs: number) {
    return this.serial(async () => [...((await this.dev.read(timeoutMs)) ?? [])])
  }
  close() {
    void this.dev.close().catch(() => {})
  }
}

export class HidHeadset implements PeripheralSession {
  kind: DeviceKind = 'headset'
  settings: DeviceSetting[] = []
  battery: number | null = null
  charging = false
  off = false

  constructor(
    public io: HidIo,
    public spec: HeadsetSpec,
    public pid: number,
    private serial: string,
    private store: SettingsStore
  ) {}

  get name() {
    return this.spec.name
  }
  /** the manager closes devices through `t` */
  get t() {
    return this.io
  }
  private get key() {
    return `${this.spec.vid.toString(16)}:${this.pid.toString(16)}:${this.serial}`
  }

  close() {
    this.io.close()
  }

  async load() {
    const saved = this.store.load(this.key) ?? {}
    this.settings = this.spec.settings.map(({ initial, write: _w, ...s }) => {
      const v = saved[s.key] ?? initial
      return Array.isArray(v) ? { ...s, value: 0, bands: s.bands!.map((b, i) => ({ ...b, gain: v[i] ?? 0 })) } : { ...s, value: v }
    })
    await this.refresh()
  }

  async refresh() {
    const b = await this.spec.battery(this.io, this.pid)
    this.off = b === 'off'
    if (b && b !== 'off') {
      this.battery = b.percent
      this.charging = b.charging
    }
  }

  state(): PeripheralState {
    return {
      settings: this.settings, battery: this.off ? null : this.battery, charging: this.charging,
      note: 'This headset can’t report its settings back, so they show what Hubless last set.'
    }
  }

  async set(key: string, value: SettingValue) {
    const s = this.settings.find((x) => x.key === key)
    const v = checkValue(s, value)
    const spec = this.spec.settings.find((x) => x.key === key)!
    for (const p of spec.write(v, this.pid)) await this.io.write(pad(p, this.spec.size))
    const save = this.spec.save?.(this.pid)
    if (save) await this.io.write(pad(save, this.spec.size))
    if (Array.isArray(v)) s!.bands = s!.bands!.map((b, i) => ({ ...b, gain: v[i] }))
    else s!.value = v
    const all = Object.fromEntries(this.settings.map((x) => [x.key, x.kind === 'eq' ? x.bands!.map((b) => b.gain) : x.value]))
    this.store.save(this.key, all)
  }
}

/** A simulated Arctis Nova 7 base station for demo mode: answers the status request, takes every setting. */
export class SimNova7Io implements HidIo {
  writes: number[][] = []
  private last: number[] = []
  async write(d: number[]) {
    this.writes.push(d)
    this.last = d
  }
  async read() {
    return this.last[1] === 0xb0 ? [0xb0, 0, 82, 3, 100, 100] : []
  }
  close() {}
}

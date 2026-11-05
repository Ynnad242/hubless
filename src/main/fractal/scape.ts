// Fractal Design Scape wireless headset, through its 2.4 GHz dongle.
// 63-byte output reports on report id 2; replies echo the first two bytes. 0x11… = dongle, 0xF1… = relayed to the
// headset (times out while it's off). Verified on dongle fw 3.33 / headset fw 3.48. Protocol facts documented by
// github.com/charlietran/scapectl.
import HID from 'node-hid'
import { randomUUID } from 'node:crypto'
import { EQ_TYPES, biquad } from '@shared/eq'
import type { EqBand, HeadsetPatch, HeadsetState } from '@shared/types'
import { Offline, Timeout, sleep } from '../logitech/hidpp'

export const FRACTAL = 0x36bc
const FILTERS = EQ_TYPES
// DSP drivers and their sample rates (fitted against the headset's stored coefficients).
const DRIVERS: [number, number][] = [[1, 44000], [2, 48000], [4, 96000]]
const ALL_RATES = 7
const MAX_BANDS = 5
const COMMIT = { live: 1, save: 2, erase: 3 } as const
const f32 = (v: number) => {
  const b = Buffer.alloc(4)
  b.writeFloatLE(v)
  return [...b]
}

export class ScapeTransport {
  private queue: Promise<unknown> = Promise.resolve()
  private waiting: ((d: Buffer) => boolean) | null = null
  private closed = false

  private constructor(public path: string, private dev: HID.HIDAsync) {
    dev.on('data', (d: Buffer) => this.waiting?.(d))
    dev.on('error', () => (this.closed = true))
  }

  static async open(path: string) {
    return new ScapeTransport(path, await HID.HIDAsync.open(path))
  }

  close() {
    this.closed = true
    this.dev.close().catch(() => {})
  }

  /** Send a command; resolve with the reply (report id stripped) that echoes its first `echo` bytes. */
  send(bytes: number[], echo = 2, timeoutMs = 700): Promise<Buffer> {
    const job = () =>
      new Promise<Buffer>((resolve, reject) => {
        if (this.closed) return reject(new Offline('dongle disconnected'))
        const timer = setTimeout(() => {
          this.waiting = null
          reject(new Timeout('headset did not answer'))
        }, timeoutMs)
        this.waiting = (d) => {
          const body = d[0] === 2 ? d.subarray(1) : d
          if (!bytes.slice(0, echo).every((b, i) => body[i] === b)) return false
          clearTimeout(timer)
          this.waiting = null
          resolve(Buffer.from(body))
          return true
        }
        const out = [2, ...bytes, ...new Array(63).fill(0)].slice(0, 64)
        this.dev.write(out).catch((e) => reject(new Offline(String(e))))
      })
    const next = this.queue.then(job, job)
    this.queue = next.catch(() => {})
    return next
  }
}

export function scapeEndpoint(): string | null {
  const d = HID.devices().find((x) => x.vendorId === FRACTAL && x.productId === 0x0001 && x.usagePage === 0xff00 && x.path)
  return d?.path ?? null
}

export class ScapeSession {
  state!: HeadsetState

  constructor(public t: ScapeTransport) {}

  async load() {
    const v = await this.t.send([0x11, 0x01])
    const serial = (await this.t.send([0x11, 0x02])).subarray(3).toString('ascii').split('\0')[0]
    this.state = {
      dongleFirmware: `${v[3]}.${v[4]}`, headsetFirmware: '', serial, connected: false, battery: null, boomMic: false,
      muted: false, eqSlot: 1, presets: [], sidetone: false, sidetoneLevel: 0, noiseCancelling: false, lighting: false
    }
    await this.refresh()
    if (this.state.connected) {
      const hv = await this.t.send([0xf1, 0x01])
      this.state.headsetFirmware = `${hv[3]}.${hv[4]}`
      this.state.presets = []
      for (const slot of [1, 2, 3]) {
        this.state.presets.push({ slot, bands: await this.readEq(slot) })
        const meta = await this.t.send([0xa7, 0x04, slot, 0x01]).catch(() => null)
        if (meta && meta[3] > 0 && meta[3] <= 40) this.presetId.set(slot, meta.subarray(4, 4 + meta[3]).toString('ascii'))
      }
    }
  }

  /** Status poll. A headset that's off makes the relayed command time out. */
  async refresh() {
    let st: Buffer
    try {
      st = await this.t.send([0xf1, 0x21])
    } catch (e) {
      if (e instanceof Timeout) {
        this.state.connected = false
        return
      }
      throw e
    }
    Object.assign(this.state, {
      connected: st[18] === 1,
      boomMic: st[3] !== 0,
      muted: st[4] !== 0,
      eqSlot: st[5] || 1,
      lighting: st[6] !== 0,
      battery: st[14] <= 100 ? st[14] : null,
      sidetone: st[15] === 1,
      sidetoneLevel: st[16],
      noiseCancelling: st[19] === 1
    })
    await this.t.send([0xa4, 0x0e, 0x99], 2, 400).catch(() => {}) // keepalive, as the official app does
  }

  private async readEq(slot: number): Promise<EqBand[]> {
    const e = await this.t.send([0xa7, 0x04, slot, 0x00])
    const bands: EqBand[] = []
    for (let i = 0; i < 5; i++) {
      const o = 3 + 12 * i
      if (!e[o]) continue
      bands.push({ type: FILTERS[e[o + 1]] ?? 'peak', freq: e.readUInt16LE(o + 2), gain: e.readFloatLE(o + 4), q: e.readFloatLE(o + 8) })
    }
    // A 0 dB peak does nothing; the firmware stores one as the placeholder for a flat EQ.
    return bands.filter((b) => !(b.type === 'peak' && Math.abs(b.gain) < 0.01))
  }

  /** Same sequence as Fractal's Adjust Pro: settings, coefficients for every DSP driver, then commit. */
  private async writeEq(slot: number, bands: EqBand[], mode: number) {
    if (slot < 1 || slot > 3) throw new Error('EQ slot must be 1, 2 or 3.')
    const use = bands.slice(0, MAX_BANDS)
    const settings: number[] = [0xa7, 0x01, (slot << 4) | ALL_RATES]
    const band = (on: number, type: number, freq: number, gain: number, q: number) => [on, type, freq & 0xff, freq >> 8, ...f32(gain), ...f32(q)]
    if (use.length) for (const b of use) settings.push(...band(1, FILTERS.indexOf(b.type), Math.round(b.freq), b.gain, b.q))
    else settings.push(...band(1, 0, 22000, 0, 0.5)) // a flat EQ is one 0 dB peak, like the factory default
    for (let i = Math.max(1, use.length); i < MAX_BANDS; i++) settings.push(...band(0, 0, 32, 0, 0.5))
    await this.t.send(settings)
    if (use.length) {
      for (let i = 0; i < use.length; i++)
        for (const [driver, fs] of DRIVERS) await this.t.send([0xa7, 0x02, slot, driver, i, ...biquad(use[i], fs).flatMap(f32)])
    } else {
      for (const [driver] of DRIVERS) await this.t.send([0xa7, 0x02, slot, driver, 0, ...[1, 0, 0, 0, 0].flatMap(f32)])
    }
    const id = Buffer.from(this.presetId.get(slot) ?? randomUUID())
    await this.t.send([0xa7, 0x03, slot, mode, ...f32(0), id.length, ...id])
    if (mode === COMMIT.save) {
      const p = this.state.presets.find((x) => x.slot === slot)
      if (p) p.bands = await this.readEq(slot)
    }
  }

  private presetId = new Map<number, string>()

  async apply(p: HeadsetPatch) {
    if (!this.state.connected) throw new Offline('The headset is switched off.')
    if (p.eqSlot !== undefined) await this.t.send([0xa7, 0x07, p.eqSlot])
    if (p.noiseCancelling !== undefined) await this.t.send([0xf1, 0x36, +p.noiseCancelling])
    if (p.lighting !== undefined) await this.t.send([0xa4, 0x04, +p.lighting])
    if (p.sidetone !== undefined) {
      await this.t.send([0xf1, 0x34, +p.sidetone, 0x00])
      await this.t.send([0xf1, 0x21]) // the dongle only relays sidetone after a status poll
    }
    if (p.sidetoneLevel !== undefined) {
      // Volume is relative: step up/down by the difference, at most 50 per command, polling in between.
      let diff = Math.max(0, Math.min(75, p.sidetoneLevel)) - this.state.sidetoneLevel
      while (diff) {
        const n = Math.min(50, Math.abs(diff))
        await this.t.send([0xf1, 0x34, diff > 0 ? 0x02 : 0x03, n])
        await this.t.send([0xf1, 0x21])
        diff -= Math.sign(diff) * n
      }
    }
    if (p.eq) await this.writeEq(p.eq.slot, p.eq.bands, p.eq.live ? COMMIT.live : COMMIT.save)
    if (p.eraseEq !== undefined) {
      await this.t.send([0xa7, 0x03, p.eraseEq, COMMIT.erase, ...f32(0), 0])
      await sleep(150)
      this.state.presets = []
      for (const slot of [1, 2, 3]) this.state.presets.push({ slot, bands: await this.readEq(slot) })
    }
    await sleep(80)
    await this.refresh()
  }
}

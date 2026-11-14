// A connected Logitech HID++ 2.0 device and the features Hubless uses.
import type { Battery, DpiGridData, Hits } from '@shared/types'
import { HidppError, Timeout, type Transport, sleep } from './hidpp'
import { crcOk, hitsFromWire, hitsToWire, withCrc } from './profile'

export const F = {
  ROOT: 0x0000, FEATURE_SET: 0x0001, FW: 0x0003, NAME: 0x0005, BATTERY_UNIFIED: 0x1004, BATTERY: 0x1000,
  DPI: 0x2201, DPI_EXT: 0x2202, RATE: 0x8060, RATE_EXT: 0x8061, ONBOARD: 0x8100, HITS: 0x1b0c,
  LED_EFFECTS: 0x8070, RGB_EFFECTS: 0x8071
} as const

const EXT_RATES = [125, 250, 500, 1000, 2000, 4000, 8000]
const CHARGING: Record<number, string> = { 0: 'Discharging', 1: 'Charging', 2: 'Charging', 3: 'Fully charged', 4: 'Charging error' }

export interface OnboardInfo {
  fmt: number
  profiles: number
  buttons: number
  sectorSize: number
}

export class LogitechDevice {
  features = new Map<number, number>()
  featureList: { index: number; id: number; hidden: boolean; version: number }[] = []
  protocol = '0.0'
  name = ''
  firmware = ''
  serial = ''
  onboard: OnboardInfo | null = null
  private grid: DpiGridData | null = null

  constructor(public t: Transport, public index: number, private fallbackName = 'Logitech device') {}

  has(id: number) {
    return this.features.has(id)
  }

  async call(id: number, fn: number, params: number[] = [], timeoutMs = 1000): Promise<Buffer> {
    const idx = this.features.get(id)
    if (idx === undefined) throw new Error(`device has no feature 0x${id.toString(16)}`)
    return this.t.request(this.index, idx, fn, params, timeoutMs)
  }

  async connect(): Promise<this> {
    const r = await this.t.request(this.index, 0, 1, [0, 0, 0x5a])
    this.protocol = `${r[0]}.${r[1]}`
    const fs = (await this.t.request(this.index, 0, 0, [0x00, 0x01]))[0]
    const count = (await this.t.request(this.index, fs, 0))[0]
    this.features.set(F.ROOT, 0).set(F.FEATURE_SET, fs)
    for (let i = 1; i <= count; i++) {
      const f = await this.t.request(this.index, fs, 1, [i])
      const id = (f[0] << 8) | f[1]
      if (!this.features.has(id)) this.features.set(id, i)
      this.featureList.push({ index: i, id, hidden: (f[2] & 0x60) !== 0, version: f[3] })
    }
    this.name = await this.readName()
    await this.readFirmware()
    if (this.has(F.ONBOARD)) {
      const o = await this.call(F.ONBOARD, 0)
      if (o[0] === 1) this.onboard = { fmt: o[1], profiles: o[3], buttons: o[5], sectorSize: (o[7] << 8) | o[8] }
    }
    return this
  }

  private async readName() {
    if (!this.has(F.NAME)) return this.fallbackName
    const n = (await this.call(F.NAME, 0))[0]
    let out = Buffer.alloc(0)
    while (out.length < n) {
      const chunk = await this.call(F.NAME, 1, [out.length])
      if (!chunk.some((b) => b)) break
      out = Buffer.concat([out, chunk])
    }
    return out.subarray(0, n).toString('utf8').replace(/\0/g, '').trim() || this.fallbackName
  }

  private async readFirmware() {
    if (!this.has(F.FW)) return
    try {
      const info = await this.call(F.FW, 0)
      this.serial = info.subarray(1, 5).toString('hex').toUpperCase()
      for (let e = 0; e < info[0]; e++) {
        const fw = await this.call(F.FW, 1, [e])
        if (fw[0] === 0) {
          const h = (b: number) => b.toString(16).padStart(2, '0')
          this.firmware = `${fw.subarray(1, 4).toString('ascii').replace(/\0/g, '')} ${h(fw[4])}.${h(fw[5])} build ${h(fw[6])}${h(fw[7])}`
          break
        }
      }
    } catch (e) {
      if (!(e instanceof HidppError || e instanceof Timeout)) throw e
    }
  }

  get isSuperstrike() {
    return this.has(F.HITS)
  }

  async battery(): Promise<Battery | null> {
    let r: Buffer | null = null
    if (this.has(F.BATTERY_UNIFIED)) r = await this.call(F.BATTERY_UNIFIED, 1)
    else if (this.has(F.BATTERY)) r = await this.call(F.BATTERY, 0)
    if (!r) return null
    const status = CHARGING[r[2]] ?? 'Unknown'
    return { percent: r[0], status, charging: status.startsWith('Charging') && status !== 'Charging error' }
  }

  async reportRates(): Promise<number[]> {
    if (this.has(F.RATE_EXT)) {
      const r = await this.call(F.RATE_EXT, 1)
      const mask = (r[0] << 8) | r[1]
      return EXT_RATES.filter((_, i) => mask & (1 << i))
    }
    if (this.has(F.RATE)) {
      const mask = (await this.call(F.RATE, 0))[0]
      return [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => mask & (1 << i)).map((i) => Math.round(1000 / (i + 1))).sort((a, b) => a - b)
    }
    return [1000]
  }

  /** Sensor DPI list: plain values or `value, 0xE000|step, end` ranges. */
  async dpiGrid(): Promise<DpiGridData> {
    if (this.grid) return this.grid
    let words: number[] = []
    try {
      if (this.has(F.DPI_EXT)) {
        let raw = Buffer.alloc(0)
        for (let page = 0; page < 8; page++) {
          const r = await this.call(F.DPI_EXT, 2, [0, 0, page])
          raw = Buffer.concat([raw, r.subarray(3, 16)])
          words = []
          for (let i = 0; i + 1 < raw.length; i += 2) words.push((raw[i] << 8) | raw[i + 1])
          if (words.includes(0)) break
        }
      } else if (this.has(F.DPI)) {
        const r = await this.call(F.DPI, 1, [0])
        for (let i = 1; i + 1 < r.length; i += 2) words.push((r[i] << 8) | r[i + 1])
      }
    } catch (e) {
      if (!(e instanceof HidppError || e instanceof Timeout)) throw e
    }
    const grid: DpiGridData = { values: [], ranges: [] }
    let prev: number | null = null
    for (let i = 0; i < words.length && words[i]; i++) {
      const w = words[i]
      if (w >> 13 === 0b111 && prev !== null && i + 1 < words.length) {
        const step = w & 0x1fff
        const end = words[i + 1]
        if (step) grid.ranges.push([prev, end, step])
        prev = end
        i++
        continue
      }
      grid.values.push(w)
      prev = w
    }
    if (!grid.values.length && !grid.ranges.length) grid.ranges.push([100, 25600, 50])
    this.grid = grid
    return grid
  }

  // ---------------------------------------------------------------- lighting (0x8070 / 0x8071)
  /** Locations of the mouse's RGB zones, in the order its onboard profiles store them (empty: no RGB). */
  async lightZones(): Promise<number[]> {
    const out: number[] = []
    try {
      if (this.has(F.LED_EFFECTS)) {
        const n = (await this.call(F.LED_EFFECTS, 0))[0]
        for (let z = 0; z < n; z++) {
          const r = await this.call(F.LED_EFFECTS, 1, [z])
          out.push((r[1] << 8) | r[2])
        }
      } else if (this.has(F.RGB_EFFECTS)) {
        const n = (await this.call(F.RGB_EFFECTS, 0, [0xff, 0xff, 0x00]))[2]
        for (let c = 0; c < n; c++) {
          const r = await this.call(F.RGB_EFFECTS, 0, [c, 0xff, 0x00])
          out.push((r[2] << 8) | r[3])
        }
      }
    } catch (e) {
      if (!(e instanceof HidppError || e instanceof Timeout)) throw e
    }
    return out
  }

  // ---------------------------------------------------------------- HITS (0x1B0C)
  async hitsCaps() {
    const r = await this.call(F.HITS, 0)
    return { actuation: r[2] >> 2 || 10, rt: r[3] >> 2 || 5, haptics: r[4] >> 2 || 5 }
  }

  async hitsGet(button: number): Promise<Hits> {
    return hitsFromWire((await this.call(F.HITS, 2, [button])).subarray(1, 4))
  }

  async hitsSet(button: number, h: Hits) {
    await this.call(F.HITS, 1, [button, ...hitsToWire(h)])
  }

  // ---------------------------------------------------------------- onboard memory (0x8100)
  async onboardMode() {
    return (await this.call(F.ONBOARD, 2))[0]
  }
  async setOnboardMode(mode: number) {
    await this.call(F.ONBOARD, 1, [mode])
  }
  async currentProfileSector() {
    const r = await this.call(F.ONBOARD, 4)
    return (r[0] << 8) | r[1]
  }
  async setCurrentProfile(sector: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.call(F.ONBOARD, 3, [sector >> 8, sector & 0xff], 1500)
        return
      } catch (e) {
        if (!(e instanceof Timeout) || attempt === 3) throw e
        await sleep(150)
      }
    }
  }
  async currentStage() {
    return (await this.call(F.ONBOARD, 11))[0]
  }
  async setCurrentStage(stage: number) {
    await this.call(F.ONBOARD, 12, [stage])
  }

  async readSector(sector: number): Promise<Uint8Array> {
    const size = this.onboard!.sectorSize
    for (let attempt = 0; attempt < 3; attempt++) {
      const buf = new Uint8Array(size)
      for (let off = 0; off < size; ) {
        const o = Math.min(off, size - 16) // reads may not run past the end of a sector
        const chunk = await this.call(F.ONBOARD, 5, [sector >> 8, sector & 0xff, o >> 8, o & 0xff])
        buf.set(chunk.subarray(0, 16), o)
        off = o + 16
      }
      if (sector >= 0x100 || sector === 0 || crcOk(buf)) return buf
    }
    throw new Error(`sector 0x${sector.toString(16)}: CRC mismatch after 3 reads`)
  }

  /** Write a whole sector (CRC already set), then verify it byte for byte. */
  async writeSector(sector: number, data: Uint8Array) {
    const size = this.onboard!.sectorSize
    if (data.length !== size) throw new Error('sector size mismatch')
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.call(F.ONBOARD, 6, [sector >> 8, sector & 0xff, 0, 0, size >> 8, size & 0xff], 2000)
        for (let off = 0; off < size; off += 16) {
          const chunk = Array.from(data.subarray(off, off + 16))
          while (chunk.length < 16) chunk.push(0)
          await this.call(F.ONBOARD, 7, chunk, 2000)
        }
        await this.call(F.ONBOARD, 8, [], 3000)
      } catch (e) {
        if (!(e instanceof Timeout || e instanceof HidppError)) throw e
        lastErr = e
      }
      await sleep(50)
      const back = await this.readSector(sector)
      if (back.every((b, i) => b === data[i])) return
    }
    throw new Error(`sector 0x${sector.toString(16)} did not verify after writing (${lastErr ?? 'mismatch'})`)
  }

  async profileTable(): Promise<{ sector: number; enabled: boolean }[]> {
    const ctl = await this.readSector(0)
    const out: { sector: number; enabled: boolean }[] = []
    for (let i = 0; i < this.onboard!.profiles; i++) {
      const sec = (ctl[4 * i] << 8) | ctl[4 * i + 1]
      if (sec === 0xffff) break
      out.push({ sector: sec, enabled: ctl[4 * i + 2] === 1 })
    }
    return out
  }

  async setProfileEnabled(slot: number, on: boolean) {
    const ctl = Uint8Array.from(await this.readSector(0))
    ctl[4 * slot + 2] = +on
    await this.writeSector(0, withCrc(ctl))
  }

  /** Factory default profile from ROM, with a valid CRC, or null. */
  async factorySector(): Promise<Uint8Array | null> {
    try {
      const rom = await this.readSector(0x100)
      const sec = (rom[0] << 8) | rom[1]
      if (sec === 0xffff || sec < 0x100) return null
      return withCrc(await this.readSector(sec))
    } catch {
      return null
    }
  }

  async dumpMemory(): Promise<Map<number, Uint8Array>> {
    const out = new Map<number, Uint8Array>([[0, await this.readSector(0)]])
    for (const { sector } of await this.profileTable()) out.set(sector, await this.readSector(sector))
    return out
  }
}

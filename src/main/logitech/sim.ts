// A simulated PRO X2 SUPERSTRIKE for demo mode and tests: answers HID++ like the real one,
// including the firmware's DPI-stage rule (only leading switched-on stages count).
import { HidppError, Offline, type Transport } from './hidpp'
import { withCrc } from './profile'

// Factory profile as read from a real PRO X2 SUPERSTRIKE (ROM sector 0x0101).
export const FACTORY = Uint8Array.from(
  Buffer.from(
    '030300002003200302b004b0040240064006026009600902800c800c02000000' +
      '00ff00ffffff14080c14080c3c002c0180010001800100028001000480010008' +
      '80010010ffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
      'ffffffffffffffffffffffffffffffff0300000000001f400000000300000000' +
      '001f400000000300000000001f403200000300000000001f40320000032a38',
    'hex'
  )
)

const SUPERSTRIKE_FEATURES = [0x0000, 0x0001, 0x0003, 0x0005, 0x1d4b, 0x0020, 0x1004, 0x2250, 0x2251, 0x2202, 0x8090,
  0x80e0, 0x1b0c, 0x8061, 0x8100, 0x8110]
const G502_FEATURES = [0x0000, 0x0001, 0x0003, 0x0005, 0x1d4b, 0x0020, 0x1b04, 0x2201, 0x8060, 0x8070, 0x8100]

/** A G502 HERO style profile (format 2): 1000 Hz, stages 400/800/1600/3200/6400, a cyan main light and a blue
 *  breathing logo. */
export function g502Profile(): Uint8Array {
  const p = new Uint8Array(255).fill(0xff)
  p.set([1, 1, 1])
  ;[400, 800, 1600, 3200, 6400].forEach((d, i) => p.set([d & 0xff, d >> 8], 3 + 2 * i))
  p.set([0, 0, 0, 0, 0], 13)
  p[17] = 0
  ;[1, 2, 4, 8, 16].forEach((b, i) => p.set([0x80, 0x01, 0x00, b], 32 + 4 * i))
  const main = [0x01, 0x00, 0xb4, 0xff, 0, 0, 0, 0, 0, 0, 0]
  const logo = [0x0a, 0x2b, 0x8c, 0xff, 0x13, 0x88, 0, 0, 0, 0, 0]
  p.set(main, 0xd0)
  p.set(logo, 0xdb)
  p.set(main, 0xe6)
  p.set(logo, 0xf1)
  return withCrc(p)
}
export const DPI_WORDS = [100, 0xe001, 200, 0xe002, 500, 0xe005, 1000, 0xe00a, 2000, 0xe014, 5000, 0xe032, 10000,
  0xe064, 20000, 0xe07d, 32000, 0xe0c8, 44000, 0]

const leadingStages = (s: Uint8Array, fmt: number) => {
  const at = (n: number) => (fmt === 8 ? 4 + 5 * n : 3 + 2 * n)
  let n = 0
  while (n < 5 && (s[at(n)] | s[at(n) + 1])) n++
  return n
}

export class SimTransport implements Transport {
  path = 'demo'
  sectors = new Map<number, Uint8Array>()
  hits = new Map<number, number[]>([[0, [0x14, 0x08, 0x0c]], [1, [0x14, 0x08, 0x0c]]])
  mode = 1
  current = 1
  stage = 0
  rate = 3
  battery = 76
  asleep = false
  /** Profile selections, to check that lighting changes are shown at once. */
  selects = 0
  private write: { sector: number; data: number[] } | null = null
  private features: number[]
  private fmt: number

  constructor(public model: 'superstrike' | 'g502' = 'superstrike') {
    this.features = model === 'g502' ? G502_FEATURES : SUPERSTRIKE_FEATURES
    this.fmt = model === 'g502' ? 2 : 8
    const factory = model === 'g502' ? g502Profile() : FACTORY
    const ctl = new Uint8Array(255).fill(0xff)
    ctl.set([0, 1, 1, 0xff, 0, 2, 0, 0xff, 0, 3, 0, 0xff, 0, 4, 0, 0xff, 0, 5, 0, 0xff])
    this.sectors.set(0, withCrc(ctl))
    for (let s = 1; s <= 5; s++) this.sectors.set(s, factory)
    this.sectors.set(0x100, Uint8Array.from([1, 1, 1, 0xff, ...new Array(251).fill(0xff)]))
    this.sectors.set(0x101, factory)
    if (model === 'g502') this.stage = 1
  }

  /** Default stage byte of a profile. */
  private defaultOf(p: Uint8Array) {
    return this.fmt === 8 ? p[2] : p[1]
  }

  close() {}

  async ping() {
    return this.asleep ? null : ([4, 2] as [number, number])
  }

  async pairedDevices() {
    return this.model === 'g502' ? [] : [{ slot: 1, wpid: 0x40bd, name: 'X2 SUPERSTRIKE', serial: 'DE400001' }]
  }

  async request(_index: number, feature: number, fn: number, params: number[] = []): Promise<Buffer> {
    if (this.asleep) throw new Offline('demo mouse is asleep')
    const p = [...params, ...new Array(16).fill(0)]
    const out = this.handle(this.features[feature], fn, p)
    if (!out) throw new HidppError(7, feature, fn)
    return Buffer.from([...out, ...new Array(16).fill(0)].slice(0, 16))
  }

  private handle(id: number | undefined, fn: number, p: number[]): number[] | null {
    switch (id) {
      case 0x0000:
        if (fn === 0) return [Math.max(0, this.features.indexOf((p[0] << 8) | p[1])), 0, 0]
        if (fn === 1) return [4, 2, p[2]]
        break
      case 0x0001:
        if (fn === 0) return [this.features.length - 1]
        if (fn === 1) return [this.features[p[0]] >> 8, this.features[p[0]] & 0xff, 0, 0]
        break
      case 0x0003:
        if (fn === 0) return [1, 0xde, 0x40, 0x00, this.model === 'g502' ? 0x02 : 0x01]
        if (fn === 1) return [0, ...Buffer.from('MPM'), 0x42, 0x00, 0x00, 0x11]
        break
      case 0x0005: {
        const name = Buffer.from(this.model === 'g502' ? 'G502 HERO Gaming Mouse' : 'PRO X2 SUPERSTRIKE')
        if (fn === 0) return [name.length]
        if (fn === 1) return [...name.subarray(p[0], p[0] + 16)]
        break
      }
      case 0x1004:
        if (fn === 1) return [this.battery, 4, 0, 0]
        break
      case 0x2202:
        if (fn === 2) {
          const stream = DPI_WORDS.flatMap((w) => [w >> 8, w & 0xff])
          const page = stream.slice(p[2] * 13, p[2] * 13 + 13)
          return [0, 0, p[2], ...page, ...new Array(13 - page.length).fill(0)]
        }
        if (fn === 5) {
          const s = this.sectors.get(this.current)!
          const dpi = this.stage < 5 ? s[4 + 5 * this.stage] | (s[5 + 5 * this.stage] << 8) : 800
          return [0, dpi >> 8, dpi & 0xff, dpi >> 8, dpi & 0xff]
        }
        break
      case 0x8061:
        if (fn === 1) return [0x00, 0x7f]
        if (fn === 2) return [this.rate]
        break
      case 0x2201: // DPI: 100..25600 in steps of 50
        if (fn === 1) return [0, 0x00, 0x64, 0xe0, 0x32, 0x64, 0x00]
        break
      case 0x8060:
        if (fn === 0) return [0x8b] // 125, 250, 500 and 1000 Hz
        break
      case 0x8070: // two zones: main lights (1) and logo (2)
        if (fn === 0) return [2, 0, 0, 0, 0]
        if (fn === 1 && p[0] < 2) return [p[0], 0, p[0] + 1, 4, 1]
        if (fn === 1) throw new HidppError(2)
        break
      case 0x1b0c:
        if (fn === 0) return [0, 3, 0x28, 0x14, 0x14, 1]
        if (fn === 2) {
          if (!this.hits.has(p[0])) throw new HidppError(2)
          return [p[0], ...this.hits.get(p[0])!]
        }
        if (fn === 1) {
          if (p[1] & 3 || p[3] & 3 || p[2] & 2 || p[1] < 4 || p[1] > 0x28 || p[3] > 0x14) throw new HidppError(2)
          this.hits.set(p[0], p.slice(1, 4))
          return p.slice(0, 4)
        }
        break
      case 0x8100:
        return this.onboard(fn, p)
    }
    return null
  }

  private onboard(fn: number, p: number[]): number[] | null {
    switch (fn) {
      case 0:
        return this.fmt === 8 ? [1, 8, 1, 5, 1, 5, 0x10, 0, 0xff, 0x0a, 4] : [1, 2, 1, 5, 1, 11, 0x10, 0, 0xff, 0x0a, 4]
      case 1:
        this.mode = p[0]
        return []
      case 2:
        return [this.mode]
      case 3: {
        this.current = (p[0] << 8) | p[1]
        this.selects++
        const prof = this.sectors.get(this.current)!
        this.stage = this.defaultOf(prof)
        if (this.fmt === 8) this.hits.set(0, [...prof.subarray(0x26, 0x29)]).set(1, [...prof.subarray(0x29, 0x2c)])
        return []
      }
      case 4:
        return [this.current >> 8, this.current & 0xff]
      case 11:
        return [this.stage]
      case 12:
        if (p[0] >= leadingStages(this.sectors.get(this.current)!, this.fmt)) throw new HidppError(2)
        this.stage = p[0]
        return []
      case 5: {
        const sec = (p[0] << 8) | p[1]
        const off = (p[2] << 8) | p[3]
        const s = this.sectors.get(sec)
        if (!s || off + 16 > 255) throw new HidppError(2)
        return [...s.subarray(off, off + 16)]
      }
      case 6:
        this.write = { sector: (p[0] << 8) | p[1], data: [] }
        return []
      case 7:
        this.write!.data.push(...p.slice(0, 16))
        return []
      case 8: {
        const { sector, data } = this.write!
        const bytes = Uint8Array.from(data.slice(0, 255))
        this.sectors.set(sector, bytes)
        this.write = null
        if (sector === this.current) {
          if (this.stage >= leadingStages(bytes, this.fmt)) this.stage = 0xff
          if (this.fmt === 8) this.hits.set(0, [...bytes.subarray(0x26, 0x29)]).set(1, [...bytes.subarray(0x29, 0x2c)])
        }
        return []
      }
    }
    return null
  }
}

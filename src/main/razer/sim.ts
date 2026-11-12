// A simulated Razer mouse for tests and the demo mode: answers 90-byte packets the way OpenRazer documents Razer firmware does (reply in
// the same packet with a status byte, argument layouts below). Strict on purpose: a wrong checksum, transaction id,
// data size or argument makes it fail the command, so driver mistakes show up as test failures.
import type { RazerLink, RazerModel } from './razer'

export interface SimOptions {
  ignoreWrites?: boolean // accept writes but don't change anything (to test read-back checks)
  asleep?: boolean // answer every command with status 4 (wireless mouse out of range)
  garbage?: boolean // answer DPI reads with nonsense
  stageBase?: 0 | 1 // how this mouse numbers its stages in replies
  maxRate?: number // refuse faster polling (status 5)
}

const POLL1: Record<number, number> = { 0x08: 125, 0x02: 500, 0x01: 1000 }
const POLL2: Record<number, number> = { 0x40: 125, 0x20: 250, 0x10: 500, 0x08: 1000, 0x04: 2000, 0x02: 4000, 0x01: 8000 }

export class SimRazer implements RazerLink {
  dpi = { x: 800, y: 800 }
  stages = [
    { x: 400, y: 400 },
    { x: 800, y: 800 },
    { x: 1600, y: 1600 }
  ]
  active = 2 // 1-based
  poll: number
  battery = 200 // 0..255
  charging = 0
  writes: string[] = []
  v2: boolean

  constructor(
    public model: RazerModel,
    private o: SimOptions = {}
  ) {
    this.v2 = model.poll![0] === 'get_polling_rate2'
    this.poll = this.v2 ? 0x08 : 0x01
  }

  get rateHz() {
    return (this.v2 ? POLL2 : POLL1)[this.poll]
  }

  async exchange(req: Uint8Array): Promise<Uint8Array> {
    const r = Uint8Array.from(req)
    const status = (s: number) => ((r[0] = s), r)
    if (req.length !== 90) return status(3)
    let crc = 0
    for (let i = 2; i < 88; i++) crc ^= req[i]
    if (crc !== req[88] || req[1] !== this.model.dpi![2]) return status(3)
    if (this.o.asleep) return status(4)
    const [size, cls, id] = [req[5], req[6], req[7]]
    const a = req.subarray(8, 88)
    const out = r.subarray(8, 88)
    const ok = () => status(2)
    const write = (what: string, apply: () => void) => {
      this.writes.push(what)
      if (!this.o.ignoreWrites) apply()
      return ok()
    }
    const key = (cls << 8) | id
    switch (key) {
      case 0x0081: // firmware
        if (size !== 2) return status(3)
        out[0] = 1
        out[1] = 4
        return ok()
      case 0x0485: // DPI read [storage, x, y, 0, 0]
        if (size !== 7) return status(3)
        out.set(this.o.garbage ? [0, 0, 1, 0, 1] : [a[0], this.dpi.x >> 8, this.dpi.x & 0xff, this.dpi.y >> 8, this.dpi.y & 0xff, 0, 0])
        return ok()
      case 0x0405: // DPI write
        if (size !== 7 || a[0] !== 1) return status(3)
        return write('dpi', () => (this.dpi = { x: (a[1] << 8) | a[2], y: (a[3] << 8) | a[4] }))
      case 0x0486: {
        if (!this.model.stages || size !== 0x26 || a[0] !== 1) return status(this.model.stages ? 3 : 5)
        const base = this.o.stageBase ?? 1
        out.set([1, this.active, this.stages.length])
        this.stages.forEach((s, i) => out.set([i + base, s.x >> 8, s.x & 0xff, s.y >> 8, s.y & 0xff, 0, 0], 3 + i * 7))
        return ok()
      }
      case 0x0406: {
        if (!this.model.stages || size !== 0x26 || a[0] !== 1) return status(this.model.stages ? 3 : 5)
        const n = a[2]
        if (n < 1 || n > 5 || a[1] < 1 || a[1] > n) return status(3)
        const list = Array.from({ length: n }, (_, i) => ({ x: (a[4 + i * 7] << 8) | a[5 + i * 7], y: (a[6 + i * 7] << 8) | a[7 + i * 7] }))
        return write('stages', () => {
          this.stages = list
          this.active = a[1]
        })
      }
      case 0x0085: // polling (classic)
        if (this.v2) return status(5)
        out[0] = this.poll
        return ok()
      case 0x0005:
        if (this.v2 || size !== 1 || !POLL1[a[0]]) return status(3)
        return write('poll', () => (this.poll = a[0]))
      case 0x00c0: // polling (8K)
        if (!this.v2) return status(5)
        out[0] = 0
        out[1] = this.poll
        return ok()
      case 0x0040:
        if (!this.v2 || size !== 2 || a[0] > 1 || !POLL2[a[1]]) return status(3)
        if (this.o.maxRate && POLL2[a[1]] > this.o.maxRate) return status(5)
        return write('poll', () => (this.poll = a[1]))
      case 0x0780:
        if (!this.model.battery) return status(5)
        out[1] = this.battery
        return ok()
      case 0x0784:
        if (!this.model.charging) return status(5)
        out[1] = this.charging
        return ok()
      default:
        return status(5)
    }
  }

  close() {}
}

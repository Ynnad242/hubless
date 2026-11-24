// SteelSeries and HyperX headsets: the packets sent for each setting, battery, and remembering write-only settings.
import { describe, expect, it } from 'vitest'
import { HEADSETS, HidHeadset, type HidIo, headsetEndpoints } from '../src/main/headsets/hid-headsets'

class SimIo implements HidIo {
  writes: number[][] = []
  constructor(private answer: (req: number[]) => number[]) {}
  private last: number[] = []
  async write(d: number[]) {
    this.writes.push(d)
    this.last = d
  }
  async read() {
    return this.answer(this.last)
  }
  close() {}
}
const spec = (name: string) => HEADSETS.find((h) => h.name === name)!
const mem = () => {
  const m = new Map<string, Record<string, number | number[]>>()
  return { m, load: (k: string) => m.get(k) ?? null, save: (k: string, v: Record<string, number | number[]>) => void m.set(k, v) }
}
const trim = (p: number[]) => {
  let n = p.length
  while (n > 0 && p[n - 1] === 0) n--
  return p.slice(0, n)
}

describe('SteelSeries Arctis Nova 7', () => {
  it('reads battery (percent and old 0..4 firmware) and sends sidetone, auto-off and EQ', async () => {
    const io = new SimIo((r) => (r[1] === 0xb0 ? [0xb0, 0, 3, 3] : []))
    const old = new HidHeadset(io, spec('Arctis Nova 7'), 0x2202, 'S', mem())
    await old.load()
    expect(old.state().battery).toBe(75)
    const io2 = new SimIo((r) => (r[1] === 0xb0 ? [0xb0, 0, 64, 1] : []))
    const st = mem()
    const h = new HidHeadset(io2, spec('Arctis Nova 7'), 0x227e, 'S', st)
    await h.load()
    expect([h.state().battery, h.state().charging]).toEqual([64, true])
    io2.writes = []
    await h.set('sidetone', 2)
    await h.set('autoOff', 15)
    await h.set('eq', [-10, 0, 0, 0, 0, 0, 0, 0, 0, 10])
    expect(io2.writes.map(trim)).toEqual([[0, 0x39, 2], [0, 0x09], [0, 0xa3, 15], [0, 0x33, 10, 20, 20, 20, 20, 20, 20, 20, 20, 30]])
    expect(io2.writes.every((w) => w.length === 64)).toBe(true)
    // remembered, since the headset can't report them
    const again = new HidHeadset(io2, spec('Arctis Nova 7'), 0x227e, 'S', st)
    await again.load()
    expect(again.state().settings.find((s) => s.key === 'sidetone')!.value).toBe(2)
    expect(again.state().settings.find((s) => s.key === 'eq')!.bands![9].gain).toBe(10)
  })

  it('shows the headset as off when only the base station answers', async () => {
    const h = new HidHeadset(new SimIo(() => [0xb0, 0, 0, 0]), spec('Arctis Nova 7'), 0x227e, 'S', mem())
    await h.load()
    expect(h.off).toBe(true)
    expect(h.state().battery).toBeNull()
  })
})

describe('SteelSeries Arctis 7 and HyperX Cloud Alpha Wireless', () => {
  it('saves after every Arctis 7 change', async () => {
    const io = new SimIo(() => [6, 0x18, 80])
    const h = new HidHeadset(io, spec('Arctis 7'), 0x12ad, 'S', mem())
    await h.load()
    expect(h.state().battery).toBe(80)
    io.writes = []
    await h.set('sidetone', 9)
    await h.set('sidetone', 0)
    expect(io.writes.map(trim)).toEqual([[6, 0x35, 1, 0, 9], [6, 9], [6, 0x35], [6, 9]])
    expect(io.writes.every((w) => w.length === 31)).toBe(true)
  })

  it('reads the Cloud Alpha battery in three steps and sets sidetone', async () => {
    const io = new SimIo((r) => ({ 3: [0x21, 0xbb, 3, 2], 0x0c: [0x21, 0xbb, 0x0c, 0], 0x0b: [0x21, 0xbb, 0x0b, 57] })[r[2]] ?? [])
    const h = new HidHeadset(io, spec('Cloud Alpha Wireless'), 0x098d, 'S', mem())
    await h.load()
    expect([h.state().battery, h.state().charging]).toEqual([57, false])
    io.writes = []
    await h.set('sidetone', 50)
    expect(io.writes.map(trim)).toEqual([[0x21, 0xbb, 0x10, 1], [0x21, 0xbb, 0x11, 64]])
    await expect(h.set('autoOff', 7)).rejects.toThrow('not available')
  })

  it('finds a headset only on its own interface', () => {
    const d = (iface: number, usagePage: number) => ({ vendorId: 0x1038, productId: 0x2202, interface: iface, usagePage, path: `/dev/hidraw${iface}`, release: 0 })
    expect(headsetEndpoints([d(0, 0x0c), d(3, 0xffc0)] as never).map((e) => e.path)).toEqual(['/dev/hidraw3'])
  })
})

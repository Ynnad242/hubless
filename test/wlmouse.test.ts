import { describe, expect, it } from 'vitest'
import { decode, plan, type Readings } from '../src/main/wlmouse/ying'

// Replies as the mouse sends them: [profile, value…]; DPI is [profile, count, (x BE16, y BE16) × count].
const readings = (): Readings => ({
  dpi: Uint8Array.from([1, 3, 0x01, 0x90, 0x01, 0x90, 0x03, 0x20, 0x03, 0x20, 0x06, 0x40, 0x06, 0x40]), // 400, 800, 1600
  stage: Uint8Array.from([1, 2]),
  rate: Uint8Array.from([1, 0x80]),
  angleSnap: Uint8Array.from([1, 0]),
  liftOff: Uint8Array.from([1, 0x87]),
  motionSync: Uint8Array.from([1, 1]),
  ripple: Uint8Array.from([1, 0]),
  debounce: Uint8Array.from([1, 4])
})

describe('WLmouse codec', () => {
  it('decodes the readings', () => {
    const p = decode(readings())
    expect(p.stages.filter((s) => s.x).map((s) => s.x)).toEqual([400, 800, 1600])
    expect(p.stages).toHaveLength(6)
    expect(p.defaultStage).toBe(1)
    expect(p.rateHz).toBe(8000)
    expect(p.extras).toEqual({ liftOffMm: 0.7, debounceMs: 4, motionSync: true, rippleControl: false })
  })

  it('plans no writes when nothing changed', () => {
    expect(plan(readings(), decode(readings()))).toEqual([])
  })

  it('plans only what changed, in the format the read returned', () => {
    const p = decode(readings())
    p.stages[1] = { x: 1200, y: 1200, lod: 0 }
    p.rateHz = 1000
    p.extras!.liftOffMm = 2
    p.extras!.debounceMs = 99
    const w = plan(readings(), p)
    expect(w.map(([s]) => s)).toEqual(['dpi', 'rate', 'liftOff', 'debounce'])
    expect(w[0].slice(1)).toEqual([0x01, 0x01, [1, 3, 0x01, 0x90, 0x01, 0x90, 0x04, 0xb0, 0x04, 0xb0, 0x06, 0x40, 0x06, 0x40]])
    expect(w[1][3]).toEqual([1, 0x01]) // 1000 Hz
    expect(w[2][3]).toEqual([1, 0x02])
    expect(w[3]).toEqual(['debounce', 0x00, 0x08, [1, 15]]) // clamped to the mouse's maximum
  })

  it('removing a stage rewrites the table and keeps the active stage valid', () => {
    const p = decode(readings())
    p.stages[2] = { x: 0, y: 0, lod: 0 }
    p.defaultStage = 1
    const w = plan(readings(), p)
    expect(w.map(([s]) => s)).toEqual(['dpi', 'stage'])
    expect(w[0][3].slice(0, 2)).toEqual([1, 2])
    expect(w[1][3]).toEqual([1, 2])
  })

  it('refuses settings the mouse does not have', () => {
    const p = decode(readings())
    p.rateHz = 3000
    expect(() => plan(readings(), p)).toThrow(/3000 Hz/)
    const q = decode(readings())
    q.stages = q.stages.map(() => ({ x: 0, y: 0, lod: 0 }))
    expect(() => plan(readings(), q)).toThrow(/at least one/)
  })
})

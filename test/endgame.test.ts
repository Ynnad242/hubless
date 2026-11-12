import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Action } from '@shared/actions'
import { decode, encode } from '../src/main/endgame/config'

// Config block read from a real OP1 8k (3367:1964, firmware 1.24), factory buttons, one DPI level.
const raw = Uint8Array.from(readFileSync(join(__dirname, 'fixtures/op1-8k-v1.bin')))

describe('OP1 8k config', () => {
  it('decodes the real block', () => {
    const p = decode(raw)
    expect(p.rateHz).toBe(8000)
    expect(p.stages.map((s) => s.x)).toEqual([1600, 0, 0, 0])
    expect(p.buttons).toEqual([Action.mouse(1), Action.mouse(2), Action.mouse(4), Action.mouse(8), Action.mouse(0x10)])
    expect(p.extras).toEqual({ liftOffMm: 1, debounceMs: 8, motionSync: false, rippleControl: false, slamClickFilter: true, jitterFilter: true })
  })

  it('re-encodes an unchanged profile byte for byte', () => {
    expect(Buffer.from(encode(decode(raw))).equals(Buffer.from(raw))).toBe(true)
  })

  it('writes edits to the right bytes only', () => {
    const p = decode(raw)
    p.rateHz = 1000
    p.stages = [{ x: 800, y: 800, lod: 1 }, { x: 1600, y: 3200, lod: 1 }, { x: 0, y: 0, lod: 1 }, { x: 0, y: 0, lod: 1 }]
    p.buttons[3] = Action.key(0x3e, 0x01) // back → Ctrl+F5
    p.extras = { ...p.extras, debounceMs: 4, motionSync: true, jitterFilter: false }
    const b = encode(p)
    const changed = [...b.keys()].filter((i) => b[i] !== raw[i])
    expect(b[21]).toBe(8) // 1000 Hz divider
    expect(b[30]).toBe(2) // two levels
    expect([b[51], b[52] | (b[53] << 8), b[56], b[57] | (b[58] << 8), b[59] | (b[60] << 8)]).toEqual([0, 800, 1, 1600, 3200])
    expect([b[99], b[100], b[101]]).toEqual([2, 0x01, 0x3e]) // back is OP1 slot 4
    expect(b[28]).toBe(1)
    expect(b[22]).toBe(0x01)
    expect(changed.every((i) => [21, 22, 28, 30].includes(i) || (i >= 51 && i <= 60) || (i >= 71 && i <= 126))).toBe(true)
    const again = decode(b)
    expect(again.buttons[3]).toBe(Action.key(0x3e, 0x01))
    expect(again.stages.map((s) => [s.x, s.y])).toEqual([[800, 800], [1600, 3200], [0, 0], [0, 0]])
    expect(again.extras.debounceMs).toBe(4)
  })

  it('refuses actions the mouse cannot do', () => {
    const p = decode(raw)
    p.buttons[2] = Action.fn(0x08) // next profile
    expect(() => encode(p)).toThrow()
  })
})

describe('mouse catalog', async () => {
  const { lookup, catalogSize } = await import('../src/main/catalog')
  it('knows popular mice by USB id', () => {
    expect(lookup(0x3367, 0x1964)?.name).toBe('OP1 8k')
    expect(lookup(0x1532, 0x00c1)).toMatchObject({ vendor: 'Razer', name: 'Viper V3 Pro', maxDpi: 35000, popular: true })
    expect(lookup(0x046d, 0xc094)?.name).toBe('G Pro X Wireless Superlight')
    expect(lookup(0x36a7, 0xa875)).toMatchObject({ vendor: 'WLmouse', name: 'Ying', maxDpi: 30000 })
    expect(lookup(0xdead, 0xbeef)).toBeUndefined()
    expect(catalogSize().models).toBeGreaterThan(200)
  })
})

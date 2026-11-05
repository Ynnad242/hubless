// Real-hardware checks for the Wooting and Scape drivers. Opt-in: HUBLESS_HW=1 npx vitest run test/peripherals.test.ts
// Every test puts the device back exactly as it was.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), 'hubless-hw-'))
const HID = (await import('node-hid')).default
HID.setDriverType('hidraw')
const { WootingSession, WootingTransport, wootingEndpoint, mmToCode, codeToMm } = await import('../src/main/wooting/wooting')
const { ScapeSession, ScapeTransport, scapeEndpoint } = await import('../src/main/fractal/scape')

const run = process.env.HUBLESS_HW === '1'

describe('wooting codec', () => {
  it('converts travel distances like the firmware', () => {
    expect(mmToCode(1.5)).toBe(0x5800)
    expect(mmToCode(4)).toBe(0x7fff)
    expect(codeToMm(0x6020)).toBe(2.01)
  })
})

describe.runIf(run && !!wootingEndpoint())('real Wooting keyboard', () => {
  let s: InstanceType<typeof WootingSession>
  let before: string
  const snapshot = () =>
    JSON.stringify({ p: s.state.profiles, a: s.state.advanced, k: s.state.perKeyActuation, r: s.state.rtGroups, l: s.state.layers, g: s.state.lighting.brightness, c: s.state.lighting.colors })
  const W = (2 << 5) | 2 // W key
  const F = (3 << 5) | 4 // F key

  beforeAll(async () => {
    const ep = wootingEndpoint()!
    s = new WootingSession(await WootingTransport.open(ep.path), ep.product, ep.serial)
    await s.load()
    s.rememberFactoryLayer()
    before = snapshot()
  }, 30000)

  afterAll(async () => {
    await s.act({ type: 'restore' })
    expect(snapshot()).toBe(before)
    s.t.close()
  }, 60000)

  it('describes the board', () => {
    expect(s.state.layout.length).toBe(61)
    expect(s.state.layers[0][2][2]).toBe(0x17) // W
  })

  it('actuation and rapid trigger', async () => {
    const orig = s.state.profiles[0].settings
    await s.act({ type: 'settings', slot: s.state.active, settings: { ...orig, actuationMm: 1.2, rtPressMm: 0.3 } })
    expect(s.state.profiles[0].settings.actuationMm).toBe(1.2)
  }, 30000)

  it('per-key actuation and per-key rapid trigger', async () => {
    await s.act({ type: 'perKey', keys: [F], actuationMm: 0.8 })
    expect(s.state.perKeyActuation[F]).toBe(0.8)
    await s.act({ type: 'perKey', keys: [F], rt: { pressMm: 0.2, releaseMm: 0.25 } })
    expect(s.state.rtGroups.some((g) => g.keys.includes(F) && g.pressMm === 0.2)).toBe(true)
    await s.act({ type: 'perKey', keys: [W], rt: null })
    expect(s.state.rtGroups.some((g) => g.keys.includes(W))).toBe(false)
  }, 30000)

  it('remaps a key on the Fn layer', async () => {
    await s.act({ type: 'map', layer: 1, keys: [F], code: 0xc2 }) // Fn+F = play/pause
    expect(s.state.layers[1][3][4]).toBe(0xc2)
  }, 30000)

  it('adds and removes advanced keys', async () => {
    const n = s.state.advanced.length
    await s.act({ type: 'advanced', key: F, entry: { key: F, kind: 'modTap', tap: 0x06, hold: 0x63 } })
    expect(s.state.advanced.length).toBe(n + 1)
    await s.act({ type: 'advanced', key: F, entry: null })
    expect(s.state.advanced.length).toBe(n)
  }, 30000)

  it('lighting brightness and key colours', async () => {
    await s.act({ type: 'lighting', brightness: 120, paint: { keys: [F], color: '#ff0000' } })
    expect(s.state.lighting.brightness).toBe(120)
    expect(s.state.lighting.colors[3][4]).toBe('#f80000')
  }, 30000)
})

describe('EQ codes', async () => {
  const { eqCode, parseEqCode } = await import('@shared/eq')
  it('round-trips', () => {
    const bands = [{ type: 'lowShelf' as const, freq: 120, gain: 2.5, q: 0.98 }, { type: 'peak' as const, freq: 260, gain: -2, q: 1.75 }]
    const back = parseEqCode(eqCode(bands))
    expect(back.map((b) => [b.type, b.freq, +b.gain.toFixed(3), +b.q.toFixed(3)])).toEqual(bands.map((b) => [b.type, b.freq, b.gain, b.q]))
  })
})

describe.runIf(run && !!scapeEndpoint())('Scape custom EQ', () => {
  it('writes a custom EQ to slot 3 exactly like Adjust Pro, then restores it', async () => {
    const { biquad } = await import('@shared/eq')
    const t = await ScapeTransport.open(scapeEndpoint()!)
    const s = new ScapeSession(t)
    await s.load()
    const orig = s.state.presets.find((p) => p.slot === 3)!.bands
    const mine = [{ type: 'peak' as const, freq: 1000, gain: 3, q: 1.2 }, { type: 'highShelf' as const, freq: 6000, gain: -2, q: 0.7 }]
    try {
      await s.apply({ eq: { slot: 3, bands: mine } })
      const got = s.state.presets.find((p) => p.slot === 3)!.bands
      expect(got.map((b) => [b.type, b.freq, +b.gain.toFixed(3), +b.q.toFixed(3)])).toEqual(mine.map((b) => [b.type, b.freq, b.gain, b.q]))
      for (const [driver, fs] of [[1, 44000], [2, 48000], [4, 96000]]) {
        const c = await t.send([0xa7, 0x05, 3, driver, 1], 2)
        const stored = [0, 1, 2, 3, 4].map((k) => c.readFloatLE(6 + 4 * k))
        biquad(mine[1], fs).forEach((v, k) => expect(Math.abs(v - stored[k])).toBeLessThan(1e-6))
      }
    } finally {
      await s.apply({ eq: { slot: 3, bands: orig } })
      const back = s.state.presets.find((p) => p.slot === 3)!.bands
      expect(back.map((b) => [b.type, b.freq, +b.gain.toFixed(3), +b.q.toFixed(3)])).toEqual(orig.map((b) => [b.type, b.freq, +b.gain.toFixed(3), +b.q.toFixed(3)]))
      t.close()
    }
  }, 30000)
})

describe.runIf(run && !!scapeEndpoint())('real Fractal Scape', () => {
  it('reads status and EQ, toggles mic noise cancelling and EQ slot, restores', async () => {
    const t = await ScapeTransport.open(scapeEndpoint()!)
    const s = new ScapeSession(t)
    await s.load()
    expect(s.state.connected).toBe(true)
    expect(s.state.presets.length).toBe(3)
    const orig = { noiseCancelling: s.state.noiseCancelling, eqSlot: s.state.eqSlot }
    try {
      await s.apply({ noiseCancelling: !orig.noiseCancelling })
      expect(s.state.noiseCancelling).toBe(!orig.noiseCancelling)
      const other = orig.eqSlot === 1 ? 2 : 1
      await s.apply({ eqSlot: other })
      expect(s.state.eqSlot).toBe(other)
    } finally {
      await s.apply(orig)
      expect(s.state.noiseCancelling).toBe(orig.noiseCancelling)
      expect(s.state.eqSlot).toBe(orig.eqSlot)
      t.close()
    }
  }, 30000)
})

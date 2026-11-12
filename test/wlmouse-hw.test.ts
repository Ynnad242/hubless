// Real WLmouse Ying on the cable. Run: HUBLESS_HW=1 npx vitest run test/wlmouse-hw.test.ts
// Reads every setting, changes each one through the same code the app uses (with read-back checks), then restores the
// original settings and checks they match byte for byte.
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { SETTINGS, WlSession, WlTransport, decode, wlmouseEndpoint } from '../src/main/wlmouse/ying'

const hw = process.env.HUBLESS_HW === '1'
const hex = (b?: Uint8Array) => (b ? Buffer.from(b).toString('hex') : '-')

describe.skipIf(!hw)('WLmouse Ying on hardware', () => {
  it('reads, writes every setting, and restores', { timeout: 120_000 }, async () => {
    const ep = wlmouseEndpoint()
    expect(ep, 'Ying not found or not accessible').toBeTruthy()
    const t = await WlTransport.open(ep!.path)
    const s = new WlSession(t, 'Ying', ep!.productId, ep!.serial)
    try {
      await s.load()
      const original = { ...s.readings }
      console.log('firmware', s.fw, 'serial', JSON.stringify(ep!.serial))
      for (const k of Object.keys(SETTINGS)) console.log(k.padEnd(10), hex(original[k as keyof typeof original]))
      console.log('decoded', JSON.stringify(decode(original)))
      if (process.env.HUBLESS_HW_SAVE) writeFileSync(process.env.HUBLESS_HW_SAVE, JSON.stringify(Object.fromEntries(Object.entries(original).map(([k, v]) => [k, hex(v)]))))
      if (process.env.HUBLESS_HW_READONLY) return

      const mem = new Map(Object.entries(original).map(([k, v]) => [(SETTINGS[k as keyof typeof SETTINGS][0] << 8) | SETTINGS[k as keyof typeof SETTINGS][1], v!]))
      const base = decode(original)
      const steps: [string, (p: ReturnType<typeof decode>) => void][] = [
        ['first DPI stage +50', (p) => (p.stages[0] = { x: p.stages[0].x + 50, y: p.stages[0].y + 50, lod: 0 })],
        ['add a stage', (p) => { const n = p.stages.filter((x) => x.x).length; if (n < 6) p.stages[n] = { x: 3200, y: 3200, lod: 0 } }],
        ['active stage = first', (p) => (p.defaultStage = p.defaultStage === 0 ? 1 : 0)],
        ['polling 500 Hz', (p) => (p.rateHz = 500)],
        ['polling 1000 Hz', (p) => (p.rateHz = 1000)],
        ['lift-off 2 mm', (p) => (p.extras!.liftOffMm = 2)],
        ['lift-off 0.7 mm', (p) => (p.extras!.liftOffMm = 0.7)],
        ['angle snapping', (p) => (p.angleSnap = !p.angleSnap)],
        ['motion sync', (p) => (p.extras!.motionSync = !p.extras!.motionSync)],
        ['ripple control', (p) => (p.extras!.rippleControl = !p.extras!.rippleControl)],
        ['debounce', (p) => (p.extras!.debounceMs = p.extras!.debounceMs >= 15 ? 14 : p.extras!.debounceMs + 1)]
      ]
      let p = structuredClone(base)
      for (const [name, change] of steps) {
        if (name.startsWith('lift-off') && !original.liftOff) continue
        change(p)
        await s.saveProfile(p)
        console.log('ok:', name)
        p = decode(s.readings)
      }
      await s.restore(mem)
      for (const k of Object.keys(original) as (keyof typeof original)[]) {
        const n = k === 'dpi' ? 2 + original.dpi![1] * 4 : 2
        expect(hex(s.readings[k]!.slice(0, n)), k).toBe(hex(original[k]!.slice(0, n)))
      }
      console.log('restored: every setting matches the original')
    } finally {
      t.close()
    }
  })
})

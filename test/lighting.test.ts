// Mouse lighting: the Logitech onboard-profile LED codec, the G502 simulator through the real session, and the Razer
// lighting zones (from OpenRazer's facts) through the Razer simulator.
import { describe, expect, it, vi } from 'vitest'
import type { LightSetting } from '@shared/types'

const saved = new Map<string, LightSetting[]>()
vi.mock('../src/main/storage', () => ({
  saveBackup: vi.fn(() => 'backup.json'),
  savedLighting: vi.fn((k: string) => saved.get(k) ?? null),
  saveLighting: vi.fn((k: string, l: LightSetting[]) => saved.set(k, structuredClone(l)))
}))

const { decodeLed, encodeLed } = await import('../src/main/logitech/lighting')
const { decode, encode, toHex } = await import('../src/main/logitech/profile')
const { LogitechDevice } = await import('../src/main/logitech/device')
const { LogitechSession } = await import('../src/main/logitech/session')
const { SimTransport, g502Profile } = await import('../src/main/logitech/sim')
const { MODELS, RazerSession, RazerTransport, razerZones } = await import('../src/main/razer/razer')
const { SimRazer } = await import('../src/main/razer/sim')

const led = (...b: number[]) => Uint8Array.from([...b, ...new Array(11 - b.length).fill(0)])

describe('Logitech LED entries', () => {
  it('reads the effects Hubless edits', () => {
    expect(decodeLed(led(0x01, 0xff, 0x80, 0x00))).toMatchObject({ effect: 'static', color: '#ff8000' })
    expect(decodeLed(led(0x0a, 0x00, 0x00, 0xff, 0x0f, 0xa0, 0, 40))).toMatchObject({ effect: 'breathing', color: '#0000ff', speedMs: 4000, brightness: 40 })
    expect(decodeLed(led(0x03, 0, 0, 0, 0, 0, 0x27, 0x10, 0))).toMatchObject({ effect: 'cycle', speedMs: 10000, brightness: 100 })
    expect(decodeLed(led(0x00)).effect).toBe('off')
    expect(decodeLed(led(0x04, 1, 2, 3)).effect).toBe('other')
  })

  it('writes them back, and keeps unchanged or unknown entries byte for byte', () => {
    const wave = led(0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
    expect(encodeLed(decodeLed(wave), wave)).toEqual(wave)
    const odd = led(0x01, 0xff, 0, 0, 0x55) // unknown trailing byte survives when nothing changed
    expect(encodeLed(decodeLed(odd), odd)).toEqual(odd)
    expect(encodeLed({ effect: 'static', color: '#00ff00', brightness: 100, speedMs: 5000 }, wave)).toEqual(led(0x01, 0, 0xff, 0))
    expect(encodeLed({ effect: 'breathing', color: '#2b8cff', brightness: 50, speedMs: 3000 }, wave)).toEqual(led(0x0a, 0x2b, 0x8c, 0xff, 0x0b, 0xb8, 0, 50))
    expect(encodeLed({ effect: 'cycle', color: '#ffffff', brightness: 100, speedMs: 99999 }, wave)).toEqual(led(0x03, 0, 0, 0, 0, 0, 0x4e, 0x20, 0))
    expect(encodeLed({ effect: 'off', color: '#ffffff', brightness: 100, speedMs: 5000 }, wave)).toEqual(led(0x00))
  })

  it('changes only the LED entry and its power-saving copy in a profile', () => {
    const raw = g502Profile()
    const p = decode(1, raw, 2)
    expect(p.lighting?.map((l) => l.effect)).toEqual(['static', 'breathing'])
    expect(toHex(encode(p))).toBe(toHex(raw))
    p.lighting![1] = { ...p.lighting![1], effect: 'static', color: '#ff0000' }
    const out = encode(p)
    const diff = [...out.keys()].filter((i) => out[i] !== raw[i])
    expect(diff.every((i) => (i >= 0xdb && i < 0xe6) || (i >= 0xf1 && i < 0xfc) || i >= 0xfd)).toBe(true) // LEDs and CRC only
    expect([...out.subarray(0xdb, 0xdf)]).toEqual([0x01, 0xff, 0, 0])
    expect([...out.subarray(0xf1, 0xf5)]).toEqual([0x01, 0xff, 0, 0])
  })
})

describe('Logitech mouse with RGB (simulated G502 HERO)', () => {
  it('finds its zones and shows a change on the mouse at once', async () => {
    const t = new SimTransport('g502')
    const s = new LogitechSession(await new LogitechDevice(t, 0xff).connect())
    await s.load()
    const st = s.state()
    expect(st.lighting?.map((z) => z.label)).toEqual(['Main lights', 'Logo'])
    const p = structuredClone(st.profiles[0])
    expect(p.lighting?.[0]).toMatchObject({ effect: 'static', color: '#00b4ff' })
    const before = t.selects
    p.lighting![0] = { effect: 'breathing', color: '#ff5a5f', brightness: 60, speedMs: 4000 }
    await s.saveProfile(p)
    expect(decode(1, await s.dev.readSector(1), 2).lighting?.[0]).toEqual(p.lighting![0])
    expect(t.selects).toBe(before + 1) // re-selected so the new light shows now
    // A change that doesn't touch the lights doesn't re-select (which would reset the DPI stage).
    const q = structuredClone(s.state().profiles[0])
    q.stages[4] = { x: 12000, y: 12000, lod: 0 }
    await s.saveProfile(q)
    expect(t.selects).toBe(before + 1)
  })

  it('offers no lighting on a mouse without RGB', async () => {
    const s = new LogitechSession(await new LogitechDevice(new SimTransport(), 1).connect())
    await s.load()
    expect(s.state().lighting).toEqual([])
    expect(s.state().profiles[0].lighting).toBeUndefined()
  })
})

describe('Razer lighting', () => {
  const byId = (id: string) => [...MODELS.values()].find((m) => m.id === id)!

  it('knows which zones each model has', () => {
    expect(razerZones(byId('BASILISK_V3_PRO_WIRELESS')).map((z) => z.label)).toEqual(['Logo', 'Scroll wheel', 'Whole mouse'])
    expect(razerZones(byId('DEATHADDER_V2')).map((z) => z.label)).toEqual(['Logo', 'Scroll wheel'])
    expect(razerZones(byId('COBRA_PRO_WIRELESS'))[0].effects).toEqual(['off', 'static', 'cycle'])
    expect(byId('DEATHADDER_V2').lighting[0].tx).toBe(0x3f)
    for (const id of ['VIPER_V3_PRO_WIRELESS', 'DEATHADDER_V3_PRO_WIRELESS', 'VIPER_V2_PRO_WIRELESS']) expect(byId(id).lighting).toEqual([])
    expect([...MODELS.values()].filter((m) => m.lighting.length).length).toBeGreaterThanOrEqual(40)
  })

  it('sets effect, colour and brightness on a simulated Basilisk V3 Pro and remembers the effect', async () => {
    const m = byId('BASILISK_V3_PRO_WIRELESS')
    const sim = new SimRazer(m)
    const s = new RazerSession(new RazerTransport(sim, m.dpi![2]), m, 'BV3P-1')
    await s.load()
    let p = s.state().profiles[0]
    expect(p.lighting?.[0]).toMatchObject({ effect: 'other', brightness: 100 }) // can't be read: unknown until set
    p = structuredClone(p)
    p.lighting![0] = { effect: 'static', color: '#ff0000', brightness: 50, speedMs: 0 }
    p.lighting![1] = { ...p.lighting![1], effect: 'off' }
    await s.saveProfile(p)
    expect(sim.leds.get(0x04)).toEqual({ effect: 1, rgb: [255, 0, 0], brightness: 128 })
    expect(sim.leds.get(0x01)?.effect).toBe(0)
    const again = s.state().profiles[0].lighting!
    expect(again[0]).toMatchObject({ effect: 'static', color: '#ff0000', brightness: 50 })
    expect(again[1].effect).toBe('off')
    expect(again[2].effect).toBe('other') // untouched zone stays unknown
    // Saving the same thing again sends nothing.
    sim.writes = []
    await s.saveProfile(structuredClone(s.state().profiles[0]))
    expect(sim.writes).toEqual([])
  })

  it('refuses an effect the zone does not have', async () => {
    const m = byId('COBRA_PRO_WIRELESS')
    const s = new RazerSession(new RazerTransport(new SimRazer(m), m.dpi![2]), m, 'CP-1')
    await s.load()
    const p = structuredClone(s.state().profiles[0])
    p.lighting![0] = { effect: 'breathing', color: '#00ff00', brightness: 100, speedMs: 0 }
    await expect(s.saveProfile(p)).rejects.toThrow("can't do that effect")
  })
})

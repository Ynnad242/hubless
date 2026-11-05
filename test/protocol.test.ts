import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Action, describeAction, hitsCode, parseHitsCode, snapDpi } from '@shared/actions'

process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), 'hubless-test-'))
const { decode, encode, crcOk, toHex } = await import('../src/main/logitech/profile')
const { FACTORY, SimTransport } = await import('../src/main/logitech/sim')
const { LogitechDevice } = await import('../src/main/logitech/device')
const { LogitechSession } = await import('../src/main/logitech/session')

describe('format 8 profile codec', () => {
  it('decodes the factory sector of a real PRO X2 and round-trips byte for byte', () => {
    const p = decode(1, FACTORY, 8)
    expect(crcOk(FACTORY)).toBe(true)
    expect(toHex(encode(p))).toBe(toHex(FACTORY))
    expect(p.stages.map((s) => s.x)).toEqual([800, 1200, 1600, 2400, 3200])
    expect([p.rateHz, p.rateWiredHz]).toEqual([1000, 1000])
    expect(p.hits).toEqual([
      { actuation: 5, rtLevel: 2, rtOn: false, haptics: 3 },
      { actuation: 5, rtLevel: 2, rtOn: false, haptics: 3 }
    ])
    expect(p.buttons.slice(0, 5).map(describeAction)).toEqual(['Left click', 'Right click', 'Middle click', 'Back', 'Forward'])
    expect([p.sleepS, p.offS]).toEqual([60, 300])
  })

  it('encodes every polling rate', () => {
    for (const hz of [125, 250, 500, 1000, 2000, 4000, 8000]) {
      const p = { ...decode(1, FACTORY, 8), rateHz: hz }
      expect(decode(1, encode(p), 8).rateHz).toBe(hz)
    }
  })

  it('keeps names and unknown bytes', () => {
    const raw = encode({ ...decode(1, FACTORY, 8), name: 'Aim ✓' })
    expect(decode(1, raw, 8).name).toBe('Aim ✓')
    expect(toHex(raw.subarray(0xd0, 0xfd))).toBe(toHex(FACTORY.subarray(0xd0, 0xfd)))
  })

  it('packs DPI stages so the firmware never ends up on no stage', () => {
    // The real bug: stages 1, 2, 4, 5 switched off, stage 3 (1600) kept as the start stage.
    const p = decode(1, FACTORY, 8)
    for (const i of [0, 1, 3, 4]) p.stages[i] = { x: 0, y: 0, lod: 2 }
    p.defaultStage = 2
    const q = decode(1, encode(p), 8)
    expect(q.stages.map((s) => s.x)).toEqual([1600, 0, 0, 0, 0])
    expect(q.defaultStage).toBe(0)
  })
})

describe('HITS', () => {
  it('matches the G HUB code format', () => {
    const [l, r] = parseHitsCode('MDAwNDA1MDMwNTEwMDQwMw==')
    expect(l).toEqual({ actuation: 4, rtLevel: 3, rtOn: true, haptics: 4 })
    expect(r).toEqual({ actuation: 5, rtLevel: 5, rtOn: false, haptics: 3 })
    expect(hitsCode(l, r)).toBe('MDAwNDA1MDMwNTEwMDQwMw==')
  })
})

describe('actions and DPI grid', () => {
  it('describes key actions', () => {
    expect(describeAction(Action.key(0x06, 0x01))).toBe('Ctrl+C')
    expect(describeAction(Action.fn(0x07))).toBe('DPI shift (hold)')
  })
  it('snaps to the sensor grid of a real PRO X2', async () => {
    const dev = await new LogitechDevice(new SimTransport(), 1).connect()
    const g = await dev.dpiGrid()
    expect([150, 1234, 7777, 26000, 43950, 99999, 1].map((v) => snapDpi(g, v))).toEqual([150, 1230, 7800, 26000, 44000, 44000, 100])
  })
})

describe('session on the simulated mouse', () => {
  it('saves DPI and HITS and applies them live', async () => {
    const t = new SimTransport()
    const s = new LogitechSession(await new LogitechDevice(t, 1).connect())
    await s.load()
    const p = structuredClone(s.profiles[0])
    p.stages[0] = { x: 1600, y: 1600, lod: 2 }
    p.hits![0] = { actuation: 2, rtLevel: 1, rtOn: true, haptics: 0 }
    await s.saveProfile(p)
    expect(decode(1, await s.dev.readSector(1), 8).stages[0].x).toBe(1600)
    expect(await s.dev.hitsGet(0)).toEqual({ actuation: 2, rtLevel: 1, rtOn: true, haptics: 0 })
  })

  it('repairs the live stage after a gap, like the real firmware needs', async () => {
    const t = new SimTransport()
    const s = new LogitechSession(await new LogitechDevice(t, 1).connect())
    await s.load()
    const p = structuredClone(s.profiles[0])
    for (const i of [0, 1, 3, 4]) p.stages[i] = { x: 0, y: 0, lod: 2 }
    p.defaultStage = 2
    await s.saveProfile(p)
    expect(t.stage).toBe(0)
    expect(decode(1, await s.dev.readSector(1), 8).stages[0].x).toBe(1600)
  })
})

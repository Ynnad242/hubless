// Full check on a real PRO X2 SUPERSTRIKE. Opt-in: HUBLESS_HW=1 npx vitest run test/hardware.test.ts
// Saves a backup first and restores the mouse's memory exactly at the end.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), 'hubless-hw-'))
const HID = (await import('node-hid')).default
HID.setDriverType('hidraw')
const { HidrawTransport, endpoints, sleep } = await import('../src/main/logitech/hidpp')
const { LogitechDevice, F } = await import('../src/main/logitech/device')
const { LogitechSession } = await import('../src/main/logitech/session')
const { decode } = await import('../src/main/logitech/profile')

const run = process.env.HUBLESS_HW === '1'

describe.runIf(run)('real PRO X2 SUPERSTRIKE', () => {
  let s: InstanceType<typeof LogitechSession>
  let orig: Map<number, Uint8Array>
  let stage0 = 0
  const liveDpi = async () => {
    const r = await s.dev.call(F.DPI_EXT, 5, [0])
    return (r[1] << 8) | r[2]
  }
  const edit = async (fn: (p: ReturnType<typeof decode>) => void) => {
    const p = structuredClone(s.profiles[s.slotOf(s.activeSector)])
    fn(p)
    await s.saveProfile(p)
  }

  beforeAll(async () => {
    const ep = endpoints().find((e) => e.receiver)!
    const t = await HidrawTransport.open(ep.path)
    for (let i = 0; i < 60 && !(await t.ping(1)); i++) await sleep(1000) // wait for the mouse to wake
    s = new LogitechSession(await new LogitechDevice(t, 1).connect())
    await s.load()
    orig = await s.dev.dumpMemory()
    stage0 = s.stage
  }, 90000)

  afterAll(async () => {
    await s.restore(orig)
    await s.dev.setCurrentStage(stage0).catch(() => {})
    const now = await s.dev.dumpMemory()
    for (const [k, v] of orig) expect(Buffer.from(now.get(k)!).equals(Buffer.from(v))).toBe(true)
    s.dev.t.close()
  }, 90000)

  it('identifies the mouse', () => {
    expect(s.dev.name).toBe('PRO X2 SUPERSTRIKE')
    expect(s.dev.onboard?.fmt).toBe(8)
    expect(s.hitsCaps).toEqual({ actuation: 10, rt: 5, haptics: 5 })
  })

  it('writes DPI stages and the sensor follows live', async () => {
    await edit((p) => {
      p.stages = [800, 1200, 1600, 2400, 3200].map((x) => ({ x, y: x, lod: 2 }))
      p.defaultStage = 0
    })
    expect(await liveDpi()).toBe(800)
    // the user's case: only stage 3 kept
    await edit((p) => {
      for (const i of [0, 1, 3, 4]) p.stages[i] = { x: 0, y: 0, lod: 2 }
      p.defaultStage = 2
    })
    expect(await liveDpi()).toBe(1600)
    await edit((p) => (p.stages[0] = { x: 3200, y: 3200, lod: 2 }))
    expect(await liveDpi()).toBe(3200)
  }, 60000)

  it('applies HITS including rapid trigger, live and stored', async () => {
    await edit((p) => (p.hits = [{ actuation: 3, rtLevel: 2, rtOn: true, haptics: 4 }, { actuation: 6, rtLevel: 1, rtOn: false, haptics: 2 }]))
    expect(await s.dev.hitsGet(0)).toEqual({ actuation: 3, rtLevel: 2, rtOn: true, haptics: 4 })
    expect(await s.dev.hitsGet(1)).toEqual({ actuation: 6, rtLevel: 1, rtOn: false, haptics: 2 })
    const stored = decode(s.activeSector, await s.dev.readSector(s.activeSector), 8)
    expect(stored.hits![0].rtOn).toBe(true)
  }, 60000)

  it('remaps a button and names the profile', async () => {
    await edit((p) => {
      p.buttons[3] = '80020106' // Ctrl+C
      p.name = 'Hubless test'
    })
    const stored = decode(s.activeSector, await s.dev.readSector(s.activeSector), 8)
    expect(stored.buttons[3]).toBe('80020106')
    expect(stored.name).toBe('Hubless test')
  }, 60000)

  it('switches profiles and HITS follow', async () => {
    await s.setEnabled(1, true)
    await s.activate(2)
    expect(await s.dev.currentProfileSector()).toBe(2)
    await s.activate(1)
    expect(await s.dev.hitsGet(0)).toEqual({ actuation: 3, rtLevel: 2, rtOn: true, haptics: 4 })
  }, 60000)
})

// Razer driver against the simulated mouse (test/razer-sim.ts), for every model the driver claims.
import { describe, expect, it, vi } from 'vitest'
import { Offline } from '../src/main/logitech/hidpp'

const backups: Map<number, Uint8Array>[] = []
vi.mock('../src/main/storage', () => ({ saveBackup: vi.fn((_k, _n, _f, mem: Map<number, Uint8Array>) => (backups.push(new Map(mem)), 'backup.json')) }))

const { MODELS, RazerSession, RazerTransport, decode, packet, rates } = await import('../src/main/razer/razer')
const { SimRazer } = await import('../src/main/razer/sim')

const open = async (pid: number, opts = {}) => {
  const m = MODELS.get(pid)!
  const sim = new SimRazer(m, opts)
  const s = new RazerSession(new RazerTransport(sim, m.dpi![2]), m, 'SIM123')
  await s.load()
  return { m, sim, s }
}

describe('Razer packets', () => {
  it('builds the documented 90-byte report with its XOR checksum', () => {
    // Firmware request as documented by OpenRazer: class 00, id 81, size 2, transaction id ff, checksum 0x83.
    const p = packet(0xff, 0x00, 0x81, 0x02)
    expect(p).toHaveLength(90)
    expect(Array.from(p.slice(0, 8))).toEqual([0, 0xff, 0, 0, 0, 0x02, 0x00, 0x81])
    expect(p[88]).toBe(0x83)
  })

  it('claims the popular models', () => {
    const names = [...MODELS.values()].map((m) => m.id)
    for (const id of ['VIPER_V3_PRO_WIRED', 'VIPER_V3_PRO_WIRELESS', 'DEATHADDER_V3_PRO_WIRED', 'DEATHADDER_V3_PRO_WIRELESS', 'VIPER_V2_PRO_WIRED', 'BASILISK_V3', 'DEATHADDER_V2'])
      expect(names).toContain(id)
    expect(MODELS.size).toBeGreaterThan(90)
  })
})

describe.each([...MODELS.values()].map((m) => [m.id, m.pid] as const))('%s (simulated)', (_id, pid) => {
  it('reads, changes every setting with read-back, and restores the backup', async () => {
    const { m, sim, s } = await open(pid)
    const start = { dpi: { ...sim.dpi }, stages: structuredClone(sim.stages), active: sim.active, poll: sim.poll }
    const p = decode(m, s.readings)
    if (m.stages) {
      expect(p.stages.filter((x) => x.x).map((x) => x.x)).toEqual([400, 800, 1600])
      expect(p.defaultStage).toBe(1)
      p.stages[0] = { x: 450, y: 450, lod: 0 }
      p.stages[3] = { x: 3200, y: 3200, lod: 0 }
      p.defaultStage = 3
    } else p.stages[0] = { x: 1200, y: 1200, lod: 0 }
    await s.saveProfile(p)
    if (m.stages) {
      expect(sim.stages.map((x) => x.x)).toEqual([450, 800, 1600, 3200])
      expect(sim.active).toBe(4)
      expect(sim.dpi).toEqual({ x: 3200, y: 3200 }) // the live DPI follows the active stage
    } else expect(sim.dpi).toEqual({ x: 1200, y: 1200 })

    for (const hz of rates(m)) {
      const q = decode(m, s.readings)
      q.rateHz = hz
      await s.saveProfile(q)
      expect(sim.rateHz).toBe(hz)
    }
    expect(backups.at(-1)!.size).toBeGreaterThan(1)

    await s.restore(backups.at(-1)!)
    expect(sim.dpi).toEqual(start.dpi)
    expect(sim.poll).toBe(start.poll)
    if (m.stages) {
      expect(sim.stages).toEqual(start.stages)
      expect(sim.active).toBe(start.active)
    }
  })
})

describe('Razer safety', () => {
  const viper = [...MODELS.values()].find((m) => m.id === 'VIPER_V3_PRO_WIRELESS')!.pid
  const da2 = [...MODELS.values()].find((m) => m.id === 'DEATHADDER_V2')!.pid

  it('reports a change the mouse did not keep, instead of claiming success', async () => {
    const { m, sim, s } = await open(da2, { ignoreWrites: true })
    const p = decode(m, s.readings)
    p.stages[0] = { x: 1600, y: 1600, lod: 0 }
    await expect(s.saveProfile(p)).rejects.toThrow(/did not keep/)
    expect(sim.writes).toEqual(['dpi'])
  })

  it('writes nothing when the mouse answers in an unexpected format', async () => {
    const m = MODELS.get(viper)!
    const sim = new SimRazer(m, { garbage: true })
    const s = new RazerSession(new RazerTransport(sim, m.dpi![2]), m, '')
    await expect(s.load()).rejects.toThrow(/unexpected format/)
    expect(sim.writes).toEqual([])
  })

  it('treats a sleeping wireless mouse as asleep, not broken', async () => {
    const m = MODELS.get(viper)!
    const s = new RazerSession(new RazerTransport(new SimRazer(m, { asleep: true }), m.dpi![2]), m, '')
    await expect(s.load()).rejects.toBeInstanceOf(Offline)
  })

  it('surfaces a polling rate the mouse refuses and keeps the old one', async () => {
    const { m, sim, s } = await open(viper, { maxRate: 4000 })
    const p = decode(m, s.readings)
    p.rateHz = 8000
    await expect(s.saveProfile(p)).rejects.toThrow(/not supported/)
    expect(sim.rateHz).toBe(1000)
  })

  it('numbers stages the way the mouse does', async () => {
    const { m, sim, s } = await open(viper, { stageBase: 0 })
    const p = decode(m, s.readings)
    p.stages[1] = { x: 900, y: 900, lod: 0 }
    await s.saveProfile(p)
    expect(sim.stages.map((x) => x.x)).toEqual([400, 900, 1600])
  })

  it('reads battery and charging on wireless models', async () => {
    const { s } = await open(viper)
    expect(s.battery).toEqual({ percent: 78, status: '', charging: false })
  })
})

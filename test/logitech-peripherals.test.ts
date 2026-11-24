// Logitech G headsets and keyboards over HID++: telling them from mice, and their settings.
import { describe, expect, it } from 'vitest'
import { LogitechDevice } from '../src/main/logitech/device'
import { LogiHeadset, LogiKeyboard, logitechKind, voltsToPercent } from '../src/main/logitech/peripheral'
import { SimTransport } from '../src/main/logitech/sim'

const open = async (model: 'g733' | 'g915' | 'superstrike' | 'g502') => {
  const t = new SimTransport(model)
  return { t, dev: await new LogitechDevice(t, model === 'superstrike' ? 1 : 0xff).connect() }
}

describe('what a Logitech device is', () => {
  it('knows headsets, keyboards (even with onboard memory) and mice apart', async () => {
    expect(await logitechKind((await open('g733')).dev)).toBe('headset')
    expect(await logitechKind((await open('g915')).dev)).toBe('keyboard')
    expect(await logitechKind((await open('superstrike')).dev)).toBe('mouse')
    expect(await logitechKind((await open('g502')).dev)).toBe('mouse')
  })
})

describe('Logitech headset', () => {
  it('reads sidetone, EQ, battery and auto power-off', async () => {
    const { dev } = await open('g733')
    const h = new LogiHeadset(dev)
    await h.load()
    const st = h.state()
    expect(st.battery).toBe(voltsToPercent(3900))
    expect(st.settings.find((s) => s.key === 'sidetone')!.value).toBe(30)
    const eq = st.settings.find((s) => s.key === 'eq')!
    expect(eq.bands).toEqual([{ freq: 80, gain: 0 }, { freq: 240, gain: 2 }, { freq: 750, gain: 0 }, { freq: 2200, gain: -3 }, { freq: 6600, gain: 4 }])
    expect([eq.min, eq.max]).toEqual([-12, 12])
    expect(st.settings.find((s) => s.key === 'autoOff')!.value).toBe(30)
  })

  it('writes settings and reads them back', async () => {
    const { t, dev } = await open('g733')
    const h = new LogiHeadset(dev)
    await h.load()
    await h.set('sidetone', 75)
    await h.set('eq', [-4, 0, 3, 6, -12])
    await h.set('autoOff', 15)
    expect([t.sidetone, t.eq, t.autoOff]).toEqual([75, [-4, 0, 3, 6, -12], 15])
    await expect(h.set('sidetone', 140)).rejects.toThrow('out of range')
    await expect(h.set('eq', [0, 0, 0])).rejects.toThrow('EQ values')
    expect(t.sidetone).toBe(75)
  })
})

describe('Logitech keyboard', () => {
  it('sets brightness, switches the backlight off, and locks keys', async () => {
    const { t, dev } = await open('g915')
    const k = new LogiKeyboard(dev)
    await k.load()
    const st = k.state()
    expect(st.battery).toBe(76)
    expect(st.settings.map((s) => s.key)).toEqual(['brightness', 'lock16', 'lock1', 'lock2', 'lock4', 'lock8'])
    await k.set('brightness', 40)
    expect(t.bright).toEqual({ on: 1, level: 40 })
    await k.set('brightness', 0)
    expect(t.bright.on).toBe(0)
    await k.set('lock16', 1)
    await k.set('lock1', 1)
    expect(t.disabled).toBe(0x11)
    await k.set('lock16', 0)
    expect(t.disabled).toBe(0x01)
  })
})

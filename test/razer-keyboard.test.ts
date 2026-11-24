// Razer keyboards: lighting, brightness and game mode with each model's own command variant and transaction id.
import { describe, expect, it } from 'vitest'
import type { LightSetting } from '../src/shared/types'
import { KEYBOARDS, RazerKeyboard, keyboardName } from '../src/main/razer/keyboard'
import { RazerTransport } from '../src/main/razer/razer'
import { SimRazerKeyboard } from '../src/main/razer/sim-keyboard'

const byId = (id: string) => [...KEYBOARDS.values()].find((m) => m.id === id)!
const store = () => {
  const m = new Map<string, LightSetting[]>()
  return { m, load: (k: string) => m.get(k) ?? null, save: (k: string, l: LightSetting[]) => void m.set(k, l) }
}
const open = async (id: string) => {
  const model = byId(id)
  const sim = new SimRazerKeyboard(model)
  const st = store()
  const k = new RazerKeyboard(new RazerTransport(sim, model.tx), model, 'S1', st)
  await k.load()
  return { k, sim, st }
}

describe('Razer keyboard models', () => {
  it('come from OpenRazer with a command variant each', () => {
    expect(KEYBOARDS.size).toBeGreaterThan(50)
    expect(byId('BLACKWIDOW_V3')).toMatchObject({ variant: 'extended', led: 5, interface: 3 })
    expect(byId('BLACKWIDOW_CHROMA')).toMatchObject({ variant: 'standard', tx: 0xff })
    expect(keyboardName(byId('BLACKWIDOW_V4_75PCT'))).toBe('BlackWidow V4 75%')
    expect(keyboardName(byId('HUNTSMAN_V3_PRO_TKL'))).toBe('Huntsman V3 Pro TKL')
    expect(keyboardName(byId('BLACKWIDOW_V3_TK'))).toBe('BlackWidow V3 Tenkeyless')
    expect(keyboardName(byId('ORNATA_V3_ALT'))).toBe('Ornata V3')
  })
})

describe('Razer keyboard', () => {
  it('sets lighting, brightness and game mode on a current (extended) keyboard', async () => {
    const { k, sim, st } = await open('BLACKWIDOW_V3')
    expect(k.state().settings.find((s) => s.key === 'effect')!.value).toBe(-1) // unknown until set
    expect(k.state().settings.find((s) => s.key === 'brightness')!.value).toBe(100)
    await k.set('color', 0xff8800)
    await k.set('effect', 1)
    expect(sim.effect).toEqual({ id: 6, rgb: [0xff, 0x88, 0x00] })
    await k.set('effect', 2)
    expect(sim.effect.id).toBe(3)
    await k.set('brightness', 40)
    expect(sim.brightness).toBe(102)
    await k.set('game', 1)
    expect(sim.game).toBe(1)
    expect([...st.m.values()][0][0]).toMatchObject({ effect: 'breathing', color: '#ff8800' }) // remembered: the keyboard can't say
  })

  it('uses the standard matrix commands on an older Chroma keyboard', async () => {
    const { k, sim } = await open('BLACKWIDOW_CHROMA')
    await k.set('color', 0x00ff00)
    await k.set('effect', 1)
    expect(sim.effect).toEqual({ id: 6, rgb: [0, 255, 0] })
    await k.set('effect', 0)
    expect(sim.effect.id).toBe(0)
    expect(sim.sent.every((x) => x.startsWith('ff:3:'))).toBe(true)
  })
})

// Webcams: reading V4L2 controls, saving settings per camera and putting them back when the camera loses them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyOrder, parseControls, SimCamera } from '../src/main/webcam/uvc'
import { WebcamSession } from '../src/main/webcam/session'
import type { SavedCamera } from '../src/main/storage'

const memStore = () => {
  const m = new Map<string, SavedCamera>()
  return { m, load: (k: string) => structuredClone(m.get(k) ?? { keep: true, values: {} }), save: (k: string, c: SavedCamera) => void m.set(k, structuredClone(c)) }
}

describe('V4L2 controls', () => {
  it('reads a real C922 listing', () => {
    const cs = parseControls(readFileSync(join(__dirname, 'fixtures/c922-ctrls.txt'), 'utf8'))
    expect(cs.map((c) => c.name)).toContain('focus_automatic_continuous')
    const exp = cs.find((c) => c.name === 'exposure_time_absolute')!
    expect(exp).toMatchObject({ type: 'int', min: 3, max: 2047, default: 250, inactive: true })
    const ae = cs.find((c) => c.name === 'auto_exposure')!
    expect(ae.type).toBe('menu')
    expect(ae.options).toEqual([{ value: 1, label: 'Manual Mode' }, { value: 3, label: 'Aperture Priority Mode' }])
    expect(cs.find((c) => c.name === 'power_line_frequency')!.options!.map((o) => o.label)).toEqual(['Disabled', '50 Hz', '60 Hz'])
    expect(cs.find((c) => c.name === 'white_balance_automatic')!.type).toBe('bool')
  })

  it('turns auto switches off before setting the values they lock', () => {
    expect(applyOrder([['exposure_time_absolute', 100], ['auto_exposure', 1], ['brightness', 90]])).toEqual([[['auto_exposure', 1]], [['exposure_time_absolute', 100], ['brightness', 90]]])
  })
})

describe('webcam session', () => {
  it('saves only what differs from the factory value, and puts it back after an unplug', async () => {
    const cam = new SimCamera()
    const store = memStore()
    const s = new WebcamSession(cam.list()[0], cam, store)
    await s.load()
    await s.set({ auto_exposure: 1, exposure_time_absolute: 400, brightness: 128 })
    expect(store.m.get(s.key)!.values).toEqual({ auto_exposure: 1, exposure_time_absolute: 400 })
    // unplugged: the camera is back on factory values
    const fresh = new SimCamera()
    const again = new WebcamSession(fresh.list()[0], fresh, store)
    await again.load()
    const val = (n: string) => again.controls.find((c) => c.name === n)!.value
    expect([val('auto_exposure'), val('exposure_time_absolute')]).toEqual([1, 400])
  })

  it('undoes another app changing a setting while "keep" is on, and leaves it alone when off', async () => {
    const cam = new SimCamera()
    const store = memStore()
    const s = new WebcamSession(cam.list()[0], cam, store)
    await s.load()
    await s.set({ focus_automatic_continuous: 0, focus_absolute: 60 })
    await cam.set(cam.list()[0].dev, [['focus_automatic_continuous', 1]]) // Zoom turns autofocus back on
    await new Promise((r) => setTimeout(r, 1600))
    expect(await s.poll()).toBe(true)
    const val = (n: string) => s.controls.find((c) => c.name === n)!.value
    expect([val('focus_automatic_continuous'), val('focus_absolute')]).toEqual([0, 60])
    await s.setKeep(false)
    await cam.set(cam.list()[0].dev, [['brightness', 10]])
    await s.set({ brightness: 200 })
    await cam.set(cam.list()[0].dev, [['brightness', 10]])
    await new Promise((r) => setTimeout(r, 1600))
    await s.poll()
    expect(val('brightness')).toBe(10)
  })

  it('reset puts factory values back and forgets the saved settings', async () => {
    const cam = new SimCamera()
    const store = memStore()
    const s = new WebcamSession(cam.list()[0], cam, store)
    await s.load()
    await s.set({ zoom_absolute: 300, saturation: 40, auto_exposure: 1, exposure_time_absolute: 400 })
    await Promise.all([s.reset(), s.poll()]) // a check for lost settings arriving mid-reset must not undo it
    expect(s.controls.find((c) => c.name === 'zoom_absolute')!.value).toBe(100)
    expect(s.controls.find((c) => c.name === 'exposure_time_absolute')!.value).toBe(250)
    expect(store.m.get(s.key)!.values).toEqual({})
  })
})

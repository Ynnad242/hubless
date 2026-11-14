// What the Actuation page shows as pressed, from live key travel.
import { describe, expect, it } from 'vitest'
import { KEY_UP, type KeyRules, nextPoint, stepKey } from '../src/shared/keytravel'

const run = (r: KeyRules, samples: number[]) => {
  let s = KEY_UP
  return samples.map((d) => (s = stepKey(s, d, r)).pressed)
}

describe('key travel', () => {
  it('without Rapid Trigger, pressed means past the actuation point', () => {
    expect(run({ actuationMm: 2, rt: null, continuous: false }, [0, 1.9, 2, 3, 2.1, 1.9, 0])).toEqual([false, false, true, true, true, false, false])
  })

  it('Rapid Trigger releases as soon as the key rises, and presses again as it goes down', () => {
    const r = { actuationMm: 2, rt: { pressMm: 0.15, releaseMm: 0.15 }, continuous: false }
    //              down past 2   peak  up .1  up .2   lowest  down .1  down .2
    expect(run(r, [1, 2.2, 3.0, 2.9, 2.8, 2.7, 2.8, 2.9])).toEqual([false, true, true, true, false, false, false, true])
    let s = KEY_UP
    for (const d of [2.2, 3.0]) s = stepKey(s, d, r)
    expect(nextPoint(s, r)).toBeCloseTo(2.85) // where it will release
  })

  it('above the actuation point Rapid Trigger lets go, unless it is continuous', () => {
    const r = { actuationMm: 2, rt: { pressMm: 0.2, releaseMm: 0.2 }, continuous: false }
    expect(run(r, [2.5, 1.5, 1.8, 2.0])).toEqual([true, false, false, true]) // back to the plain actuation point
    expect(run({ ...r, continuous: true }, [2.5, 1.5, 1.8])).toEqual([true, false, true]) // re-press 0.2 above the low point
  })

  it('the same sample twice changes nothing', () => {
    const r = { actuationMm: 2, rt: { pressMm: 0.15, releaseMm: 0.15 }, continuous: false }
    expect(run(r, [3, 3, 2.8, 2.8])).toEqual(run(r, [3, 2.8]).flatMap((p) => [p, p]))
  })
})

// What an analog key reports as pressed, from its live travel: plain actuation, or Rapid Trigger the way Wooting
// keyboards run it. Fed one travel sample at a time; feeding the same sample twice changes nothing.

export interface KeyRules {
  actuationMm: number
  rt: { pressMm: number; releaseMm: number } | null
  continuous: boolean // Rapid Trigger stays on until the key is fully up, not only below the actuation point
}

export interface KeyTravelState {
  pressed: boolean
  inRt: boolean // Rapid Trigger has taken over (the key went past the actuation point)
  peak: number // deepest point since the last press, where a release is measured from
  valley: number // highest point since the last release, where the next press is measured from
}

export const KEY_UP: KeyTravelState = { pressed: false, inRt: false, peak: 0, valley: 0 }
const FULLY_UP = 0.05

export function stepKey(s: KeyTravelState, d: number, r: KeyRules): KeyTravelState {
  if (!r.rt) return { ...KEY_UP, pressed: d >= r.actuationMm }
  if (d < FULLY_UP) return KEY_UP
  // Above the actuation point Rapid Trigger lets go, unless it's continuous.
  if (s.inRt && !r.continuous && d < r.actuationMm) return { ...KEY_UP, valley: d }
  if (s.pressed) {
    const peak = Math.max(s.peak, d)
    return d <= peak - r.rt.releaseMm ? { pressed: false, inRt: true, peak, valley: d } : { ...s, peak }
  }
  const valley = s.inRt ? Math.min(s.valley, d) : d
  const fire = s.inRt ? d >= valley + r.rt.pressMm : d >= r.actuationMm
  return fire ? { pressed: true, inRt: true, peak: d, valley } : { ...s, valley }
}

/** Where the next change happens, in mm: the release point while pressed, the re-press point while released in RT. */
export function nextPoint(s: KeyTravelState, r: KeyRules): number | null {
  if (!r.rt || !s.inRt) return null
  return s.pressed ? Math.max(0, s.peak - r.rt.releaseMm) : s.valley + r.rt.pressMm
}

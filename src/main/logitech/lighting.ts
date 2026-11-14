// Lighting stored in Logitech onboard profiles (G-series formats 1-6, as in libratbag's notes): two 11-byte LED
// entries at 0xD0 and 0xDB, and the same two again at 0xE6 and 0xF1 for the mouse's second (power-saving) set,
// which Hubless keeps equal to the first like G HUB does.
//   mode 0x00 off
//   mode 0x01 fixed colour: r g b, effect 0
//   mode 0x03 colour cycle: 5 unused bytes, period ms (BE16), intensity 1-100 (0 = 100)
//   mode 0x0A breathing: r g b, period ms (BE16), waveform, intensity 1-100 (0 = 100)
// Other modes (colour wave, starlight, ripple, custom animations) are kept byte for byte until the zone is changed.
import type { LightEffect, LightSetting, LightZone } from '@shared/types'

export const LED_SIZE = 11
export const LEDS = [0xd0, 0xdb]
export const ALT_LEDS = [0xe6, 0xf1]
/** Profile sectors shorter than this (255 bytes, the usual size) have no lighting entries. */
export const LIGHT_SECTOR_MIN = 0xff

const MODE = { off: 0x00, static: 0x01, cycle: 0x03, breathing: 0x0a } as const
export const DEFAULT_SPEED = { breathing: 5000, cycle: 10000 }

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
export const rgb = (c: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c)
  const n = m ? parseInt(m[1], 16) : 0xffffff
  return [n >> 16, (n >> 8) & 0xff, n & 0xff]
}

export function decodeLed(b: Uint8Array): LightSetting {
  const be = (o: number) => (b[o] << 8) | b[o + 1]
  const pct = (v: number) => (v === 0 || v > 100 ? 100 : v)
  switch (b[0]) {
    case MODE.off:
      return { effect: 'off', color: '#ffffff', brightness: 100, speedMs: DEFAULT_SPEED.breathing }
    case MODE.static:
      return { effect: 'static', color: hex(b[1], b[2], b[3]), brightness: 100, speedMs: DEFAULT_SPEED.breathing }
    case MODE.cycle:
      return { effect: 'cycle', color: '#ffffff', brightness: pct(b[8]), speedMs: be(6) || DEFAULT_SPEED.cycle }
    case MODE.breathing:
      return { effect: 'breathing', color: hex(b[1], b[2], b[3]), brightness: pct(b[7]), speedMs: be(4) || DEFAULT_SPEED.breathing }
    default:
      return { effect: 'other', color: '#ffffff', brightness: 100, speedMs: DEFAULT_SPEED.breathing }
  }
}

const same = (a: LightSetting, b: LightSetting) =>
  a.effect === b.effect && a.color.toLowerCase() === b.color.toLowerCase() && a.brightness === b.brightness && a.speedMs === b.speedMs

/** The 11 bytes for a setting; the old bytes when nothing changed (so unknown fields and effects survive). */
export function encodeLed(s: LightSetting, old: Uint8Array): Uint8Array {
  if (s.effect === 'other' || same(s, decodeLed(old))) return Uint8Array.from(old)
  const b = new Uint8Array(LED_SIZE)
  const speed = Math.max(1000, Math.min(20000, Math.round(s.speedMs)))
  const intensity = Math.max(1, Math.min(100, Math.round(s.brightness)))
  if (s.effect === 'static') b.set([MODE.static, ...rgb(s.color), 0])
  else if (s.effect === 'cycle') b.set([MODE.cycle, 0, 0, 0, 0, 0, speed >> 8, speed & 0xff, intensity === 100 ? 0 : intensity])
  else if (s.effect === 'breathing') b.set([MODE.breathing, ...rgb(s.color), speed >> 8, speed & 0xff, 0, intensity === 100 ? 0 : intensity])
  return b
}

/** HID++ LED zone locations (0x8070 / 0x8071) as shown to the user. */
export const ZONE_NAMES: Record<number, string> = { 1: 'Main lights', 2: 'Logo', 3: 'Left side', 4: 'Right side', 5: 'All lights' }

export function logitechZone(label: string): LightZone {
  const effects: LightEffect[] = ['off', 'static', 'breathing', 'cycle']
  return { label, effects, brightness: ['breathing', 'cycle'], speed: ['breathing', 'cycle'] }
}

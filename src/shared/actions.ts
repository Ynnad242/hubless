// Logitech onboard button actions (4 bytes) and G HUB HITS codes. Pure functions, usable in both processes.
import type { Hits } from './types'

export const MOUSE_BUTTONS: Record<number, string> = {
  0x0001: 'Left click', 0x0002: 'Right click', 0x0004: 'Middle click', 0x0008: 'Back',
  0x0010: 'Forward', 0x0020: 'Button 6', 0x0040: 'Button 7', 0x0080: 'Button 8'
}

export const FUNCTIONS: Record<number, string> = {
  0x01: 'Tilt left', 0x02: 'Tilt right', 0x03: 'Next DPI', 0x04: 'Previous DPI', 0x05: 'Cycle DPI',
  0x06: 'Default DPI', 0x07: 'DPI shift (hold)', 0x08: 'Next profile', 0x09: 'Previous profile',
  0x0a: 'Cycle profile', 0x0b: 'G-Shift (hold)', 0x0c: 'Show battery', 0x10: 'Scroll down', 0x11: 'Scroll up'
}

export const MEDIA: Record<number, string> = {
  0x00cd: 'Play / Pause', 0x00b5: 'Next track', 0x00b6: 'Previous track', 0x00b7: 'Stop',
  0x00e2: 'Mute', 0x00e9: 'Volume up', 0x00ea: 'Volume down', 0x006f: 'Brightness up',
  0x0070: 'Brightness down', 0x0192: 'Calculator', 0x0194: 'File manager', 0x018a: 'Mail',
  0x0223: 'Browser home', 0x0224: 'Browser back', 0x0225: 'Browser forward', 0x0227: 'Browser refresh'
}

export const MODIFIERS: Record<number, string> = {
  0x01: 'Ctrl', 0x02: 'Shift', 0x04: 'Alt', 0x08: 'Super',
  0x10: 'Right Ctrl', 0x20: 'Right Shift', 0x40: 'Right Alt', 0x80: 'Right Super'
}

export const KEYS: Record<number, string> = (() => {
  const k: Record<number, string> = {}
  for (let i = 0; i < 26; i++) k[0x04 + i] = String.fromCharCode(65 + i)
  for (let i = 0; i < 10; i++) k[0x1e + i] = String((i + 1) % 10)
  Object.assign(k, {
    0x28: 'Enter', 0x29: 'Esc', 0x2a: 'Backspace', 0x2b: 'Tab', 0x2c: 'Space', 0x2d: '-', 0x2e: '=',
    0x2f: '[', 0x30: ']', 0x31: '\\', 0x33: ';', 0x34: "'", 0x35: '`', 0x36: ',', 0x37: '.', 0x38: '/',
    0x39: 'Caps Lock', 0x46: 'Print Screen', 0x47: 'Scroll Lock', 0x48: 'Pause', 0x49: 'Insert',
    0x4a: 'Home', 0x4b: 'Page Up', 0x4c: 'Delete', 0x4d: 'End', 0x4e: 'Page Down', 0x4f: 'Right',
    0x50: 'Left', 0x51: 'Down', 0x52: 'Up'
  })
  for (let i = 0; i < 12; i++) k[0x3a + i] = `F${i + 1}`
  for (let i = 0; i < 12; i++) k[0x68 + i] = `F${i + 13}`
  return k
})()

/** Browser KeyboardEvent.code -> HID usage, for recording shortcuts. */
export const CODE_TO_HID: Record<string, number> = (() => {
  const m: Record<string, number> = {}
  for (let i = 0; i < 26; i++) m[`Key${String.fromCharCode(65 + i)}`] = 0x04 + i
  for (let i = 1; i <= 9; i++) m[`Digit${i}`] = 0x1d + i
  m.Digit0 = 0x27
  for (let i = 1; i <= 24; i++) m[`F${i}`] = i <= 12 ? 0x39 + i : 0x67 + (i - 12)
  Object.assign(m, {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
    BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
    Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47,
    Pause: 0x48, Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
    ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52
  })
  return m
})()

export type ActionKind = 'default' | 'disabled' | 'mouse' | 'key' | 'media' | 'function' | 'other'

const bytes = (hex: string) => hex.match(/../g)!.map((b) => parseInt(b, 16))
const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0')).join('')

export function actionKind(a: string): ActionKind {
  const r = bytes(a)
  if (a === 'ffffffff') return 'default'
  if (r[0] >> 4 === 0x8) return (['disabled', 'mouse', 'key', 'media'] as const)[r[1]] ?? 'other'
  if (r[0] >> 4 === 0x9) return 'function'
  return 'other'
}

export function actionCode(a: string): number {
  const r = bytes(a)
  switch (actionKind(a)) {
    case 'mouse':
    case 'media':
      return (r[2] << 8) | r[3]
    case 'key':
      return r[3]
    case 'function':
      return r[1]
    default:
      return 0
  }
}

export const Action = {
  mouse: (mask: number) => hex([0x80, 0x01, mask >> 8, mask & 0xff]),
  key: (usage: number, mods = 0) => hex([0x80, 0x02, mods, usage]),
  media: (usage: number) => hex([0x80, 0x03, usage >> 8, usage & 0xff]),
  fn: (id: number) => hex([0x90, id, 0xff, 0x00]),
  disabled: () => '8000ffff'
}

export function describeAction(a: string): string {
  const k = actionKind(a)
  const code = actionCode(a)
  if (k === 'mouse') return MOUSE_BUTTONS[code] ?? `Mouse buttons 0x${code.toString(16)}`
  if (k === 'key') {
    const mods = bytes(a)[2]
    const prefix = Object.entries(MODIFIERS)
      .filter(([bit]) => mods & Number(bit))
      .map(([, n]) => n + '+')
      .join('')
    return prefix + (KEYS[code] ?? `Key 0x${code.toString(16)}`)
  }
  if (k === 'media') return MEDIA[code] ?? `Media key 0x${code.toString(16)}`
  if (k === 'function') return FUNCTIONS[code] ?? `Function 0x${code.toString(16)}`
  if (k === 'disabled') return 'Disabled'
  if (k === 'default') return 'Default'
  return `Custom (${a})`
}

// ---------------------------------------------------------------- HITS codes

export function hitsCode(left: Hits, right: Hits): string {
  const d2 = (n: number) => String(n).padStart(2, '0')
  const s =
    `00${d2(left.actuation)}${d2(right.actuation)}${d2(left.rtLevel)}${d2(right.rtLevel)}` +
    `${+left.rtOn}${+right.rtOn}${d2(left.haptics)}${d2(right.haptics)}`
  return btoa(s)
}

export function parseHitsCode(code: string): [Hits, Hits] {
  let s: string
  try {
    s = atob(code.trim())
  } catch {
    throw new Error('That is not a HITS code.')
  }
  if (s.length !== 16 || !/^\d+$/.test(s) || !s.startsWith('00')) throw new Error('Unknown HITS code version.')
  const n = (i: number) => Number(s.slice(i, i + 2))
  const left: Hits = { actuation: n(2), rtLevel: n(6), rtOn: s[10] === '1', haptics: n(12) }
  const right: Hits = { actuation: n(4), rtLevel: n(8), rtOn: s[11] === '1', haptics: n(14) }
  for (const h of [left, right]) {
    if (h.actuation < 1 || h.actuation > 10 || h.rtLevel < 1 || h.rtLevel > 5 || h.haptics < 0 || h.haptics > 5)
      throw new Error('A value in that HITS code is out of range.')
  }
  return [left, right]
}

// ---------------------------------------------------------------- DPI grid

export function snapDpi(grid: { values: number[]; ranges: [number, number, number][] }, dpi: number): number {
  const all = [...grid.values, ...grid.ranges.flatMap((r) => [r[0], r[1]])]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const v = Math.max(min, Math.min(max, Math.round(dpi)))
  const cands = [...grid.values]
  for (const [lo, hi, step] of grid.ranges) {
    if (v >= lo && v <= hi) {
      cands.push(lo + Math.round((v - lo) / step) * step)
      break
    }
  }
  if (!cands.length) cands.push(...all)
  return cands.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))
}

export function gridBounds(grid: { values: number[]; ranges: [number, number, number][] }): [number, number] {
  const all = [...grid.values, ...grid.ranges.flatMap((r) => [r[0], r[1]])]
  return [Math.min(...all), Math.max(...all)]
}

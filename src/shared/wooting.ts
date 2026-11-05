// Wooting key codes and the physical 60% layout. Matrix ids are (row << 5) | col.

const NAMES: [number, string, string][] = [] // [code, long name, short label]
const add = (code: number, name: string, short = name) => NAMES.push([code, name, short])
for (let i = 0; i < 26; i++) add(0x01 + i, String.fromCharCode(65 + i))
for (let i = 0; i < 10; i++) add(0x1b + i, String((i + 1) % 10))
;([
  [0x25, 'Enter'], [0x26, 'Escape', 'Esc'], [0x27, 'Backspace', '⌫'], [0x28, 'Tab'], [0x29, 'Space', ''], [0x2a, 'Minus', '-'],
  [0x2b, 'Equals', '='], [0x2c, 'Left bracket', '['], [0x2d, 'Right bracket', ']'], [0x2e, 'Backslash', '\\'], [0x2f, 'ISO hash', '#'],
  [0x30, 'Semicolon', ';'], [0x31, 'Quote', "'"], [0x32, 'Grave', '`'], [0x33, 'Comma', ','], [0x34, 'Period', '.'], [0x35, 'Slash', '/'],
  [0x36, 'Caps Lock', 'Caps'], [0x43, 'Print Screen', 'PrtSc'], [0x44, 'Scroll Lock', 'ScrLk'], [0x45, 'Pause'], [0x46, 'Insert', 'Ins'],
  [0x47, 'Home'], [0x48, 'Page Up', 'PgUp'], [0x49, 'Delete', 'Del'], [0x4a, 'End'], [0x4b, 'Page Down', 'PgDn'], [0x4c, 'Right', '→'],
  [0x4d, 'Left', '←'], [0x4e, 'Down', '↓'], [0x4f, 'Up', '↑'], [0x51, 'Num Lock', 'NumLk'], [0x61, 'ISO backslash', '\\'],
  [0x63, 'Left Ctrl', 'Ctrl'], [0x64, 'Left Shift', 'Shift'], [0x65, 'Left Alt', 'Alt'], [0x66, 'Left Super', 'Super'],
  [0x67, 'Right Ctrl', 'Ctrl'], [0x68, 'Right Shift', 'Shift'], [0x69, 'Right Alt', 'Alt'], [0x6a, 'Right Super', 'Super'], [0x77, 'Menu'],
  [0xc0, 'Next track', '⏭'], [0xc1, 'Previous track', '⏮'], [0xc2, 'Play / Pause', '⏯'], [0xc3, 'Mute', '🔇'], [0xc4, 'Volume up', 'Vol+'],
  [0xc5, 'Volume down', 'Vol−'], [0xc6, 'Media player', 'Media'], [0xc7, 'Mail'], [0xc8, 'Calculator', 'Calc'], [0xc9, 'File manager', 'Files'],
  [0xca, 'Search'], [0xcb, 'Browser', 'Web'], [0xcc, 'Browser back', 'Back'], [0xcd, 'Browser forward', 'Fwd'], [0xd1, 'Power'],
  [0xd2, 'Sleep'], [0xd6, 'Display brightness down', 'Bri−'], [0xd7, 'Display brightness up', 'Bri+'], [0xd8, 'Left click', 'LMB'],
  [0xd9, 'Right click', 'RMB'], [0xda, 'Middle click', 'MMB'], [0xdb, 'Mouse back', 'M4'], [0xdc, 'Mouse forward', 'M5'],
  [0xe0, 'Lighting brighter', 'RGB+'], [0xe1, 'Lighting dimmer', 'RGB−'], [0xe5, 'Profile 1', 'P1'], [0xe2, 'Profile 2', 'P2'],
  [0xe3, 'Profile 3', 'P3'], [0xe4, 'Profile 4', 'P4'], [0xec, 'Cycle profile', 'P↻'], [0xe6, 'Lighting mode', 'RGB'], [0xe7, 'Fn', 'Fn'],
  [0xea, 'Fn 2', 'Fn2'], [0xeb, 'Fn 3', 'Fn3'], [0xe8, 'Key lock', 'Lock'], [0xff, 'None', '']
] as [number, string, string?][]).forEach(([c, n, s]) => add(c, n, s ?? n))
for (let i = 0; i < 12; i++) add(0x37 + i, `F${i + 1}`)
for (let i = 0; i < 12; i++) add(0x6b + i, `F${i + 13}`)

export const KEY_NAMES = new Map(NAMES.map(([c, n]) => [c, n]))
const SHORT = new Map(NAMES.map(([c, , s]) => [c, s]))
export const keyName = (c: number) => KEY_NAMES.get(c) ?? `0x${c.toString(16)}`
export const keyLabel = (c: number) => SHORT.get(c) ?? '?'

export const KEY_GROUPS: [string, number[]][] = [
  ['Letters & numbers', [...Array.from({ length: 26 }, (_, i) => 0x01 + i), ...Array.from({ length: 10 }, (_, i) => 0x1b + i)]],
  ['Modifiers', [0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0xe7, 0xea, 0xeb]],
  ['Editing & navigation', [0x25, 0x26, 0x27, 0x28, 0x29, 0x36, 0x46, 0x49, 0x47, 0x4a, 0x48, 0x4b, 0x4f, 0x4e, 0x4d, 0x4c, 0x77]],
  ['Symbols', [0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x2f, 0x61]],
  ['Function keys', [...Array.from({ length: 12 }, (_, i) => 0x37 + i), ...Array.from({ length: 12 }, (_, i) => 0x6b + i), 0x43, 0x44, 0x45, 0x51]],
  ['Media', [0xc2, 0xc0, 0xc1, 0xc3, 0xc4, 0xc5, 0xc6, 0xd6, 0xd7]],
  ['Apps & system', [0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xd1, 0xd2]],
  ['Mouse', [0xd8, 0xd9, 0xda, 0xdb, 0xdc]],
  ['Keyboard', [0xe5, 0xe2, 0xe3, 0xe4, 0xec, 0xe0, 0xe1, 0xe6, 0xe8, 0xff]]
]

export interface KeyDef {
  id: number // matrix id
  row: number
  col: number
  x: number // position and width in key units
  y: number
  w: number
}

// 60% ANSI: [matrix column, width] per row (matrix rows 1..5).
const ANSI_60: [number, number][][] = [
  [...Array.from({ length: 13 }, (_, c) => [c, 1] as [number, number]), [13, 2]],
  [[0, 1.5], ...Array.from({ length: 12 }, (_, c) => [c + 1, 1] as [number, number]), [13, 1.5]],
  [[0, 1.75], ...Array.from({ length: 11 }, (_, c) => [c + 1, 1] as [number, number]), [13, 2.25]],
  [[0, 2.25], ...Array.from({ length: 10 }, (_, c) => [c + 2, 1] as [number, number]), [13, 2.75]],
  [[0, 1.25], [1, 1.25], [2, 1.25], [6, 6.25], [10, 1.25], [11, 1.25], [12, 1.25], [13, 1.25]]
]

/** Physical layout. 60-key boards get the real 60% ANSI shape; others a plain grid of the cells in use. */
export function layoutFor(baseLayer: number[][]): KeyDef[] {
  const used = (r: number, c: number) => (baseLayer[r]?.[c] ?? 0xff) !== 0xff
  const is60 = baseLayer.length >= 6 && baseLayer.every((row, r) => row.slice(14).every((c) => c === 0xff) || r === 0)
  const keys: KeyDef[] = []
  if (is60) {
    ANSI_60.forEach((row, i) => {
      let x = 0
      for (const [col, w] of row) {
        keys.push({ id: ((i + 1) << 5) | col, row: i + 1, col, x, y: i, w })
        x += w
      }
    })
    return keys
  }
  baseLayer.forEach((row, r) => row.forEach((_, c) => used(r, c) && keys.push({ id: (r << 5) | c, row: r, col: c, x: c, y: r, w: 1 })))
  return keys
}

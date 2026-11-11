// Endgame Gear OP1 8k (USB 3367:1964) onboard configuration: one 1040-byte block, read with command a1 12 and
// written back whole through feature report a0 (command a0 11). No checksum. Layout verified on firmware 1.24;
// the shared offsets agree with egctl's notes for the OP1 8k v2, the button table sits 6 bytes earlier on v1.
import { Action, actionCode, actionKind } from '@shared/actions'
import type { MouseExtras, ProfileData, Stage } from '@shared/types'

export const CONFIG_LEN = 1040 // including the report id byte
export const RATES = [1000, 2000, 4000, 8000]
export const DPI_RANGE: [number, number, number] = [50, 26000, 50]
export const LEVELS = 4
export const SLOTS = 8 // left, right, middle, forward, back, DPI button, wheel up, wheel down

const OFF = {
  rate: 21, // polling divider of 8 kHz: 1 = 8000, 2 = 4000, 4 = 2000, 8 = 1000
  filters: 22, // 0x01 slam-click filter, 0x10 jitter filter
  lod: 25, // lift-off distance, 1 or 2 mm
  angleSnap: 26,
  ripple: 27,
  motionSync: 28,
  levels: 30, // active DPI levels, 1..4
  colors: 31, // 4 × [r, g, b, on, n] DPI LED colours
  cpis: 51, // 4 × [split, x LE16, y LE16]
  buttons: 71 // 8 × [type, value×5, debounce ms]
}
const SLAM = 0x01
const JITTER = 0x10

/** UI button order (Logitech style: left, right, wheel, back, forward) → OP1 slot. */
const UI_TO_SLOT = [0, 1, 2, 4, 3]

const TYPE = { mouse: 0, scroll: 1, key: 2, cpiLoop: 9, cpi: 12, media: 32, disabled: 0xff }
/** Logitech function ids the OP1 can do: cycle DPI, scroll down, scroll up. */
export const FUNCTIONS = [0x05, 0x10, 0x11]


const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)))
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const put16 = (b: Uint8Array, o: number, v: number) => {
  b[o] = v & 0xff
  b[o + 1] = v >> 8
}

export const rateOf = (divider: number) => (divider <= 1 ? 8000 : divider === 2 ? 4000 : divider <= 4 ? 2000 : 1000)
export const dividerOf = (hz: number) => ({ 8000: 1, 4000: 2, 2000: 4, 1000: 8 })[hz] ?? 8

/** A config block looks sane: the right size and a level count the firmware accepts. */
export const plausible = (b: Uint8Array) => b.length >= CONFIG_LEN - 4 && b[OFF.levels] >= 1 && b[OFF.levels] <= LEVELS

function slotAction(b: Uint8Array, slot: number): string {
  const o = OFF.buttons + slot * 7
  const [type, v0, v1] = [b[o], b[o + 1], b[o + 2]]
  switch (type) {
    case TYPE.mouse:
      return Action.mouse(v0)
    case TYPE.scroll:
      return Action.fn((v0 & 0x80) === 0 ? 0x11 : 0x10)
    case TYPE.key:
      return Action.key(v1, v0)
    case TYPE.cpiLoop:
      return Action.fn(0x05)
    case TYPE.media:
      return Action.media(v0)
    case TYPE.disabled:
      return Action.disabled()
    default:
      return hex([0xee, type, v0, v1]) // shown as "Custom", written back untouched
  }
}

function writeSlot(b: Uint8Array, slot: number, action: string) {
  const o = OFF.buttons + slot * 7
  const v = new Uint8Array(5)
  let type: number
  const k = actionKind(action)
  const code = actionCode(action)
  if (k === 'mouse') {
    if (code > 0xff) throw new Error('The OP1 8k only knows the five standard mouse buttons.')
    type = TYPE.mouse
    v[0] = code
  } else if (k === 'key') {
    type = TYPE.key
    v[0] = unhex(action)[2]
    v[1] = code
  } else if (k === 'media') {
    if (code > 0xff) throw new Error('The OP1 8k can’t send that media key.')
    type = TYPE.media
    v[0] = code
  } else if (k === 'disabled') type = TYPE.disabled
  else if (k === 'function' && code === 0x05) {
    type = TYPE.cpiLoop
    v[0] = b[o] === TYPE.cpiLoop ? b[o + 1] : 0xf1 // keep the firmware's own loop flags
  } else if (k === 'function' && (code === 0x10 || code === 0x11)) {
    type = TYPE.scroll
    v[0] = code === 0x11 ? 0x01 : 0xff
  } else throw new Error('The OP1 8k can’t do that action.')
  b[o] = type
  b.set(v, o + 1)
}

export function decode(b: Uint8Array): ProfileData & { extras: MouseExtras } {
  const levels = b[OFF.levels]
  const stages: Stage[] = []
  for (let i = 0; i < LEVELS; i++) {
    const o = OFF.cpis + i * 5
    const x = u16(b, o + 1)
    const y = b[o] ? u16(b, o + 3) : x
    stages.push(i < levels ? { x, y, lod: b[OFF.lod] } : { x: 0, y: 0, lod: b[OFF.lod] })
  }
  return {
    sector: 1, fmt: 0, enabled: true, name: '',
    rateHz: rateOf(b[OFF.rate]), rateWiredHz: null, sleepS: null, offS: null,
    stages, defaultStage: 0, shiftStage: 0, hits: null,
    buttons: UI_TO_SLOT.map((s) => slotAction(b, s)), shiftButtons: [],
    angleSnap: !!b[OFF.angleSnap],
    raw: hex(b),
    extras: {
      liftOffMm: b[OFF.lod] >= 2 ? 2 : 1,
      debounceMs: b[OFF.buttons + 6],
      motionSync: !!b[OFF.motionSync],
      rippleControl: !!b[OFF.ripple],
      slamClickFilter: !!(b[OFF.filters] & SLAM),
      jitterFilter: !!(b[OFF.filters] & JITTER)
    }
  }
}

/** Apply an edited profile onto the raw block it came from; untouched bytes stay as they were. */
export function encode(p: ProfileData & { extras?: MouseExtras }): Uint8Array {
  const b = unhex(p.raw)
  const before = decode(b)
  b[OFF.rate] = dividerOf(p.rateHz)
  b[OFF.angleSnap] = +p.angleSnap
  const on = p.stages.filter((s) => s.x > 0 && s.x < 0xffff)
  if (!on.length) throw new Error('Keep at least one DPI level.')
  if (on.length > LEVELS) throw new Error(`The OP1 8k has ${LEVELS} DPI levels.`)
  const [min, max, step] = DPI_RANGE
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  on.forEach((s, i) => {
    const o = OFF.cpis + i * 5
    const x = snap(s.x)
    const y = snap(s.y || s.x)
    b[o] = +(x !== y)
    put16(b, o + 1, x)
    put16(b, o + 3, y)
  })
  b[OFF.levels] = on.length
  p.buttons.forEach((a, i) => {
    if (i < UI_TO_SLOT.length && a !== before.buttons[i]) writeSlot(b, UI_TO_SLOT[i], a)
  })
  const x = p.extras
  if (x) {
    b[OFF.lod] = x.liftOffMm >= 2 ? 2 : 1
    b[OFF.motionSync] = +x.motionSync
    b[OFF.ripple] = +x.rippleControl
    b[OFF.filters] = (b[OFF.filters] & ~(SLAM | JITTER)) | (x.slamClickFilter ? SLAM : 0) | (x.jitterFilter ? JITTER : 0)
    const ms = Math.max(0, Math.min(25, Math.round(x.debounceMs)))
    for (let s = 0; s < SLOTS; s++) b[OFF.buttons + s * 7 + 6] = ms
  }
  return b
}

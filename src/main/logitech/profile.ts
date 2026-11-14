// Onboard profile sectors. Format 8 (PRO X2/X3 SUPERSTRIKE) is verified byte-for-byte on a PRO X2;
// formats 1-6 use the common G-series layout. Encoding patches the original bytes so unknown fields survive.
import type { Hits, ProfileData, Stage } from '@shared/types'
import { ALT_LEDS, LEDS, LED_SIZE, LIGHT_SECTOR_MIN, decodeLed, encodeLed } from './lighting'

export function crc16(data: Uint8Array): number {
  let crc = 0xffff
  for (const b of data) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

export const crcOk = (s: Uint8Array) => crc16(s.subarray(0, -2)) === ((s[s.length - 2] << 8) | s[s.length - 1])

export function withCrc(s: Uint8Array): Uint8Array {
  const out = Uint8Array.from(s)
  const c = crc16(out.subarray(0, -2))
  out[out.length - 2] = c >> 8
  out[out.length - 1] = c & 0xff
  return out
}

export const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex')
export const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'))

export const hitsToWire = (h: Hits) => [(h.actuation << 2) & 0xfc, ((h.rtLevel << 2) & 0xfc) | +h.rtOn, (h.haptics << 2) & 0xfc]
export const hitsFromWire = (b: ArrayLike<number>): Hits => ({
  actuation: b[0] >> 2, rtLevel: b[1] >> 2, rtOn: (b[1] & 1) === 1, haptics: b[2] >> 2
})

const enabled = (s: Stage) => s.x > 0 && s.x < 0xffff

/**
 * Move switched-on DPI stages to the front. The firmware counts stages from entry 0 up to the first
 * switched-off one, so a gap leaves it on no stage at all (live stage 0xFF, old DPI kept).
 */
export function packStages(p: ProfileData): ProfileData {
  const on = p.stages.map((s, i) => [s, i] as const).filter(([s]) => enabled(s))
  const off = p.stages.map((s, i) => [s, i] as const).filter(([s]) => !enabled(s))
  const order = [...on, ...off]
  const remap = new Map(order.map(([, old], i) => [old, i]))
  const stages = order.map(([s]) => (enabled(s) ? s : { x: 0, y: 0, lod: s.lod || 2 }))
  let def = remap.get(p.defaultStage) ?? 0
  if (def >= on.length) def = 0
  let shift = remap.get(p.shiftStage) ?? 0
  if (shift >= on.length) shift = def
  return { ...p, stages, defaultStage: def, shiftStage: shift }
}

const NAME = 0xa0
const nameFrom = (b: Uint8Array) => {
  if (b[0] === 0xff && b[1] === 0xff) return ''
  return Buffer.from(b).toString('utf16le').split('\0')[0].replace(/￿/g, '')
}
const nameBytes = (name: string, size: number) => {
  const out = new Uint8Array(size).fill(name ? 0 : 0xff)
  if (name) out.set(Buffer.from(name.slice(0, size / 2), 'utf16le').subarray(0, size))
  return out
}

const hzFromIndex = (i: number) => (i <= 6 ? 125 << i : 1000)
const indexFromHz = (hz: number) => Math.max(0, Math.min(6, Math.floor(Math.log2(hz / 125))))

export function decode(sector: number, raw: Uint8Array, fmt: number, isEnabled = true): ProfileData {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const act = (off: number) => toHex(raw.subarray(off, off + 4))
  if (fmt === 8) {
    return {
      sector, fmt, enabled: isEnabled, raw: toHex(raw),
      rateHz: hzFromIndex(raw[0]), rateWiredHz: hzFromIndex(raw[1]),
      defaultStage: raw[2] % 5, shiftStage: raw[3] % 5,
      stages: [0, 1, 2, 3, 4].map((i) => ({
        x: dv.getUint16(4 + 5 * i, true), y: dv.getUint16(6 + 5 * i, true), lod: raw[8 + 5 * i]
      })),
      angleSnap: raw[0x22] === 1,
      hits: [hitsFromWire(raw.subarray(0x26, 0x29)), hitsFromWire(raw.subarray(0x29, 0x2c))],
      sleepS: dv.getUint16(0x2c, true), offS: dv.getUint16(0x2e, true),
      buttons: Array.from({ length: 16 }, (_, i) => act(0x30 + 4 * i)),
      shiftButtons: Array.from({ length: 12 }, (_, i) => act(0x70 + 4 * i)),
      name: nameFrom(raw.subarray(NAME, NAME + 48))
    }
  }
  const words = [0, 1, 2, 3, 4].map((i) => dv.getUint16(3 + 2 * i, true))
  const ms = raw[0] || 1
  return {
    sector, fmt, enabled: isEnabled, raw: toHex(raw),
    rateHz: ms === 0xff ? 1000 : Math.round(1000 / ms), rateWiredHz: null,
    defaultStage: raw[1] % 5, shiftStage: raw[2] % 5,
    stages: words.map((w) => ({ x: w, y: w, lod: 0 })),
    angleSnap: raw[17] === 1, hits: null, sleepS: null, offS: null,
    buttons: Array.from({ length: 16 }, (_, i) => act(32 + 4 * i)),
    shiftButtons: Array.from({ length: 16 }, (_, i) => act(96 + 4 * i)),
    name: raw.length >= 208 ? nameFrom(raw.subarray(160, 208)) : '',
    ...(raw.length >= LIGHT_SECTOR_MIN && { lighting: LEDS.map((o) => decodeLed(raw.subarray(o, o + LED_SIZE))) })
  }
}

export function encode(profile: ProfileData): Uint8Array {
  const p = packStages(profile)
  const b = fromHex(p.raw)
  const dv = new DataView(b.buffer)
  const put = (off: number, hex: string) => b.set(fromHex(hex), off)
  if (p.fmt === 8) {
    b[0] = indexFromHz(p.rateHz)
    if (p.rateWiredHz) b[1] = indexFromHz(Math.min(p.rateWiredHz, 1000))
    b[2] = p.defaultStage
    b[3] = p.shiftStage
    p.stages.slice(0, 5).forEach((s, i) => {
      dv.setUint16(4 + 5 * i, s.x, true)
      dv.setUint16(6 + 5 * i, s.y, true)
      b[8 + 5 * i] = s.lod
    })
    b[0x22] = +p.angleSnap
    if (p.hits) b.set([...hitsToWire(p.hits[0]), ...hitsToWire(p.hits[1])], 0x26)
    if (p.sleepS != null) dv.setUint16(0x2c, p.sleepS, true)
    if (p.offS != null) dv.setUint16(0x2e, p.offS, true)
    p.buttons.slice(0, 16).forEach((a, i) => put(0x30 + 4 * i, a))
    p.shiftButtons.slice(0, 12).forEach((a, i) => put(0x70 + 4 * i, a))
    b.set(nameBytes(p.name, 48), NAME)
  } else {
    b[0] = Math.max(1, Math.min(8, Math.round(1000 / p.rateHz)))
    b[1] = p.defaultStage
    b[2] = p.shiftStage
    p.stages.slice(0, 5).forEach((s, i) => dv.setUint16(3 + 2 * i, enabled(s) ? s.x : 0, true))
    b[17] = +p.angleSnap
    p.buttons.slice(0, 16).forEach((a, i) => put(32 + 4 * i, a))
    p.shiftButtons.slice(0, 16).forEach((a, i) => put(96 + 4 * i, a))
    if (b.length >= 210) b.set(nameBytes(p.name, 48), 160)
    if (b.length >= LIGHT_SECTOR_MIN)
      p.lighting?.slice(0, LEDS.length).forEach((l, i) => {
        const old = b.slice(LEDS[i], LEDS[i] + LED_SIZE)
        const led = encodeLed(l, old)
        if (led.every((v, j) => v === old[j])) return
        b.set(led, LEDS[i])
        b.set(led, ALT_LEDS[i])
      })
  }
  return withCrc(b)
}

export const stageCount = (p: ProfileData) => p.stages.filter(enabled).length

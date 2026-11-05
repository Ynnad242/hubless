// Parametric EQ maths shared by the Scape driver (coefficients) and the UI (response graph, EQ codes).
import type { EqBand } from './types'

export const EQ_TYPES: EqBand['type'][] = ['peak', 'lowShelf', 'highShelf', 'lowPass', 'highPass', 'notch', 'bandPass']

/** RBJ cookbook biquad, normalised: [b0, b1, b2, a1, a2]. Matches the Scape's stored coefficients to 1e-7. */
export function biquad(b: EqBand, fs: number): [number, number, number, number, number] {
  const w0 = (2 * Math.PI * b.freq) / fs
  const A = 10 ** (b.gain / 40)
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * Math.max(b.q, 0.05))
  let c: number[]
  switch (b.type) {
    case 'lowShelf': {
      const s = 2 * Math.sqrt(A) * alpha
      c = [A * (A + 1 - (A - 1) * cos + s), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - s), A + 1 + (A - 1) * cos + s, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - s]
      break
    }
    case 'highShelf': {
      const s = 2 * Math.sqrt(A) * alpha
      c = [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s), A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s]
      break
    }
    case 'lowPass':
      c = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha]
      break
    case 'highPass':
      c = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha]
      break
    case 'notch':
      c = [1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha]
      break
    case 'bandPass':
      c = [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha]
      break
    default:
      c = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A]
  }
  return [c[0] / c[3], c[1] / c[3], c[2] / c[3], c[4] / c[3], c[5] / c[3]]
}

/** Combined response (dB) of the bands at frequency f. */
export function responseDb(bands: EqBand[], f: number, fs = 48000): number {
  const w = (2 * Math.PI * f) / fs
  let db = 0
  for (const b of bands) {
    const [b0, b1, b2, a1, a2] = biquad(b, fs)
    const re = (x0: number, x1: number, x2: number) => x0 + x1 * Math.cos(w) + x2 * Math.cos(2 * w)
    const im = (x1: number, x2: number) => -x1 * Math.sin(w) - x2 * Math.sin(2 * w)
    const num = re(b0, b1, b2) ** 2 + im(b1, b2) ** 2
    const den = re(1, a1, a2) ** 2 + im(a1, a2) ** 2
    db += 10 * Math.log10(num / den)
  }
  return db
}

// Adjust Pro EQ codes: base64 of [version=1][count][15 bytes per band: type, gain f32, Q f32, freq u16, 4 pad][xor]
export function eqCode(bands: EqBand[]): string {
  const buf = new DataView(new ArrayBuffer(3 + 15 * bands.length))
  buf.setUint8(0, 1)
  buf.setUint8(1, bands.length)
  bands.forEach((b, i) => {
    const o = 2 + 15 * i
    buf.setUint8(o, EQ_TYPES.indexOf(b.type))
    buf.setFloat32(o + 1, b.gain, true)
    buf.setFloat32(o + 5, b.q, true)
    buf.setUint16(o + 9, b.freq, true)
  })
  const bytes = new Uint8Array(buf.buffer)
  bytes[bytes.length - 1] = bytes.slice(0, -1).reduce((x, y) => x ^ y, 0)
  return btoa(String.fromCharCode(...bytes))
}

export function parseEqCode(code: string): EqBand[] {
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(code.trim()), (c) => c.charCodeAt(0))
  } catch {
    throw new Error('That is not an EQ code.')
  }
  if (bytes[0] !== 1 || bytes.length !== 3 + 15 * bytes[1]) throw new Error('Unknown EQ code version.')
  if (bytes.slice(0, -1).reduce((x, y) => x ^ y, 0) !== bytes[bytes.length - 1]) throw new Error('That EQ code is damaged.')
  const dv = new DataView(bytes.buffer)
  const bands: EqBand[] = []
  for (let i = 0; i < Math.min(bytes[1], 5); i++) {
    const o = 2 + 15 * i
    bands.push({ type: EQ_TYPES[dv.getUint8(o)] ?? 'peak', gain: dv.getFloat32(o + 1, true), q: dv.getFloat32(o + 5, true), freq: dv.getUint16(o + 9, true) })
  }
  return bands
}

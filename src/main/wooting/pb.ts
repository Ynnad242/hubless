// Minimal protobuf reader/writer. Messages are kept as ordered field lists so anything Hubless doesn't
// understand is written back exactly as the keyboard sent it.

export type Field = { f: number; v: number } | { f: number; b: Buffer }
export type Msg = Field[]

export function decode(buf: Buffer): Msg {
  const out: Msg = []
  let i = 0
  const varint = () => {
    let v = 0
    let s = 0
    let x: number
    do {
      if (i >= buf.length) throw new Error('truncated protobuf')
      x = buf[i++]
      v += (x & 0x7f) * 2 ** s
      s += 7
    } while (x & 0x80)
    return v
  }
  while (i < buf.length) {
    const key = varint()
    const f = Math.floor(key / 8)
    const wt = key & 7
    if (wt === 0) out.push({ f, v: varint() })
    else if (wt === 2) {
      const n = varint()
      out.push({ f, b: Buffer.from(buf.subarray(i, i + n)) })
      i += n
    } else throw new Error(`unsupported protobuf wire type ${wt}`)
  }
  return out
}

export function varint(v: number): number[] {
  const o: number[] = []
  do {
    let byte = v % 128
    v = Math.floor(v / 128)
    if (v) byte |= 0x80
    o.push(byte)
  } while (v)
  return o
}

export function encode(m: Msg): Buffer {
  const out: number[] = []
  for (const x of m) {
    if ('v' in x) out.push(...varint(x.f * 8), ...varint(x.v))
    else out.push(...varint(x.f * 8 + 2), ...varint(x.b.length), ...x.b)
  }
  return Buffer.from(out)
}

export const num = (m: Msg, f: number, d = 0) => {
  const x = m.find((y) => y.f === f && 'v' in y)
  return x && 'v' in x ? x.v : d
}
export const bytes = (m: Msg, f: number) => {
  const x = m.find((y) => y.f === f && 'b' in y)
  return x && 'b' in x ? x.b : null
}
export const msg = (m: Msg, f: number): Msg => {
  const b = bytes(m, f)
  return b ? decode(b) : []
}
export const all = (m: Msg, f: number): Buffer[] => m.filter((y) => y.f === f && 'b' in y).map((y) => (y as { b: Buffer }).b)

export function packed(b: Buffer | null): number[] {
  if (!b) return []
  const out: number[] = []
  let i = 0
  while (i < b.length) {
    let v = 0
    let s = 0
    let x: number
    do {
      x = b[i++]
      v += (x & 0x7f) * 2 ** s
      s += 7
    } while (x & 0x80)
    out.push(v)
  }
  return out
}
export const pack = (nums: number[]) => Buffer.from(nums.flatMap(varint))

/** Replace (or append) a scalar field, keeping field order. */
export function setNum(m: Msg, f: number, v: number): Msg {
  const i = m.findIndex((x) => x.f === f)
  const next = [...m]
  if (i >= 0) next[i] = { f, v }
  else next.push({ f, v })
  return next.sort((a, b) => a.f - b.f)
}
export function setBytes(m: Msg, f: number, b: Buffer): Msg {
  const i = m.findIndex((x) => x.f === f)
  const next = [...m]
  if (i >= 0) next[i] = { f, b }
  else next.push({ f, b })
  return next.sort((a, b2) => a.f - b2.f)
}

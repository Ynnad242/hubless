// The user's own top-down photo of their mouse, with the buttons found in the photo and drawn on like G HUB:
// selection tint, actuation line, rapid-trigger window and live presses. Falls back to null if the photo
// doesn't look like a dark-buttoned top view (the caller then shows the drawn mouse).
import { useEffect, useRef, useState } from 'react'
import type { Hits } from '@shared/types'

interface Masks {
  w: number
  h: number
  left: Uint8Array
  right: Uint8Array
  top: number // first and last rows of the button area
  bottom: number
  cx: number // centre column
}

function findButtons(img: HTMLImageElement): Masks | null {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0)
  const px = g.getImageData(0, 0, w, h).data
  // Body extent (non-transparent pixels) gives the centre line.
  let minX = w
  let maxX = 0
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < w; x += 2) {
      if (px[(y * w + x) * 4 + 3] > 200) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
      }
    }
  const cx = Math.round((minX + maxX) / 2)
  const left = new Uint8Array(w * h)
  const right = new Uint8Array(w * h)
  let top = h
  let bottom = 0
  let count = 0
  const limit = Math.round(h * 0.55)
  for (let y = 0; y < limit; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (px[i + 3] < 200) continue
      const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
      if (lum > 95) continue
      if (Math.abs(x - cx) < w * 0.07) continue // wheel and the split between the buttons
      ;(x < cx ? left : right)[y * w + x] = 1
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
      count++
    }
  if (count >= w * h * 0.03) return { w, h, left, right, top, bottom, cx }
  return findLightButtons(px, w, h, minX, maxX, cx)
}

/** Light-coloured mice (e.g. a white OP1 8k): the main buttons are the body above the seam that runs across it. */
function findLightButtons(px: Uint8ClampedArray, w: number, h: number, minX: number, maxX: number, cx: number): Masks | null {
  const body = maxX - minX
  const opaque = (x: number, y: number) => px[(y * w + x) * 4 + 3] > 200
  const dark = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] < 150
  }
  let seam = -1
  for (let y = Math.round(h * 0.2); y < Math.round(h * 0.55) && seam < 0; y++) {
    let n = 0
    for (let x = minX; x <= maxX; x++) if (opaque(x, y) && dark(x, y)) n++
    if (n > body * 0.45) seam = y
  }
  if (seam < 0) return null
  let top = -1
  for (let y = 0; y < seam && top < 0; y++) for (let x = minX; x <= maxX; x += 2) if (opaque(x, y)) top = y
  const left = new Uint8Array(w * h)
  const right = new Uint8Array(w * h)
  for (let y = Math.max(0, top); y < seam; y++)
    for (let x = minX; x <= maxX; x++) {
      if (!opaque(x, y) || Math.abs(x - cx) < w * 0.07) continue
      ;(x < cx ? left : right)[y * w + x] = 1
    }
  return { w, h, left, right, top: Math.max(0, top), bottom: seam, cx }
}

interface Props {
  photo: string
  selected: number[] // profile button slots: 0 left, 1 right, 2 wheel, 3 back, 4 forward
  pressed?: number[]
  hits?: Hits[] | null // when set, actuation lines are drawn on the main buttons
  maxAct?: number
  onButton?: (i: number) => void
  badges?: boolean // numbered badges on every button (Buttons page)
  depth?: [number, number] // live press depth of left/right on the actuation scale
  className?: string
  onUnsupported?: () => void
}

// Wheel and side buttons as fractions of a top-down photo (tuned on the PRO X2 SUPERSTRIKE).
const SPOTS: Record<number, { x: number; y: number; w: number; h: number }> = {
  2: { x: 0.415, y: 0.11, w: 0.17, h: 0.155 },
  4: { x: 0.0, y: 0.32, w: 0.06, h: 0.115 },
  3: { x: 0.0, y: 0.445, w: 0.07, h: 0.165 }
}

export function PhotoMouse({ photo, selected, pressed = [], hits, maxAct = 10, onButton, badges, depth, className, onUnsupported }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [masks, setMasks] = useState<Masks | null>(null)

  useEffect(() => {
    const i = new Image()
    i.onload = () => {
      const m = findButtons(i)
      if (!m) onUnsupported?.()
      setImg(i)
      setMasks(m)
    }
    i.src = photo
  }, [photo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!img || !masks || !canvas.current) return
    const { w, h } = masks
    const c = canvas.current
    c.width = w
    c.height = h
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const tint = g.getImageData(0, 0, w, h)
    const d = tint.data
    const span = masks.bottom - masks.top
    for (const side of [0, 1] as const) {
      const mask = side ? masks.right : masks.left
      const on = selected.includes(side)
      const live = depth?.[side] ?? 0
      const down = pressed.includes(side) || (!!hits && live >= (hits[side]?.actuation ?? 99))
      if (!on && !down && !live) continue
      const depthY = masks.top + span * (live / (maxAct + 1))
      const act = hits?.[side]?.actuation ?? 0
      const lineY = masks.top + span * (act / (maxAct + 1))
      const rt = hits?.[side]?.rtOn ? (span * (hits![side].rtLevel ?? 1)) / (2 * (maxAct + 1)) : 0
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue
        const y = Math.floor(i / w)
        // Pressed part (above the actuation line) is the strong blue; below it a lighter tint.
        let a = !hits ? 0.55 : y <= lineY ? 0.62 : 0.32
        if (hits && rt && y > lineY - rt && y <= lineY) a = 0.45
        if (live && y <= depthY) a = down ? 0.92 : 0.78 // the part of the button that is pushed down right now
        else if (down && !live) a = 0.85
        const k = i * 4
        d[k] = d[k] * (1 - a) + 43 * a
        d[k + 1] = d[k + 1] * (1 - a) + 140 * a
        d[k + 2] = d[k + 2] * (1 - a) + 255 * a
      }
    }
    g.putImageData(tint, 0, 0)
    // Actuation lines with their level, like the G HUB view.
    for (const side of [0, 1] as const) {
      if (!hits?.[side]) continue
      const act = hits[side].actuation
      const y = masks.top + span * (act / (maxAct + 1))
      const xs: number[] = []
      const mask = side ? masks.right : masks.left
      for (let x = 0; x < w; x++) if (mask[Math.round(y) * w + x]) xs.push(x)
      if (!xs.length) continue
      g.strokeStyle = 'rgba(255,255,255,0.95)'
      g.lineWidth = Math.max(2, w / 220)
      g.setLineDash([w / 70, w / 110])
      g.beginPath()
      g.moveTo(xs[0], y)
      g.lineTo(xs[xs.length - 1], y)
      g.stroke()
      g.setLineDash([])
      const bx = (xs[0] + xs[xs.length - 1]) / 2
      const r = w / 17
      g.fillStyle = selected.includes(side) ? '#2b8cff' : 'rgba(17,18,21,0.9)'
      g.beginPath()
      g.arc(bx, y, r, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#fff'
      g.lineWidth = Math.max(1.5, w / 300)
      g.stroke()
      g.fillStyle = '#fff'
      g.font = `700 ${Math.round(r * 1.1)}px Inter, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(String(act), bx, y + 1)
    }
    // Wheel and side buttons: outlined areas, filled when selected or pressed.
    for (const [slot, r] of Object.entries(SPOTS)) {
      const i = Number(slot)
      const on = selected.includes(i)
      const down = pressed.includes(i)
      if (!on && !down && !badges) continue
      const x = r.x * w
      const y = r.y * h
      const rw = r.w * w
      const rh = r.h * h
      g.beginPath()
      g.roundRect(x, y, rw, rh, Math.min(rw, rh) / 2)
      g.fillStyle = down ? 'rgba(43,140,255,0.85)' : on ? 'rgba(43,140,255,0.5)' : 'rgba(43,140,255,0.0)'
      g.fill()
      g.strokeStyle = on || down ? '#2b8cff' : 'rgba(43,140,255,0.55)'
      g.lineWidth = Math.max(2, w / 200)
      g.stroke()
    }
    if (badges) {
      const centre = (slot: number): [number, number] => {
        if (slot === 0) return [masks.cx - w * 0.2, masks.top + (masks.bottom - masks.top) * 0.42]
        if (slot === 1) return [masks.cx + w * 0.2, masks.top + (masks.bottom - masks.top) * 0.42]
        const r = SPOTS[slot]
        return [(r.x + r.w / 2) * w + (slot >= 3 ? w * 0.075 : 0), (r.y + r.h / 2) * h]
      }
      const rad = w / 22
      for (const slot of [0, 1, 2, 3, 4]) {
        const [bx, by] = centre(slot)
        const sel = selected.includes(slot)
        g.beginPath()
        g.arc(bx, by, rad, 0, Math.PI * 2)
        g.fillStyle = sel ? '#ffffff' : 'rgba(17,18,21,0.92)'
        g.fill()
        g.strokeStyle = sel ? '#2b8cff' : 'rgba(255,255,255,0.75)'
        g.lineWidth = Math.max(2, w / 220)
        g.stroke()
        g.fillStyle = sel ? '#2b8cff' : '#ffffff'
        g.font = `700 ${Math.round(rad * 1.15)}px Inter, sans-serif`
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(String(slot + 1), bx, by + 1)
      }
    }
  }, [img, masks, selected, pressed, hits, maxAct, badges, depth])

  if (!img || !masks) return null
  return (
    <canvas
      ref={canvas}
      className={className}
      style={{ cursor: onButton ? 'pointer' : undefined }}
      onClick={(e) => {
        if (!onButton) return
        const r = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - r.left) / r.width) * masks.w
        const y = ((e.clientY - r.top) / r.height) * masks.h
        for (const [slot, s2] of Object.entries(SPOTS)) {
          const pad = masks.w * 0.03
          if (x >= s2.x * masks.w - pad && x <= (s2.x + s2.w) * masks.w + pad && y >= s2.y * masks.h && y <= (s2.y + s2.h) * masks.h) return onButton(Number(slot))
        }
        if (y < masks.bottom + masks.h * 0.03) onButton(x < masks.cx ? 0 : 1)
      }}
      aria-label="Your mouse"
    />
  )
}

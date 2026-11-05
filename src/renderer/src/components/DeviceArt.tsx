// Hubless's own product illustrations (no vendor artwork): a symmetrical gaming mouse, a 60% keyboard and a headset.
import { type ReactNode, useId } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------- mouse geometry (viewBox 0 0 240 400)
export const MOUSE = {
  body: 'M120 18 C178 18 206 72 210 152 C214 242 206 330 176 368 C160 389 80 389 64 368 C34 330 26 242 30 152 C34 72 62 18 120 18 Z',
  left: 'M117 23 C72 25 41 68 36 152 C62 162 94 166 117 166 Z',
  right: 'M123 23 C168 25 199 68 204 152 C178 162 146 166 123 166 Z',
  wheel: { x: 111, y: 58, w: 18, h: 58 },
  forward: { x: 23, y: 150, w: 11, h: 40 },
  back: { x: 23, y: 196, w: 11, h: 40 },
  /** anchor points for callouts, per profile button slot */
  anchors: [
    [78, 92],
    [162, 92],
    [120, 87],
    [28, 216],
    [28, 170]
  ] as [number, number][]
}

export type MouseRegion = 0 | 1 | 2 | 3 | 4

interface MouseProps {
  /** button slots drawn in the accent colour */
  highlight?: number[]
  /** slots that are pressed right now */
  pressed?: number[]
  onRegion?: (i: MouseRegion) => void
  hover?: number | null
  onHover?: (i: number | null) => void
  className?: string
  children?: ReactNode // extra SVG drawn in the mouse's coordinate space
  dark?: boolean
}

/** Top view of a symmetrical gaming mouse. Regions are clickable when onRegion is set. */
export function MouseArt({ highlight = [], pressed = [], onRegion, hover, onHover, className, children, dark }: MouseProps) {
  const id = useId().replace(/:/g, '')
  const shell = dark ? ['#3a3c42', '#1b1c20'] : ['#fbfbfc', '#c8cbd2']
  const region = (i: MouseRegion, el: ReactNode) => {
    const lit = highlight.includes(i) || pressed.includes(i)
    return (
      <g
        key={i}
        onClick={onRegion ? () => onRegion(i) : undefined}
        onMouseEnter={onHover ? () => onHover(i) : undefined}
        onMouseLeave={onHover ? () => onHover(null) : undefined}
        style={{ cursor: onRegion ? 'pointer' : undefined }}
        fill={lit ? (pressed.includes(i) ? '#5aa7ff' : `url(#${id}-lit)`) : hover === i ? `url(#${id}-hover)` : 'transparent'}
        className="transition-[fill] duration-150"
      >
        {el}
      </g>
    )
  }
  return (
    <svg viewBox="0 0 240 400" className={cn('h-full w-auto overflow-visible', className)} aria-hidden={!onRegion}>
      <defs>
        <radialGradient id={`${id}-shell`} cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor={shell[0]} />
          <stop offset="1" stopColor={shell[1]} />
        </radialGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#fff" stopOpacity={dark ? 0.08 : 0.55} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-lit`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4ea2ff" stopOpacity="0.92" />
          <stop offset="1" stopColor="#1f7ef0" stopOpacity="0.92" />
        </linearGradient>
        <linearGradient id={`${id}-hover`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b8cff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#2b8cff" stopOpacity="0.18" />
        </linearGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <path d={MOUSE.body} />
        </clipPath>
      </defs>
      <ellipse cx="120" cy="378" rx="104" ry="18" fill={`url(#${id}-shadow)`} />
      {/* side buttons sit under the shell edge */}
      {[MOUSE.forward, MOUSE.back].map((r, k) => (
        <rect key={k} x={r.x} y={r.y} width={r.w} height={r.h} rx="5" fill={dark ? '#2a2c31' : '#b9bdc6'} />
      ))}
      <path d={MOUSE.body} fill={`url(#${id}-shell)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <rect x="60" y="0" width="80" height="400" fill={`url(#${id}-sheen)`} opacity="0.7" />
      </g>
      {/* button split + palm line */}
      <path d="M120 22 L120 166" stroke={dark ? '#0d0d10' : '#9da2ad'} strokeWidth="2.2" />
      <path d="M36 152 C62 162 94 166 117 166 M123 166 C146 166 178 162 204 152" fill="none" stroke={dark ? '#0d0d10' : '#a7acb6'} strokeWidth="1.6" />
      {region(0, <path d={MOUSE.left} />)}
      {region(1, <path d={MOUSE.right} />)}
      {/* wheel well + wheel */}
      <rect x="106" y="52" width="28" height="70" rx="14" fill={dark ? '#0c0c0f' : '#2a2c31'} />
      {region(2, <rect x={MOUSE.wheel.x} y={MOUSE.wheel.y} width={MOUSE.wheel.w} height={MOUSE.wheel.h} rx="9" />)}
      {!highlight.includes(2) && !pressed.includes(2) && hover !== 2 && (
        <g pointerEvents="none">
          <rect x={MOUSE.wheel.x} y={MOUSE.wheel.y} width={MOUSE.wheel.w} height={MOUSE.wheel.h} rx="9" fill="#3a3d44" />
          {Array.from({ length: 9 }, (_, i) => (
            <line key={i} x1="113" x2="127" y1={63 + i * 6} y2={63 + i * 6} stroke="#55585f" strokeWidth="1.2" />
          ))}
        </g>
      )}
      {region(4, <rect x={MOUSE.forward.x} y={MOUSE.forward.y} width={MOUSE.forward.w} height={MOUSE.forward.h} rx="5" />)}
      {region(3, <rect x={MOUSE.back.x} y={MOUSE.back.y} width={MOUSE.back.w} height={MOUSE.back.h} rx="5" />)}
      {children}
    </svg>
  )
}

// ---------------------------------------------------------------- keyboard (60%)

const ROWS: number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75],
  [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25]
]

export function KeyboardArt({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const u = 18.8 // one key unit; every row is 15 units wide
  return (
    <svg viewBox="0 0 300 116" className={cn('h-auto w-full', className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}-case`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c2e34" />
          <stop offset="1" stopColor="#16171a" />
        </linearGradient>
        <linearGradient id={`${id}-cap`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3d44" />
          <stop offset="1" stopColor="#24262b" />
        </linearGradient>
        <linearGradient id={`${id}-glow`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2b8cff" />
          <stop offset="1" stopColor="#7c6cff" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="294" height="110" rx="9" fill={`url(#${id}-case)`} stroke="#3c3f46" strokeWidth="1" />
      {ROWS.map((row, r) => {
        let x = 9
        return row.map((w, k) => {
          const kx = x
          x += w * u
          return (
            <g key={`${r}-${k}`}>
              <rect x={kx} y={9 + r * u} width={w * u - 1.6} height={u - 1.6} rx="3" fill={`url(#${id}-cap)`} />
              <rect x={kx + 2.5} y={9 + r * u + 2} width={w * u - 6.6} height={u - 7} rx="2" fill="#ffffff" opacity="0.05" />
            </g>
          )
        })
      })}
      <rect x="9" y="108.5" width="282" height="1.6" rx="1" fill={`url(#${id}-glow)`} opacity="0.85" />
    </svg>
  )
}

// ---------------------------------------------------------------- headset

export function HeadsetArt({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 220 230" className={cn('h-full w-auto', className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}-band`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4d55" />
          <stop offset="1" stopColor="#1d1e22" />
        </linearGradient>
        <radialGradient id={`${id}-cup`} cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#40434b" />
          <stop offset="1" stopColor="#141518" />
        </radialGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="110" cy="218" rx="86" ry="10" fill={`url(#${id}-shadow)`} />
      <path d="M34 128 C30 52 66 14 110 14 C154 14 190 52 186 128" fill="none" stroke={`url(#${id}-band)`} strokeWidth="15" strokeLinecap="round" />
      <path d="M44 120 C42 62 72 30 110 30 C148 30 178 62 176 120" fill="none" stroke="#2b2d32" strokeWidth="6" strokeLinecap="round" />
      {[38, 182].map((cx, k) => (
        <g key={cx}>
          <rect x={cx - 10} y="110" width="20" height="26" rx="6" fill="#2a2c31" />
          <ellipse cx={cx} cy="160" rx="32" ry="44" fill={`url(#${id}-cup)`} stroke="#4a4d55" strokeWidth="1.2" />
          <ellipse cx={cx + (k ? -9 : 9)} cy="160" rx="16" ry="27" fill="#0f1012" opacity="0.65" />
          <ellipse cx={cx} cy="160" rx="7" ry="11" fill="#2b8cff" opacity="0.9" />
        </g>
      ))}
      <path d="M44 186 C56 214 92 222 116 212" fill="none" stroke="#2f3136" strokeWidth="5" strokeLinecap="round" />
      <circle cx="118" cy="211" r="6" fill="#1b1c20" stroke="#4a4d55" />
    </svg>
  )
}

export function DeviceArt({ kind, className }: { kind: 'mouse' | 'keyboard' | 'headset'; className?: string }) {
  if (kind === 'keyboard') return <KeyboardArt className={className} />
  if (kind === 'headset') return <HeadsetArt className={className} />
  return <MouseArt className={className} />
}

import { useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { responseDb } from '@shared/eq'
import type { EqBand } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const TYPES: [EqBand['type'], string][] = [
  ['peak', 'Peak'], ['lowShelf', 'Low shelf'], ['highShelf', 'High shelf'], ['lowPass', 'Low pass'], ['highPass', 'High pass'], ['notch', 'Notch'], ['bandPass', 'Band pass']
]
const COLORS = ['#2b8cff', '#34c77b', '#f5a524', '#ff5a8a', '#a78bfa']
const W = 640
const H = 240
const R = 12
const fx = (f: number) => (Math.log10(f / 20) / 3) * W
const xf = (x: number) => 20 * 10 ** ((x / W) * 3)
const gy = (db: number) => H / 2 - (Math.max(-R, Math.min(R, db)) / R) * (H / 2 - 10)
const yg = (y: number) => ((H / 2 - y) / (H / 2 - 10)) * R
const hz = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k` : `${Math.round(f)}`)

/** Interactive parametric EQ: drag points (frequency/gain), edit numbers, add/remove bands. */
export function EqEditor({ bands, onChange, readOnly }: { bands: EqBand[]; onChange: (b: EqBand[], done: boolean) => void; readOnly?: boolean }) {
  const [sel, setSel] = useState(0)
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const path = useMemo(() => {
    const pts: string[] = []
    for (let i = 0; i <= 240; i++) {
      const f = 20 * 1000 ** (i / 240)
      pts.push(`${i ? 'L' : 'M'}${fx(f).toFixed(1)} ${gy(responseDb(bands, f)).toFixed(1)}`)
    }
    return pts.join(' ')
  }, [bands])
  const set = (i: number, patch: Partial<EqBand>, done = true) => onChange(bands.map((b, k) => (k === i ? { ...b, ...patch } : b)), done)
  const point = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * (W + 50) - 40, ((e.clientY - r.top) / r.height) * (H + 30) - 6]
  }
  const b = bands[sel]
  const hasGain = (t: EqBand['type']) => t === 'peak' || t === 'lowShelf' || t === 'highShelf'

  return (
    <div className="w-full max-w-3xl space-y-4">
      <svg
        ref={svg}
        viewBox={`-40 -6 ${W + 50} ${H + 30}`}
        className={cn('w-full touch-none select-none', !readOnly && 'cursor-crosshair')}
        onPointerMove={(e) => {
          if (drag.current === null) return
          const [x, y] = point(e)
          const i = drag.current
          set(i, { freq: Math.round(Math.max(20, Math.min(20000, xf(Math.max(0, Math.min(W, x)))))), ...(hasGain(bands[i].type) ? { gain: Math.round(yg(y) * 10) / 10 } : {}) }, false)
        }}
        onPointerUp={() => {
          if (drag.current !== null) onChange(bands, true)
          drag.current = null
        }}
        aria-label="EQ curve"
      >
        {[-12, -6, 0, 6, 12].map((db) => (
          <g key={db}>
            <line x1="0" x2={W} y1={gy(db)} y2={gy(db)} stroke="currentColor" strokeOpacity={db === 0 ? 0.25 : 0.08} />
            <text x="-8" y={gy(db) + 4} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.45">
              {db > 0 ? `+${db}` : db}
            </text>
          </g>
        ))}
        {[50, 100, 200, 500, 1000, 2000, 5000, 10000].map((f) => (
          <g key={f}>
            <line x1={fx(f)} x2={fx(f)} y1="0" y2={H} stroke="currentColor" strokeOpacity="0.06" />
            <text x={fx(f)} y={H + 16} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.45">
              {hz(f)}
            </text>
          </g>
        ))}
        <path d={`${path} L${W} ${H / 2} L0 ${H / 2} Z`} fill="#2b8cff" opacity="0.12" />
        <path d={path} fill="none" stroke="#2b8cff" strokeWidth="2.5" strokeLinejoin="round" />
        {bands.map((band, i) => (
          <circle
            key={i}
            cx={fx(band.freq)}
            cy={gy(hasGain(band.type) ? band.gain : 0)}
            r={i === sel ? 9 : 7}
            fill={COLORS[i]}
            stroke="#0b0b0d"
            strokeWidth="2"
            className={readOnly ? undefined : 'cursor-grab'}
            onPointerDown={(e) => {
              setSel(i)
              if (readOnly) return
              ;(e.target as Element).setPointerCapture(e.pointerId)
              drag.current = i
            }}
          />
        ))}
      </svg>

      {!readOnly && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            {bands.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSel(i)}
                className={cn('flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold', i === sel ? 'border-primary/60 bg-primary/10' : 'bg-surface-2')}
              >
                <span className="size-2 rounded-full" style={{ background: COLORS[i] }} /> Band {i + 1}
              </button>
            ))}
            {bands.length < 5 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => {
                  onChange([...bands, { type: 'peak', freq: 1000, gain: 0, q: 1 }], true)
                  setSel(bands.length)
                }}
              >
                <Plus className="size-3.5" /> Add band
              </Button>
            )}
          </div>
          {b && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-surface p-3">
              <Field label="Type">
                <Select value={b.type} onValueChange={(v) => set(sel, { type: v as EqBand['type'] })}>
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map(([v, t]) => (
                      <SelectItem key={v} value={v}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Num label="Frequency (Hz)" value={b.freq} min={20} max={20000} step={1} onCommit={(v) => set(sel, { freq: Math.round(v) })} />
              {hasGain(b.type) && <Num label="Gain (dB)" value={+b.gain.toFixed(1)} min={-12} max={12} step={0.1} onCommit={(v) => set(sel, { gain: v })} />}
              <Num label="Q" value={+b.q.toFixed(2)} min={0.1} max={10} step={0.01} onCommit={(v) => set(sel, { q: v })} />
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto size-8 text-muted-foreground"
                aria-label="Remove band"
                onClick={() => {
                  onChange(bands.filter((_, k) => k !== sel), true)
                  setSel(Math.max(0, sel - 1))
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="caption block">{label}</span>
      {children}
    </label>
  )
}

function Num({ label, value, min, max, step, onCommit }: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  return (
    <Field label={label}>
      <Input
        key={value}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step={step}
        className="h-8 w-28 tabular-nums"
        onBlur={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v) && v !== value) onCommit(Math.max(min, Math.min(max, v)))
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </Field>
  )
}

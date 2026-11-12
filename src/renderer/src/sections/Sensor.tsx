import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ProfileData, Stage } from '@shared/types'
import { gridBounds, snapDpi } from '@shared/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Canvas, Caption, Row, SidePanel } from '@/components/kit'
import type { MouseCtl } from '@/hooks/useMouse'
import { cn } from '@/lib/utils'

/** One colour per DPI stage, matching the indicator dots everywhere. */
export const STAGE_COLORS = ['#2b8cff', '#34c77b', '#f5a524', '#ff5a8a', '#a78bfa']
const SLEEP: [number, string][] = [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes'], [900, '15 minutes']]
const TICKS = [200, 400, 800, 1600, 3200, 6400, 12800, 25600]
/** One-click DPI values under the big readout. */
const PRESETS = [400, 800, 1200, 1600, 2400, 3200, 6400]
const on = (s: Stage) => s.x > 0 && s.x < 0xffff
const fmt = (n: number) => n.toLocaleString('en-US')
const short = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`)

/** The firmware cycles switched-on stages in order with no gaps, so stages are kept packed at the front. */
function pack(d: ProfileData) {
  const order = [...d.stages.keys()].sort((a, b) => +on(d.stages[b]) - +on(d.stages[a]) || a - b)
  const remap = new Map(order.map((old, i) => [old, i]))
  d.stages = order.map((i) => (on(d.stages[i]) ? d.stages[i] : { x: 0, y: 0, lod: d.stages[i].lod || 2 }))
  const count = d.stages.filter(on).length
  d.defaultStage = Math.min(remap.get(d.defaultStage) ?? 0, Math.max(0, count - 1))
  d.shiftStage = Math.min(remap.get(d.shiftStage) ?? 0, Math.max(0, count - 1))
}

export function Sensor({ mouse }: { mouse: MouseCtl }) {
  const { draft, state, update, editSector } = mouse
  const [sel, setSel] = useState(0)
  const [text, setText] = useState('')
  const [more, setMore] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const track = useRef<HTMLDivElement>(null)
  useEffect(() => setSel(draft?.defaultStage ?? 0), [editSector]) // eslint-disable-line react-hooks/exhaustive-deps
  const stages = draft?.stages.filter(on) ?? []
  const cur = draft?.stages[sel]
  useEffect(() => setText(cur && on(cur) ? String(cur.x) : ''), [cur])
  if (!draft || !state || !cur) return null

  const grid = state.grid
  const [min, max] = gridBounds(grid)
  const logPos = (dpi: number) => (Math.log(Math.max(dpi, min) / min) / Math.log(max / min)) * 100
  /** Track position (0..100) → DPI, rounded to 50 so dragging lands on tidy values. */
  const fromPos = (p: number) => snapDpi(grid, Math.round((min * (max / min) ** (Math.max(0, Math.min(100, p)) / 100)) / 50) * 50 || min)
  const live = state.activeSector === draft.sector ? state.stage : -1
  const maxStages = state.limits?.stages ?? 5
  const canStart = state.limits?.startStage ?? true
  const canShift = state.limits?.shiftStage ?? true

  const setDpi = (v: number, i = sel) => {
    const dpi = snapDpi(grid, v)
    update((d) => {
      const s = d.stages[i]
      if (s.x === dpi) return
      d.stages[i] = { x: dpi, y: s.y !== s.x ? s.y : dpi, lod: s.lod || 2 }
    })
  }
  const posAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return ((clientX - r.left) / r.width) * 100
  }
  /** Grab the handle under the pointer (or move the selected stage to where the track was clicked), then drag. */
  const onTrackDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const p = posAt(e.clientX)
    const width = track.current!.getBoundingClientRect().width
    const near = stages
      .map((s, i) => ({ i, d: (Math.abs(logPos(s.x) - p) / 100) * width }))
      .filter((h) => h.d <= 14)
      .sort((a, b) => a.d - b.d || +(b.i === sel) - +(a.i === sel))[0]
    const i = near ? near.i : sel
    setSel(i)
    setDrag(i)
    if (!near) setDpi(fromPos(p), i)
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    track.current!.querySelectorAll<HTMLElement>('[role=slider]')[i]?.focus({ preventScroll: true })
  }
  const onTrackMove = (e: React.PointerEvent) => {
    if (drag !== null) setDpi(fromPos(posAt(e.clientX)), drag)
  }
  const onTrackUp = () => setDrag(null)
  const onHandleKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.shiftKey ? 500 : 50
    const x = stages[i].x
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
    let next: number | undefined = { Home: min, End: max }[e.key]
    if (dir) {
      // Land on the next multiple of the step; skip values the sensor's DPI grid rounds back to x.
      for (let k = (dir > 0 ? Math.floor(x / step) : Math.ceil(x / step)) + dir; k * step >= min - step && k * step <= max + step; k += dir) {
        next = snapDpi(grid, k * step)
        if (next !== x) break
      }
    }
    if (next == null) return
    e.preventDefault()
    setSel(i)
    setDpi(next, i)
  }
  const add = () => {
    const last = stages[stages.length - 1]?.x ?? 800
    const dpi = snapDpi(grid, Math.min(max, last * 2))
    update((d) => {
      d.stages[stages.length] = { x: dpi, y: dpi, lod: d.stages[0].lod || 2 }
    })
    setSel(stages.length)
  }
  const remove = (i: number) => {
    if (stages.length <= 1) return toast.error('Keep at least one DPI stage.')
    update((d) => {
      d.stages[i] = { x: 0, y: 0, lod: d.stages[i].lod || 2 }
      pack(d)
    })
    setSel(Math.max(0, Math.min(sel > i ? sel - 1 : sel, stages.length - 2)))
  }

  return (
    <>
      <SidePanel title="DPI">
        <div className="space-y-1.5">
          {stages.map((s, i) => (
            <div
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => setSel(i)}
              onKeyDown={(e) => e.key === 'Enter' && setSel(i)}
              className={cn(
                'group flex h-11 items-center gap-3 rounded-lg border px-3 transition-colors',
                i === sel ? 'border-primary/60 bg-primary/10' : 'border-transparent bg-surface-2 hover:border-foreground/15'
              )}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: STAGE_COLORS[i] }} />
              <span className="flex-1 text-[15px] font-semibold tabular-nums">{fmt(s.x)}</span>
              {canStart && i === draft.defaultStage && <span className="caption text-primary">Start</span>}
              {i === live && <span className="size-1.5 rounded-full bg-success" title="In use now" />}
              <button
                type="button"
                aria-label={`Remove stage ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(i)
                }}
                className="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {stages.length < maxStages && (
            <button
              type="button"
              onClick={add}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              <Plus className="size-4" /> Add stage
            </button>
          )}
        </div>

        <div className="rounded-lg bg-surface-2 p-3.5">
          <div className="flex items-center gap-2">
            <Input
              value={text}
              inputMode="numeric"
              onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
              onBlur={() => text && setDpi(Number(text))}
              onKeyDown={(e) => e.key === 'Enter' && text && setDpi(Number(text))}
              className="h-9 w-24 bg-background text-base font-semibold tabular-nums"
              aria-label="DPI"
            />
            <span className="text-sm text-muted-foreground">DPI</span>
            {canStart && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-8 text-xs"
                disabled={draft.defaultStage === sel}
                onClick={() => update((d) => (d.defaultStage = sel))}
              >
                {draft.defaultStage === sel ? 'Starting stage' : 'Make starting stage'}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <Caption>Polling rate</Caption>
          <Select value={String(draft.rateHz)} onValueChange={(v) => update((d) => (d.rateHz = Number(v)))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state.rates.map((hz) => (
                <SelectItem key={hz} value={String(hz)}>
                  {short(hz)} · {(1000 / hz).toFixed(hz >= 1000 ? 3 : 1)} ms
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="border-t pt-3">
          <button type="button" onClick={() => setMore((m) => !m)} className="flex w-full items-center justify-between py-1 text-sm font-medium">
            Advanced
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', more && 'rotate-180')} />
          </button>
          {more && (
            <div className="mt-3 space-y-4">
              <Row label="Separate vertical DPI">
                <Switch checked={cur.y !== cur.x} onCheckedChange={(v) => update((d) => (d.stages[sel].y = v ? snapDpi(grid, Math.round(cur.x / 2)) : d.stages[sel].x))} />
              </Row>
              {cur.y !== cur.x && (
                <Row label="Vertical DPI">
                  <Input
                    key={cur.y}
                    defaultValue={cur.y}
                    className="h-8 w-24 tabular-nums"
                    onBlur={(e) => update((d) => (d.stages[sel].y = snapDpi(grid, Number(e.target.value) || cur.x)))}
                  />
                </Row>
              )}
              {canShift && (
                <Row label="DPI shift stage" hint="While “DPI shift” is held">
                  <Pick value={String(draft.shiftStage)} items={stages.map((s, i) => [String(i), fmt(s.x)])} onChange={(v) => update((d) => (d.shiftStage = Number(v)))} />
                </Row>
              )}
              {draft.fmt === 8 && (
                <Row label="Lift-off distance">
                  <Pick
                    value={String(Math.max(1, Math.min(3, draft.stages[0].lod)))}
                    items={[['1', 'Low'], ['2', 'Medium'], ['3', 'High']]}
                    onChange={(v) => update((d) => (d.stages = d.stages.map((s) => ({ ...s, lod: Number(v) }))))}
                  />
                </Row>
              )}
              {state.limits?.angleSnap !== false && (
                <Row label="Angle snapping">
                  <Switch checked={draft.angleSnap} onCheckedChange={(v) => update((d) => (d.angleSnap = v))} />
                </Row>
              )}
              {draft.extras && (
                <>
                  {(state.limits?.liftOff ?? [1, 2]).length > 0 && (
                    <Row label="Lift-off distance">
                      <Pick
                        value={String(draft.extras.liftOffMm)}
                        items={(state.limits?.liftOff ?? [1, 2]).map((mm) => [String(mm), `${mm} mm`])}
                        onChange={(v) => update((d) => (d.extras!.liftOffMm = Number(v)))}
                      />
                    </Row>
                  )}
                  {state.limits?.motionSync !== false && (
                    <Row label="Motion sync" hint="Aligns sensor frames with USB polls">
                      <Switch checked={draft.extras.motionSync} onCheckedChange={(v) => update((d) => (d.extras!.motionSync = v))} />
                    </Row>
                  )}
                  {state.limits?.rippleControl !== false && (
                    <Row label="Ripple control" hint="Smooths jitter at high DPI">
                      <Switch checked={draft.extras.rippleControl} onCheckedChange={(v) => update((d) => (d.extras!.rippleControl = v))} />
                    </Row>
                  )}
                  {/* Mice without a Buttons page keep their click debounce here. */}
                  {state.limits?.buttons === false && (state.limits.debounceMax ?? 25) > 0 && (
                    <Row label="Click debounce" hint="Lower is faster; raise it if clicks double up">
                      <Pick
                        value={String(draft.extras.debounceMs)}
                        items={Array.from({ length: (state.limits.debounceMax ?? 25) + 1 }, (_, ms) => [String(ms), `${ms} ms`])}
                        onChange={(v) => update((d) => (d.extras!.debounceMs = Number(v)))}
                      />
                    </Row>
                  )}
                </>
              )}
              {draft.rateWiredHz != null && (
                <Row label="Polling with cable">
                  <Pick value={String(Math.min(draft.rateWiredHz, 1000))} items={[125, 250, 500, 1000].map((v) => [String(v), `${v} Hz`])} onChange={(v) => update((d) => (d.rateWiredHz = Number(v)))} />
                </Row>
              )}
              {draft.sleepS != null && (
                <Row label="Sleep after">
                  <Pick
                    value={String(SLEEP.reduce((a, b) => (Math.abs(b[0] - draft.sleepS!) < Math.abs(a[0] - draft.sleepS!) ? b : a))[0])}
                    items={SLEEP.map(([s, t]) => [String(s), t])}
                    onChange={(v) =>
                      update((d) => {
                        d.sleepS = Number(v)
                        d.offS = Math.max(d.offS ?? 300, d.sleepS)
                      })
                    }
                  />
                </Row>
              )}
            </div>
          )}
        </div>
      </SidePanel>

      <Canvas className="flex-col gap-14 px-10">
        <div className="text-center">
          <div className="flex items-baseline justify-center gap-3">
            <span className="text-8xl font-bold tracking-tight tabular-nums">{fmt(cur.x)}</span>
            <span className="text-2xl font-semibold text-muted-foreground">DPI</span>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: STAGE_COLORS[sel] }} />
            Stage {sel + 1}
            {canStart && sel === draft.defaultStage && ' · starting stage'}
            {sel === live && <span className="text-success">· in use now</span>}
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-1.5" role="group" aria-label="Quick DPI">
            {PRESETS.filter((v) => v >= min && v <= max).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setDpi(v)}
                aria-pressed={cur.x === v}
                className={cn(
                  'h-8 min-w-16 rounded-md border px-3 text-sm font-medium tabular-nums transition-colors',
                  cur.x === v
                    ? 'text-foreground'
                    : 'border-foreground/10 text-muted-foreground hover:border-foreground/25 hover:text-foreground'
                )}
                style={cur.x === v ? { borderColor: STAGE_COLORS[sel], background: `${STAGE_COLORS[sel]}26` } : undefined}
              >
                {fmt(v)}
              </button>
            ))}
          </div>
        </div>
        <div className="w-full max-w-2xl">
          <div
            ref={track}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerCancel={onTrackUp}
            className={cn('relative h-16 touch-none select-none', drag !== null ? 'cursor-grabbing' : 'cursor-pointer')}
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2" />
            <div
              className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-40"
              style={{ width: `${logPos(cur.x)}%`, background: STAGE_COLORS[sel] }}
            />
            {stages.map((s, i) => (
              <div
                key={i}
                role="slider"
                tabIndex={0}
                aria-label={`Stage ${i + 1} DPI`}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={s.x}
                onFocus={() => setSel(i)}
                onKeyDown={(e) => onHandleKey(e, i)}
                className={cn(
                  'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background outline-none transition-[width,height,box-shadow] focus-visible:ring-4',
                  i === sel ? 'z-10 size-6 ring-4' : 'size-4 hover:size-5',
                  drag === i ? 'cursor-grabbing' : 'cursor-grab'
                )}
                style={{ left: `${logPos(s.x)}%`, background: STAGE_COLORS[i], '--tw-ring-color': `${STAGE_COLORS[i]}40` } as React.CSSProperties}
              >
                {i === sel && (
                  <span className="pointer-events-none absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums">
                    {fmt(s.x)}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="relative h-5">
            {TICKS.filter((t) => t >= min && t <= max).map((t) => (
              <span key={t} className="absolute -translate-x-1/2 text-[11px] text-muted-foreground tabular-nums" style={{ left: `${logPos(t)}%` }}>
                {t >= 1000 ? `${t / 1000}k` : t}
              </span>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Pick a value above, drag a dot, or click the track to move the selected stage. Arrow keys nudge by 50 (Shift: 500).
            <br />
            The DPI button cycles through these stages in order. Sensor range {fmt(min)}–{fmt(max)} DPI.
          </p>
        </div>
      </Canvas>
    </>
  )
}

function Pick({ value, items, onChange }: { value: string; items: [string, string][]; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(([v, t]) => (
          <SelectItem key={v} value={v}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

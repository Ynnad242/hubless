import { useEffect, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ProfileData, Stage } from '@shared/types'
import { gridBounds, snapDpi } from '@shared/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Canvas, Caption, Row, SidePanel } from '@/components/kit'
import type { MouseCtl } from '@/hooks/useMouse'
import { cn } from '@/lib/utils'

/** One colour per DPI stage, matching the indicator dots everywhere. */
export const STAGE_COLORS = ['#2b8cff', '#34c77b', '#f5a524', '#ff5a8a', '#a78bfa']
const SLEEP: [number, string][] = [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes'], [900, '15 minutes']]
const TICKS = [200, 400, 800, 1600, 3200, 6400, 12800, 25600]
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
  useEffect(() => setSel(draft?.defaultStage ?? 0), [editSector]) // eslint-disable-line react-hooks/exhaustive-deps
  const stages = draft?.stages.filter(on) ?? []
  const cur = draft?.stages[sel]
  useEffect(() => setText(cur && on(cur) ? String(cur.x) : ''), [cur])
  if (!draft || !state || !cur) return null

  const grid = state.grid
  const [min, max] = gridBounds(grid)
  const logPos = (dpi: number) => (Math.log(Math.max(dpi, min) / min) / Math.log(max / min)) * 100
  const fromPos = (p: number) => snapDpi(grid, min * (max / min) ** (p / 100))
  const live = state.activeSector === draft.sector ? state.stage : -1

  const setDpi = (v: number) => {
    const dpi = snapDpi(grid, v)
    update((d) => {
      const s = d.stages[sel]
      d.stages[sel] = { x: dpi, y: s.y !== s.x ? s.y : dpi, lod: s.lod || 2 }
    })
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
              {i === draft.defaultStage && <span className="caption text-primary">Start</span>}
              {i === live && <span className="size-1.5 rounded-full bg-success" title="In use now" />}
              <button
                type="button"
                aria-label={`Remove stage ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(i)
                }}
                className="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {stages.length < 5 && (
            <button
              type="button"
              onClick={add}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              <Plus className="size-4" /> Add stage
            </button>
          )}
        </div>

        <div className="space-y-3 rounded-lg bg-surface-2 p-3.5">
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
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-8 text-xs"
              disabled={draft.defaultStage === sel}
              onClick={() => update((d) => (d.defaultStage = sel))}
            >
              {draft.defaultStage === sel ? 'Starting stage' : 'Make starting stage'}
            </Button>
          </div>
          <Slider min={0} max={100} step={0.1} value={[logPos(cur.x)]} onValueChange={([p]) => setDpi(fromPos(p))} aria-label="DPI" />
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
              <Row label="DPI shift stage" hint="While “DPI shift” is held">
                <Pick value={String(draft.shiftStage)} items={stages.map((s, i) => [String(i), fmt(s.x)])} onChange={(v) => update((d) => (d.shiftStage = Number(v)))} />
              </Row>
              {draft.fmt === 8 && (
                <Row label="Lift-off distance">
                  <Pick
                    value={String(Math.max(1, Math.min(3, draft.stages[0].lod)))}
                    items={[['1', 'Low'], ['2', 'Medium'], ['3', 'High']]}
                    onChange={(v) => update((d) => (d.stages = d.stages.map((s) => ({ ...s, lod: Number(v) }))))}
                  />
                </Row>
              )}
              <Row label="Angle snapping">
                <Switch checked={draft.angleSnap} onCheckedChange={(v) => update((d) => (d.angleSnap = v))} />
              </Row>
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
            {sel === draft.defaultStage && ' · starting stage'}
            {sel === live && <span className="text-success">· in use now</span>}
          </div>
        </div>
        <div className="w-full max-w-2xl">
          <div className="relative h-14">
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-2" />
            {stages.map((s, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Stage ${i + 1}: ${s.x} DPI`}
                onClick={() => setSel(i)}
                className={cn(
                  'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background transition-all',
                  i === sel ? 'size-5 ring-4' : 'size-3.5 hover:scale-125'
                )}
                style={{ left: `${logPos(s.x)}%`, background: STAGE_COLORS[i], '--tw-ring-color': `${STAGE_COLORS[i]}40` } as React.CSSProperties}
              />
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

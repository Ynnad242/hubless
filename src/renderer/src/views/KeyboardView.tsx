import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Gauge, Keyboard, Layers, Lightbulb, Pencil, RotateCcw, Search, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type { AdvancedKey, Capability, DeviceSummary, KeyboardAction, KeyboardSettings, KeyboardState } from '@shared/types'
import { KEY_GROUPS, type KeyDef, keyLabel, keyName } from '@shared/wooting'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { KeyMap } from '@/components/KeyMap'
import { Canvas, Caption, PanelTabs, Row, SidePanel } from '@/components/kit'
import type { SaveStatus } from '@/hooks/useMouse'
import { useAnalog } from '@/hooks/useAnalog'
import { cn } from '@/lib/utils'
import { type RailItem, SaveState, Shell } from './Shell'

const RAIL: RailItem[] = [
  { key: 'actuation', label: 'Actuation & Rapid Trigger', icon: Gauge },
  { key: 'keymap', label: 'Key mapping', icon: Keyboard },
  { key: 'advanced', label: 'Advanced keys', icon: Zap },
  { key: 'lighting', label: 'Lighting', icon: Lightbulb }
]

/** Distances are stored in 4 mm / 16383 steps; show what the user picked (0.1 mm for actuation, 0.05 for RT). */
const mm = (v: number, step = 0.05) => `${(Math.round(v / step) * step).toFixed(step < 0.1 ? 2 : 1)} mm`
const near = (a: number, b: number) => Math.abs(a - b) < 0.03

// ---------------------------------------------------------------- state

function useKeyboard(id: string) {
  const [state, setState] = useState<KeyboardState | null>(null)
  const [draft, setDraft] = useState<KeyboardSettings | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const latest = useRef<KeyboardSettings | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const adopt = useCallback((s: KeyboardState) => {
    setState(s)
    const p = s.profiles.find((x) => x.slot === s.active) ?? s.profiles[0]
    latest.current = p ? { ...p.settings } : null
    setDraft(latest.current)
  }, [])

  useEffect(() => {
    void window.hubless.keyboardState(id).then(adopt, (e) => toast.error(e.message))
  }, [id, adopt])

  /** Run an action now (one at a time, in order). */
  const act = useCallback(
    (action: KeyboardAction, message?: string) => {
      setStatus('saving')
      const job = async () => {
        try {
          const s = await window.hubless.keyboardAction(id, action)
          setState(s)
          setStatus('saved')
          if (message) toast.success(message)
        } catch (e) {
          setStatus('error')
          toast.error((e as Error).message)
          void window.hubless.keyboardState(id).then(adopt)
        }
      }
      queue.current = queue.current.then(job, job)
      return queue.current
    },
    [id, adopt]
  )

  /** Run an action shortly after the last call with the same key (sliders). */
  const later = useCallback(
    (key: string, action: () => KeyboardAction) => {
      const t = timers.current.get(key)
      if (t) clearTimeout(t)
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key)
          void act(action())
        }, 400)
      )
    },
    [act]
  )

  const updateSettings = (patch: Partial<KeyboardSettings>) => {
    if (!latest.current || !state) return
    latest.current = { ...latest.current, ...patch }
    setDraft(latest.current)
    later('settings', () => ({ type: 'settings', slot: state.active, settings: latest.current! }))
  }

  // Stay in sync with Wootility (it edits the same settings on the keyboard): re-read when the window
  // regains focus and every 15 s, but never while one of our own edits is waiting to be saved.
  useEffect(() => {
    const busy = () => [...timers.current.values()].length > 0
    const sync = () => {
      if (busy() || document.hidden) return
      void window.hubless.keyboardAction(id, { type: 'reload' }).then((s) => !busy() && adopt(s), () => {})
    }
    const t = setInterval(sync, 15000)
    window.addEventListener('focus', sync)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', sync)
    }
  }, [id, adopt])

  return { state, draft, status, act, later, updateSettings, adopt }
}
type Kb = ReturnType<typeof useKeyboard>

function useSelection() {
  const [sel, setSel] = useState<Set<number>>(new Set())
  const select = (id: number, add: boolean) =>
    setSel((s) => {
      const n = new Set(add ? s : [])
      if (add && s.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return { sel, select, clear: () => setSel(new Set()), set: setSel }
}

// ---------------------------------------------------------------- shared bits

function DistanceSlider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const v = Math.round(value / step) * step
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm">{label}</span>
        <span className="text-sm font-semibold text-primary tabular-nums">{mm(v, step)}</span>
      </div>
      <Slider min={min} max={max} step={step} value={[v]} onValueChange={([x]) => onChange(Math.round(x * 100) / 100)} aria-label={label} />
    </div>
  )
}

/** Side view of one switch's travel, to scale: actuation point and the rapid-trigger window. */
function KeyTravel({ actuationMm, rt, liveMm, label }: { actuationMm: number; rt: { pressMm: number; releaseMm: number } | null; liveMm?: number | null; label?: string }) {
  const top = 24
  const h = 200
  const y = (v: number) => top + (v / 4) * h
  const ay = y(actuationMm)
  const rel = rt ? (rt.releaseMm / 4) * h : 0
  const live = liveMm ?? 0
  const fired = live >= actuationMm
  return (
    <svg viewBox="0 0 300 270" className="h-[250px] w-auto" aria-label={`Actuation at ${actuationMm} mm`}>
      {[0, 1, 2, 3, 4].map((v) => (
        <g key={v}>
          <line x1="40" x2="50" y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity="0.3" />
          <text x="34" y={y(v) + 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity="0.5">
            {v} mm
          </text>
        </g>
      ))}
      <rect x="100" y={top} width="56" height={h} rx="10" fill="var(--surface-2)" />
      <rect x="100" y={top} width="56" height={ay - top} rx="10" fill="#2b8cff" opacity="0.18" />
      {live > 0.02 && <rect x="100" y={top} width="56" height={y(live) - top} rx="10" fill={fired ? '#2b8cff' : '#5aa7ff'} opacity={fired ? 0.9 : 0.55} />}
      {/* the keycap rides down with the key */}
      <rect x="78" y={top - 22 + (live / 4) * h} width="100" height="18" rx="6" fill={fired ? '#1f6fd6' : '#2a2c31'} stroke="#3c3f46" />
      {liveMm != null && (
        <text x="128" y={top + h + 22} textAnchor="middle" fontSize="12" fontWeight="700" fill={fired ? '#2b8cff' : 'currentColor'} fillOpacity={fired ? 1 : 0.6}>
          {label ? `${label} · ` : ''}{live.toFixed(2)} mm{fired ? ' · pressed' : ''}
        </text>
      )}
      {rt && <rect x="94" y={ay - rel} width="68" height={rel} fill="#34c77b" opacity="0.3" />}
      <line x1="88" x2="168" y1={ay} y2={ay} stroke="#2b8cff" strokeWidth="3" strokeLinecap="round" />
      <text x="178" y={ay + 4} fontSize="13" fontWeight="700" fill="#2b8cff">
        {mm(actuationMm, 0.1)}
      </text>
      {rt && (
        <text x="178" y={Math.max(14, ay - rel - 6)} fontSize="11" fill="#34c77b">
          resets {mm(rt.releaseMm)} up
        </text>
      )}
    </svg>
  )
}

/** Searchable key-code list, grouped. */
function KeyPicker({ value, onPick, extra }: { value?: number; onPick: (code: number) => void; extra?: React.ReactNode }) {
  const [q, setQ] = useState('')
  const groups = useMemo(
    () => KEY_GROUPS.map(([g, codes]) => [g, codes.filter((c) => keyName(c).toLowerCase().includes(q.toLowerCase()))] as const).filter(([, c]) => c.length),
    [q]
  )
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search keys" className="h-9 pl-8" />
      </div>
      {extra}
      {groups.map(([g, codes]) => (
        <div key={g} className="space-y-1.5">
          <Caption>{g}</Caption>
          <div className="flex flex-wrap gap-1">
            {codes.map((c) => (
              <button
                key={c}
                type="button"
                title={keyName(c)}
                onClick={() => onPick(c)}
                className={cn(
                  'h-8 min-w-8 rounded-md border px-2 text-xs font-semibold transition-colors',
                  c === value ? 'border-primary bg-primary/20 text-primary' : 'bg-surface-2 hover:border-foreground/25'
                )}
              >
                {keyLabel(c) || keyName(c)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const baseLabel = (s: KeyboardState) => (k: KeyDef) => keyLabel(s.layers[0]?.[k.row]?.[k.col] ?? 0xff) || (k.w > 4 ? 'Space' : '')
const rtFor = (s: KeyboardState, id: number) => s.rtGroups.find((g) => g.keys.includes(id)) ?? null

// ---------------------------------------------------------------- sections

function Actuation({ kb, id }: { kb: Kb; id: string }) {
  const s = kb.state!
  const g = kb.draft!
  const { sel, select, clear } = useSelection()
  const analog = useAnalog(id, true)
  // Analog values run 0..255 over 0.1..4.0 mm of travel.
  const travel = (k: KeyDef) => {
    const v = analog?.[k.row]?.[k.col] ?? 0
    return v ? 0.1 + (v / 255) * 3.9 : 0
  }
  const actOf = (k: KeyDef) => s.perKeyActuation[k.id] ?? g.actuationMm
  const deepest = analog ? s.layout.reduce<KeyDef | null>((best, k) => (travel(k) > 0.05 && (!best || travel(k) > travel(best)) ? k : best), null) : null
  const keys = [...sel]
  const first = keys[0]
  const perAct = first !== undefined ? s.perKeyActuation[first] : undefined
  const perRt = first !== undefined ? rtFor(s, first) : null
  const [local, setLocal] = useState<{ act?: number | null; rt?: { pressMm: number; releaseMm: number } | null }>({})
  useEffect(() => setLocal({}), [first])
  const act = local.act === undefined ? perAct : local.act ?? undefined
  const rt = local.rt === undefined ? (perRt ? { pressMm: perRt.pressMm, releaseMm: perRt.releaseMm } : undefined) : local.rt ?? undefined

  return (
    <>
      <SidePanel
        title={keys.length ? `${keys.length} key${keys.length > 1 ? 's' : ''} selected` : 'Actuation & Rapid Trigger'}
        action={keys.length ? <Button variant="ghost" size="sm" onClick={clear}>Done</Button> : undefined}
      >
        {!keys.length ? (
          <>
            <p className="text-xs text-muted-foreground">These apply to every key. Click keys on the map to give them their own values.</p>
            <div className="space-y-4">
              <Caption>Actuation point</Caption>
              <DistanceSlider label="Press depth" value={g.actuationMm} min={0.1} max={4} step={0.1} onChange={(v) => kb.updateSettings({ actuationMm: v })} />
              <div className="flex flex-wrap gap-1.5">
                {([['Hair trigger', 0.4], ['Gaming', 1.2], ['Balanced', 2], ['Typing', 2.8]] as const).map(([n, v]) => (
                  <Button key={n} size="sm" variant={near(g.actuationMm, v) ? 'default' : 'secondary'} className="h-7 rounded-full px-3 text-xs" onClick={() => kb.updateSettings({ actuationMm: v })}>
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-4 border-t pt-4">
              <Row label="Rapid Trigger" hint="Re-arms a key as soon as it starts rising">
                <Switch checked={g.rapidTrigger} onCheckedChange={(v) => kb.updateSettings({ rapidTrigger: v })} />
              </Row>
              {g.rapidTrigger && (
                <>
                  <DistanceSlider label={g.rtReleaseMm === null ? 'Sensitivity' : 'Press sensitivity'} value={g.rtPressMm} min={0.1} max={2} step={0.05} onChange={(v) => kb.updateSettings({ rtPressMm: v })} />
                  <Row label="Separate release sensitivity">
                    <Switch checked={g.rtReleaseMm !== null} onCheckedChange={(v) => kb.updateSettings({ rtReleaseMm: v ? g.rtPressMm : null })} />
                  </Row>
                  {g.rtReleaseMm !== null && (
                    <DistanceSlider label="Release sensitivity" value={g.rtReleaseMm} min={0.1} max={2} step={0.05} onChange={(v) => kb.updateSettings({ rtReleaseMm: v })} />
                  )}
                  <Row label="Continuous Rapid Trigger" hint="Stay in Rapid Trigger until the key is fully released">
                    <Switch checked={g.continuousRt} onCheckedChange={(v) => kb.updateSettings({ continuousRt: v })} />
                  </Row>
                </>
              )}
            </div>
            <div className="border-t pt-4">
              <Row label="Tachyon mode" hint="Lowest latency. Lighting brightness is limited while it’s on.">
                <Switch checked={g.tachyon} onCheckedChange={(v) => kb.updateSettings({ tachyon: v })} />
              </Row>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <Row label="Own actuation point" hint={act === undefined ? `Uses the profile’s ${mm(g.actuationMm, 0.1)}` : undefined}>
                <Switch
                  checked={act !== undefined}
                  onCheckedChange={(v) => {
                    setLocal((l) => ({ ...l, act: v ? g.actuationMm : null }))
                    void kb.act({ type: 'perKey', keys, actuationMm: v ? g.actuationMm : null })
                  }}
                />
              </Row>
              {act !== undefined && (
                <DistanceSlider
                  label="Press depth"
                  value={act}
                  min={0.1}
                  max={4}
                  step={0.1}
                  onChange={(v) => {
                    setLocal((l) => ({ ...l, act: v }))
                    kb.later('perkey-act', () => ({ type: 'perKey', keys, actuationMm: v }))
                  }}
                />
              )}
            </div>
            <div className="space-y-4 border-t pt-4">
              <Row label="Own Rapid Trigger" hint={rt === undefined ? (g.rapidTrigger ? 'Uses the profile setting' : 'Off, like the profile') : 'On for these keys'}>
                <Switch
                  checked={rt !== undefined}
                  onCheckedChange={(v) => {
                    const val = v ? { pressMm: g.rtPressMm, releaseMm: g.rtReleaseMm ?? g.rtPressMm } : null
                    setLocal((l) => ({ ...l, rt: val }))
                    void kb.act({ type: 'perKey', keys, rt: val })
                  }}
                />
              </Row>
              {rt !== undefined && (
                <>
                  <DistanceSlider
                    label="Press sensitivity"
                    value={rt.pressMm}
                    min={0.1}
                    max={2}
                    step={0.05}
                    onChange={(v) => {
                      const next = { pressMm: v, releaseMm: rt.releaseMm }
                      setLocal((l) => ({ ...l, rt: next }))
                      kb.later('perkey-rt', () => ({ type: 'perKey', keys, rt: next }))
                    }}
                  />
                  <DistanceSlider
                    label="Release sensitivity"
                    value={rt.releaseMm}
                    min={0.1}
                    max={2}
                    step={0.05}
                    onChange={(v) => {
                      const next = { pressMm: rt.pressMm, releaseMm: v }
                      setLocal((l) => ({ ...l, rt: next }))
                      kb.later('perkey-rt', () => ({ type: 'perKey', keys, rt: next }))
                    }}
                  />
                </>
              )}
            </div>
          </>
        )}
      </SidePanel>
      <Canvas className="flex-col gap-6 px-6">
        <KeyMap
          layout={s.layout}
          label={baseLabel(s)}
          selected={sel}
          onSelect={select}
          depth={(k) => travel(k) / 4}
          active={(k) => travel(k) >= actOf(k)}
          badge={(k) => {
            const a = s.perKeyActuation[k.id]
            const r = rtFor(s, k.id)
            return [a !== undefined ? a.toFixed(1) : '', r ? `RT${r.pressMm.toFixed(2).replace(/^0/, '')}` : ''].filter(Boolean).join(' ') || undefined
          }}
          marked={(k) => s.perKeyActuation[k.id] !== undefined || !!rtFor(s, k.id)}
        />
        <div className="flex items-center gap-8">
          {(() => {
            const watched = s.layout.find((k) => k.id === first) ?? deepest
            return (
              <KeyTravel
                actuationMm={watched && first === undefined ? actOf(watched) : (act ?? g.actuationMm)}
                rt={rt ?? (g.rapidTrigger ? { pressMm: g.rtPressMm, releaseMm: g.rtReleaseMm ?? g.rtPressMm } : null)}
                liveMm={watched ? travel(watched) : analog ? 0 : null}
                label={watched ? baseLabel(s)(watched) || 'Space' : undefined}
              />
            )
          })()}
          <p className="max-w-56 text-xs text-muted-foreground">
            Press any key to see how far it travels. Keys with their own values are outlined and show them on the key; Ctrl-click to
            select several.
          </p>
        </div>
      </Canvas>
    </>
  )
}

function KeyMapping({ kb }: { kb: Kb }) {
  const s = kb.state!
  const [layer, setLayer] = useState<'0' | '1' | '2'>('0')
  const L = Number(layer)
  const { sel, select, clear } = useSelection()
  const keys = [...sel]
  const code = (k: KeyDef) => s.layers[L]?.[k.row]?.[k.col] ?? 0xff
  const first = s.layout.find((k) => k.id === keys[0])
  return (
    <>
      <SidePanel title="Key mapping" action={keys.length ? <Button variant="ghost" size="sm" onClick={clear}>Done</Button> : undefined}>
        <PanelTabs
          value={layer}
          onChange={(v) => {
            setLayer(v)
            clear()
          }}
          items={[['0', 'Base'], ['1', 'Fn layer'], ['2', 'Fn 2 layer']]}
        />
        {!keys.length ? (
          <p className="text-sm text-muted-foreground">
            {L === 0 ? 'Click a key to choose what it types.' : `Choose what keys do while ${L === 1 ? 'Fn' : 'Fn 2'} is held. Empty keys fall through to the base layer.`}
          </p>
        ) : (
          <KeyPicker
            value={first ? code(first) : undefined}
            onPick={(c) => void kb.act({ type: 'map', layer: L, keys, code: c })}
            extra={
              <Button variant="secondary" size="sm" onClick={() => void kb.act({ type: 'map', layer: L, keys, code: null }, L === 0 ? 'Key restored' : 'Key cleared')}>
                <RotateCcw className="size-3.5" /> {L === 0 ? 'Restore original key' : 'Clear (use base layer)'}
              </Button>
            }
          />
        )}
      </SidePanel>
      <Canvas className="px-6">
        <KeyMap
          layout={s.layout}
          label={(k) => (code(k) === 0xff ? '' : keyLabel(code(k)) || (k.w > 4 ? 'Space' : keyName(code(k))))}
          selected={sel}
          onSelect={select}
        />
      </Canvas>
    </>
  )
}

const KIND_LABEL: Record<AdvancedKey['kind'], string> = {
  modTap: 'Mod-Tap', toggle: 'Toggle', snapTap: 'Snap Tap', socd: 'SOCD', dks: 'Dynamic Keystroke', other: 'Other'
}

function Advanced({ kb }: { kb: Kb }) {
  const s = kb.state!
  const { sel, select, clear, set } = useSelection()
  const key = [...sel][0]
  const existing = s.advanced.find((a) => a.key === key)
  const [kind, setKind] = useState<'modTap' | 'toggle' | 'snapTap'>('modTap')
  const [tap, setTap] = useState<number | undefined>()
  const [hold, setHold] = useState<number | undefined>()
  const [pickOther, setPickOther] = useState(false)
  useEffect(() => {
    if (existing && (existing.kind === 'modTap' || existing.kind === 'toggle' || existing.kind === 'snapTap')) {
      setKind(existing.kind)
      setTap(existing.kind === 'toggle' ? existing.code : existing.tap)
      setHold(existing.hold)
    } else {
      setTap(undefined)
      setHold(undefined)
    }
    setPickOther(false)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: number) => {
    const k = s.layout.find((x) => x.id === id)
    return k ? baseLabel(s)(k) || 'Space' : `#${id}`
  }
  const describe = (a: AdvancedKey) =>
    a.kind === 'modTap'
      ? `tap ${keyName(a.tap!)} · hold ${keyName(a.hold!)}`
      : a.kind === 'toggle'
        ? `toggles ${keyName(a.code!)}`
        : a.kind === 'snapTap' || a.kind === 'socd'
          ? `paired with ${name(a.other!)}`
          : a.kind === 'dks'
            ? 'four actions along the key travel'
            : ''

  return (
    <>
      <SidePanel title="Advanced keys" action={key !== undefined ? <Button variant="ghost" size="sm" onClick={clear}>Done</Button> : undefined}>
        {key === undefined ? (
          <>
            <p className="text-sm text-muted-foreground">Give a key two jobs. Click a key on the map to add or change one.</p>
            <div className="space-y-1.5">
              {s.advanced.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
              {s.advanced.map((a) => (
                <div key={a.key} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => set(new Set([a.key]))}>
                    <div className="text-sm font-semibold">
                      {name(a.key)} · {KIND_LABEL[a.kind]}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{describe(a)}</div>
                  </button>
                  <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label="Remove" onClick={() => void kb.act({ type: 'advanced', key: a.key, entry: null }, 'Advanced key removed')}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : existing && !['modTap', 'toggle', 'snapTap'].includes(existing.kind) ? (
          <>
            <p className="text-sm">
              {name(key)} has a {KIND_LABEL[existing.kind]} set up ({describe(existing)}). Hubless keeps it as it is; you can remove it.
            </p>
            <Button variant="destructive" onClick={() => void kb.act({ type: 'advanced', key, entry: null }, 'Advanced key removed').then(clear)}>
              Remove
            </Button>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold">Key: {name(key)}</div>
            <PanelTabs value={kind} onChange={setKind} items={[['modTap', 'Mod-Tap'], ['toggle', 'Toggle'], ['snapTap', 'Snap Tap']]} />
            <p className="text-xs text-muted-foreground">
              {kind === 'modTap'
                ? 'One key when tapped, another while held.'
                : kind === 'toggle'
                  ? 'Press once to hold the key down, press again to release it.'
                  : 'With both keys pressed, only the most recent one counts. Great for strafing (A/D).'}
            </p>
            {kind === 'modTap' && (
              <>
                <Caption>Tap · {tap !== undefined ? keyName(tap) : 'choose below'}</Caption>
                <KeyPicker value={tap} onPick={setTap} />
                <Caption>Hold · {hold !== undefined ? keyName(hold) : 'choose below'}</Caption>
                <KeyPicker value={hold} onPick={setHold} />
              </>
            )}
            {kind === 'toggle' && <KeyPicker value={tap} onPick={setTap} />}
            {kind === 'snapTap' && (
              <Button variant={pickOther ? 'default' : 'secondary'} onClick={() => setPickOther(true)}>
                {pickOther ? 'Now click the other key on the map…' : 'Choose the paired key'}
              </Button>
            )}
            <div className="sticky bottom-0 mt-auto flex gap-2 bg-surface pt-2">
              {kind !== 'snapTap' && (
                <Button
                  className="flex-1"
                  disabled={tap === undefined || (kind === 'modTap' && hold === undefined)}
                  onClick={() =>
                    void kb
                      .act({ type: 'advanced', key, entry: kind === 'modTap' ? { key, kind, tap, hold } : { key, kind: 'toggle', code: tap } }, 'Advanced key saved')
                      .then(clear)
                  }
                >
                  Save
                </Button>
              )}
              {existing && (
                <Button variant="secondary" onClick={() => void kb.act({ type: 'advanced', key, entry: null }, 'Advanced key removed').then(clear)}>
                  Remove
                </Button>
              )}
            </div>
          </>
        )}
      </SidePanel>
      <Canvas className="px-6">
        <KeyMap
          layout={s.layout}
          label={baseLabel(s)}
          selected={sel}
          onSelect={(id) => {
            if (pickOther && key !== undefined && id !== key) {
              setPickOther(false)
              void kb.act({ type: 'advanced', key, entry: { key, kind: 'snapTap', other: id } }, 'Snap Tap saved').then(clear)
              return
            }
            select(id, false)
          }}
          badge={(k) => {
            const a = s.advanced.find((x) => x.key === k.id)
            return a ? KIND_LABEL[a.kind] : undefined
          }}
          marked={(k) => s.advanced.some((x) => x.key === k.id)}
        />
      </Canvas>
    </>
  )
}

const SWATCHES = ['#ffffff', '#2b8cff', '#00e5ff', '#34c77b', '#f5d524', '#f5a524', '#ff5a5f', '#ff5ca8', '#a78bfa', '#000000']

function Lighting({ kb }: { kb: Kb }) {
  const s = kb.state!
  const { sel, select, clear, set } = useSelection()
  const [color, setColor] = useState('#2b8cff')
  const [bright, setBright] = useState(s.lighting.brightness)
  useEffect(() => setBright(s.lighting.brightness), [s.lighting.brightness])
  const keys = [...sel]
  return (
    <>
      <SidePanel title="Lighting">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <Caption>Brightness</Caption>
            <span className="text-sm font-semibold tabular-nums">{Math.round((bright / 255) * 100)}%</span>
          </div>
          <Slider
            min={0}
            max={255}
            step={1}
            value={[bright]}
            onValueChange={([v]) => {
              setBright(v)
              kb.later('bright', () => ({ type: 'lighting', brightness: v }))
            }}
            aria-label="Brightness"
          />
        </div>
        <div className="space-y-3 border-t pt-4">
          <Caption>Mode</Caption>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={!s.lighting.effect ? 'default' : 'secondary'} size="sm" onClick={() => void kb.act({ type: 'lighting', effect: 'static' })}>
              Your colours
            </Button>
            <Button
              variant={s.lighting.effect ? 'default' : 'secondary'}
              size="sm"
              disabled={!s.lighting.effect && !s.lighting.canRestoreEffect}
              onClick={() => void kb.act({ type: 'lighting', effect: 'original' })}
            >
              Animated effect
            </Button>
          </div>
          {s.lighting.effect && <p className="text-xs text-muted-foreground">An animated effect is running. Painting keys switches to your own colours.</p>}
        </div>
        <div className="space-y-3 border-t pt-4">
          <Caption>Paint keys</Caption>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn('size-7 rounded-full border-2', color === c ? 'border-primary' : 'border-white/10')}
                style={{ background: c }}
              />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="size-7 cursor-pointer rounded-full bg-transparent" aria-label="Custom colour" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" disabled={!keys.length} onClick={() => void kb.act({ type: 'lighting', paint: { keys, color } }).then(clear)}>
              Paint {keys.length || ''} selected
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void kb.act({ type: 'lighting', paint: { keys: s.layout.map((k) => k.id), color } }, 'Whole keyboard painted')}>
              Paint all keys
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="w-full text-muted-foreground" onClick={() => set(new Set(s.layout.map((k) => k.id)))}>
            Select all keys
          </Button>
        </div>
      </SidePanel>
      <Canvas className="px-6">
        <KeyMap layout={s.layout} label={baseLabel(s)} selected={sel} onSelect={select} color={(k) => s.lighting.colors[k.row]?.[k.col]} />
      </Canvas>
    </>
  )
}

function DeviceSettings({ kb, device, photo }: { kb: Kb; device: DeviceSummary; photo?: string }) {
  const s = kb.state!
  const [renaming, setRenaming] = useState<{ slot: number; name: string } | null>(null)
  const [restore, setRestore] = useState(false)
  return (
    <>
      <SidePanel title="Device settings">
        <dl className="space-y-3 text-sm">
          {[
            ['Model', `Wooting ${device.name}`],
            ['Firmware', s.firmware],
            ['Serial number', s.serial || 'Unknown'],
            ['Connection', device.connection]
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="selectable text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-2 border-t pt-4">
          <Caption>Profiles</Caption>
          {s.profiles.map((p) => (
            <div key={p.slot} className="flex h-11 items-center gap-2 rounded-lg bg-surface-2 px-3">
              <span className="flex-1 truncate text-sm font-semibold">{p.name}</span>
              {p.slot === s.active ? (
                <span className="caption text-success">In use</span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void kb.act({ type: 'activate', slot: p.slot }, 'Profile switched')}>
                  Use
                </Button>
              )}
              <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label="Rename" onClick={() => setRenaming({ slot: p.slot, name: p.name })}>
                <Pencil className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-auto space-y-2 border-t pt-4">
          <Caption>Backup</Caption>
          <p className="text-xs text-muted-foreground">Hubless saves every keyboard setting before its first change in a session.</p>
          <Button variant="secondary" size="sm" className="w-full" onClick={() => setRestore(true)}>
            <RotateCcw className="size-3.5" /> Undo changes since the last backup
          </Button>
        </div>
      </SidePanel>
      <Canvas className="flex-col gap-8 px-6">
        {photo && <img src={photo} alt={`${device.vendor} ${device.name}`} draggable={false} className="max-h-64 w-full max-w-3xl object-contain" />}
        <KeyMap layout={s.layout} label={baseLabel(s)} selected={new Set()} onSelect={() => {}} color={(k) => s.lighting.colors[k.row]?.[k.col]} />
      </Canvas>
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename profile</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (renaming) void kb.act({ type: 'rename', slot: renaming.slot, name: renaming.name.trim() || 'Profile' }, 'Profile renamed')
              setRenaming(null)
            }}
          >
            <Input autoFocus maxLength={24} value={renaming?.name ?? ''} onChange={(e) => setRenaming((r) => r && { ...r, name: e.target.value })} />
            <DialogFooter>
              <Button type="submit">Rename</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={restore} onOpenChange={setRestore}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo all keyboard changes?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Actuation, rapid trigger, key mapping, advanced keys and lighting go back to the last backup.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRestore(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setRestore(false)
                void kb.act({ type: 'restore' }, 'Keyboard restored').then(() => window.hubless.keyboardState(device.id).then(kb.adopt))
              }}
            >
              Undo changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------- page

export function KeyboardView({ device, photo, onBack }: { device: DeviceSummary; photo?: string; onBack: () => void }) {
  const kb = useKeyboard(device.id)
  const [section, setSection] = useState<Capability>('actuation')
  const { state } = kb
  const ready = !!(state && kb.draft)

  const body = !ready
    ? null
    : {
        actuation: <Actuation kb={kb} id={device.id} />,
        keymap: <KeyMapping kb={kb} />,
        advanced: <Advanced kb={kb} />,
        lighting: <Lighting kb={kb} />,
        device: <DeviceSettings kb={kb} device={device} photo={photo} />
      }[section as 'actuation']

  return (
    <Shell
      name={`Wooting ${device.name}`}
      rail={RAIL}
      section={section}
      onSection={setSection}
      onBack={onBack}
      loading={!ready}
      asleep={device.status === 'asleep' ? 'The keyboard is not answering. Try plugging it back in.' : null}
      right={
        <>
          <SaveState status={kb.status} />
          {state && (
            <Select value={String(state.active)} onValueChange={(v) => void kb.act({ type: 'activate', slot: Number(v) }, 'Profile switched')}>
              <SelectTrigger className="h-9 w-56 bg-surface">
                <Layers className="size-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {state.profiles.map((p) => (
                  <SelectItem key={p.slot} value={String(p.slot)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </>
      }
    >
      {body}
    </Shell>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Copy, Mic, MicOff, Pencil, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { eqCode, parseEqCode } from '@shared/eq'
import type { Capability, DeviceSummary, EqBand, HeadsetPatch, HeadsetState } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { HeadsetArt } from '@/components/DeviceArt'
import { EqEditor } from '@/components/EqEditor'
import { Canvas, Caption, Row, SidePanel } from '@/components/kit'
import type { SaveStatus } from '@/hooks/useMouse'
import { cn } from '@/lib/utils'
import { type RailItem, SaveState, Shell } from './Shell'

const RAIL: RailItem[] = [{ key: 'audio', label: 'Audio & EQ', icon: SlidersHorizontal }]

const describe = (bands: EqBand[]) => {
  if (!bands.length || bands.every((b) => Math.abs(b.gain) < 0.05 && (b.type === 'peak' || b.type.endsWith('Shelf')))) return 'Flat'
  const lows = bands.filter((b) => b.freq < 250).reduce((s, b) => s + b.gain, 0)
  const highs = bands.filter((b) => b.freq > 1000).reduce((s, b) => s + b.gain, 0)
  if (lows > 1 && lows > highs) return 'Bass boost'
  if (highs > 1) return 'Bright'
  return `${bands.length} bands`
}

// Preset names live on this PC only (the headset doesn't store names).
const nameKey = (serial: string, slot: number) => `hubless:eqname:${serial}:${slot}`
const readName = (serial: string, slot: number) => {
  try {
    return localStorage.getItem(nameKey(serial, slot))
  } catch {
    return null
  }
}

export function HeadsetView({ device, photo, onBack }: { device: DeviceSummary; photo?: string; onBack: () => void }) {
  const [state, setState] = useState<HeadsetState | null>(null)
  const [section, setSection] = useState<Capability>('audio')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [editSlot, setEditSlot] = useState<number | null>(null)
  const [draft, setDraft] = useState<EqBand[] | null>(null)
  const [renaming, setRenaming] = useState<{ slot: number; name: string } | null>(null)
  const [codeDialog, setCodeDialog] = useState(false)
  const [code, setCode] = useState('')
  const [, rerender] = useState(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveBusy = useRef(false)
  useEffect(() => {
    void window.hubless.headsetState(device.id).then(setState, (e) => toast.error(e.message))
    // Keep mute, boom mic and battery live; skipped while an EQ edit is being saved.
    const t = setInterval(() => {
      if (!saveTimer.current && !liveBusy.current) void window.hubless.headsetState(device.id).then(setState, () => {})
    }, 2000)
    return () => clearInterval(t)
  }, [device.id, device.status])

  const slot = editSlot ?? state?.eqSlot ?? 1
  const preset = state?.presets.find((p) => p.slot === slot)
  const bands = draft ?? preset?.bands ?? []
  useEffect(() => setDraft(null), [slot])

  const apply = async (patch: HeadsetPatch, quiet = false) => {
    if (!state) return
    if (!quiet) setStatus('saving')
    try {
      const s = await window.hubless.setHeadset(device.id, patch)
      setState(s)
      if (!quiet) setStatus('saved')
    } catch (e) {
      setStatus('error')
      toast.error((e as Error).message)
      void window.hubless.headsetState(device.id).then(setState)
    }
  }

  const editEq = (next: EqBand[], done: boolean) => {
    setDraft(next)
    // While dragging, preview on the headset (only for the slot that's playing); save once the edit settles.
    if (!done && slot === state?.eqSlot && !liveBusy.current) {
      liveBusy.current = true
      void apply({ eq: { slot, bands: next, live: true } }, true).finally(() => (liveBusy.current = false))
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (done) saveTimer.current = setTimeout(() => void apply({ eq: { slot, bands: next } }).then(() => {
        setDraft(null)
        saveTimer.current = null
      }), 500)
  }

  const off = device.status === 'asleep'
  const presetName = (s: number) => (state && readName(state.serial, s)) || `Preset ${s}`

  const body = !state ? null : section === 'device' ? (
    <>
      <SidePanel title="Device settings">
        <dl className="space-y-3 text-sm">
          {[
            ['Headset firmware', state.headsetFirmware || '—'],
            ['Dongle firmware', state.dongleFirmware],
            ['Dongle serial', state.serial],
            ['Connection', device.connection]
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="selectable text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </SidePanel>
      <Canvas>{photo ? <img src={photo} alt={`${device.vendor} ${device.name}`} draggable={false} className="h-72 w-auto object-contain" /> : <HeadsetArt className="h-72" />}</Canvas>
    </>
  ) : (
    <>
      <SidePanel title="Audio">
        <div className="space-y-2">
          <Caption>EQ preset</Caption>
          {state.presets.map((p) => (
            <div
              key={p.slot}
              role="button"
              tabIndex={0}
              onClick={() => {
                setEditSlot(p.slot)
                if (p.slot !== state.eqSlot) void apply({ eqSlot: p.slot })
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLElement).click()}
              className={cn(
                'group flex h-12 w-full items-center gap-2 rounded-lg border px-3.5 text-left transition-colors',
                p.slot === state.eqSlot ? 'border-primary/60 bg-primary/10' : 'border-transparent bg-surface-2 hover:border-foreground/15'
              )}
            >
              <span className="flex-1 truncate text-sm font-semibold">{presetName(p.slot)}</span>
              <span className="text-xs text-muted-foreground">{describe(p.bands)}</span>
              <button
                type="button"
                aria-label="Rename preset"
                className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  setRenaming({ slot: p.slot, name: presetName(p.slot) })
                }}
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="space-y-4 border-t pt-4">
          <Caption>Microphone</Caption>
          <Row label="Noise cancelling" hint="Filters background noise from your mic">
            <Switch checked={state.noiseCancelling} onCheckedChange={(v) => apply({ noiseCancelling: v })} />
          </Row>
          <Row label="Sidetone" hint="Hear your own voice in the headset">
            <Switch checked={state.sidetone} onCheckedChange={(v) => apply({ sidetone: v })} />
          </Row>
          {state.sidetone && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Sidetone volume</span>
                <span className="font-semibold text-primary tabular-nums">{state.sidetoneLevel}</span>
              </div>
              <Slider min={0} max={75} step={1} defaultValue={[state.sidetoneLevel]} key={state.sidetoneLevel} onValueCommit={([v]) => apply({ sidetoneLevel: v })} aria-label="Sidetone volume" />
            </div>
          )}
        </div>
        <div className="space-y-4 border-t pt-4">
          <Caption>Lighting</Caption>
          <Row label="Headset lighting">
            <Switch checked={state.lighting} onCheckedChange={(v) => apply({ lighting: v })} />
          </Row>
        </div>
      </SidePanel>
      <Canvas
        className="flex-col items-stretch justify-start gap-6 overflow-y-auto px-8 pt-2"
        title={`EQ · ${presetName(slot)}`}
        action={
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setCodeDialog(true)}>
              <Copy className="size-3.5" /> EQ code
            </Button>
            {slot !== 1 && (
              <Button size="sm" variant="ghost" onClick={() => void apply({ eraseEq: slot }).then(() => setDraft(null))}>
                <RotateCcw className="size-3.5" /> Factory preset
              </Button>
            )}
          </div>
        }
      >
        <div className="flex items-center gap-8">
          {photo ? <img src={photo} alt={`${device.vendor} ${device.name}`} draggable={false} className="h-32 w-auto object-contain" /> : <HeadsetArt className="h-32" />}
          <div className="space-y-2">
            {state.battery !== null && (
              <div>
                <Caption>Battery</Caption>
                <div className="text-2xl font-bold tabular-nums">{state.battery}%</div>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {state.muted ? <MicOff className="size-4 text-destructive" /> : <Mic className="size-4" />}
              {state.muted ? 'Mic muted' : state.boomMic ? 'Boom mic connected' : 'Built-in mic'}
            </div>
          </div>
        </div>
        <EqEditor bands={bands} onChange={editEq} />
      </Canvas>
    </>
  )

  return (
    <Shell
      name={device.name}
      rail={RAIL}
      section={section}
      onSection={setSection}
      onBack={onBack}
      loading={!state}
      asleep={off ? 'The headset is switched off. Turn it on to change its settings.' : null}
      right={
        <>
          <SaveState status={status} />
          {state?.battery != null && <span className="text-sm text-muted-foreground tabular-nums">{state.battery}% battery</span>}
        </>
      }
    >
      {body}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename preset</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (renaming && state) {
                try {
                  localStorage.setItem(nameKey(state.serial, renaming.slot), renaming.name.trim() || `Preset ${renaming.slot}`)
                } catch {
                  /* storage unavailable */
                }
                rerender((n) => n + 1)
              }
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
      <Dialog open={codeDialog} onOpenChange={setCodeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>EQ code</DialogTitle>
            <DialogDescription>Works with Fractal’s Adjust Pro too. Copy this preset, or paste a code to load it into {presetName(slot)}.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-1 pl-3">
            <code className="selectable flex-1 truncate text-sm">{eqCode(bands)}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(eqCode(bands))
                toast.success('EQ code copied')
              }}
            >
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              try {
                const parsed = parseEqCode(code)
                setCodeDialog(false)
                setCode('')
                editEq(parsed, true)
                toast.success('EQ code loaded')
              } catch (err) {
                toast.error((err as Error).message)
              }
            }}
          >
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste an EQ code" className="font-mono" />
            <Button type="submit" disabled={!code.trim()}>
              Load
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Shell>
  )
}

import { useState } from 'react'
import { ArrowDownToLine, Copy, RotateCcw, Share2, Undo2, Vibrate } from 'lucide-react'
import { toast } from 'sonner'
import type { Hits } from '@shared/types'
import { hitsCode, parseHitsCode } from '@shared/actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { MouseArt } from '@/components/DeviceArt'
import { PhotoMouse } from '@/components/PhotoMouse'
import { usePhysicalButtons } from '@/hooks/usePhysicalButtons'
import { useDepth } from '@/hooks/useDepth'
import { TestPad } from '@/components/TestPad'
import { Canvas, Caption, PanelTabs, SidePanel, VerticalStepper } from '@/components/kit'
import type { MouseCtl } from '@/hooks/useMouse'
import { cn } from '@/lib/utils'

type Tab = 'actuation' | 'rt' | 'haptics'
type Target = 'both' | 'left' | 'right'

const FACTORY: Hits = { actuation: 5, rtLevel: 2, rtOn: false, haptics: 3 }
const PRESETS: [string, Hits][] = [
  ['Balanced', { actuation: 5, rtLevel: 3, rtOn: false, haptics: 3 }],
  ['Fast tap', { actuation: 2, rtLevel: 1, rtOn: true, haptics: 3 }],
  ['Spam click', { actuation: 1, rtLevel: 1, rtOn: true, haptics: 2 }],
  ['Deliberate', { actuation: 8, rtLevel: 3, rtOn: false, haptics: 4 }],
  ['Silent', { actuation: 5, rtLevel: 3, rtOn: false, haptics: 0 }]
]

const TAB_INFO: Record<Tab, string> = {
  actuation: 'How far you press before the click registers.',
  rt: 'Releases the click the moment the button starts rising, so the next click lands sooner.',
  haptics: 'Strength of the vibration that simulates a mechanical click.'
}

/** Per-button values beside the mouse. */
function Callout({ title, h, active, onClick, live }: { title: string; h: Hits; active: boolean; onClick: () => void; live: number }) {
  const row = (Icon: typeof Vibrate, v: string, label: string) => (
    <div className="flex items-center gap-2.5" title={label}>
      <Icon className="size-3.5 text-muted-foreground" />
      <span className={cn('text-base font-bold tabular-nums', active && 'text-primary')}>{v}</span>
    </div>
  )
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-24 flex-col gap-2 rounded-lg border bg-surface px-3.5 py-3 text-left transition-colors',
        active ? 'border-primary/70' : 'hover:border-foreground/20'
      )}
    >
      <Caption className={active ? 'text-primary' : undefined}>{title}</Caption>
      {row(ArrowDownToLine, String(h.actuation), 'Actuation point')}
      {row(Undo2, h.rtOn ? String(h.rtLevel) : 'Off', 'Rapid trigger')}
      {row(Vibrate, h.haptics ? String(h.haptics) : 'Off', 'Haptics')}
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" title="Live press depth">
        <div className={cn('h-full rounded-full transition-[width] duration-75', live >= h.actuation ? 'bg-primary' : 'bg-primary/50')} style={{ width: `${Math.min(100, (live / 10) * 100)}%` }} />
      </div>
    </button>
  )
}

export function Triggers({ mouse, id, photo }: { mouse: MouseCtl; id: string; photo?: string }) {
  const [tab, setTab] = useState<Tab>('actuation')
  const pressed = usePhysicalButtons(id)
  const depth = useDepth(id)
  const [photoOk, setPhotoOk] = useState(true)
  const [target, setTarget] = useState<Target>('both')
  const [share, setShare] = useState(false)
  const [code, setCode] = useState('')
  const { draft, state, update } = mouse
  if (!draft?.hits || !state) return null
  const caps = state.hitsCaps ?? { actuation: 10, rt: 5, haptics: 5 }
  const idx = target === 'left' ? [0] : target === 'right' ? [1] : [0, 1]
  const h = draft.hits[idx[0]]
  const set = (patch: Partial<Hits>) => update((d) => idx.forEach((i) => Object.assign(d.hits![i], patch)), { previewHits: true })
  const [l, r] = draft.hits

  const stepper = {
    actuation: (
      <VerticalStepper label="Actuation point" min={1} max={caps.actuation} value={h.actuation} onChange={(v) => set({ actuation: v })} top="Short click" bottom="Deep click" />
    ),
    rt: (
      <VerticalStepper label="Reset distance" min={1} max={caps.rt} value={h.rtLevel} disabled={!h.rtOn} onChange={(v) => set({ rtLevel: v })} top="Instant reset" bottom="Long reset" />
    ),
    haptics: <VerticalStepper label="Haptic strength" min={0} max={caps.haptics} value={h.haptics} onChange={(v) => set({ haptics: v })} top="Off" bottom="Strong" />
  }[tab]
  const value = { actuation: String(h.actuation), rt: h.rtOn ? String(h.rtLevel) : 'Off', haptics: h.haptics ? String(h.haptics) : 'Off' }[tab]
  const resetTab = () =>
    set(tab === 'actuation' ? { actuation: FACTORY.actuation } : tab === 'rt' ? { rtLevel: FACTORY.rtLevel, rtOn: FACTORY.rtOn } : { haptics: FACTORY.haptics })

  return (
    <>
      <SidePanel title="HITS configuration">
        <PanelTabs value={tab} onChange={setTab} items={[['actuation', 'Actuation'], ['rt', 'Rapid trigger'], ['haptics', 'Haptics']]} />
        <p className="text-sm text-muted-foreground">{TAB_INFO[tab]}</p>
        <Select value={target} onValueChange={(v) => setTarget(v as Target)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="both">Both buttons (L + R)</SelectItem>
            <SelectItem value="left">Left button</SelectItem>
            <SelectItem value="right">Right button</SelectItem>
          </SelectContent>
        </Select>
        {tab === 'rt' && (
          <label className="flex items-center justify-between rounded-lg bg-surface-2 px-3.5 py-2.5 text-sm font-medium">
            Rapid Trigger
            <Switch checked={h.rtOn} onCheckedChange={(v) => set({ rtOn: v })} />
          </label>
        )}
        <div className="flex items-start justify-between">
          {stepper}
          <div className="flex flex-col items-end gap-2">
            <span className="text-4xl font-bold tabular-nums">{value}</span>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetTab}>
              <RotateCcw className="size-3.5" /> Default
            </Button>
          </div>
        </div>
        <div className="mt-auto space-y-2.5 border-t pt-4">
          <Caption>Presets</Caption>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([name, p]) => (
              <Button
                key={name}
                size="sm"
                variant="secondary"
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => update((d) => idx.forEach((i) => (d.hits![i] = { ...p })), { previewHits: true })}
              >
                {name}
              </Button>
            ))}
          </div>
        </div>
      </SidePanel>

      <Canvas
        title="HITS code"
        action={
          <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label="Share HITS code" onClick={() => setShare(true)}>
            <Share2 className="size-4" />
          </Button>
        }
        className="flex-col gap-8"
      >
        <div className="flex items-start gap-6">
          <div className="mt-10">
            <Callout title="Left" h={l} live={depth[0]} active={idx.includes(0)} onClick={() => setTarget('left')} />
          </div>
          <div className="flex h-[380px] items-center justify-center">
            {photo && photoOk ? (
              <PhotoMouse
                photo={photo}
                selected={idx}
                pressed={pressed.filter((b) => b < 2)}
                hits={draft.hits}
                depth={depth}
                maxAct={caps.actuation}
                onButton={(i) => setTarget(i === 0 ? 'left' : 'right')}
                onUnsupported={() => setPhotoOk(false)}
                className="h-full w-auto"
              />
            ) : (
              <MouseArt highlight={idx} pressed={pressed} onRegion={(i) => i < 2 && setTarget(i === 0 ? 'left' : 'right')} />
            )}
          </div>
          <div className="mt-10">
            <Callout title="Right" h={r} live={depth[1]} active={idx.includes(1)} onClick={() => setTarget('right')} />
          </div>
        </div>
        <div className="flex w-full flex-col items-center gap-2">
          <Caption>Try it · click inside with either button</Caption>
          <TestPad />
        </div>
      </Canvas>

      <Dialog open={share} onOpenChange={setShare}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>HITS code</DialogTitle>
            <DialogDescription>Codes work with G HUB too. Share yours, or paste one from a teammate or pro player.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-1 pl-3">
            <code className="selectable flex-1 truncate text-sm">{hitsCode(l, r)}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(hitsCode(l, r))
                toast.success('Code copied')
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
                const [a, b] = parseHitsCode(code)
                update((d) => (d.hits = [a, b]), { previewHits: true })
                setCode('')
                setShare(false)
                toast.success('HITS code applied')
              } catch (err) {
                toast.error((err as Error).message)
              }
            }}
          >
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste a code" className="font-mono" />
            <Button type="submit" disabled={!code.trim()}>
              Apply
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Action, CODE_TO_HID, FUNCTIONS, MEDIA, MOUSE_BUTTONS, actionCode, actionKind, describeAction } from '@shared/actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MOUSE, MouseArt } from '@/components/DeviceArt'
import { PhotoMouse } from '@/components/PhotoMouse'
import { Canvas, Caption, PanelTabs, SidePanel } from '@/components/kit'
import type { MouseCtl } from '@/hooks/useMouse'
import { usePhysicalButtons } from '@/hooks/usePhysicalButtons'
import { cn } from '@/lib/utils'

export const BUTTON_NAMES = ['Left button', 'Right button', 'Wheel click', 'Back', 'Forward']
type Tab = 'mouse' | 'keys' | 'media' | 'functions'
const MOD_KEYS = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])
const DOM_BUTTON: Record<number, number> = { 0: 0, 2: 1, 1: 2, 3: 3, 4: 4 }

function usePressed() {
  const [pressed, setPressed] = useState<number[]>([])
  useEffect(() => {
    const down = (e: MouseEvent) => setPressed((p) => [...p, DOM_BUTTON[e.button]])
    const up = (e: MouseEvent) => setPressed((p) => p.filter((b) => b !== DOM_BUTTON[e.button]))
    window.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
    }
  }, [])
  return pressed
}

export function Buttons({ mouse, id, photo }: { mouse: MouseCtl; id: string; photo?: string }) {
  const [photoOk, setPhotoOk] = useState(true)
  const { draft, state, update } = mouse
  const [sel, setSel] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('mouse')
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const inApp = usePressed()
  const physical = usePhysicalButtons(id)
  const pressed = [...new Set([...inApp, ...physical])]
  const current = draft?.buttons[sel] ?? 'ffffffff'
  useEffect(() => {
    const k = actionKind(current)
    setTab(k === 'key' ? 'keys' : k === 'media' ? 'media' : k === 'function' || k === 'disabled' ? 'functions' : 'mouse')
    setQuery('')
    setRecording(false)
  }, [sel]) // eslint-disable-line react-hooks/exhaustive-deps

  const lists = useMemo<Record<Exclude<Tab, 'keys'>, [string, string][]>>(
    () => ({
      mouse: Object.entries(MOUSE_BUTTONS).map(([c, n]) => [n, Action.mouse(Number(c))]),
      media: Object.entries(MEDIA).map(([c, n]) => [n, Action.media(Number(c))]),
      functions: [...Object.entries(FUNCTIONS).map(([c, n]) => [n, Action.fn(Number(c))] as [string, string]), ['Do nothing', Action.disabled()]]
    }),
    []
  )
  if (!draft || !state) return null
  const n = Math.min(5, state.onboard?.buttons ?? 5)

  const assign = (action: string, force = false) => {
    const next = draft.buttons.map((b, k) => (k === sel ? action : b))
    const keepsLeft = next.slice(0, 5).some((b) => actionKind(b) === 'mouse' && actionCode(b) & 1)
    if (!keepsLeft && !force) return setConfirm(action)
    update((d) => (d.buttons[sel] = action), { immediate: true })
  }

  // Labels sit in two columns beside the mouse; badges on the mouse carry the same numbers.
  const label = (i: number) => (
    <button
      key={i}
      type="button"
      onClick={() => setSel(i)}
      onMouseEnter={() => setHover(i)}
      onMouseLeave={() => setHover(null)}
      className={cn(
        'flex w-44 items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 text-left transition-colors',
        sel === i ? 'border-primary/70' : 'hover:border-foreground/20'
      )}
    >
      <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', sel === i ? 'bg-primary text-white' : 'bg-surface-2')}>
        {i + 1}
      </span>
      <span className="min-w-0">
        <span className="caption block text-[10px]">{BUTTON_NAMES[i]}</span>
        <span className="block truncate text-sm font-semibold">{describeAction(draft.buttons[i])}</span>
      </span>
    </button>
  )

  return (
    <>
      <SidePanel title={`${sel + 1} · ${BUTTON_NAMES[sel]}`}>
        <div className="rounded-lg bg-surface-2 px-3.5 py-2.5">
          <Caption>Assigned</Caption>
          <div className="text-[15px] font-semibold">{describeAction(current)}</div>
        </div>
        <PanelTabs value={tab} onChange={setTab} items={[['mouse', 'Mouse'], ['keys', 'Keys'], ['media', 'Media'], ['functions', 'Functions']]} />
        {tab === 'keys' ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setRecording(true)}
              onBlur={() => setRecording(false)}
              onKeyDown={(e) => {
                if (!recording) return
                e.preventDefault()
                if (MOD_KEYS.has(e.code)) return
                const usage = CODE_TO_HID[e.code]
                if (usage === undefined) return toast.error('That key can’t be assigned.')
                const mods = (e.ctrlKey ? 1 : 0) | (e.shiftKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0)
                assign(Action.key(usage, mods))
                setRecording(false)
              }}
              className={cn(
                'flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition-colors',
                recording ? 'border-primary bg-primary/10' : 'hover:border-foreground/25'
              )}
            >
              <span className="text-lg font-semibold">{recording ? 'Press a key…' : 'Record a shortcut'}</span>
              <span className="text-xs text-muted-foreground">Hold Ctrl, Shift, Alt or Super for a combination</span>
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-9 pl-8" />
            </div>
            <div className="space-y-0.5">
              {lists[tab]
                .filter(([name]) => name.toLowerCase().includes(query.toLowerCase()))
                .map(([name, action]) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => assign(action)}
                    className={cn(
                      'flex h-9 w-full items-center justify-between rounded-md px-3 text-left text-sm transition-colors',
                      action === current ? 'bg-primary/12 font-semibold text-primary' : 'hover:bg-surface-2'
                    )}
                  >
                    {name}
                    {action === current && <Check className="size-4" />}
                  </button>
                ))}
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="mt-auto self-start text-muted-foreground"
          onClick={() => {
            update((d) => d.buttons.splice(0, 5, ...[0x01, 0x02, 0x04, 0x08, 0x10].map(Action.mouse)), { immediate: true })
            toast.success('Buttons restored to defaults')
          }}
        >
          Restore all buttons to default
        </Button>
      </SidePanel>

      <Canvas title="Assignments" className="gap-8">
        <div className="flex flex-col gap-3">{[0, 4, 3].filter((i) => i < n).map(label)}</div>
        <div className="flex h-[420px] items-center justify-center">
          {photo && photoOk ? (
            <PhotoMouse
              photo={photo}
              selected={[sel]}
              pressed={pressed}
              badges
              onButton={(i) => i < n && setSel(i)}
              onUnsupported={() => setPhotoOk(false)}
              className="h-full w-auto"
            />
          ) : (
          <MouseArt highlight={[sel]} pressed={pressed} hover={hover} onHover={setHover} onRegion={(i) => i < n && setSel(i)}>
            {MOUSE.anchors.slice(0, n).map(([x, y], i) => (
              <g key={i} pointerEvents="none">
                <circle cx={x} cy={y} r="8.5" fill={sel === i ? '#ffffff' : '#111215'} stroke={sel === i ? '#2b8cff' : '#ffffff'} strokeOpacity={sel === i ? 1 : 0.5} strokeWidth="1.5" />
                <text x={x} y={y + 3.6} textAnchor="middle" fontSize="10" fontWeight="700" fill={sel === i ? '#2b8cff' : '#ffffff'}>
                  {i + 1}
                </text>
              </g>
            ))}
          </MouseArt>
          )}
        </div>
        <div className="flex flex-col gap-3">{[1, 2].filter((i) => i < n).map(label)}</div>
      </Canvas>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keep a left click?</DialogTitle>
            <DialogDescription>No button would send a left click any more, which makes your computer hard to use with this mouse.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm) assign(confirm, true)
                setConfirm(null)
              }}
            >
              Assign anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

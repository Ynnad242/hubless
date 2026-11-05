import { useEffect, useState } from 'react'
import { Download, Pencil, RotateCcw, Upload } from 'lucide-react'
import { describeAction } from '@shared/actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Canvas, Caption, SidePanel } from '@/components/kit'
import type { MouseCtl } from '@/hooks/useMouse'
import { cn } from '@/lib/utils'
import { BUTTON_NAMES } from './Buttons'
import { STAGE_COLORS } from './Sensor'

export function Profiles({ mouse, id }: { mouse: MouseCtl; id: string }) {
  const { state, editSector, act, editProfile, update } = mouse
  const [sel, setSel] = useState(editSector)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  useEffect(() => setSel(editSector), [editSector])
  if (!state) return null
  const api = window.hubless
  const i = Math.max(0, state.profiles.findIndex((p) => p.sector === sel))
  const p = state.profiles[i]
  const name = (k: number) => state.profiles[k].name || `Profile ${k + 1}`
  const active = p.sector === state.activeSector

  const rename = (nm: string) => {
    const clean = nm.trim().slice(0, 24)
    if (p.sector === editSector) update((d) => (d.name = clean), { immediate: true })
    else void act(() => api.saveProfile(id, { ...p, name: clean }))
  }

  return (
    <>
      <SidePanel title="Onboard profiles">
        <p className="text-sm text-muted-foreground">Five complete setups stored inside the mouse. Profiles that are on are included when you cycle with a button.</p>
        <div className="space-y-1.5">
          {state.profiles.map((q, k) => {
            const inUse = q.sector === state.activeSector
            return (
              <div
                key={q.sector}
                role="button"
                tabIndex={0}
                onClick={() => setSel(q.sector)}
                onKeyDown={(e) => e.key === 'Enter' && setSel(q.sector)}
                className={cn(
                  'flex h-12 items-center gap-3 rounded-lg border px-3 transition-colors',
                  q.sector === sel ? 'border-primary/60 bg-primary/10' : 'border-transparent bg-surface-2 hover:border-foreground/15'
                )}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: STAGE_COLORS[k], opacity: q.enabled ? 1 : 0.3 }} />
                <span className={cn('flex-1 truncate text-sm font-semibold', !q.enabled && 'text-muted-foreground')}>{name(k)}</span>
                {inUse ? (
                  <span className="caption text-success">In use</span>
                ) : (
                  <Switch
                    checked={q.enabled}
                    onClick={(e) => e.stopPropagation()}
                    onCheckedChange={(v) => act(() => api.setProfileEnabled(id, k, v))}
                    aria-label={`Include ${name(k)} in profile cycling`}
                  />
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-auto space-y-2 border-t pt-4">
          <Caption>Share</Caption>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" onClick={() => void api.exportProfile(id, p.sector)}>
              <Download className="size-3.5" /> Export
            </Button>
            <Button variant="secondary" size="sm" onClick={() => act(() => api.importProfile(id, p.sector), 'Profile imported')}>
              <Upload className="size-3.5" /> Import
            </Button>
          </div>
        </div>
      </SidePanel>

      <Canvas className="items-start pt-14">
        <div className="w-full max-w-xl space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Caption>{active ? 'In use' : p.enabled ? 'On' : 'Off'}</Caption>
              <div className="flex items-center gap-2">
                <h2 className="text-4xl font-bold tracking-tight">{name(i)}</h2>
                <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label="Rename" onClick={() => setRenaming(name(i))}>
                  <Pencil className="size-4" />
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              {!active && (
                <Button onClick={() => act(() => api.activateProfile(id, p.sector), `${name(i)} is now in use`, p.sector)}>Use profile</Button>
              )}
              <Button variant="secondary" disabled={p.sector === editSector} onClick={() => editProfile(p.sector)}>
                {p.sector === editSector ? 'Editing' : 'Edit'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat label="DPI stages">
              <div className="flex flex-wrap gap-1.5">
                {p.stages.filter((s) => s.x > 0).map((s, k) => (
                  <span key={k} className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-sm font-semibold tabular-nums">
                    <span className="size-2 rounded-full" style={{ background: STAGE_COLORS[k] }} />
                    {s.x}
                  </span>
                ))}
              </div>
            </Stat>
            <Stat label="Polling rate">
              <span className="text-xl font-bold tabular-nums">{p.rateHz} Hz</span>
            </Stat>
            {p.hits && (
              <Stat label="HITS triggers">
                <div className="space-y-0.5 text-sm">
                  {p.hits.map((h, k) => (
                    <div key={k} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{k ? 'Right' : 'Left'}</span>
                      <span className="font-medium tabular-nums">
                        Act {h.actuation} · {h.rtOn ? `RT ${h.rtLevel}` : 'RT off'} · Haptic {h.haptics || 'off'}
                      </span>
                    </div>
                  ))}
                </div>
              </Stat>
            )}
            <Stat label="Buttons">
              <div className="space-y-0.5 text-sm">
                {p.buttons.slice(0, Math.min(5, state.onboard?.buttons ?? 5)).map((b, k) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{BUTTON_NAMES[k]}</span>
                    <span className="truncate font-medium">{describeAction(b)}</span>
                  </div>
                ))}
              </div>
            </Stat>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-5">
            <span className="text-sm text-muted-foreground">Copy settings from</span>
            <Select value="" onValueChange={(v) => act(() => api.replaceProfile(id, p.sector, { fromSector: Number(v) }), 'Settings copied')}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Choose profile" />
              </SelectTrigger>
              <SelectContent>
                {state.profiles.map((q, k) =>
                  q.sector === p.sector ? null : (
                    <SelectItem key={q.sector} value={String(q.sector)}>
                      {name(k)}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            {state.hasFactory && (
              <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => setResetting(true)}>
                <RotateCcw className="size-3.5" /> Reset to factory
              </Button>
            )}
          </div>
        </div>
      </Canvas>

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename profile</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (renaming !== null) rename(renaming)
              setRenaming(null)
            }}
          >
            <Input autoFocus maxLength={24} value={renaming ?? ''} onChange={(e) => setRenaming(e.target.value)} />
            <DialogFooter>
              <Button type="submit">Rename</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={resetting} onOpenChange={setResetting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset {name(i)} to factory settings?</DialogTitle>
            <DialogDescription>DPI, buttons, polling rate and triggers go back to how the mouse came out of the box. A backup is kept.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setResetting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setResetting(false)
                void act(() => api.replaceProfile(id, p.sector, 'factory'), 'Profile reset')
              }}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border bg-surface p-4">
      <Caption>{label}</Caption>
      {children}
    </div>
  )
}

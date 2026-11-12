import { useEffect, useState } from 'react'
import { ExternalLink, FileText, Info, RefreshCw, Scale, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AppSettings, UpdateStatus } from '@shared/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Caption, Row } from '@/components/kit'
import { Markdown } from '@/components/Markdown'


export function SettingsDialog({ open, onOpenChange, update, onAbout }: { open: boolean; onOpenChange: (o: boolean) => void; update: UpdateStatus; onAbout: () => void }) {
  const [s, setS] = useState<AppSettings | null>(null)
  const [doc, setDoc] = useState<{ name: Doc; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [version, setVersion] = useState('')
  const api = window.hubless
  useEffect(() => {
    if (!open) return
    void api.appSettings().then(setS)
    void api.appInfo().then((i) => setVersion(i.version))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = async (patch: Partial<AppSettings>) => setS(await api.setAppSettings(patch))
  const show = (name: Doc) => openDocument(name, setDoc)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Device settings are stored in your devices. These only change how the app behaves.</DialogDescription>
          </DialogHeader>
          {s && (
            <div className="space-y-5 pt-2">
              <Row label="Keep running in the tray" hint="Closing the window leaves Hubless in the tray, so it can warn you about low batteries">
                <Switch checked={s.runInTray} onCheckedChange={(v) => set({ runInTray: v })} />
              </Row>
              <Row label="Start when you log in" hint="Starts quietly in the tray">
                <Switch checked={s.startOnLogin} onCheckedChange={(v) => set({ startOnLogin: v })} />
              </Row>
              <Row label="Low battery warning" hint="A notification when a wireless device runs low">
                <Select value={String(s.lowBattery)} onValueChange={(v) => set({ lowBattery: Number(v) })}>
                  <SelectTrigger size="sm" className="w-28" aria-label="Low battery warning">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 10, 15, 20, 30].map((v) => (
                      <SelectItem key={v} value={String(v)}>
                        {v ? `At ${v}%` : 'Off'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            </div>
          )}

          {s && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-baseline justify-between">
                <Caption>Updates</Caption>
                {version && <span className="text-xs tabular-nums text-muted-foreground">Version {version}</span>}
              </div>
              <Row label="Update automatically" hint="Every time Hubless starts it looks for a new version and installs it, then opens as usual">
                <Switch checked={s.autoUpdate} onCheckedChange={(v) => set({ autoUpdate: v })} disabled={update.state === 'unsupported'} />
              </Row>
              <div className="flex items-center gap-3">
                <p className="flex-1 text-xs text-muted-foreground">{updateText(update)}</p>
                {update.state === 'ready' || update.state === 'installing' ? (
                  <Button size="sm" disabled={update.state === 'installing'} onClick={() => void api.installUpdate()}>
                    {update.state === 'ready' ? 'Update now' : 'Installing…'}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={update.state === 'unsupported' || update.state === 'checking' || update.state === 'downloading'}
                    onClick={() => void api.checkForUpdates()}
                  >
                    <RefreshCw className={cn('size-4', update.state === 'checking' && 'animate-spin')} /> Check now
                  </Button>
                )}
              </div>
              {update.state === 'downloading' && (
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={update.percent} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${update.percent}%` }} />
                </div>
              )}
            </div>
          )}

          <div className="space-y-3 border-t pt-4">
            <Caption>Device access</Caption>
            <div className="flex items-center gap-3">
              <p className="flex-1 text-xs text-muted-foreground">If a plugged-in device doesn’t show up, let Hubless talk to it. You’ll be asked for your password once.</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const r = await api.grantAccess()
                  ;(r.ok ? toast.success : toast.error)(r.message)
                }}
              >
                <ShieldCheck className="size-4" /> Grant access
              </Button>
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <Caption>Your data</Caption>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Hubless has no accounts, analytics or telemetry and never sends your data anywhere; it only asks GitHub for new versions. What it keeps (settings,
              devices seen before, your photos and device backups) stays in your home folder.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void show('privacy')}>
                <FileText className="size-4" /> Privacy
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Delete all Hubless data…
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-xs text-muted-foreground">Free and open source</span>
            <Button variant="ghost" size="sm" onClick={onAbout}>
              <Info className="size-4" /> About Hubless
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DocumentDialog doc={doc} onClose={() => setDoc(null)} />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all Hubless data?</DialogTitle>
            <DialogDescription>
              This removes your app settings, the list of devices seen before, photos you picked, the start-on-login entry and
              every device backup. It can’t be undone. Settings stored in your devices stay on the devices. Hubless restarts
              afterwards as if freshly installed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void api.deleteAllData()}>
              Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export type Doc = 'privacy' | 'licenses'

export const openDocument = (name: Doc, set: (d: { name: Doc; text: string }) => void) =>
  window.hubless.readDocument(name).then((text) => set({ name, text }), (e) => toast.error(e.message))

/** Shows a shipped document (privacy statement or open-source licenses). */
export function DocumentDialog({ doc, onClose }: { doc: { name: Doc; text: string } | null; onClose: () => void }) {
  return (
      <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{doc?.name === 'privacy' ? 'Privacy' : 'Open-source licenses'}</DialogTitle>
            <DialogDescription className="sr-only">{doc?.name === 'privacy' ? 'What Hubless stores and how to delete it' : 'Licenses of software and data used by Hubless'}</DialogDescription>
          </DialogHeader>
          {doc && <Markdown text={doc.text.replace(/^# .*\n/, '')} />}
        </DialogContent>
      </Dialog>
  )
}

/** Version, license, disclaimer and the shipped documents. */
export function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [info, setInfo] = useState<{ version: string; license: string; homepage: string } | null>(null)
  const [doc, setDoc] = useState<{ name: Doc; text: string } | null>(null)
  useEffect(() => {
    if (open) void window.hubless.appInfo().then(setInfo)
  }, [open])
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hubless {info?.version}</DialogTitle>
            <DialogDescription>
              One app for your gaming mice, keyboards and headsets on Linux. Settings are stored in your devices, so nothing has to keep running.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>Free and open source under the {info?.license ?? 'MIT'} license. No accounts, analytics or telemetry.</p>
            <p>
              Not affiliated with or endorsed by Logitech, Razer, Wooting, Fractal Design, Endgame Gear, WLmouse or any other manufacturer. Product
              names and photos belong to their owners and are used only to identify compatible hardware.
            </p>
            <p>
              Hubless writes settings into your devices’ memory, making a backup first. It is provided as is, without warranty. Protocol
              research builds on Solaar, libratbag, OpenRazer, egctl, OpenMouse and the SUPERSTRIKE community.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => void openDocument('privacy', setDoc)}>
              <FileText className="size-4" /> Privacy
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void openDocument('licenses', setDoc)}>
              <Scale className="size-4" /> Open-source licenses
            </Button>
            {info && (
              <Button variant="secondary" size="sm" asChild>
                <a href={info.homepage} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> GitHub · report a problem
                </a>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <DocumentDialog doc={doc} onClose={() => setDoc(null)} />
    </>
  )
}

function updateText(u: UpdateStatus) {
  const when = (t: number | null) => (t ? `, checked ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '')
  switch (u.state) {
    case 'unsupported':
      return u.reason
    case 'idle':
      return 'Not checked yet.'
    case 'checking':
      return 'Looking for a new version…'
    case 'none':
      return `You have the latest version${when(u.checkedAt)}.`
    case 'downloading':
      return `Downloading Hubless ${u.version}… ${u.percent}%`
    case 'ready':
      return `Hubless ${u.version} is ready to install.${u.needsPassword ? ' Installing asks for your password.' : ' It installs when you close Hubless, or now.'} Your settings are kept.`
    case 'installing':
      return `Installing Hubless ${u.version}… Hubless restarts by itself.`
    case 'error':
      return `Couldn’t update: ${u.message}`
  }
}

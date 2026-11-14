import { useState } from 'react'
import { ClipboardCopy, FolderOpen, HardDriveDownload, History } from 'lucide-react'
import { toast } from 'sonner'
import type { BackupInfo, DeviceSummary } from '@shared/types'
import { Button } from '@/components/ui/button'
import { FirmwarePanel } from '@/components/FirmwarePanel'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MouseArt } from '@/components/DeviceArt'
import { Canvas, Caption, SidePanel } from '@/components/kit'
import type { MouseCtl } from '@/hooks/useMouse'
import { copyDeviceReport } from '@/lib/report'

const FEATURE_NAMES: Record<number, string> = {
  0x0000: 'Root', 0x0001: 'Feature set', 0x0003: 'Firmware info', 0x0005: 'Device name', 0x1004: 'Battery',
  0x1d4b: 'Wireless status', 0x0020: 'Config change', 0x2202: 'DPI', 0x2250: 'Motion stats', 0x2251: 'Wheel stats',
  0x8090: 'Mode status', 0x8061: 'Polling rate', 0x8100: 'Onboard profiles', 0x8110: 'Button spy', 0x1b0c: 'HITS analog buttons'
}

export function Settings({ mouse, device, photo }: { mouse: MouseCtl; device: DeviceSummary; photo?: string }) {
  const { state, act } = mouse
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [features, setFeatures] = useState(false)
  if (!state) return null
  const api = window.hubless
  const details: [string, string][] = [
    ['Connection', device.connection],
    ['Firmware', state.firmware || 'Unknown'],
    ['Serial number', state.serial || 'Unknown'],
    /^\d/.test(state.protocol) ? ['HID++ version', state.protocol] : ['Protocol', state.protocol],
    [
      'Onboard memory',
      state.limits && !state.limits.profiles ? 'One configuration' : state.onboard ? `${state.onboard.profiles} profiles · format ${state.onboard.fmt}` : 'None'
    ]
  ]

  return (
    <>
      <SidePanel title="Device settings">
        <dl className="space-y-3">
          {details.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="selectable text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <FirmwarePanel device={device} />
        <div className="space-y-2 border-t pt-4">
          <Caption>Backups</Caption>
          <p className="text-xs text-muted-foreground">The whole mouse memory is saved before the first change of every session.</p>
          <div className="grid gap-2">
            <Button variant="secondary" size="sm" className="justify-start" onClick={() => api.backup(device.id).then(() => toast.success('Backup saved'), (e) => toast.error(e.message))}>
              <HardDriveDownload className="size-4" /> Back up now
            </Button>
            <Button variant="secondary" size="sm" className="justify-start" onClick={() => api.listBackups(device.id).then(setBackups)}>
              <History className="size-4" /> Restore a backup…
            </Button>
            <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => api.openBackupsFolder(device.id)}>
              <FolderOpen className="size-4" /> Open backups folder
            </Button>
          </div>
        </div>
        <div className="space-y-2 border-t pt-4">
          <Caption>Help improve support</Caption>
          <p className="text-xs text-muted-foreground">
            {device.verified ? 'Something not working right?' : 'Hubless hasn’t been tested on this model yet.'} Copy a report of what the mouse told Hubless and
            paste it into a GitHub issue. Copying it changes nothing on the mouse.
          </p>
          <Button variant="secondary" size="sm" className="justify-start" onClick={() => copyDeviceReport(device.id)}>
            <ClipboardCopy className="size-4" /> Copy device report
          </Button>
        </div>
        {state.features.length > 0 && <div className="mt-auto border-t pt-4">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setFeatures((f) => !f)}>
            {features ? 'Hide' : 'Show'} HID++ feature table
          </button>
          {features && (
            <div className="mt-2 space-y-1 font-mono text-[11px]">
              {state.features.filter((f) => !f.hidden).map((f) => (
                <div key={f.index} className="flex justify-between gap-2">
                  <span>0x{f.id.toString(16).padStart(4, '0')} {FEATURE_NAMES[f.id] ?? '?'}</span>
                  <span className="text-muted-foreground">v{f.version}</span>
                </div>
              ))}
            </div>
          )}
        </div>}
      </SidePanel>

      <Canvas className="flex-col gap-6">
        <div className="flex h-[360px] items-center justify-center">
          {photo ? <img src={photo} alt={`${device.vendor} ${device.name}`} draggable={false} className="max-h-full max-w-[420px] object-contain" /> : <MouseArt />}
        </div>
        {device.battery && (
          <div className="w-64 space-y-2 text-center">
            <div className="text-3xl font-bold tabular-nums">{device.battery.percent}%</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={device.battery.percent <= 15 && !device.battery.charging ? 'h-full bg-destructive' : 'h-full bg-primary'}
                style={{ width: `${device.battery.percent}%` }}
              />
            </div>
            <div className="text-sm text-muted-foreground">{device.battery.status}</div>
          </div>
        )}
        <p className="text-sm text-muted-foreground">{device.verified ? 'Verified with Hubless on real hardware.' : 'Not tested with Hubless yet. A backup is saved before every first change.'}</p>
      </Canvas>

      <Dialog open={!!backups} onOpenChange={(o) => !o && setBackups(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore a backup</DialogTitle>
            <DialogDescription>Restoring writes the whole profile memory back to the mouse.</DialogDescription>
          </DialogHeader>
          {backups?.length === 0 && <p className="text-sm text-muted-foreground">No backups yet.</p>}
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {backups?.map((b) => (
              <button
                key={b.path}
                type="button"
                className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm hover:bg-surface-2"
                onClick={() => {
                  setBackups(null)
                  void act(() => api.restoreBackup(device.id, b.path), 'Backup restored')
                }}
              >
                <span className="font-medium">{new Date(b.created * 1000).toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">{b.label === 'before-changes' ? 'Before changes' : b.label === 'manual' ? 'Manual' : b.label}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

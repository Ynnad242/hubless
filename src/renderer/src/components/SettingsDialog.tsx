import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Row } from '@/components/kit'

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [s, setS] = useState<AppSettings | null>(null)
  useEffect(() => {
    if (open) void window.hubless.appSettings().then(setS)
  }, [open])
  const set = async (patch: Partial<AppSettings>) => setS(await window.hubless.setAppSettings(patch))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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
                <SelectTrigger size="sm" className="w-28">
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
      </DialogContent>
    </Dialog>
  )
}

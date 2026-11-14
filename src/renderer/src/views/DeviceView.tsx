import { useEffect, useState } from 'react'
import { Crosshair, Layers, Lightbulb, MousePointerClick, SquareMousePointer } from 'lucide-react'
import type { Capability, DeviceSummary } from '@shared/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type MouseCtl, useMouse } from '@/hooks/useMouse'
import { Buttons } from '@/sections/Buttons'
import { Lighting } from '@/sections/Lighting'
import { Profiles } from '@/sections/Profiles'
import { Sensor } from '@/sections/Sensor'
import { Settings as DeviceSettings } from '@/sections/Settings'
import { Triggers } from '@/sections/Triggers'
import { type RailItem, SaveState, Shell } from './Shell'

const RAIL: RailItem[] = [
  { key: 'triggers', label: 'HITS triggers', icon: MousePointerClick },
  { key: 'sensor', label: 'Sensor & DPI', icon: Crosshair },
  { key: 'buttons', label: 'Buttons', icon: SquareMousePointer },
  { key: 'lighting', label: 'Lighting', icon: Lightbulb },
  { key: 'profiles', label: 'Profiles', icon: Layers }
]

/** Mouse page (Logitech). */
export function DeviceView({ device, photo, onBack, expose }: { device: DeviceSummary; photo?: string; onBack: () => void; expose: (m: MouseCtl, nav: (c: Capability) => void) => void }) {
  const mouse = useMouse(device.id)
  const [section, setSection] = useState<Capability>(device.capabilities[0])
  useEffect(() => expose(mouse, setSection), [mouse, expose])
  useEffect(() => {
    if (device.status === 'ready') void mouse.reload()
  }, [device.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const { state } = mouse

  const body = {
    triggers: <Triggers mouse={mouse} id={device.id} photo={photo} />,
    sensor: <Sensor mouse={mouse} />,
    buttons: <Buttons mouse={mouse} id={device.id} photo={photo} />,
    lighting: <Lighting mouse={mouse} device={device} photo={photo} />,
    profiles: <Profiles mouse={mouse} id={device.id} />,
    device: <DeviceSettings mouse={mouse} device={device} photo={photo} />
  }[section as 'triggers']

  return (
    <Shell
      name={device.name}
      rail={RAIL.filter((r) => device.capabilities.includes(r.key))}
      section={section}
      onSection={setSection}
      onBack={async () => {
        await mouse.flush()
        onBack()
      }}
      busy={device.status === 'asleep' && !!device.note}
      asleep={device.status === 'asleep' ? (device.note ? `${device.note}.` : `Your ${device.name} is asleep. Move it or click a button to keep editing.`) : null}
      loading={!state}
      right={
        <>
          <SaveState status={mouse.saveStatus} />
          {state && state.profiles.length > 1 && (
            <Select value={String(mouse.editSector)} onValueChange={(v) => void mouse.editProfile(Number(v))}>
              <SelectTrigger className="h-9 w-56 bg-surface">
                <Layers className="size-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {state.profiles.map((p, i) => (
                  <SelectItem key={p.sector} value={String(p.sector)}>
                    {p.name || `Profile ${i + 1}`}
                    {p.sector === state.activeSector && <span className="text-xs text-success">in use</span>}
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

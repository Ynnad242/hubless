import { type ReactNode, useEffect } from 'react'
import { ArrowLeft, Check, Loader2, Moon, Settings, TriangleAlert } from 'lucide-react'
import type { Capability } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SaveStatus } from '@/hooks/useMouse'
import { cn } from '@/lib/utils'

export interface RailItem {
  key: Capability
  label: string
  icon: typeof Settings
}

export function SaveState({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  return (
    <span className={cn('flex items-center gap-1.5 text-xs font-medium', status === 'saved' ? 'text-success' : status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
      {status === 'saving' ? <Loader2 className="size-3.5 animate-spin" /> : status === 'saved' ? <Check className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
      {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved to device' : 'Not saved'}
    </span>
  )
}

function RailButton({ label, icon: Icon, active, onClick }: { label: string; icon: typeof Settings; active: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            'flex size-11 items-center justify-center rounded-lg transition-colors',
            active ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
          )}
        >
          <Icon className="size-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

interface Props {
  name: string
  rail: RailItem[]
  section: Capability
  onSection: (c: Capability) => void
  onBack: () => void
  right?: ReactNode
  asleep?: string | null
  loading?: boolean
  children: ReactNode
}

/** Device page frame: back + name, header actions, icon rail (device settings pinned at the bottom), content. */
export function Shell({ name, rail, section, onSection, onBack, right, asleep, loading, children }: Props) {
  useEffect(() => {
    ;(window as unknown as { __nav: (c: Capability) => void }).__nav = onSection // used by the screenshot tool
  }, [onSection])
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 px-4">
        <Button size="icon" variant="ghost" aria-label="Back to devices" onClick={onBack}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-xl font-bold tracking-tight">{name}</h1>
        <div className="ml-auto flex items-center gap-4">{right}</div>
      </header>
      {asleep && (
        <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/8 px-4 py-2.5 text-sm">
          <Moon className="size-4 text-primary" /> {asleep}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4">
        <nav className="flex w-14 shrink-0 flex-col items-center gap-2 rounded-xl border bg-rail py-3">
          {rail.map((r) => (
            <RailButton key={r.key} label={r.label} icon={r.icon} active={section === r.key} onClick={() => onSection(r.key)} />
          ))}
          <div className="mt-auto">
            <RailButton label="Device settings" icon={Settings} active={section === 'device'} onClick={() => onSection('device')} />
          </div>
        </nav>
        <div className={cn('flex min-w-0 flex-1 gap-4', asleep && 'pointer-events-none opacity-50')}>
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  )
}

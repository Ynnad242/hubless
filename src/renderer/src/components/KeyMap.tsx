import type { ReactNode } from 'react'
import type { KeyDef } from '@shared/wooting'
import { cn } from '@/lib/utils'

interface Props {
  layout: KeyDef[]
  label: (k: KeyDef) => ReactNode
  selected: Set<number>
  onSelect: (id: number, additive: boolean) => void
  /** per-key fill (lighting) */
  color?: (k: KeyDef) => string | undefined
  /** small corner text (e.g. a per-key value) */
  badge?: (k: KeyDef) => string | undefined
  /** keys drawn as "changed from default" */
  marked?: (k: KeyDef) => boolean
  /** live press depth 0..1, drawn as a fill rising from the bottom */
  depth?: (k: KeyDef) => number
  /** key is past its actuation point right now */
  active?: (k: KeyDef) => boolean
}

const U = 52 // px per key unit

/** The physical keyboard, clickable. Ctrl/Shift-click adds keys to the selection. */
export function KeyMap({ layout, label, selected, onSelect, color, badge, marked, depth, active }: Props) {
  const width = Math.max(...layout.map((k) => k.x + k.w))
  const rows = Math.max(...layout.map((k) => k.y)) + 1
  return (
    <div className="w-full overflow-x-auto">
      <div className="relative mx-auto rounded-xl border bg-rail p-2.5" style={{ width: width * U + 20, height: rows * U + 20 }}>
        {layout.map((k) => {
          const sel = selected.has(k.id)
          const fill = color?.(k)
          const b = badge?.(k)
          return (
            <button
              key={k.id}
              type="button"
              onClick={(e) => onSelect(k.id, e.ctrlKey || e.metaKey || e.shiftKey)}
              className={cn(
                'absolute flex flex-col items-center justify-center rounded-md border text-[11px] font-semibold transition-colors',
                sel ? 'z-10 border-primary bg-primary/20 text-white ring-2 ring-primary/50' : 'border-white/[0.06] bg-surface-2 hover:border-foreground/25',
                marked?.(k) && !sel && 'border-primary/40'
              )}
              style={{ left: 10 + k.x * U + 2, top: 10 + k.y * U + 2, width: k.w * U - 4, height: U - 4 }}
            >
              {fill && <span className="absolute inset-x-1.5 bottom-1 h-1 rounded-full" style={{ background: fill }} />}
              {depth && depth(k) > 0.01 && (
                <span
                  className={cn('absolute inset-x-0 bottom-0 rounded-md', active?.(k) ? 'bg-primary/55' : 'bg-primary/25')}
                  style={{ height: `${Math.min(100, depth(k) * 100)}%` }}
                />
              )}
              <span className="relative max-w-full truncate px-1">{label(k)}</span>
              {b && <span className="relative text-[9px] font-bold text-primary tabular-nums">{b}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

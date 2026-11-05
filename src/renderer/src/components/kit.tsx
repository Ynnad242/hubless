// Small building blocks shared by every screen.
import { type ReactNode, useRef } from 'react'
import { cn } from '@/lib/utils'

export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('caption', className)}>{children}</div>
}

/** Underlined text tabs (the panel's section switcher). */
export function PanelTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div role="tablist" className="flex gap-5 border-b">
      {items.map(([k, label]) => (
        <button
          key={k}
          role="tab"
          type="button"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={cn(
            '-mb-px border-b-2 pb-2.5 text-[11px] font-bold tracking-[0.08em] uppercase transition-colors',
            value === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

interface StepperProps {
  min: number
  max: number
  value: number
  onChange: (v: number) => void
  top: string
  bottom: string
  label: string
  disabled?: boolean
}

/** Vertical stepped slider with a tick per level, labelled at both ends. Lowest value at the top. */
export function VerticalStepper({ min, max, value, onChange, top, bottom, label, disabled }: StepperProps) {
  const ref = useRef<HTMLDivElement>(null)
  const steps = max - min
  const pick = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientY - r.top) / r.height))
    const v = min + Math.round(t * steps)
    if (v !== value) onChange(v)
  }
  const pos = ((value - min) / steps) * 100
  return (
    <div className={cn('flex gap-4', disabled && 'pointer-events-none opacity-35')}>
      <div
        ref={ref}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-orientation="vertical"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e.clientY)
        }}
        onPointerMove={(e) => e.buttons === 1 && pick(e.clientY)}
        onKeyDown={(e) => {
          const d = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key]
          if (d) {
            e.preventDefault()
            onChange(Math.max(min, Math.min(max, value + d)))
          }
        }}
        className="relative h-64 w-10 shrink-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-surface-2" />
        <div className="absolute top-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-primary transition-[height] duration-150" style={{ height: `${pos}%` }} />
        {Array.from({ length: steps + 1 }, (_, i) => (
          <div
            key={i}
            className={cn('absolute left-1/2 h-px w-4 translate-x-2', i <= value - min ? 'bg-primary/70' : 'bg-foreground/20')}
            style={{ top: `${(i / steps) * 100}%` }}
          />
        ))}
        <div
          className="absolute left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-white shadow-[0_0_0_4px_rgb(43_140_255/0.18)] transition-[top] duration-150"
          style={{ top: `${pos}%` }}
        />
      </div>
      <div className="flex flex-col justify-between py-0.5 text-xs font-semibold text-muted-foreground">
        <span>{top}</span>
        <span>{bottom}</span>
      </div>
    </div>
  )
}

/** Fixed-width control panel next to the canvas. */
export function SidePanel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-xl border bg-surface">
      <div className="flex h-14 shrink-0 items-center justify-between px-5">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {action}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">{children}</div>
    </aside>
  )
}

/** The area right of the panel where the device is shown. */
export function Canvas({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {(title || action) && (
        <div className="flex h-14 shrink-0 items-center gap-2 px-2">
          {title && <h2 className="text-[15px] font-bold">{title}</h2>}
          {action}
        </div>
      )}
      <div className={cn('flex min-h-0 flex-1 items-center justify-center', className)}>{children}</div>
    </section>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

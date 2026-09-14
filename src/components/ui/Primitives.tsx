import { ChevronRight, Minus, Plus } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { useT } from '@/i18n/react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ Coach mark */
/** The coach's visual identity: no face, just a calm living point of light. */
export function CoachMark({ size = 28, className, active }: { size?: number; className?: string; active?: boolean }) {
  return (
    <span className={cn('relative inline-flex items-center justify-center shrink-0', className)} style={{ width: size, height: size }} aria-hidden>
      <span className={cn('absolute inset-0 rounded-full bg-accent opacity-25 blur-[6px]', active && 'coach-mark')} />
      <span className="absolute inset-[22%] rounded-full bg-accent" />
      <span className="absolute inset-[38%] rounded-full bg-accent-strong opacity-70" />
    </span>
  )
}

/* ------------------------------------------------------------------ Progress */
export function ProgressBar({ value, className, tone = 'accent', height = 6 }: { value: number; className?: string; tone?: 'accent' | 'text' | 'warn'; height?: number }) {
  const reduce = useReducedMotion()
  const pct = Math.max(0, Math.min(100, value * 100))
  return (
    <div className={cn('w-full rounded-full bg-surface-3 overflow-hidden', className)} style={{ height }}>
      <motion.div
        className={cn('h-full rounded-full', tone === 'accent' && 'bg-accent', tone === 'text' && 'bg-text', tone === 'warn' && 'bg-warn')}
        initial={{ width: reduce ? `${pct}%` : 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  )
}

export function Ring({ value, size = 64, stroke = 6, children, tone = 'accent', className }: { value: number; size?: number; stroke?: number; children?: ReactNode; tone?: 'accent' | 'text'; className?: string }) {
  const reduce = useReducedMotion()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, value))
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-3)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tone === 'accent' ? 'var(--accent)' : 'var(--text)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c * (1 - pct) : c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />
}

/* ------------------------------------------------------------------ Rows */
export function ListRow({ label, value, onClick, icon, danger, sub, right, as = 'button' }: { label: ReactNode; value?: ReactNode; onClick?: () => void; icon?: ReactNode; danger?: boolean; sub?: ReactNode; right?: ReactNode; as?: 'button' | 'div' }) {
  const Comp = as === 'button' && onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={cn('flex items-center gap-3 w-full min-h-[52px] px-4 text-left', onClick && 'hover:bg-surface-2/60 active:bg-surface-2 transition-colors', danger && 'text-danger')}
    >
      {icon && <span className={cn('shrink-0 text-text-2', danger && 'text-danger')}>{icon}</span>}
      <span className="flex-1 min-w-0 py-3">
        <span className="block text-[15px] font-medium leading-tight">{label}</span>
        {sub && <span className="block text-[13px] text-text-3 mt-0.5 leading-snug">{sub}</span>}
      </span>
      {value && <span className="text-[14px] text-text-3 truncate max-w-[45%]">{value}</span>}
      {right}
      {onClick && !right && <ChevronRight size={16} className="text-text-4 shrink-0" />}
    </Comp>
  )
}

export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-[20px] bg-surface border border-border overflow-hidden divide-y divide-[var(--hairline)]', className)}>{children}</div>
}

/* ------------------------------------------------------------------ Inputs */
export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn('h-12 w-full rounded-[14px] bg-surface border border-border px-4 text-[16px] placeholder:text-text-4 focus:border-border-strong focus:outline-none', className)}
      {...rest}
    />
  )
}

export function Stepper({ value, onChange, min = 0, max = 999, step = 1, unit, format }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; format?: (v: number) => string }) {
  const tr = useT()
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step))
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-surface-2 p-1">
      <button aria-label={tr.t('common.decrease')} onClick={() => onChange(clamp(value - step))} className="h-9 w-9 rounded-full bg-bg-elev flex items-center justify-center text-text-2 hover:text-text">
        <Minus size={16} />
      </button>
      <span className="min-w-[64px] text-center text-[15px] font-semibold tabular">
        {format ? format(value) : value}
        {unit && <span className="text-text-3 font-medium text-[13px] ml-0.5">{unit}</span>}
      </span>
      <button aria-label={tr.t('common.increase')} onClick={() => onChange(clamp(value + step))} className="h-9 w-9 rounded-full bg-bg-elev flex items-center justify-center text-text-2 hover:text-text">
        <Plus size={16} />
      </button>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-7 w-12 rounded-full transition-colors shrink-0', checked ? 'bg-accent' : 'bg-surface-3')}
    >
      <motion.span layout className={cn('absolute top-0.5 h-6 w-6 rounded-full shadow-sm', checked ? 'bg-accent-ink/90 left-[22px]' : 'bg-bg-elev left-0.5')} transition={{ type: 'spring', stiffness: 600, damping: 40 }} />
    </button>
  )
}

/* ------------------------------------------------------------------ Empty */
export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-6">
      {icon && <div className="mb-4 text-text-3">{icon}</div>}
      <h3 className="title text-[18px] mb-1.5">{title}</h3>
      {body && <p className="text-[14px] text-text-2 max-w-[280px] text-pretty leading-relaxed">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ Stat */
export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="label mb-1">{label}</div>
      <div className="text-[22px] font-semibold tabular title">{value}</div>
      {sub && <div className="text-[12px] text-text-3 mt-0.5">{sub}</div>}
    </div>
  )
}

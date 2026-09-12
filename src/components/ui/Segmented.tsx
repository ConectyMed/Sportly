import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

export interface SegmentedProps<T extends string> {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  className?: string
  size?: 'sm' | 'md'
  id?: string
}

export function Segmented<T extends string>({ value, options, onChange, className, size = 'md', id = 'seg' }: SegmentedProps<T>) {
  return (
    <div className={cn('relative flex bg-surface-2 rounded-full p-1', className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative flex-1 rounded-full font-medium transition-colors',
              size === 'md' ? 'h-9 text-[14px]' : 'h-8 text-[13px]',
              active ? 'text-text' : 'text-text-3 hover:text-text-2',
            )}
          >
            {active && <motion.span layoutId={`${id}-pill`} className="absolute inset-0 rounded-full bg-bg-elev border border-border-strong shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <span className="relative z-10">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

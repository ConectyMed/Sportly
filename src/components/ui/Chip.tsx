import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean
  icon?: ReactNode
  tone?: 'default' | 'accent'
  size?: 'sm' | 'md'
}

export function Chip({ selected, icon, tone = 'default', size = 'md', className, children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap transition-[background-color,border-color,transform] active:scale-[0.97]',
        size === 'md' ? 'h-10 px-4 text-[14px]' : 'h-8 px-3 text-[13px]',
        selected
          ? 'bg-accent text-accent-ink border-transparent'
          : tone === 'accent'
            ? 'bg-accent-soft text-accent-text border-transparent hover:bg-accent-soft-2'
            : 'bg-surface text-text-2 border-border hover:border-border-strong hover:text-text',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

export function Tag({ children, tone = 'default', className }: { children: ReactNode; tone?: 'default' | 'accent' | 'warn' | 'danger' | 'info'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center h-6 px-2 rounded-md text-[11px] font-semibold tracking-wide uppercase whitespace-nowrap shrink-0',
        tone === 'default' && 'bg-surface-2 text-text-2',
        tone === 'accent' && 'bg-accent-soft text-accent-text',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'info' && 'bg-info-soft text-info',
        className,
      )}
    >
      {children}
    </span>
  )
}

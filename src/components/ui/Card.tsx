import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg'
  tone?: 'default' | 'accent' | 'elevated' | 'ghost'
  interactive?: boolean
}

export function Card({ padding = 'md', tone = 'default', interactive, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[22px] border transition-colors',
        tone === 'default' && 'bg-surface border-border',
        tone === 'elevated' && 'bg-surface-2 border-border-strong shadow-md',
        tone === 'accent' && 'bg-accent-soft border-transparent',
        tone === 'ghost' && 'bg-transparent border-border',
        padding === 'sm' && 'p-3.5',
        padding === 'md' && 'p-5',
        padding === 'lg' && 'p-6',
        interactive && 'active:scale-[0.99] hover:border-border-strong cursor-pointer',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function SectionLabel({ children, className, right }: { children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between mb-3', className)}>
      <span className="label">{children}</span>
      {right}
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-hairline', className)} />
}

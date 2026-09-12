import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn, haptic } from '@/lib/utils'
import { useStore } from '@/store/useStore'

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'accent-soft'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  full?: boolean
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-strong active:brightness-95 shadow-[0_8px_24px_-10px_var(--accent-glow)]',
  secondary: 'bg-surface-2 text-text hover:bg-surface-3 active:bg-surface-3',
  ghost: 'bg-transparent text-text-2 hover:bg-surface hover:text-text',
  outline: 'bg-transparent border border-border-strong text-text hover:bg-surface',
  danger: 'bg-danger-soft text-danger hover:brightness-110',
  'accent-soft': 'bg-accent-soft text-accent-text hover:bg-accent-soft-2',
}

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px] rounded-full gap-1.5',
  md: 'h-11 px-5 text-[15px] rounded-full gap-2',
  lg: 'h-[52px] px-6 text-[16px] rounded-full gap-2',
  icon: 'h-11 w-11 rounded-full',
  'icon-sm': 'h-9 w-9 rounded-full',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', full, loading, icon, iconRight, className, children, onClick, disabled, ...rest },
  ref,
) {
  const hapticOn = useStore((s) => s.preferences.hapticFeedback)
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center font-medium select-none transition-[background-color,transform,opacity] duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
        variants[variant],
        sizes[size],
        full && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      onClick={(e) => {
        if (hapticOn) haptic(6)
        onClick?.(e)
      }}
      {...rest}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      {children}
      {iconRight}
    </button>
  )
})

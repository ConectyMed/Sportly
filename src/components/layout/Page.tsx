import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/utils'

export interface PageProps {
  title?: ReactNode
  eyebrow?: ReactNode
  back?: boolean | string
  right?: ReactNode
  children: ReactNode
  className?: string
  /** Large display title vs compact header. */
  large?: boolean
  noPad?: boolean
}

export function Page({ title, eyebrow, back, right, children, className, large, noPad }: PageProps) {
  const navigate = useNavigate()
  return (
    <div className={cn('flex flex-col min-h-full', className)}>
      {(back || right || (title && !large)) && (
        <header className={cn('pt-safe sticky top-0 z-30 blur-bar', large ? 'bg-transparent' : 'border-b border-hairline')} style={{ background: large ? undefined : 'var(--tabbar-bg)' }}>
          <div className={cn('flex items-center gap-2 px-4', large ? 'h-14' : 'h-14')}>
            {back && (
              <button aria-label="Back" onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))} className="h-10 w-10 -ml-2 rounded-full flex items-center justify-center text-text-2 hover:text-text hover:bg-surface">
                <ChevronLeft size={22} />
              </button>
            )}
            {!large && (
              <div className="flex-1 min-w-0">
                {eyebrow && <div className="label leading-none">{eyebrow}</div>}
                <h1 className="title text-[17px] truncate">{title}</h1>
              </div>
            )}
            {large && <div className="flex-1" />}
            {right && <div className="flex items-center gap-1">{right}</div>}
          </div>
        </header>
      )}
      {large && (
        <div className={cn('px-5 pb-2', back || right ? 'pt-1' : 'pt-[calc(env(safe-area-inset-top)+20px)]')}>
          {eyebrow && <div className="label mb-1.5">{eyebrow}</div>}
          <h1 className="display text-[30px]">{title}</h1>
        </div>
      )}
      <div className={cn('flex-1', !noPad && 'px-4 pb-8 pt-2 sm:px-5')}>{children}</div>
    </div>
  )
}

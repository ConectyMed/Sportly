import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useT } from '@/i18n/react'
import { cn } from '@/lib/utils'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Sheet grows to content by default; `tall` gives a near-full-height panel. */
  size?: 'auto' | 'tall'
  hideClose?: boolean
  className?: string
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ open, onClose, title, children, size = 'auto', hideClose, className }: SheetProps) {
  const reduce = useReducedMotion()
  const tr = useT()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
        >
          <div className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[2px]" onClick={onClose} aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'relative w-full sm:max-w-[440px] bg-bg-elev border border-border-strong rounded-t-[28px] sm:rounded-[28px] shadow-lg flex flex-col overflow-hidden',
              size === 'tall' ? 'h-[88dvh] sm:h-[80vh]' : 'max-h-[88dvh] sm:max-h-[80vh]',
              className,
            )}
            initial={reduce ? { opacity: 0 } : { y: '100%', opacity: 1 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: '100%', opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40, mass: 0.8 }}
            drag={reduce ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 800) onClose()
            }}
          >
            <div className="pt-2.5 pb-1 flex justify-center sm:hidden">
              <div className="h-1.5 w-10 rounded-full bg-border-strong" />
            </div>
            {(title || !hideClose) && (
              <div className="flex items-center justify-between px-5 pt-2 pb-2 sm:pt-5">
                <h2 className="title text-[19px]">{title}</h2>
                {!hideClose && (
                  <button aria-label={tr.t('common.close')} onClick={onClose} className="h-9 w-9 rounded-full bg-surface-2 text-text-2 flex items-center justify-center hover:text-text">
                    <X size={18} />
                  </button>
                )}
              </div>
            )}
            <div className="overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))] flex-1 no-scrollbar">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

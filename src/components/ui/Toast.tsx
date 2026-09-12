import { AnimatePresence, motion } from 'motion/react'
import { Check, Info, AlertCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'

export function Toast() {
  const toast = useStore((s) => s.ui.toast)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed left-0 right-0 top-[max(12px,env(safe-area-inset-top))] z-[60] flex justify-center px-4">
      <AnimatePresence>
        {toast && (
          <motion.button
            key={toast.id}
            onClick={dismiss}
            initial={{ y: -16, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -12, opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-surface-2 border border-border-strong shadow-md px-4 h-11 text-[14px] font-medium max-w-[92vw]"
          >
            {toast.kind === 'success' ? <Check size={16} className="text-accent-text" /> : toast.kind === 'error' ? <AlertCircle size={16} className="text-danger" /> : <Info size={16} className="text-text-2" />}
            <span className="truncate">{toast.text}</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

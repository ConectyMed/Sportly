import { Bell, House, TrendingUp, User } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { Suspense, useEffect } from 'react'
import { Skeleton } from '@/components/ui/Primitives'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { runNotificationSweep } from '@/coach/coachService'
import { CoachMark } from '@/components/ui/Primitives'
import { Toast } from '@/components/ui/Toast'
import { useIsDesktop } from '@/lib/hooks'
import { cn, haptic } from '@/lib/utils'
import { useStore } from '@/store/useStore'

const TABS = [
  { to: '/', label: 'Home', icon: House },
  { to: '/coach', label: 'Coach', icon: null },
  { to: '/progress', label: 'Progress', icon: TrendingUp },
  { to: '/profile', label: 'Profile', icon: User },
] as const

function RouteFallback() {
  return (
    <div className="px-5 pt-[calc(env(safe-area-inset-top)+64px)] space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full rounded-[22px]" />
      <Skeleton className="h-24 w-full rounded-[22px]" />
    </div>
  )
}

function isActivePath(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/' || pathname.startsWith('/nutrition') || pathname.startsWith('/calendar') || pathname.startsWith('/notifications')
  if (to === '/progress') return pathname.startsWith('/progress') || pathname.startsWith('/goals')
  if (to === '/profile') return pathname.startsWith('/profile')
  return pathname.startsWith(to)
}

export function AppShell() {
  const desktop = useIsDesktop()
  const location = useLocation()
  const reduce = useReducedMotion()
  const coachName = useStore((s) => s.coach.name)
  const unread = useStore((s) => s.notifications.filter((n) => !n.read).length)
  const navigate = useNavigate()
  const isCoach = location.pathname.startsWith('/coach')
  const routeKey = location.pathname.split('/').slice(1, 3).join('/') || 'home'

  useEffect(() => {
    runNotificationSweep()
    const id = setInterval(runNotificationSweep, 10 * 60_000)
    return () => clearInterval(id)
  }, [])

  const nav = (
    <nav className={cn(desktop ? 'flex flex-col gap-1' : 'flex justify-around items-stretch h-[58px]')} aria-label="Primary">
      {TABS.map((t) => {
        const active = isActivePath(location.pathname, t.to)
        const Icon = t.icon
        return (
          <NavLink
            key={t.to}
            to={t.to}
            onClick={() => haptic(4)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center transition-colors select-none',
              desktop
                ? cn('gap-3 h-11 px-3.5 rounded-[14px] text-[14px] font-medium', active ? 'bg-surface-2 text-text' : 'text-text-2 hover:text-text hover:bg-surface')
                : cn('flex-col justify-center gap-1 flex-1 text-[10.5px] font-medium tracking-wide', active ? 'text-text' : 'text-text-3'),
            )}
          >
            {Icon ? <Icon size={desktop ? 18 : 22} strokeWidth={active ? 2.2 : 1.8} /> : <CoachMark size={desktop ? 20 : 24} active={active} />}
            <span>{t.to === '/coach' ? (desktop ? coachName : 'Coach') : t.label}</span>
            {!desktop && active && <motion.span layoutId="tab-dot" className="absolute -bottom-[1px] h-[3px] w-5 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
          </NavLink>
        )
      })}
    </nav>
  )

  if (desktop) {
    return (
      <div className="min-h-dvh flex justify-center">
        <div className="flex w-full max-w-[1180px] gap-8 px-6 py-6">
          <aside className="w-[220px] shrink-0 sticky top-6 self-start">
            <div className="flex items-center gap-2.5 px-3.5 mb-8">
              <CoachMark size={26} />
              <div>
                <div className="title text-[17px] leading-none">Sportly</div>
                <div className="text-[11px] text-text-3 mt-1 tracking-wide">Your Coach Daily</div>
              </div>
            </div>
            {nav}
            <button onClick={() => navigate('/notifications')} className="mt-4 flex items-center gap-3 h-11 px-3.5 rounded-[14px] text-[14px] font-medium text-text-2 hover:text-text hover:bg-surface w-full">
              <Bell size={18} />
              <span>Notifications</span>
              {unread > 0 && <span className="ml-auto h-5 min-w-5 px-1.5 rounded-full bg-accent text-accent-ink text-[11px] font-bold flex items-center justify-center">{unread}</span>}
            </button>
          </aside>
          <main className={cn('flex-1 min-w-0', isCoach ? 'max-w-[820px]' : 'max-w-[640px]')}>
            <div className="rounded-[32px] border border-border bg-bg-elev min-h-[calc(100dvh-48px)] overflow-hidden relative">
              <motion.div key={routeKey} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }} className="h-full">
                <Suspense fallback={<RouteFallback />}>
                  <Outlet />
                </Suspense>
              </motion.div>
            </div>
          </main>
        </div>
        <Toast />
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <div className={cn('flex-1 min-h-0', !isCoach && 'pb-[calc(58px+env(safe-area-inset-bottom))]')}>
        <motion.div key={routeKey} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="min-h-full">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </motion.div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 z-40 blur-bar border-t border-border" style={{ background: 'var(--tabbar-bg)' }}>
        {nav}
        <div className="pb-safe" />
      </div>
      <Toast />
    </div>
  )
}

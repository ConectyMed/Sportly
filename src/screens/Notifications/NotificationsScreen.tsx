import { Bell, BellOff, Check } from 'lucide-react'
import { useNavigate } from 'react-router'
import { requestPushPermission, runNotificationSweep } from '@/coach/coachService'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { CoachMark, EmptyState } from '@/components/ui/Primitives'
import { useT } from '@/i18n/react'
import { relativeTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useStore } from '@/store/useStore'
import { useEffect } from 'react'

export function NotificationsScreen() {
  const navigate = useNavigate()
  const tr = useT()
  const notifications = useStore((s) => s.notifications)
  const markRead = useStore((s) => s.markNotificationRead)
  const markAll = useStore((s) => s.markAllNotificationsRead)
  const clear = useStore((s) => s.clearNotifications)
  const prefs = useStore((s) => s.preferences.notifications)
  const coachName = useStore((s) => s.coach.name)
  const unread = notifications.filter((n) => !n.read).length
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'

  useEffect(() => {
    runNotificationSweep()
  }, [])

  return (
    <Page
      back="/"
      title={tr.t('common.notifications')}
      right={
        unread > 0 ? (
          <Button size="sm" variant="ghost" onClick={markAll}>
            {tr.t('calendar.notifications.markAllRead')}
          </Button>
        ) : notifications.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={clear}>
            {tr.t('calendar.notifications.clear')}
          </Button>
        ) : undefined
      }
    >
      {!prefs.enabled && (
        <Card padding="sm" className="mt-2 flex items-center gap-3">
          <BellOff size={18} className="text-text-3" />
          <div className="flex-1 text-[13.5px] text-text-2">{tr.t('calendar.notifications.off')}</div>
          <Button size="sm" variant="secondary" onClick={() => navigate('/profile/notifications')}>
            {tr.t('common.settings')}
          </Button>
        </Card>
      )}
      {prefs.enabled && permission === 'default' && (
        <Card padding="sm" className="mt-2 flex items-center gap-3">
          <Bell size={18} className="text-accent-text" />
          <div className="flex-1 text-[13.5px] text-text-2">{tr.t('calendar.notifications.nudges', { name: coachName })}</div>
          <Button size="sm" variant="primary" onClick={() => requestPushPermission().then(() => useStore.getState().toast(tr.t('common.updated'), 'success'))}>
            {tr.t('common.allow')}
          </Button>
        </Card>
      )}
      {notifications.length === 0 ? (
        <Card className="mt-3">
          <EmptyState icon={<CoachMark size={36} />} title={tr.t('calendar.notifications.allQuiet')} body={tr.t('calendar.notifications.allQuietBody', { name: coachName })} />
        </Card>
      ) : (
        <ul className="mt-3 space-y-2">
          {notifications.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => {
                  markRead(n.id)
                  if (n.action) navigate(n.action.to)
                }}
                className={cn('w-full text-left rounded-[20px] border p-4 flex gap-3 transition-colors', n.read ? 'bg-transparent border-border' : 'bg-surface border-border-strong')}
              >
                <CoachMark size={20} className="mt-0.5" active={!n.read} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className={cn('text-[15px] leading-snug', !n.read && 'font-semibold')}>{n.title}</div>
                    <span className="text-[11px] text-text-4 shrink-0">{relativeTime(n.createdAt)}</span>
                  </div>
                  <div className="text-[13.5px] text-text-2 mt-0.5">{n.body}</div>
                  {n.action && <div className="text-[12.5px] text-accent-text mt-1.5 font-medium">{n.action.label} →</div>}
                </div>
                {n.read && <Check size={14} className="text-text-4 mt-1" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

import { Check, ChevronLeft, ChevronRight, MoveRight, Play, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Chip, Tag } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/Primitives'
import { Sheet } from '@/components/ui/Sheet'
import type { CalendarEvent } from '@/domain/types'
import { addDays, dayKey, daysInMonth, formatDate, fromDayKey, monthName, startOfMonth, todayKey, weekdayName, WEEKDAY_SHORT } from '@/lib/dates'
import { cn, formatMinutes } from '@/lib/utils'
import { useStore } from '@/store/useStore'

export function CalendarScreen() {
  const navigate = useNavigate()
  const events = useStore((s) => s.events)
  const workouts = useStore((s) => s.workouts)
  const coachName = useStore((s) => s.coach.name)
  const moveEvent = useStore((s) => s.moveEvent)
  const skipWorkout = useStore((s) => s.skipWorkout)
  const startWorkout = useStore((s) => s.startWorkout)
  const today = todayKey()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<string>(today)
  const [moving, setMoving] = useState<CalendarEvent | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of events) {
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    return map
  }, [events])

  const grid = useMemo(() => {
    const first = startOfMonth(month)
    const lead = (first.getDay() + 6) % 7
    const n = daysInMonth(month)
    const cells: Array<{ key: string; day: number } | null> = []
    for (let i = 0; i < lead; i++) cells.push(null)
    for (let d = 1; d <= n; d++) cells.push({ key: dayKey(new Date(month.getFullYear(), month.getMonth(), d)), day: d })
    while (cells.length % 7) cells.push(null)
    return cells
  }, [month])

  const dayEvents = byDay.get(selected) ?? []
  const monthStats = useMemo(() => {
    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
    const list = events.filter((e) => e.date.startsWith(prefix) && e.type === 'workout')
    return { done: list.filter((e) => e.status === 'completed').length, planned: list.filter((e) => e.status === 'planned').length }
  }, [events, month])

  const ask = (p: string) => navigate(`/coach?prompt=${encodeURIComponent(p)}`)

  return (
    <Page back="/" title="Calendar" eyebrow={`${monthStats.done} done · ${monthStats.planned} planned`}>
      <Card padding="sm" className="mt-2">
        <div className="flex items-center justify-between px-1 mb-3">
          <button aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="h-9 w-9 rounded-full flex items-center justify-center text-text-2 hover:bg-surface-2">
            <ChevronLeft size={18} />
          </button>
          <div className="title text-[16px]">
            {monthName(month)} {month.getFullYear()}
          </div>
          <button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="h-9 w-9 rounded-full flex items-center justify-center text-text-2 hover:bg-surface-2">
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-text-3 mb-1">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <div key={d}>{WEEKDAY_SHORT[d].slice(0, 2)}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {grid.map((c, i) => {
            if (!c) return <div key={i} />
            const evs = byDay.get(c.key) ?? []
            const isSel = c.key === selected
            const isToday = c.key === today
            const status = evs.some((e) => e.status === 'completed') ? 'completed' : evs.some((e) => e.status === 'planned') ? 'planned' : evs.some((e) => e.status === 'skipped') ? 'skipped' : null
            return (
              <button key={c.key} onClick={() => setSelected(c.key)} aria-label={formatDate(fromDayKey(c.key))} aria-pressed={isSel} className="flex flex-col items-center gap-1 py-1">
                <span className={cn('h-9 w-9 rounded-full flex items-center justify-center text-[14px] tabular transition-colors', isSel ? 'bg-text text-bg font-semibold' : isToday ? 'text-accent-text font-semibold' : 'text-text-2 hover:bg-surface-2')}>{c.day}</span>
                <span className={cn('h-1.5 w-1.5 rounded-full', status === 'completed' ? 'bg-accent' : status === 'planned' ? 'bg-text-3' : status === 'skipped' ? 'bg-warn' : 'bg-transparent')} />
              </button>
            )
          })}
        </div>
      </Card>

      <SectionLabel className="mt-5">{selected === today ? 'Today' : formatDate(fromDayKey(selected), { weekday: true })}</SectionLabel>
      {dayEvents.length === 0 ? (
        <Card>
          <EmptyState
            title={selected < today ? 'Nothing logged' : 'Rest day'}
            body={selected < today ? 'No session on this day.' : `Ask ${coachName} to plan something here.`}
            action={selected >= today ? <Chip tone="accent" onClick={() => ask(selected === today ? 'Build today’s workout' : `Plan a workout for ${weekdayName(fromDayKey(selected))}`)}>Plan a workout</Chip> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {dayEvents.map((e) => {
            const w = e.workoutId ? workouts[e.workoutId] : undefined
            return (
              <Card key={e.id} padding="sm">
                <div className="flex items-center gap-3">
                  <span className={cn('h-9 w-9 rounded-full flex items-center justify-center shrink-0', e.status === 'completed' ? 'bg-accent text-accent-ink' : e.status === 'skipped' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-text-2')}>{e.status === 'completed' ? <Check size={16} strokeWidth={3} /> : e.status === 'skipped' ? <X size={16} /> : <Play size={14} fill="currentColor" />}</span>
                  <button onClick={() => w && navigate(`/workout/${w.id}`)} className="flex-1 min-w-0 text-left">
                    <div className="text-[15px] font-semibold truncate">{e.title}</div>
                    <div className="text-[12.5px] text-text-3">
                      {w ? `${formatMinutes(w.estimatedMinutes)} · ${w.exercises.length} exercises` : e.type}
                      {e.movedFrom && ` · moved from ${weekdayName(fromDayKey(e.movedFrom), true)}`}
                    </div>
                  </button>
                  {e.programId && <Tag tone="accent">Program</Tag>}
                </div>
                {e.status === 'planned' && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-hairline">
                    {e.date === today && w && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Play size={13} fill="currentColor" />}
                        onClick={() => {
                          startWorkout(w.id)
                          navigate(`/workout/${w.id}/session`)
                        }}
                      >
                        Start
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" icon={<MoveRight size={14} />} onClick={() => setMoving(e)}>
                      Move
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (w) skipWorkout(w.id)
                      }}
                    >
                      Skip
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <SectionLabel className="mt-6">Plan with {coachName}</SectionLabel>
      <div className="flex flex-wrap gap-2 pb-4">
        <Chip onClick={() => ask('Plan my week')}>Plan my week</Chip>
        <Chip onClick={() => ask('Move Monday to Wednesday')}>Move Monday → Wednesday</Chip>
        <Chip onClick={() => ask('Create me a 12-week program')}>12-week program</Chip>
      </div>

      <Sheet open={Boolean(moving)} onClose={() => setMoving(null)} title={moving ? `Move ${moving.title}` : 'Move'}>
        <div className="space-y-1.5 pb-2">
          {Array.from({ length: 7 }, (_, i) => addDays(fromDayKey(moving?.date ?? today), i - 3))
            .filter((d) => dayKey(d) !== moving?.date && dayKey(d) >= today)
            .map((d) => {
              const key = dayKey(d)
              const clash = (byDay.get(key) ?? []).some((e) => e.status === 'planned')
              return (
                <button
                  key={key}
                  onClick={() => {
                    if (moving) moveEvent(moving.id, key)
                    setSelected(key)
                    setMoving(null)
                    useStore.getState().toast(`Moved to ${weekdayName(d)}`, 'success')
                  }}
                  className="w-full flex items-center justify-between rounded-[14px] bg-surface border border-border px-4 py-3 hover:border-border-strong text-left"
                >
                  <span className="text-[15px] font-medium">{key === today ? 'Today' : formatDate(d, { weekday: true })}</span>
                  {clash && <span className="text-[11px] text-warn">has a session</span>}
                </button>
              )
            })}
        </div>
      </Sheet>
    </Page>
  )
}

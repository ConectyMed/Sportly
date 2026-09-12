import { ArrowRight, Bell, Calendar, ChevronRight, Download, Flame, Play, Sparkles, Utensils, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { generateTodayWorkoutQuick, selectActiveProgram, selectTodayNutrition, selectTodayWorkout } from '@/coach/coachService'
import { consistencyStreak, generateInsights, weeklyStats, weightTrend } from '@/coach/insights'
import { buildVoice } from '@/coach/personality'
import { programWeekFor } from '@/coach/programGenerator'
import { computeReadiness } from '@/coach/readiness'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { CoachMark, ProgressBar, Ring } from '@/components/ui/Primitives'
import { FOCUS_LABELS } from '@/domain/labels'
import { formatDate, fromDayKey, timeOfDayGreeting, todayKey, weekdayName } from '@/lib/dates'
import { useNow } from '@/lib/hooks'
import { useInstall } from '@/lib/install'
import { cn, formatMinutes } from '@/lib/utils'
import { useStore } from '@/store/useStore'

export function HomeScreen() {
  const navigate = useNavigate()
  const now = useNow()
  const user = useStore((s) => s.user)!
  const coach = useStore((s) => s.coach)
  const goals = useStore((s) => s.goals)
  const workoutsMap = useStore((s) => s.workouts)
  const checkIns = useStore((s) => s.checkIns)
  const measurements = useStore((s) => s.measurements)
  const unread = useStore((s) => s.notifications.filter((n) => !n.read).length)
  const setCheckIn = useStore((s) => s.setCheckIn)
  const addMeasurement = useStore((s) => s.addMeasurement)
  const startWorkout = useStore((s) => s.startWorkout)
  const todayWorkout = useStore((s) => selectTodayWorkout(s))
  const nutrition = useStore((s) => selectTodayNutrition(s))
  const program = useStore((s) => selectActiveProgram(s))
  const [checkStep, setCheckStep] = useState<'sleep' | 'energy' | 'done'>('sleep')

  const today = todayKey()
  const checkIn = checkIns[today]
  const workouts = useMemo(() => Object.values(workoutsMap), [workoutsMap])
  const readiness = useMemo(() => computeReadiness(checkIn, workouts, today, user.sleepHoursTypical), [checkIn, workouts, today, user.sleepHoursTypical])
  const streak = useMemo(() => consistencyStreak(workouts, user.availability.daysPerWeek), [workouts, user.availability.daysPerWeek])
  const week = useMemo(() => weeklyStats(workouts, 1)[0], [workouts])
  const insights = useMemo(() => generateInsights({ workouts, measurements, checkIns, goals, targetPerWeek: user.availability.daysPerWeek }), [workouts, measurements, checkIns, goals, user.availability.daysPerWeek])
  const trend = useMemo(() => weightTrend(measurements), [measurements])
  const voice = useMemo(() => buildVoice(coach.personality), [coach.personality])

  const nextPlanned = useMemo(() => {
    return workouts
      .filter((w) => w.status === 'planned' && w.scheduledFor > today)
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0]
  }, [workouts, today])

  const focus = useMemo(() => {
    const r = readiness
    if (todayWorkout?.status === 'completed') return voice.compose({ core: 'Session done. The best thing you can do now is eat well and sleep.', calm: 'Let it land.', push: 'Recover like it matters.' })
    if (!r.hasCheckIn) return voice.compose({ core: 'Tell me how you slept and I will shape today around it.', soft: 'When you have a second,' })
    if (r.recommendation === 'push') return voice.compose({ core: 'You’re recovering well today. We can push a little harder.', push: 'Use it.', calm: 'Enjoy the good day.' })
    if (r.recommendation === 'lighter') return voice.compose({ core: 'Readiness is a little low. Today is about showing up, not setting records.', calm: 'Gentle is still progress.' })
    if (r.recommendation === 'rest') return voice.compose({ core: 'Your body is asking for recovery. A walk and an early night beat a hard session today.', calm: 'Recovery is training.' })
    const top = insights[0]
    return top ? `${top.text}${top.detail ? ` ${top.detail}` : ''}` : voice.compose({ core: 'Solid readiness. A normal, well-executed session is exactly right.', push: 'Go earn it.' })
  }, [readiness, todayWorkout, voice, insights])

  const greeting = timeOfDayGreeting(now)
  const firstName = user.name.split(' ')[0]
  const hasHistory = workouts.some((w) => w.status === 'completed')
  const isRestDay = !todayWorkout && hasHistory && !user.availability.preferredDays.includes(now.getDay())

  return (
    <div className="pt-safe">
      <div className="px-5 pt-3 pb-1 flex items-start justify-between">
        <div>
          <div className="label mb-1">{greeting}</div>
          <h1 className="display text-[32px]">{firstName}</h1>
          <div className="text-[13.5px] text-text-3 mt-1">{formatDate(now, { weekday: true })}</div>
        </div>
        <button aria-label="Notifications" onClick={() => navigate('/notifications')} className="relative h-11 w-11 rounded-full bg-surface border border-border flex items-center justify-center text-text-2 hover:text-text">
          <Bell size={19} />
          {unread > 0 && <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-accent text-accent-ink text-[11px] font-bold flex items-center justify-center">{unread}</span>}
        </button>
      </div>

      <div className="px-4 sm:px-5 pb-6 space-y-5 mt-4">
        {/* TODAY */}
        <section>
          <SectionLabel right={program ? <button onClick={() => navigate(`/program/${program.id}`)} className="text-[12px] text-text-3 hover:text-text">Week {Math.max(1, Math.min(program.weeks, programWeekFor(program, now)))} of {program.weeks}</button> : undefined}>Today</SectionLabel>
          {todayWorkout ? (
            <Card padding="lg" tone={todayWorkout.status === 'completed' ? 'default' : 'elevated'}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[12.5px] text-text-3 mb-1">{todayWorkout.status === 'completed' ? 'Completed' : todayWorkout.status === 'in_progress' ? 'In progress' : FOCUS_LABELS[todayWorkout.focus]}</div>
                  <h2 className="display text-[28px] truncate">{todayWorkout.title}</h2>
                  <div className="text-[14px] text-text-2 mt-1">
                    {todayWorkout.status === 'completed' && todayWorkout.summary
                      ? `${formatMinutes(Math.round(todayWorkout.summary.durationSec / 60))} · ${todayWorkout.summary.setsCompleted} sets · ${Math.round(todayWorkout.summary.totalVolumeKg).toLocaleString()} kg`
                      : `${formatMinutes(todayWorkout.estimatedMinutes)} · ${todayWorkout.exercises.length} exercises`}
                  </div>
                </div>
                {todayWorkout.status === 'completed' && (
                  <Ring value={1} size={44} stroke={4}>
                    <span className="text-accent-text text-[12px]">✓</span>
                  </Ring>
                )}
              </div>
              {todayWorkout.status !== 'completed' && (
                <ul className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-text-2">
                  {todayWorkout.exercises.slice(0, 5).map((e) => (
                    <li key={e.id} className="truncate max-w-full">
                      {e.name}
                    </li>
                  ))}
                  {todayWorkout.exercises.length > 5 && <li className="text-text-4">+{todayWorkout.exercises.length - 5}</li>}
                </ul>
              )}
              <div className="flex gap-2 mt-5">
                {todayWorkout.status === 'completed' ? (
                  <>
                    <Button variant="secondary" full onClick={() => navigate(`/workout/${todayWorkout.id}`)} iconRight={<ArrowRight size={16} />}>
                      Summary
                    </Button>
                    <Button variant="secondary" onClick={() => navigate('/coach?prompt=' + encodeURIComponent('What should I eat now?'))}>
                      Refuel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="primary"
                      size="lg"
                      full
                      icon={<Play size={16} fill="currentColor" />}
                      onClick={() => {
                        startWorkout(todayWorkout.id)
                        navigate(`/workout/${todayWorkout.id}/session`)
                      }}
                    >
                      {todayWorkout.status === 'in_progress' ? 'Continue workout' : 'Start workout'}
                    </Button>
                    <Button variant="secondary" size="lg" onClick={() => navigate(`/workout/${todayWorkout.id}`)}>
                      Preview
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ) : (
            <Card padding="lg" tone="elevated">
              <div className="text-[12.5px] text-text-3 mb-1">{isRestDay ? 'Rest day' : 'Nothing planned yet'}</div>
              <h2 className="display text-[28px]">{isRestDay ? 'Recover' : 'Let’s build today'}</h2>
              <p className="text-[14px] text-text-2 mt-1.5 text-pretty">
                {isRestDay
                  ? nextPlanned
                    ? `Next session: ${nextPlanned.title} on ${weekdayName(fromDayKey(nextPlanned.scheduledFor))}. A walk and good food today.`
                    : 'A walk, good food and sleep. Or ask me for something light.'
                  : `I’ll build a session around your goal, your recovery and what you did last.`}
              </p>
              <div className="flex gap-2 mt-5">
                <Button
                  variant={isRestDay ? 'secondary' : 'primary'}
                  size="lg"
                  full
                  icon={<Sparkles size={16} />}
                  onClick={() => {
                    const w = generateTodayWorkoutQuick()
                    navigate(`/workout/${w.id}`)
                  }}
                >
                  {isRestDay ? 'Train anyway' : 'Build today’s workout'}
                </Button>
                <Button variant="secondary" size="lg" onClick={() => navigate('/coach')}>
                  Ask {coach.name}
                </Button>
              </div>
            </Card>
          )}
        </section>

        {/* READINESS */}
        <section>
          <SectionLabel>Readiness</SectionLabel>
          <Card>
            <div className="flex items-center gap-5">
              <Ring value={readiness.score / 100} size={84} stroke={7}>
                <div className="text-center">
                  <div className="text-[22px] font-semibold tabular title leading-none">{readiness.score}%</div>
                </div>
              </Ring>
              <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-3">
                <div>
                  <div className="text-[11.5px] text-text-3">Energy</div>
                  <div className="text-[16px] font-semibold tabular">{readiness.hasCheckIn ? `${readiness.energy}/10` : '—'}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-text-3">Recovery</div>
                  <div className="text-[16px] font-semibold">{readiness.hasCheckIn ? readiness.recovery : '—'}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-text-3">Sleep</div>
                  <div className="text-[16px] font-semibold tabular">{readiness.sleepHours !== undefined ? `${readiness.sleepHours} h` : '—'}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-text-3">Last 48h</div>
                  <div className="text-[16px] font-semibold tabular">{readiness.recentSessions} {readiness.recentSessions === 1 ? 'session' : 'sessions'}</div>
                </div>
              </div>
            </div>
            {!readiness.hasCheckIn && checkStep !== 'done' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 pt-4 border-t border-hairline">
                <div className="text-[13.5px] font-medium mb-2">{checkStep === 'sleep' ? 'How did you sleep?' : 'And your energy right now?'}</div>
                <div className="flex flex-wrap gap-2">
                  {checkStep === 'sleep'
                    ? [5, 6, 7, 8, 9].map((h) => (
                        <Chip
                          key={h}
                          size="sm"
                          onClick={() => {
                            setCheckIn(today, { sleepHours: h, sleepQuality: (h <= 5 ? 1 : h <= 6 ? 2 : h <= 7 ? 3 : 4) as 1 | 2 | 3 | 4 })
                            addMeasurement({ type: 'sleep_hours', value: h, unit: 'h', date: today, source: 'user' })
                            setCheckStep('energy')
                          }}
                        >
                          {h === 5 ? '≤5 h' : h === 9 ? '9+ h' : `${h} h`}
                        </Chip>
                      ))
                    : [3, 5, 7, 9].map((e) => (
                        <Chip
                          key={e}
                          size="sm"
                          onClick={() => {
                            setCheckIn(today, { energy: e, fatigue: 11 - e })
                            setCheckStep('done')
                          }}
                        >
                          {e === 3 ? 'Low' : e === 5 ? 'Okay' : e === 7 ? 'Good' : 'Great'}
                        </Chip>
                      ))}
                </div>
              </motion.div>
            )}
            {readiness.factors.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {readiness.factors.map((f) => (
                  <span key={f} className="text-[11.5px] px-2 py-1 rounded-md bg-surface-2 text-text-2">
                    {f}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </section>

        {/* FOCUS */}
        <section>
          <SectionLabel>Today’s focus</SectionLabel>
          <button onClick={() => navigate('/coach')} className="w-full text-left rounded-[22px] border border-border bg-surface p-5 flex gap-3.5 hover:border-border-strong active:scale-[0.995]">
            <CoachMark size={24} className="mt-0.5" active />
            <div className="flex-1">
              <p className="text-[15.5px] leading-relaxed text-pretty">{focus}</p>
              <div className="text-[12px] text-text-3 mt-2 flex items-center gap-1">
                Talk to {coach.name} <ChevronRight size={12} />
              </div>
            </div>
          </button>
        </section>

        {/* SECONDARY */}
        <section className="grid grid-cols-2 gap-3">
          <button onClick={() => navigate('/progress')} className="rounded-[22px] border border-border bg-surface p-4 text-left hover:border-border-strong">
            <div className="flex items-center gap-1.5 text-[11.5px] text-text-3 mb-2">
              <Flame size={13} className={cn(streak.current > 0 && 'text-accent-text')} /> Consistency
            </div>
            <div className="text-[22px] font-semibold tabular title">
              {streak.current} <span className="text-[13px] text-text-3 font-medium">{streak.current === 1 ? 'week' : 'weeks'}</span>
            </div>
            <div className="text-[12px] text-text-3 mt-1">
              {week.sessions} of {user.availability.daysPerWeek} this week
            </div>
            <ProgressBar value={week.sessions / Math.max(1, user.availability.daysPerWeek)} className="mt-2" height={4} />
          </button>
          <button onClick={() => navigate('/progress')} className="rounded-[22px] border border-border bg-surface p-4 text-left hover:border-border-strong">
            <div className="text-[11.5px] text-text-3 mb-2">Weight</div>
            <div className="text-[22px] font-semibold tabular title">
              {trend.current ?? user.weightKg} <span className="text-[13px] text-text-3 font-medium">kg</span>
            </div>
            <div className="text-[12px] text-text-3 mt-1">{trend.change30 !== undefined ? `${trend.change30 > 0 ? '+' : ''}${trend.change30} kg · 30 days` : 'Log to see the trend'}</div>
          </button>
        </section>

        {/* NUTRITION + CALENDAR */}
        <section className="space-y-2.5">
          <button onClick={() => navigate('/nutrition')} className="w-full rounded-[22px] border border-border bg-surface p-4 flex items-center gap-3.5 text-left hover:border-border-strong">
            <span className="h-10 w-10 rounded-full bg-surface-2 flex items-center justify-center text-text-2">
              <Utensils size={18} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold">Nutrition</div>
              <div className="text-[12.5px] text-text-3 truncate">{nutrition ? `${nutrition.calories.toLocaleString()} kcal · ${nutrition.proteinG} g protein · ${nutrition.meals.length} meals` : 'Today’s targets and meals'}</div>
            </div>
            <ChevronRight size={16} className="text-text-4" />
          </button>
          <button onClick={() => navigate('/calendar')} className="w-full rounded-[22px] border border-border bg-surface p-4 flex items-center gap-3.5 text-left hover:border-border-strong">
            <span className="h-10 w-10 rounded-full bg-surface-2 flex items-center justify-center text-text-2">
              <Calendar size={18} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold">This week</div>
              <div className="text-[12.5px] text-text-3 truncate">{nextPlanned ? `Next: ${nextPlanned.title} · ${weekdayName(fromDayKey(nextPlanned.scheduledFor))}` : 'Plan your week with your coach'}</div>
            </div>
            <ChevronRight size={16} className="text-text-4" />
          </button>
        </section>

        <InstallHint />
        <div className="text-center text-[11px] text-text-4 pt-2">Sportly · Your Coach Daily</div>
      </div>
    </div>
  )
}

function InstallHint() {
  const { canPrompt, standalone, ios, prompt } = useInstall()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('sportly.installHint') === '1'
    } catch {
      return false
    }
  })
  if (standalone || dismissed || (!canPrompt && !ios)) return null
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem('sportly.installHint', '1')
    } catch {
      /* noop */
    }
  }
  return (
    <div className="rounded-[20px] border border-border bg-surface p-4 flex items-center gap-3">
      <span className="h-10 w-10 rounded-full bg-accent-soft text-accent-text flex items-center justify-center shrink-0">
        <Download size={18} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[14.5px] font-semibold">Add Sportly to your home screen</div>
        <div className="text-[12.5px] text-text-3">{canPrompt ? 'Full-screen, offline-ready, one tap away.' : 'Tap Share, then “Add to Home Screen”.'}</div>
      </div>
      {canPrompt ? (
        <Button size="sm" variant="primary" onClick={() => prompt().then((ok) => ok && dismiss())}>
          Install
        </Button>
      ) : (
        <button aria-label="Dismiss" onClick={dismiss} className="h-8 w-8 rounded-full flex items-center justify-center text-text-3 hover:text-text">
          <X size={16} />
        </button>
      )}
    </div>
  )
}

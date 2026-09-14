import { ArrowRight, Calendar, Check, FileText, Image as ImageIcon, Mic, Play, Sparkles, Target } from 'lucide-react'
import { useNavigate } from 'react-router'
import { exerciseName, focusLabel, mealSlotLabel, mealTemplateName, phaseLabel, programDisplayName, workoutTitle } from '@/domain/labels'
import type { CoachCard, Workout } from '@/domain/types'
import { t, tn } from '@/i18n'
import { useT } from '@/i18n/react'
import { formatShortDate, fromDayKey, weekdayName } from '@/lib/dates'
import { cn, formatMinutes } from '@/lib/utils'
import { useStore } from '@/store/useStore'
import { Button } from '@/components/ui/Button'
import { Tag } from '@/components/ui/Chip'
import { FoodCardView } from './FoodCard'

interface CardProps {
  card: CoachCard
  onSend?: (text: string) => void
}

const frame = 'rounded-[20px] border border-border bg-surface overflow-hidden'

export function CoachCardView({ card, onSend }: CardProps) {
  switch (card.type) {
    case 'workout':
      return <WorkoutCardView card={card} onSend={onSend} />
    case 'program':
      return <ProgramCardView card={card} />
    case 'nutrition':
      return <NutritionCardView card={card} />
    case 'progress':
      return <ProgressCardView card={card} />
    case 'goal':
      return <GoalCardView card={card} />
    case 'calendar':
      return <CalendarCardView card={card} />
    case 'memory':
      return <MemoryCardView card={card} />
    case 'attachment':
      return <AttachmentCardView card={card} />
    case 'food':
      return <FoodCardView card={card} onSend={onSend} />
    default:
      return null
  }
}

function WorkoutCardView({ card, onSend }: CardProps) {
  const navigate = useNavigate()
  const tr = useT()
  const workout = useStore((s) => (card.refId ? s.workouts[card.refId] : undefined))
  const startWorkout = useStore((s) => s.startWorkout)
  if (!workout) return <div className={cn(frame, 'p-4 text-[13px] text-text-3')}>{tr.t('coachScreen.workoutGone')}</div>
  const done = workout.status === 'completed'
  return (
    <div className={frame}>
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="label">{done ? tr.t('common.completed') : workout.scheduledFor === new Date().toISOString().slice(0, 10) ? tr.t('coachScreen.todaysWorkout') : tr.t('coachScreen.weekdayWorkout', { day: weekdayName(fromDayKey(workout.scheduledFor)) })}</span>
          {workout.constraints?.intensity === 'light' && <Tag tone="info">{tr.t('common.lightTag')}</Tag>}
          {workout.constraints?.intensity === 'hard' && <Tag tone="accent">{tr.t('common.pushTag')}</Tag>}
        </div>
        <div className="title text-[20px]">{workoutTitle(workout)}</div>
        <div className="text-[13px] text-text-2 mt-0.5">{tr.t('coachScreen.workoutMeta', { minutes: formatMinutes(workout.estimatedMinutes), focus: focusLabel(workout.focus), exercises: tr.tn('common.exercises', workout.exercises.length) })}</div>
        <ol className="mt-3 space-y-1.5">
          {workout.exercises.slice(0, 6).map((e, i) => (
            <li key={e.id} className="flex items-center gap-2.5 text-[14px]">
              <span className="w-5 text-[12px] text-text-4 tabular text-right">{i + 1}</span>
              <span className="flex-1 truncate">{exerciseName(e.exerciseId, e.name)}</span>
              <span className="text-[12px] text-text-3 tabular">
                {e.sets.length}×{e.sets[0]?.targetSeconds ? `${e.sets[0].targetSeconds}s` : e.sets[0]?.targetReps}
                {e.sets[0]?.targetWeightKg ? ` · ${tr.num(e.sets[0].targetWeightKg)} kg` : ''}
              </span>
            </li>
          ))}
          {workout.exercises.length > 6 && <li className="text-[12px] text-text-4 pl-7">{tr.t('coachScreen.more', { n: workout.exercises.length - 6 })}</li>}
        </ol>
      </div>
      <div className="flex gap-2 p-3 pt-0">
        {done ? (
          <Button size="sm" variant="secondary" full onClick={() => navigate(`/workout/${workout.id}`)} iconRight={<ArrowRight size={14} />}>
            {tr.t('coachScreen.viewSummary')}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              full
              icon={<Play size={14} fill="currentColor" />}
              onClick={() => {
                startWorkout(workout.id)
                navigate(`/workout/${workout.id}/session`)
              }}
            >
              {workout.status === 'in_progress' ? tr.t('common.continue') : tr.t('coachScreen.startWorkout')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => (onSend ? onSend(tr.t('coachScreen.prompt.changeToday')) : navigate(`/workout/${workout.id}`))}>
              {tr.t('common.change')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function ProgramCardView({ card }: CardProps) {
  const navigate = useNavigate()
  const tr = useT()
  const program = useStore((s) => (card.refId ? s.programs[card.refId] : undefined))
  if (!program) return null
  const phases = [...new Set(program.weeksPlan.map((w) => w.phase))]
  return (
    <div className={frame}>
      <div className="p-4">
        <span className="label">{tr.t('common.program')}</span>
        <div className="title text-[20px] mt-1">{programDisplayName(program)}</div>
        <div className="text-[13px] text-text-2 mt-0.5">{tr.t('coachScreen.programMeta', { weeks: tr.tn('common.weeks', program.weeks), days: tr.t('common.daysPerWeekShort', { count: program.daysPerWeek }), date: formatShortDate(fromDayKey(program.startDate)) })}</div>
        <div className="flex gap-1 mt-3">
          {program.weeksPlan.map((w) => (
            <div key={w.week} className={cn('h-1.5 flex-1 rounded-full', w.phase === 'deload' ? 'bg-info' : w.phase === 'peak' ? 'bg-accent' : 'bg-accent-soft-2')} title={tr.t('coachScreen.weekPhase', { week: tr.t('common.week', { n: w.week }), phase: phaseLabel(w.phase) })} />
          ))}
        </div>
        <div className="text-[12px] text-text-3 mt-2 capitalize">{phases.map((p) => phaseLabel(p)).join(' · ')}</div>
      </div>
      <div className="p-3 pt-0">
        <Button size="sm" variant="secondary" full onClick={() => navigate(`/program/${program.id}`)} iconRight={<ArrowRight size={14} />}>
          {tr.t('coachScreen.viewProgram')}
        </Button>
      </div>
    </div>
  )
}

function NutritionCardView({ card }: CardProps) {
  const navigate = useNavigate()
  const tr = useT()
  const plan = useStore((s) => (card.refId ? s.nutritionPlans[card.refId] : undefined))
  if (!plan) return null
  return (
    <div className={frame}>
      <div className="p-4">
        <span className="label">{card.title ?? tr.t('coachScreen.nutrition')}</span>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="title text-[24px] tabular">{tr.int(plan.calories)}</span>
          <span className="text-[13px] text-text-2">{tr.t('common.kcal')}</span>
        </div>
        <div className="flex gap-4 mt-2 text-[13px] tabular">
          <Macro label={tr.t('common.protein')} value={plan.proteinG} />
          <Macro label={tr.t('common.carbs')} value={plan.carbsG} />
          <Macro label={tr.t('common.fat')} value={plan.fatG} />
        </div>
        <ul className="mt-3 space-y-1.5">
          {plan.meals.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-[14px]">
              <span className="text-[11px] uppercase tracking-wide text-text-4 w-[74px] shrink-0">{mealSlotLabel(m.slot)}</span>
              <span className="flex-1 truncate">{mealTemplateName(m.templateId, m.name)}</span>
              <span className="text-[12px] text-text-3 tabular">{m.calories}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="p-3 pt-0">
        <Button size="sm" variant="secondary" full onClick={() => navigate('/nutrition')} iconRight={<ArrowRight size={14} />}>
          {tr.t('coachScreen.fullPlan')}
        </Button>
      </div>
    </div>
  )
}

function Macro({ label, value }: { label: string; value: number }) {
  const tr = useT()
  return (
    <span>
      <span className="font-semibold">
        {value} {tr.t('common.g')}
      </span>{' '}
      <span className="text-text-3">{label}</span>
    </span>
  )
}

function ProgressCardView({ card }: CardProps) {
  const navigate = useNavigate()
  const tr = useT()
  const d = (card.data ?? {}) as { sessions?: number; streak?: number; weight?: number; change30?: number; insights?: string[] }
  return (
    <div className={frame}>
      <div className="p-4">
        <span className="label">{card.title ?? tr.t('coachScreen.progress')}</span>
        <div className="grid grid-cols-3 gap-3 mt-2">
          <Mini label={tr.t('coachScreen.sessions')} value={String(d.sessions ?? 0)} sub={tr.tn('common.weeks', 4)} />
          <Mini label={tr.t('coachScreen.streak')} value={tr.t('coachScreen.weeksShort', { n: d.streak ?? 0 })} />
          <Mini label={tr.t('coachScreen.weight')} value={d.weight ? tr.num(d.weight) : '—'} sub={d.change30 !== undefined ? `${tr.signed(d.change30)} ${tr.t('common.kg')}` : undefined} />
        </div>
        {d.insights?.length ? (
          <ul className="mt-3 space-y-1.5">
            {d.insights.map((i) => (
              <li key={i} className="flex gap-2 text-[13px] text-text-2">
                <Sparkles size={14} className="text-accent-text mt-0.5 shrink-0" />
                {i}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="p-3 pt-0">
        <Button size="sm" variant="secondary" full onClick={() => navigate('/progress')} iconRight={<ArrowRight size={14} />}>
          {tr.t('coachScreen.openProgress')}
        </Button>
      </div>
    </div>
  )
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] text-text-3">{label}</div>
      <div className="text-[18px] font-semibold tabular title">{value}</div>
      {sub && <div className="text-[11px] text-text-3">{sub}</div>}
    </div>
  )
}

function GoalCardView({ card }: CardProps) {
  const navigate = useNavigate()
  const tr = useT()
  return (
    <div className={cn(frame, 'p-4 flex items-center gap-3')}>
      <span className="h-10 w-10 rounded-full bg-accent-soft text-accent-text flex items-center justify-center shrink-0">
        <Target size={18} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold truncate">{card.title}</div>
        <div className="text-[13px] text-text-3">{card.subtitle}</div>
      </div>
      <Button size="sm" variant="secondary" onClick={() => navigate('/goals')}>
        {tr.t('common.edit')}
      </Button>
    </div>
  )
}

function CalendarCardView({ card }: CardProps) {
  const navigate = useNavigate()
  const tr = useT()
  const d = (card.data ?? {}) as { days?: Array<{ date: string; title: string }>; from?: string; to?: string }
  return (
    <div className={frame}>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Calendar size={14} className="text-text-3" />
          <span className="label">{card.title}</span>
        </div>
        {d.days ? (
          <ul className="space-y-1.5">
            {d.days.map((x) => (
              <li key={x.date} className="flex items-center gap-3 text-[14px]">
                <span className="w-9 text-[12px] text-text-3">{weekdayName(fromDayKey(x.date), true)}</span>
                <span className="flex-1 truncate">{x.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[15px] font-medium">{card.subtitle}</div>
        )}
      </div>
      <div className="p-3 pt-0">
        <Button size="sm" variant="secondary" full onClick={() => navigate('/calendar')} iconRight={<ArrowRight size={14} />}>
          {tr.t('coachScreen.openCalendar')}
        </Button>
      </div>
    </div>
  )
}

function MemoryCardView({ card }: CardProps) {
  const navigate = useNavigate()
  return (
    <button onClick={() => navigate('/profile/memory')} className={cn(frame, 'p-3.5 flex items-center gap-3 w-full text-left hover:border-border-strong')}>
      <span className="h-8 w-8 rounded-full bg-accent-soft text-accent-text flex items-center justify-center shrink-0">
        <Check size={15} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-text-3">{card.title}</div>
        <div className="text-[14px] font-medium truncate">{card.subtitle}</div>
      </div>
      <ArrowRight size={14} className="text-text-4" />
    </button>
  )
}

function AttachmentCardView({ card }: CardProps) {
  const tr = useT()
  const kind = card.subtitle
  const Icon = kind === 'image' ? ImageIcon : kind === 'audio' ? Mic : FileText
  return (
    <div className={cn(frame, 'p-3 flex items-center gap-3')}>
      <span className="h-9 w-9 rounded-[10px] bg-surface-2 text-text-2 flex items-center justify-center shrink-0">
        <Icon size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium truncate">{card.title}</div>
        <div className="text-[12px] text-text-3 capitalize">{tr.t('coachScreen.savedToHistory')}</div>
      </div>
    </div>
  )
}

export function workoutSubtitle(w: Workout): string {
  return t('common.minutesExercises', { minutes: formatMinutes(w.estimatedMinutes), exercises: tn('common.exercises', w.exercises.length) })
}

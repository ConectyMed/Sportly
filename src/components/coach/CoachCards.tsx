import { ArrowRight, Calendar, Check, FileText, Image as ImageIcon, Mic, Play, Sparkles, Target } from 'lucide-react'
import { useNavigate } from 'react-router'
import { FOCUS_LABELS } from '@/domain/labels'
import type { CoachCard, Workout } from '@/domain/types'
import { formatShortDate, fromDayKey, weekdayName } from '@/lib/dates'
import { cn, formatMinutes } from '@/lib/utils'
import { useStore } from '@/store/useStore'
import { Button } from '@/components/ui/Button'
import { Tag } from '@/components/ui/Chip'
import { MEAL_SLOT_LABELS } from '@/domain/labels'

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
    default:
      return null
  }
}

function WorkoutCardView({ card, onSend }: CardProps) {
  const navigate = useNavigate()
  const workout = useStore((s) => (card.refId ? s.workouts[card.refId] : undefined))
  const startWorkout = useStore((s) => s.startWorkout)
  if (!workout) return <div className={cn(frame, 'p-4 text-[13px] text-text-3')}>This workout is no longer available.</div>
  const done = workout.status === 'completed'
  return (
    <div className={frame}>
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="label">{done ? 'Completed' : workout.scheduledFor === new Date().toISOString().slice(0, 10) ? 'Today’s workout' : `${weekdayName(fromDayKey(workout.scheduledFor))}’s workout`}</span>
          {workout.constraints?.intensity === 'light' && <Tag tone="info">Light</Tag>}
          {workout.constraints?.intensity === 'hard' && <Tag tone="accent">Push</Tag>}
        </div>
        <div className="title text-[20px]">{workout.title}</div>
        <div className="text-[13px] text-text-2 mt-0.5">
          {formatMinutes(workout.estimatedMinutes)} · {FOCUS_LABELS[workout.focus]} · {workout.exercises.length} exercises
        </div>
        <ol className="mt-3 space-y-1.5">
          {workout.exercises.slice(0, 6).map((e, i) => (
            <li key={e.id} className="flex items-center gap-2.5 text-[14px]">
              <span className="w-5 text-[12px] text-text-4 tabular text-right">{i + 1}</span>
              <span className="flex-1 truncate">{e.name}</span>
              <span className="text-[12px] text-text-3 tabular">
                {e.sets.length}×{e.sets[0]?.targetSeconds ? `${e.sets[0].targetSeconds}s` : e.sets[0]?.targetReps}
                {e.sets[0]?.targetWeightKg ? ` · ${e.sets[0].targetWeightKg} kg` : ''}
              </span>
            </li>
          ))}
          {workout.exercises.length > 6 && <li className="text-[12px] text-text-4 pl-7">+{workout.exercises.length - 6} more</li>}
        </ol>
      </div>
      <div className="flex gap-2 p-3 pt-0">
        {done ? (
          <Button size="sm" variant="secondary" full onClick={() => navigate(`/workout/${workout.id}`)} iconRight={<ArrowRight size={14} />}>
            View summary
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
              {workout.status === 'in_progress' ? 'Continue' : 'Start workout'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => (onSend ? onSend('Change today’s workout') : navigate(`/workout/${workout.id}`))}>
              Change
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function ProgramCardView({ card }: CardProps) {
  const navigate = useNavigate()
  const program = useStore((s) => (card.refId ? s.programs[card.refId] : undefined))
  if (!program) return null
  const phases = [...new Set(program.weeksPlan.map((w) => w.phase))]
  return (
    <div className={frame}>
      <div className="p-4">
        <span className="label">Program</span>
        <div className="title text-[20px] mt-1">{program.name}</div>
        <div className="text-[13px] text-text-2 mt-0.5">
          {program.weeks} weeks · {program.daysPerWeek} days/week · starts {formatShortDate(fromDayKey(program.startDate))}
        </div>
        <div className="flex gap-1 mt-3">
          {program.weeksPlan.map((w) => (
            <div key={w.week} className={cn('h-1.5 flex-1 rounded-full', w.phase === 'deload' ? 'bg-info' : w.phase === 'peak' ? 'bg-accent' : 'bg-accent-soft-2')} title={`Week ${w.week}: ${w.phase}`} />
          ))}
        </div>
        <div className="text-[12px] text-text-3 mt-2 capitalize">{phases.join(' · ')}</div>
      </div>
      <div className="p-3 pt-0">
        <Button size="sm" variant="secondary" full onClick={() => navigate(`/program/${program.id}`)} iconRight={<ArrowRight size={14} />}>
          View program
        </Button>
      </div>
    </div>
  )
}

function NutritionCardView({ card }: CardProps) {
  const navigate = useNavigate()
  const plan = useStore((s) => (card.refId ? s.nutritionPlans[card.refId] : undefined))
  if (!plan) return null
  return (
    <div className={frame}>
      <div className="p-4">
        <span className="label">{card.title ?? 'Nutrition'}</span>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="title text-[24px] tabular">{plan.calories.toLocaleString()}</span>
          <span className="text-[13px] text-text-2">kcal</span>
        </div>
        <div className="flex gap-4 mt-2 text-[13px] tabular">
          <Macro label="Protein" value={plan.proteinG} />
          <Macro label="Carbs" value={plan.carbsG} />
          <Macro label="Fat" value={plan.fatG} />
        </div>
        <ul className="mt-3 space-y-1.5">
          {plan.meals.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-[14px]">
              <span className="text-[11px] uppercase tracking-wide text-text-4 w-[74px] shrink-0">{MEAL_SLOT_LABELS[m.slot]}</span>
              <span className="flex-1 truncate">{m.name}</span>
              <span className="text-[12px] text-text-3 tabular">{m.calories}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="p-3 pt-0">
        <Button size="sm" variant="secondary" full onClick={() => navigate('/nutrition')} iconRight={<ArrowRight size={14} />}>
          Full plan
        </Button>
      </div>
    </div>
  )
}

function Macro({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="font-semibold">{value} g</span> <span className="text-text-3">{label}</span>
    </span>
  )
}

function ProgressCardView({ card }: CardProps) {
  const navigate = useNavigate()
  const d = (card.data ?? {}) as { sessions?: number; streak?: number; weight?: number; change30?: number; insights?: string[] }
  return (
    <div className={frame}>
      <div className="p-4">
        <span className="label">{card.title ?? 'Progress'}</span>
        <div className="grid grid-cols-3 gap-3 mt-2">
          <Mini label="Sessions" value={String(d.sessions ?? 0)} sub="4 weeks" />
          <Mini label="Streak" value={`${d.streak ?? 0} wk`} />
          <Mini label="Weight" value={d.weight ? `${d.weight}` : '—'} sub={d.change30 !== undefined ? `${d.change30 > 0 ? '+' : ''}${d.change30} kg` : undefined} />
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
          Open progress
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
        Edit
      </Button>
    </div>
  )
}

function CalendarCardView({ card }: CardProps) {
  const navigate = useNavigate()
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
          Open calendar
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
  const kind = card.subtitle
  const Icon = kind === 'image' ? ImageIcon : kind === 'audio' ? Mic : FileText
  return (
    <div className={cn(frame, 'p-3 flex items-center gap-3')}>
      <span className="h-9 w-9 rounded-[10px] bg-surface-2 text-text-2 flex items-center justify-center shrink-0">
        <Icon size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium truncate">{card.title}</div>
        <div className="text-[12px] text-text-3 capitalize">Saved to your history</div>
      </div>
    </div>
  )
}

export function workoutSubtitle(w: Workout): string {
  return `${formatMinutes(w.estimatedMinutes)} · ${w.exercises.length} exercises`
}

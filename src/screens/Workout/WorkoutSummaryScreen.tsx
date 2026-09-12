import { Trophy } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { consistencyStreak } from '@/coach/insights'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { CoachMark } from '@/components/ui/Primitives'
import type { WorkoutSummary } from '@/domain/types'
import { formatMinutes } from '@/lib/utils'
import { useStore } from '@/store/useStore'

const FEELINGS: Array<{ v: NonNullable<WorkoutSummary['feeling']>; label: string }> = [
  { v: 'great', label: 'Great' },
  { v: 'good', label: 'Good' },
  { v: 'ok', label: 'Okay' },
  { v: 'rough', label: 'Rough' },
]

export function WorkoutSummaryScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const workout = useStore((s) => (id ? s.workouts[id] : undefined))
  const updateWorkout = useStore((s) => s.updateWorkout)
  const addMemory = useStore((s) => s.addMemory)
  const coachName = useStore((s) => s.coach.name)
  const user = useStore((s) => s.user)!
  const workouts = useStore((s) => s.workouts)
  const [note, setNote] = useState('')
  const summary = workout?.summary

  if (!workout || !summary) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-text-2">No summary to show.</p>
          <Button className="mt-4" onClick={() => navigate('/')}>
            Back home
          </Button>
        </div>
      </div>
    )
  }

  const streak = consistencyStreak(Object.values(workouts), user.availability.daysPerWeek)
  const setFeeling = (v: WorkoutSummary['feeling']) => {
    updateWorkout(workout.id, { summary: { ...summary, feeling: v, notes: note || summary.notes } })
    addMemory({ category: 'reaction', text: `${workout.title} felt ${v}${note ? `: ${note}` : ''}`, source: 'inferred' })
  }

  return (
    <div className="min-h-dvh flex flex-col max-w-[560px] mx-auto px-5 pt-safe">
      <div className="flex-1 flex flex-col pt-10">
        <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }} className="self-start">
          <CoachMark size={44} active />
        </motion.div>
        <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="display text-[36px] mt-6">
          Done.
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="text-[15px] text-text-2 mt-1">
          {workout.title} · {summary.setsCompleted === summary.setsPlanned ? 'every set completed' : `${summary.setsCompleted} of ${summary.setsPlanned} sets`}
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="grid grid-cols-3 gap-3 mt-8">
          <Stat label="Time" value={formatMinutes(Math.max(1, Math.round(summary.durationSec / 60)))} />
          {summary.totalVolumeKg > 0 ? <Stat label="Volume" value={`${Math.round(summary.totalVolumeKg).toLocaleString()}`} unit="kg" /> : <Stat label="Exercises" value={`${summary.exercisesCompleted}`} unit={`/ ${workout.exercises.length}`} />}
          <Stat label="Sets" value={`${summary.setsCompleted}`} unit={`/ ${summary.setsPlanned}`} />
        </motion.div>

        {summary.prs.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} className="mt-4 rounded-[20px] bg-accent-soft p-4">
            <div className="flex items-center gap-2 text-accent-text mb-2">
              <Trophy size={16} />
              <span className="label text-accent-text">Personal best</span>
            </div>
            {summary.prs.map((p) => (
              <div key={p.exerciseId} className="flex justify-between text-[15px]">
                <span className="font-medium">{p.name}</span>
                <span className="tabular">
                  {p.weightKg} kg × {p.reps}
                </span>
              </div>
            ))}
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="mt-4 rounded-[20px] border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] text-text-3">Consistency</div>
              <div className="text-[18px] font-semibold title">
                {streak.current} {streak.current === 1 ? 'week' : 'weeks'} · {streak.thisWeek} of {user.availability.daysPerWeek} this week
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="mt-6">
          <div className="text-[14px] font-medium mb-2">How did it feel?</div>
          <div className="flex gap-2 flex-wrap">
            {FEELINGS.map((f) => (
              <Chip key={f.v} selected={summary.feeling === f.v} onClick={() => setFeeling(f.v)}>
                {f.label}
              </Chip>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note && updateWorkout(workout.id, { summary: { ...summary, notes: note } })}
            placeholder={`Anything ${coachName} should know? (optional)`}
            className="mt-3 h-11 w-full rounded-[14px] bg-surface border border-border px-4 text-[15px] placeholder:text-text-4 focus:outline-none focus:border-border-strong"
          />
        </motion.div>
      </div>

      <div className="py-5 pb-[max(20px,env(safe-area-inset-bottom))] space-y-2">
        <Button variant="primary" size="lg" full onClick={() => navigate('/coach', { replace: true })}>
          Hear from {coachName}
        </Button>
        <Button variant="ghost" size="lg" full onClick={() => navigate('/', { replace: true })}>
          Back home
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-[20px] border border-border bg-surface p-4">
      <div className="text-[11.5px] text-text-3">{label}</div>
      <div className="text-[22px] font-semibold tabular title mt-1">
        {value}
        {unit && <span className="text-[12px] text-text-3 font-medium ml-1">{unit}</span>}
      </div>
    </div>
  )
}

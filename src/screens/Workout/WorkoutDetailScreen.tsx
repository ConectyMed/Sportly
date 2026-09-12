import { Play, Sparkles, Trophy } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Chip, Tag } from '@/components/ui/Chip'
import { CoachMark, EmptyState } from '@/components/ui/Primitives'
import { Sheet } from '@/components/ui/Sheet'
import { getExercise, MUSCLE_LABELS } from '@/domain/exercises'
import { FOCUS_LABELS } from '@/domain/labels'
import { formatDate, fromDayKey, isToday } from '@/lib/dates'
import { formatMinutes } from '@/lib/utils'
import { useStore } from '@/store/useStore'

export function WorkoutDetailScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const workout = useStore((s) => (id ? s.workouts[id] : undefined))
  const startWorkout = useStore((s) => s.startWorkout)
  const skipWorkout = useStore((s) => s.skipWorkout)
  const coachName = useStore((s) => s.coach.name)
  const [changeOpen, setChangeOpen] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)

  if (!workout) {
    return (
      <Page title="Workout" back>
        <EmptyState title="This workout isn’t here anymore" body="It may have been replaced by a newer plan." action={<Button variant="primary" onClick={() => navigate('/')}>Back home</Button>} />
      </Page>
    )
  }

  const done = workout.status === 'completed'
  const totalSets = workout.exercises.reduce((a, e) => a + e.sets.length, 0)
  const ask = (prompt: string) => navigate(`/coach?prompt=${encodeURIComponent(prompt)}`)

  return (
    <Page back title={done ? 'Summary' : isToday(fromDayKey(workout.scheduledFor)) ? 'Today’s workout' : formatDate(fromDayKey(workout.scheduledFor), { weekday: true })}>
      <div className="pt-2 pb-2">
        <div className="flex items-center gap-2 mb-1.5">
          <Tag>{FOCUS_LABELS[workout.focus]}</Tag>
          {workout.constraints?.intensity === 'light' && <Tag tone="info">Light</Tag>}
          {workout.constraints?.intensity === 'hard' && <Tag tone="accent">Push</Tag>}
          {workout.programId && <Tag tone="accent">Program</Tag>}
          {workout.status === 'skipped' && <Tag tone="warn">Skipped</Tag>}
        </div>
        <h1 className="display text-[32px]">{workout.title}</h1>
        <div className="text-[14px] text-text-2 mt-1.5">
          {done && workout.summary
            ? `${formatMinutes(Math.round(workout.summary.durationSec / 60))} · ${workout.summary.setsCompleted}/${workout.summary.setsPlanned} sets · ${Math.round(workout.summary.totalVolumeKg).toLocaleString()} kg`
            : `${formatMinutes(workout.estimatedMinutes)} · ${workout.exercises.length} exercises · ${totalSets} sets`}
        </div>
      </div>

      {workout.coachNote && (
        <div className="flex gap-3 rounded-[18px] bg-surface border border-border p-4 mb-4">
          <CoachMark size={20} className="mt-0.5" />
          <p className="text-[14px] text-text-2 leading-relaxed">{workout.coachNote}</p>
        </div>
      )}

      {done && workout.summary?.prs.length ? (
        <Card tone="accent" className="mb-4">
          <div className="flex items-center gap-2 mb-2 text-accent-text">
            <Trophy size={16} />
            <span className="label text-accent-text">Personal bests</span>
          </div>
          <ul className="space-y-1">
            {workout.summary.prs.map((p) => (
              <li key={p.exerciseId} className="flex justify-between text-[14px]">
                <span className="font-medium">{p.name}</span>
                <span className="tabular text-text-2">
                  {p.weightKg} kg × {p.reps}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <SectionLabel>Exercises</SectionLabel>
      <div className="space-y-2.5">
        {workout.exercises.map((e, i) => {
          const def = getExercise(e.exerciseId)
          return (
            <Card key={e.id} padding="sm">
              <div className="flex items-start gap-3">
                <span className="h-7 w-7 rounded-full bg-surface-2 text-[12px] font-semibold flex items-center justify-center tabular shrink-0 mt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-[15.5px] font-semibold truncate">{e.name}</div>
                    {e.group && <Tag>Superset</Tag>}
                  </div>
                  <div className="text-[12.5px] text-text-3 mt-0.5">
                    {MUSCLE_LABELS[def.primary]} · rest {e.restSeconds}s
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {e.sets.map((s, si) => (
                      <span key={s.id} className={`text-[12.5px] tabular px-2 py-1 rounded-md ${s.completed ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-text-2'}`}>
                        {si + 1}·{' '}
                        {s.targetSeconds ? `${s.actualSeconds ?? s.targetSeconds}s` : `${s.actualReps ?? s.targetReps}`}
                        {(s.actualWeightKg ?? s.targetWeightKg) ? ` × ${s.actualWeightKg ?? s.targetWeightKg} kg` : ''}
                      </span>
                    ))}
                  </div>
                  {e.note && <div className="text-[12.5px] text-text-3 mt-2 italic">{e.note}</div>}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {workout.history?.length ? (
        <div className="mt-4 text-[12px] text-text-4">
          Changes: {workout.history.join(' · ')}
        </div>
      ) : null}

      {!done && (
        <div className="sticky bottom-[calc(58px+env(safe-area-inset-bottom)+12px)] sm:bottom-4 mt-6 flex gap-2">
          <Button
            variant="primary"
            size="lg"
            full
            icon={<Play size={16} fill="currentColor" />}
            onClick={() => {
              startWorkout(workout.id)
              navigate(`/workout/${workout.id}/session`)
            }}
          >
            {workout.status === 'in_progress' ? 'Continue' : 'Start workout'}
          </Button>
          <Button variant="secondary" size="lg" icon={<Sparkles size={16} />} onClick={() => setChangeOpen(true)}>
            Change
          </Button>
        </div>
      )}
      {done && (
        <div className="mt-6 flex gap-2">
          <Button variant="secondary" full onClick={() => navigate('/progress')}>
            See progress
          </Button>
          <Button variant="secondary" full onClick={() => ask('How did that session go?')}>
            Ask {coachName}
          </Button>
        </div>
      )}

      <Sheet open={changeOpen} onClose={() => setChangeOpen(false)} title={`Change with ${coachName}`}>
        <p className="text-[13.5px] text-text-3 mb-4">Tell your coach what to adjust. The workout updates in place.</p>
        <div className="flex flex-wrap gap-2 pb-2">
          <Chip onClick={() => ask('Make it shorter')}>Shorter</Chip>
          <Chip onClick={() => ask('Make it longer')}>Longer</Chip>
          <Chip onClick={() => ask('I only have dumbbells')}>Dumbbells only</Chip>
          <Chip onClick={() => ask('Bodyweight only today')}>Bodyweight only</Chip>
          <Chip onClick={() => ask("I don't want cardio today")}>No cardio</Chip>
          <Chip onClick={() => ask('Make it easier')}>Lighter</Chip>
          <Chip onClick={() => ask('Make it harder')}>Harder</Chip>
          <Chip onClick={() => setSwapOpen(true)}>Swap an exercise</Chip>
          <Chip onClick={() => ask('Give me something different')}>Something different</Chip>
        </div>
        <div className="mt-4 pt-4 border-t border-hairline">
          <Button
            variant="ghost"
            full
            onClick={() => {
              skipWorkout(workout.id)
              setChangeOpen(false)
              navigate('/')
            }}
          >
            Skip today
          </Button>
        </div>
      </Sheet>

      <Sheet open={swapOpen} onClose={() => setSwapOpen(false)} title="Swap which exercise?">
        <div className="space-y-2 pb-2">
          {workout.exercises.map((e) => (
            <button key={e.id} onClick={() => ask(`Replace ${e.name}`)} className="w-full text-left rounded-[16px] bg-surface border border-border px-4 py-3 text-[15px] font-medium hover:border-border-strong">
              {e.name}
            </button>
          ))}
        </div>
      </Sheet>
    </Page>
  )
}

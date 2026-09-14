import { Play, Sparkles, Trophy } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Chip, Tag } from '@/components/ui/Chip'
import { CoachMark, EmptyState } from '@/components/ui/Primitives'
import { Sheet } from '@/components/ui/Sheet'
import { getExercise } from '@/domain/exercises'
import { exerciseCue, exerciseName, focusLabel, muscleLabel, workoutCoachNote, workoutTitle } from '@/domain/labels'
import { useT } from '@/i18n/react'
import { formatDate, fromDayKey, isToday } from '@/lib/dates'
import { formatMinutes } from '@/lib/utils'
import { userAction } from '@/coach/userActions'
import { useStore } from '@/store/useStore'

export function WorkoutDetailScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const tr = useT()
  const workout = useStore((s) => (id ? s.workouts[id] : undefined))
  const startWorkout = useStore((s) => s.startWorkout)
  const skipWorkout = (workoutId: string) => userAction({ type: 'skip_workout', workoutId })
  const coachName = useStore((s) => s.coach.name)
  const [changeOpen, setChangeOpen] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)

  if (!workout) {
    return (
      <Page title={tr.t('workout.title')} back>
        <EmptyState
          title={tr.t('workout.gone')}
          body={tr.t('workout.goneBody')}
          action={
            <Button variant="primary" onClick={() => navigate('/')}>
              {tr.t('common.backHome')}
            </Button>
          }
        />
      </Page>
    )
  }

  const done = workout.status === 'completed'
  const totalSets = workout.exercises.reduce((a, e) => a + e.sets.length, 0)
  const ask = (prompt: string) => navigate(`/coach?prompt=${encodeURIComponent(prompt)}`)
  const coachNote = workoutCoachNote(workout)

  return (
    <Page back title={done ? tr.t('workout.summary') : isToday(fromDayKey(workout.scheduledFor)) ? tr.t('workout.todaysWorkout') : formatDate(fromDayKey(workout.scheduledFor), { weekday: true })}>
      <div className="pt-2 pb-2">
        <div className="flex items-center gap-2 mb-1.5">
          <Tag>{focusLabel(workout.focus)}</Tag>
          {workout.constraints?.intensity === 'light' && <Tag tone="info">{tr.t('common.lightTag')}</Tag>}
          {workout.constraints?.intensity === 'hard' && <Tag tone="accent">{tr.t('common.pushTag')}</Tag>}
          {workout.programId && <Tag tone="accent">{tr.t('common.program')}</Tag>}
          {workout.status === 'skipped' && <Tag tone="warn">{tr.t('common.skipped')}</Tag>}
        </div>
        <h1 className="display text-[32px]">{workoutTitle(workout)}</h1>
        <div className="text-[14px] text-text-2 mt-1.5">
          {done && workout.summary
            ? tr.t('workout.doneStats', { minutes: formatMinutes(Math.round(workout.summary.durationSec / 60)), done: workout.summary.setsCompleted, planned: workout.summary.setsPlanned, kg: tr.int(workout.summary.totalVolumeKg) })
            : tr.t('workout.plannedStats', { minutes: formatMinutes(workout.estimatedMinutes), exercises: tr.tn('common.exercises', workout.exercises.length), sets: tr.tn('common.sets', totalSets) })}
        </div>
      </div>

      {coachNote && (
        <div className="flex gap-3 rounded-[18px] bg-surface border border-border p-4 mb-4">
          <CoachMark size={20} className="mt-0.5" />
          <p className="text-[14px] text-text-2 leading-relaxed">{coachNote}</p>
        </div>
      )}

      {done && workout.summary?.prs.length ? (
        <Card tone="accent" className="mb-4">
          <div className="flex items-center gap-2 mb-2 text-accent-text">
            <Trophy size={16} />
            <span className="label text-accent-text">{tr.t('workout.personalBests')}</span>
          </div>
          <ul className="space-y-1">
            {workout.summary.prs.map((p) => (
              <li key={p.exerciseId} className="flex justify-between text-[14px]">
                <span className="font-medium">{exerciseName(p.exerciseId, p.name)}</span>
                <span className="tabular text-text-2">
                  {tr.num(p.weightKg)} {tr.t('common.kg')} × {p.reps}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <SectionLabel>{tr.t('workout.exercises')}</SectionLabel>
      <div className="space-y-2.5">
        {workout.exercises.map((e, i) => {
          const def = getExercise(e.exerciseId)
          const note = e.note ? exerciseCue(e.exerciseId, e.note) : undefined
          return (
            <Card key={e.id} padding="sm">
              <div className="flex items-start gap-3">
                <span className="h-7 w-7 rounded-full bg-surface-2 text-[12px] font-semibold flex items-center justify-center tabular shrink-0 mt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-[15.5px] font-semibold truncate">{exerciseName(e.exerciseId, e.name)}</div>
                    {e.group && <Tag>{tr.t('common.superset')}</Tag>}
                  </div>
                  <div className="text-[12.5px] text-text-3 mt-0.5">{tr.t('workout.muscleRest', { muscle: muscleLabel(def.primary), s: e.restSeconds })}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {e.sets.map((s, si) => (
                      <span key={s.id} className={`text-[12.5px] tabular px-2 py-1 rounded-md ${s.completed ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-text-2'}`}>
                        {si + 1}·{' '}
                        {s.targetSeconds ? `${s.actualSeconds ?? s.targetSeconds}s` : `${s.actualReps ?? s.targetReps}`}
                        {(s.actualWeightKg ?? s.targetWeightKg) ? ` × ${tr.num(s.actualWeightKg ?? s.targetWeightKg ?? 0)} ${tr.t('common.kg')}` : ''}
                      </span>
                    ))}
                  </div>
                  {note && <div className="text-[12.5px] text-text-3 mt-2 italic">{note}</div>}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {workout.history?.length ? <div className="mt-4 text-[12px] text-text-4">{tr.t('workout.changes', { list: workout.history.join(' · ') })}</div> : null}

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
            {workout.status === 'in_progress' ? tr.t('common.continue') : tr.t('workout.startWorkout')}
          </Button>
          <Button variant="secondary" size="lg" icon={<Sparkles size={16} />} onClick={() => setChangeOpen(true)}>
            {tr.t('common.change')}
          </Button>
        </div>
      )}
      {done && (
        <div className="mt-6 flex gap-2">
          <Button variant="secondary" full onClick={() => navigate('/progress')}>
            {tr.t('workout.seeProgress')}
          </Button>
          <Button variant="secondary" full onClick={() => ask(tr.t('workout.prompt.howDidItGo'))}>
            {tr.t('workout.askCoach', { name: coachName })}
          </Button>
        </div>
      )}

      <Sheet open={changeOpen} onClose={() => setChangeOpen(false)} title={tr.t('workout.changeWith', { name: coachName })}>
        <p className="text-[13.5px] text-text-3 mb-4">{tr.t('workout.changeHint')}</p>
        <div className="flex flex-wrap gap-2 pb-2">
          <Chip onClick={() => ask(tr.t('workout.prompt.shorter'))}>{tr.t('workout.chip.shorter')}</Chip>
          <Chip onClick={() => ask(tr.t('workout.prompt.longer'))}>{tr.t('workout.chip.longer')}</Chip>
          <Chip onClick={() => ask(tr.t('workout.prompt.dumbbellsOnly'))}>{tr.t('workout.chip.dumbbellsOnly')}</Chip>
          <Chip onClick={() => ask(tr.t('workout.prompt.bodyweightOnly'))}>{tr.t('workout.chip.bodyweightOnly')}</Chip>
          <Chip onClick={() => ask(tr.t('workout.prompt.noCardio'))}>{tr.t('workout.chip.noCardio')}</Chip>
          <Chip onClick={() => ask(tr.t('workout.prompt.easier'))}>{tr.t('workout.chip.lighter')}</Chip>
          <Chip onClick={() => ask(tr.t('workout.prompt.harder'))}>{tr.t('workout.chip.harder')}</Chip>
          <Chip onClick={() => setSwapOpen(true)}>{tr.t('workout.chip.swap')}</Chip>
          <Chip onClick={() => ask(tr.t('workout.prompt.different'))}>{tr.t('workout.chip.different')}</Chip>
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
            {tr.t('workout.skipToday')}
          </Button>
        </div>
      </Sheet>

      <Sheet open={swapOpen} onClose={() => setSwapOpen(false)} title={tr.t('workout.swapWhich')}>
        <div className="space-y-2 pb-2">
          {workout.exercises.map((e) => (
            <button key={e.id} onClick={() => ask(tr.t('workout.prompt.replace', { exercise: exerciseName(e.exerciseId, e.name) }))} className="w-full text-left rounded-[16px] bg-surface border border-border px-4 py-3 text-[15px] font-medium hover:border-border-strong">
              {exerciseName(e.exerciseId, e.name)}
            </button>
          ))}
        </div>
      </Sheet>
    </Page>
  )
}

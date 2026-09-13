import type { Workout, WorkoutSummary } from '@/domain/types'
import { formatShortDate } from '@/lib/dates'
import { useStore } from '@/store/useStore'
import { detectPRs } from './insights'
import { workoutVolume } from './workoutGenerator'

/**
 * The one way a workout becomes “completed”. The session screen, the workout
 * detail page and the coach's complete_workout tool all go through here, so
 * history, calendar, progress and streaks can never disagree.
 */
export function completeWorkoutRecord(workoutId: string, feeling?: WorkoutSummary['feeling'], notes?: string): WorkoutSummary | undefined {
  const s = useStore.getState()
  const w = s.workouts[workoutId]
  if (!w) return undefined
  const history = Object.values(s.workouts)
  const startedAt = w.startedAt ? new Date(w.startedAt).getTime() : Date.now() - w.estimatedMinutes * 60_000
  const durationSec = Math.max(60, Math.round((Date.now() - startedAt) / 1000))
  const setsPlanned = w.exercises.reduce((a, e) => a + e.sets.length, 0)
  const setsCompleted = w.exercises.reduce((a, e) => a + e.sets.filter((x) => x.completed).length, 0)
  const exercisesCompleted = w.exercises.filter((e) => e.sets.some((x) => x.completed)).length
  const prs = detectPRs(w, history)
  const summary: WorkoutSummary = {
    durationSec,
    totalVolumeKg: workoutVolume(w),
    setsCompleted,
    setsPlanned,
    exercisesCompleted,
    prs: prs.map((p) => ({ exerciseId: p.exerciseId, name: p.name, weightKg: p.weightKg, reps: p.reps, e1rm: p.e1rm })),
    feeling,
    notes,
  }
  s.completeWorkout(workoutId, summary)
  ensureEventForWorkout({ ...w, status: 'completed' })
  if (feeling) s.addMemory({ category: 'reaction', text: `${w.title} on ${formatShortDate(new Date())} felt ${feeling}${notes ? `: ${notes}` : ''}`, source: 'inferred', persistence: 'temporary' })
  return summary
}

/** Tick every remaining set as done (used when the user reports finishing from chat). */
export function tickRemainingSets(workout: Workout): Workout {
  return {
    ...workout,
    startedAt: workout.startedAt ?? new Date(Date.now() - workout.estimatedMinutes * 60_000).toISOString(),
    exercises: workout.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((x) => (x.completed ? x : { ...x, completed: true, actualReps: x.actualReps ?? x.targetReps, actualWeightKg: x.actualWeightKg ?? x.targetWeightKg, actualSeconds: x.actualSeconds ?? x.targetSeconds })),
    })),
  }
}

/** Every workout has exactly one calendar event that mirrors its title, date and status. */
export function ensureEventForWorkout(workout: Workout): void {
  const s = useStore.getState()
  const existing = s.events.find((e) => e.workoutId === workout.id)
  const status = workout.status === 'completed' ? 'completed' : workout.status === 'skipped' ? 'skipped' : 'planned'
  if (existing) {
    if (existing.title !== workout.title || existing.date !== workout.scheduledFor || existing.status !== status) s.upsertEvent({ ...existing, title: workout.title, date: workout.scheduledFor, status })
    return
  }
  s.upsertEvent({
    id: `evt_${workout.id}`,
    type: 'workout',
    date: workout.scheduledFor,
    title: workout.title,
    workoutId: workout.id,
    programId: workout.programId,
    status,
    createdAt: new Date().toISOString(),
  })
}

import { programCanonicalName, renderWorkoutTitle, titleKeyOf, splitLabel as splitLabelOf } from '@/domain/labels'
import type { CalendarEvent, Goal, GoalType, Program, ProgramDay, ProgramWeek, UserProfile, Workout, WorkoutFocus } from '@/domain/types'
import { t } from '@/i18n'
import { addDays, dayKey, fromDayKey, startOfWeek } from '@/lib/dates'
import { uid } from '@/lib/utils'
import { chooseSplit, generateWorkout, primaryGoal, splitRotation } from './workoutGenerator'

export interface GenerateProgramInput {
  user: UserProfile
  goals: Goal[]
  history: Workout[]
  weeks?: number
  daysPerWeek?: number
  startDate?: string
  goalType?: GoalType
  name?: string
}

function phaseFor(week: number, total: number): ProgramWeek['phase'] {
  if (week % 4 === 0 && total >= 8) return 'deload'
  if (week === total && total >= 6) return 'peak'
  const pos = week / total
  if (pos <= 0.34) return 'foundation'
  if (pos <= 0.67) return 'build'
  return 'intensify'
}

function multipliers(phase: ProgramWeek['phase'], week: number): { intensity: number; volume: number } {
  switch (phase) {
    case 'foundation':
      return { intensity: 0.9 + week * 0.015, volume: 1 }
    case 'build':
      return { intensity: 0.97 + (week % 4) * 0.02, volume: 1.15 }
    case 'intensify':
      return { intensity: 1.03 + (week % 4) * 0.02, volume: 1.05 }
    case 'peak':
      return { intensity: 1.08, volume: 0.85 }
    case 'deload':
      return { intensity: 0.85, volume: 0.6 }
  }
}

/** English canonical program name (stored). Screens render programDisplayName() in the user's language. */
export function programName(goal: GoalType, weeks: number): string {
  return programCanonicalName(goal, weeks)
}

export function generateProgram(input: GenerateProgramInput): Program {
  const { user, goals } = input
  const goal = input.goalType ?? primaryGoal(goals)
  const weeks = Math.min(24, Math.max(4, input.weeks ?? 12))
  const daysPerWeek = Math.min(6, Math.max(2, input.daysPerWeek ?? user.availability.daysPerWeek))
  const split = chooseSplit(daysPerWeek, goal)
  const rotation = splitRotation(split, daysPerWeek)
  const preferred = [...user.availability.preferredDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  const days = preferred.length >= daysPerWeek ? preferred.slice(0, daysPerWeek) : defaultDays(daysPerWeek)

  const startDate = input.startDate ?? dayKey(nextMonday())
  const weeksPlan: ProgramWeek[] = []
  for (let w = 1; w <= weeks; w++) {
    const phase = phaseFor(w, weeks)
    const m = multipliers(phase, w)
    const dayPlans: ProgramDay[] = days.map((dow, i) => {
      const focus = rotation[i % rotation.length] as WorkoutFocus
      return { dayOfWeek: dow, focus, title: renderWorkoutTitle({ focus }, 'en'), exerciseIds: [], minutes: user.availability.sessionMinutes }
    })
    // Stored notes are English canonical; screens render phaseNote(phase) in the user's language.
    weeksPlan.push({ week: w, phase, intensityMultiplier: m.intensity, volumeMultiplier: m.volume, note: t(`phaseNote.${phase}`, undefined, 'en'), days: dayPlans })
  }

  const description = t('programDesc', { goal: t(`goal.${goal}`, undefined, 'en'), weeks, days: daysPerWeek, split: splitLabelOf(split, 'en'), tail: t(weeks >= 8 ? 'programDesc.deload' : 'programDesc.short', undefined, 'en') }, 'en')

  return {
    id: uid('prg'),
    name: input.name ?? programName(goal, weeks),
    goalType: goal,
    weeks,
    daysPerWeek,
    split,
    startDate,
    status: 'active',
    weeksPlan,
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** Localised split label. */
export function splitLabel(split: Program['split']): string {
  return splitLabelOf(split)
}

function defaultDays(n: number): number[] {
  const presets: Record<number, number[]> = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] }
  return presets[n] ?? [1, 3, 5]
}

function nextMonday(): Date {
  const monday = startOfWeek(new Date())
  const today = new Date()
  // If today is Monday, start today. Otherwise next Monday.
  return today.getDay() === 1 ? monday : addDays(monday, 7)
}

/** Materialise concrete workouts and calendar events for a program. */
export function materializeProgram(program: Program, user: UserProfile, goals: Goal[], history: Workout[]): { workouts: Workout[]; events: CalendarEvent[] } {
  const workouts: Workout[] = []
  const events: CalendarEvent[] = []
  const start = startOfWeek(fromDayKey(program.startDate))
  const generatedHistory = [...history]
  for (const week of program.weeksPlan) {
    week.days.forEach((day, di) => {
      const offset = (day.dayOfWeek + 6) % 7
      const date = dayKey(addDays(start, (week.week - 1) * 7 + offset))
      if (date < program.startDate) return
      const workout = generateWorkout({
        user,
        goals,
        history: generatedHistory,
        constraints: { focus: day.focus, minutes: day.minutes },
        date,
        seed: `${program.id}-${week.week}-${di}`,
        source: 'program',
        program: { id: program.id, week: week.week, day: di + 1, intensity: week.intensityMultiplier, volume: week.volumeMultiplier },
      })
      workout.title = renderWorkoutTitle({ focus: day.focus }, 'en')
      workout.titleKey = titleKeyOf({ focus: day.focus })
      workout.coachNote = week.note
      workout.noteKey = week.phase
      workouts.push(workout)
      events.push({
        id: uid('evt'),
        type: 'workout',
        date,
        title: workout.title,
        workoutId: workout.id,
        programId: program.id,
        status: 'planned',
        createdAt: new Date().toISOString(),
      })
    })
  }
  return { workouts, events }
}

export function programWeekFor(program: Program, date = new Date()): number {
  const start = startOfWeek(fromDayKey(program.startDate))
  const diff = Math.floor((startOfWeek(date).getTime() - start.getTime()) / (7 * 86_400_000))
  return diff + 1
}

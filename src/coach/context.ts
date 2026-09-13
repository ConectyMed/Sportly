import type { Conversation, DayKey, Goal, MemoryItem, Workout } from '@/domain/types'
import { GOAL_LABELS } from '@/domain/labels'
import { addDays, dayKey, todayKey } from '@/lib/dates'
import { round } from '@/lib/utils'
import { selectDailyNutrition, selectMealsForDate } from '@/store/selectors'
import type { AppState } from '@/store/useStore'
import { consistencyStreak, goalProgress, personalRecords, weeklyStats, weightTrend, type WeekStat } from './insights'
import { isExpired } from './memory'
import { programWeekFor } from './programGenerator'
import { computeReadiness, type Readiness } from './readiness'
import { buildTemporalContext, type TemporalContext } from './time'
import { workoutVolume } from './workoutGenerator'

/**
 * CoachContextSnapshot: the structured, serialisable picture of the user that
 * the coach reasons from. It is DERIVED from the store on every turn and never
 * stored, so it cannot drift from the screens.
 *
 * Priority when sources disagree (enforced by construction):
 *   1. current structured state (profile, goals, workouts, meals, check-ins)
 *   2. recent actions (audit log)
 *   3. recent conversation (references, topic)
 *   4. persistent memory
 *   5. history
 * Conversation and memory are included as context, never as the value of a
 * field that the structured state already answers.
 */

export interface GoalSnapshot {
  id: string
  type: Goal['type']
  rank: Goal['rank']
  label: string
  metric?: Goal['metric']
  targetValue?: number
  targetUnit?: string
  targetDate?: DayKey
  progressPct: number
  progressLabel: string
}

export interface WorkoutSnapshot {
  id: string
  title: string
  date: DayKey
  status: Workout['status']
  focus: Workout['focus']
  minutes: number
  exercises: string[]
  volumeKg?: number
  programWeek?: number
}

export interface CoachContextSnapshot {
  generatedAt: string
  time: TemporalContext
  profile: {
    name: string
    age: number
    sex: string
    heightCm: number
    weightKg: number
    level: string
    yearsTraining: number
    sports: string[]
    equipment: string[]
    trainsAt: string
    availability: { daysPerWeek: number; preferredDays: number[]; sessionMinutes: number; preferredTime: string }
    diet: string
    dietaryFlags: string[]
    dislikedFoods: string[]
    dislikedExercises: string[]
  }
  goals: { primary?: GoalSnapshot; secondary: GoalSnapshot[] }
  training: {
    today?: WorkoutSnapshot
    tomorrow?: WorkoutSnapshot
    upcoming: WorkoutSnapshot[]
    recentCompleted: WorkoutSnapshot[]
    sessionsLast7Days: number
    sessionsLast28Days: number
    volumeLast7DaysKg: number
    targetPerWeek: number
    dislikedExercises: string[]
  }
  readiness: Readiness & { checkIn?: { fatigue?: number; energy?: number; sleepHours?: number; soreness?: number; mood?: string } }
  nutrition: {
    date: DayKey
    isTrainingDay: boolean
    targets: { calories: number; proteinG: number; carbsG: number; fatG: number }
    consumed: { calories: number; proteinG: number; carbsG: number; fatG: number }
    remaining: { calories: number; proteinG: number; carbsG: number; fatG: number }
    todayMeals: Array<{ id: string; slot: string; name: string; calories: number; proteinG: number; status: 'draft' | 'logged' }>
    yesterday: { calories: number; proteinG: number; meals: number }
    planId?: string
  }
  progress: {
    weight: ReturnType<typeof weightTrend>
    consistency: ReturnType<typeof consistencyStreak>
    weeks: WeekStat[]
    personalRecords: Array<{ exerciseId: string; name: string; weightKg: number; reps: number; e1rm: number }>
    totalCompleted: number
  }
  calendar: {
    upcoming: Array<{ id: string; date: DayKey; title: string; type: string; status: string; workoutId?: string }>
    recent: Array<{ id: string; date: DayKey; title: string; type: string; status: string; workoutId?: string }>
  }
  program?: {
    id: string
    name: string
    goalType: Goal['type']
    weeks: number
    daysPerWeek: number
    currentWeek: number
    phase?: string
    status: string
    nextSessions: WorkoutSnapshot[]
  }
  memory: {
    persistent: Array<{ id: string; category: MemoryItem['category']; text: string; confidence?: number; updatedAt?: string }>
    temporary: Array<{ id: string; category: MemoryItem['category']; text: string; expiresAt?: string }>
  }
  conversation: {
    id?: string
    topic?: string
    references: { workoutId?: string; mealId?: string; goalId?: string; eventId?: string; programId?: string; nutritionPlanId?: string }
    recent: Array<{ role: 'user' | 'coach'; text: string }>
  }
  recentActions: Array<{ tool: string; ok: boolean; summary: string; at: string }>
}

export function workoutSnapshot(w: Workout): WorkoutSnapshot {
  return {
    id: w.id,
    title: w.title,
    date: w.scheduledFor,
    status: w.status,
    focus: w.focus,
    minutes: w.estimatedMinutes,
    exercises: w.exercises.map((e) => e.name),
    volumeKg: w.status === 'completed' ? round(workoutVolume(w)) : undefined,
    programWeek: w.programWeek,
  }
}

export function goalSnapshot(g: Goal, state: Pick<AppState, 'measurements' | 'workouts' | 'user'>): GoalSnapshot {
  const p = goalProgress(g, state.measurements, Object.values(state.workouts), state.user?.availability.daysPerWeek ?? 3)
  return { id: g.id, type: g.type, rank: g.rank, label: g.label || GOAL_LABELS[g.type], metric: g.metric, targetValue: g.targetValue, targetUnit: g.targetUnit, targetDate: g.targetDate, progressPct: round(p.pct * 100), progressLabel: p.label }
}

export function buildContextSnapshot(state: AppState, conversation?: Conversation, now = new Date()): CoachContextSnapshot {
  const time = buildTemporalContext(now)
  const user = state.user
  if (!user) throw new Error('No user profile: onboarding has not completed')
  const workouts = Object.values(state.workouts)
  const completed = workouts.filter((w) => w.status === 'completed').sort((a, b) => (a.completedAt ?? a.scheduledFor).localeCompare(b.completedAt ?? b.scheduledFor))
  const since = (days: number) => dayKey(addDays(now, -days))
  const last7 = completed.filter((w) => w.scheduledFor >= since(7))
  const last28 = completed.filter((w) => w.scheduledFor >= since(28))
  const planned = workouts.filter((w) => w.status === 'planned' || w.status === 'in_progress').sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
  const todayWorkout = planned.find((w) => w.scheduledFor === time.today) ?? completed.filter((w) => w.scheduledFor === time.today).at(-1)
  const tomorrowWorkout = planned.find((w) => w.scheduledFor === time.tomorrow)
  const readiness = computeReadiness(state.checkIns[time.today], workouts, time.today, user.sleepHoursTypical)
  const checkIn = state.checkIns[time.today]
  const daily = selectDailyNutrition(state, time.today)
  const yMeals = selectMealsForDate(state, time.yesterday)
  const program = Object.values(state.programs).find((p) => p.status === 'active')
  const primary = state.goals.find((g) => g.rank === 'primary')
  const memory = state.memory.filter((m) => !isExpired(m, now))
  const in14 = dayKey(addDays(now, 14))
  const ago7 = since(7)
  const eventLite = (e: AppState['events'][number]) => ({ id: e.id, date: e.date, title: e.title, type: e.type, status: e.status, workoutId: e.workoutId })

  return {
    generatedAt: time.now,
    time,
    profile: {
      name: user.name,
      age: user.age,
      sex: user.sex,
      heightCm: user.heightCm,
      weightKg: user.weightKg,
      level: user.level,
      yearsTraining: user.yearsTraining,
      sports: user.sports,
      equipment: user.equipment,
      trainsAt: user.trainsAt,
      availability: { ...user.availability },
      diet: user.diet,
      dietaryFlags: user.dietaryFlags,
      dislikedFoods: user.dislikedFoods,
      dislikedExercises: user.dislikedExercises ?? [],
    },
    goals: {
      primary: primary ? goalSnapshot(primary, state) : undefined,
      secondary: state.goals.filter((g) => g.rank !== 'primary').map((g) => goalSnapshot(g, state)),
    },
    training: {
      today: todayWorkout ? workoutSnapshot(todayWorkout) : undefined,
      tomorrow: tomorrowWorkout ? workoutSnapshot(tomorrowWorkout) : undefined,
      upcoming: planned.filter((w) => w.scheduledFor > time.today && w.scheduledFor <= in14).slice(0, 8).map(workoutSnapshot),
      recentCompleted: completed.slice(-5).reverse().map(workoutSnapshot),
      sessionsLast7Days: last7.length,
      sessionsLast28Days: last28.length,
      volumeLast7DaysKg: round(last7.reduce((a, w) => a + workoutVolume(w), 0)),
      targetPerWeek: user.availability.daysPerWeek,
      dislikedExercises: user.dislikedExercises ?? [],
    },
    readiness: { ...readiness, checkIn: checkIn ? { fatigue: checkIn.fatigue, energy: checkIn.energy, sleepHours: checkIn.sleepHours, soreness: checkIn.soreness, mood: checkIn.mood } : undefined },
    nutrition: {
      date: daily.date,
      isTrainingDay: daily.isTrainingDay,
      targets: daily.targets,
      consumed: { calories: daily.consumed.calories, proteinG: daily.consumed.proteinG, carbsG: daily.consumed.carbsG, fatG: daily.consumed.fatG },
      remaining: daily.remaining,
      todayMeals: [...daily.meals, ...daily.drafts].map((m) => ({ id: m.id, slot: m.slot, name: m.name, calories: m.calories, proteinG: m.proteinG, status: m.status })),
      yesterday: { calories: round(yMeals.reduce((a, m) => a + m.calories, 0)), proteinG: round(yMeals.reduce((a, m) => a + m.proteinG, 0)), meals: yMeals.length },
      planId: daily.plan?.id,
    },
    progress: {
      weight: weightTrend(state.measurements),
      consistency: consistencyStreak(workouts, user.availability.daysPerWeek),
      weeks: weeklyStats(workouts, 4, now),
      personalRecords: personalRecords(workouts)
        .slice(0, 5)
        .map((p) => ({ exerciseId: p.exerciseId, name: p.name, weightKg: p.weightKg, reps: p.reps, e1rm: p.e1rm })),
      totalCompleted: completed.length,
    },
    calendar: {
      upcoming: state.events
        .filter((e) => e.date >= time.today && e.date <= in14 && e.status !== 'skipped')
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 14)
        .map(eventLite),
      recent: state.events
        .filter((e) => e.date < time.today && e.date >= ago7)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10)
        .map(eventLite),
    },
    program: program
      ? {
          id: program.id,
          name: program.name,
          goalType: program.goalType,
          weeks: program.weeks,
          daysPerWeek: program.daysPerWeek,
          currentWeek: programWeekFor(program, now),
          phase: program.weeksPlan[Math.min(program.weeksPlan.length, programWeekFor(program, now)) - 1]?.phase,
          status: program.status,
          nextSessions: planned.filter((w) => w.programId === program.id && w.scheduledFor >= time.today).slice(0, 3).map(workoutSnapshot),
        }
      : undefined,
    memory: {
      persistent: memory.filter((m) => m.persistence !== 'temporary').map((m) => ({ id: m.id, category: m.category, text: m.text, confidence: m.confidence, updatedAt: m.updatedAt })),
      temporary: memory.filter((m) => m.persistence === 'temporary').map((m) => ({ id: m.id, category: m.category, text: m.text, expiresAt: m.expiresAt })),
    },
    conversation: {
      id: conversation?.id,
      topic: conversation?.context.topic,
      references: {
        workoutId: conversation?.context.lastWorkoutId,
        mealId: conversation?.context.lastMealId,
        goalId: conversation?.context.lastGoalId,
        eventId: conversation?.context.lastEventId,
        programId: conversation?.context.lastProgramId,
        nutritionPlanId: conversation?.context.lastNutritionPlanId,
      },
      recent: (conversation ? (state.messages[conversation.id] ?? []) : [])
        .slice(-6)
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'coach', text: m.text.slice(0, 280) })),
    },
    recentActions: state.actionLog.slice(0, 8).map((a) => ({ tool: a.tool, ok: a.ok, summary: a.summary, at: a.at })),
  }
}

/** Summary of one day: what was planned, what happened, what was eaten. Used for temporal questions. */
export interface DaySummary {
  date: DayKey
  planned: WorkoutSnapshot[]
  completed: WorkoutSnapshot[]
  skipped: WorkoutSnapshot[]
  meals: Array<{ id: string; slot: string; name: string; calories: number; proteinG: number }>
  calories: number
  proteinG: number
  checkIn?: { fatigue?: number; energy?: number; sleepHours?: number }
}

export function selectDaySummary(state: Pick<AppState, 'workouts' | 'meals' | 'checkIns'>, date: DayKey = todayKey()): DaySummary {
  const ws = Object.values(state.workouts).filter((w) => w.scheduledFor === date)
  const meals = selectMealsForDate(state, date)
  const ci = state.checkIns[date]
  return {
    date,
    planned: ws.filter((w) => w.status === 'planned' || w.status === 'in_progress').map(workoutSnapshot),
    completed: ws.filter((w) => w.status === 'completed').map(workoutSnapshot),
    skipped: ws.filter((w) => w.status === 'skipped').map(workoutSnapshot),
    meals: meals.map((m) => ({ id: m.id, slot: m.slot, name: m.name, calories: m.calories, proteinG: m.proteinG })),
    calories: round(meals.reduce((a, m) => a + m.calories, 0)),
    proteinG: round(meals.reduce((a, m) => a + m.proteinG, 0)),
    checkIn: ci ? { fatigue: ci.fatigue, energy: ci.energy, sleepHours: ci.sleepHours } : undefined,
  }
}

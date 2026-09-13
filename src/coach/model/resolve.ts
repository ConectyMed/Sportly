import type { Conversation, DayKey, EntityRef, Goal, LoggedMeal, Workout } from '@/domain/types'
import { addDays, dayKey, formatShortDate, fromDayKey, nextWeekday, parseWeekday, todayKey, weekdayName } from '@/lib/dates'
import type { AppState } from '@/store/useStore'
import type { ToolError } from '../tools/contracts'

/**
 * Reference resolution for model tool calls. A model says “tomorrow’s workout”
 * or passes an id it saw in the context; Sportly turns that into a real entity
 * using the conversation, the temporal context and the authoritative store,
 * and refuses to guess when several entities could match.
 */

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: ToolError }

const DAY = /^\d{4}-\d{2}-\d{2}$/

const refuse = <T>(code: ToolError['code'], message: string, candidates?: EntityRef[]): Resolved<T> => ({ ok: false, error: { code, message, candidates } })

/** "today" / "tomorrow" / a weekday / YYYY-MM-DD → DayKey. Returns null for text it cannot read. */
export function resolveDate(input: string | undefined, now = new Date()): DayKey | null | undefined {
  if (input === undefined || input === null || input === '') return undefined
  const t = String(input).trim().toLowerCase()
  if (DAY.test(t)) return dayKey(fromDayKey(t)) === t ? t : null
  if (t === 'today') return dayKey(now)
  if (t === 'tomorrow') return dayKey(addDays(now, 1))
  if (t === 'yesterday') return dayKey(addDays(now, -1))
  const wd = parseWeekday(t.replace(/^(next|this)\s+/, ''))
  if (wd !== null && /^[a-z]+$/.test(t.replace(/^(next|this)\s+/, ''))) return dayKey(nextWeekday(wd, now, !t.startsWith('next')))
  return null
}

export const workoutRef = (w: Workout): EntityRef => ({ type: 'workout', id: w.id, label: `${w.title} · ${weekdayName(fromDayKey(w.scheduledFor), true)} ${formatShortDate(fromDayKey(w.scheduledFor))}` })
export const mealRef = (m: LoggedMeal): EntityRef => ({ type: 'meal', id: m.id, label: `${m.name} (${m.slot.replace('_', '-')}, ${m.calories} kcal)` })
export const goalRef = (g: Goal): EntityRef => ({ type: 'goal', id: g.id, label: `${g.label} (${g.rank})` })

export interface WorkoutRefArgs {
  workoutId?: string
  when?: string
}

export interface ResolveWorkoutOptions {
  /** Statuses the action accepts. */
  statuses: Array<Workout['status']>
  now?: Date
  conversation?: Conversation
  /** What the action does, for messages (“move”, “delete”). */
  verb: string
}

export function resolveWorkout(args: WorkoutRefArgs, state: Pick<AppState, 'workouts'>, opts: ResolveWorkoutOptions): Resolved<Workout> {
  const now = opts.now ?? new Date()
  const today = dayKey(now)
  const all = Object.values(state.workouts)
  const allowed = (w: Workout) => opts.statuses.includes(w.status)
  if (args.workoutId) {
    const w = state.workouts[args.workoutId]
    if (!w) return refuse('not_found', `No workout with id ${args.workoutId}.`)
    if (!allowed(w)) return refuse('not_allowed', `${w.title} is ${w.status.replace('_', ' ')}; only ${opts.statuses.join(' or ').replace('_', ' ')} sessions can be ${opts.verb}.`)
    return { ok: true, value: w }
  }
  if (args.when !== undefined) {
    const date = resolveDate(args.when, now)
    if (!date) return refuse('invalid_input', `“${args.when}” is not a date I can read. Use YYYY-MM-DD, today, tomorrow or a weekday.`)
    const onDay = all.filter((w) => w.scheduledFor === date)
    const match = onDay.filter(allowed).sort((a, b) => (a.status === 'in_progress' ? -1 : b.status === 'in_progress' ? 1 : 0))[0]
    if (match) return { ok: true, value: match }
    const other = onDay[0]
    if (other) return refuse('not_allowed', `${other.title} on ${weekdayName(fromDayKey(date))} is ${other.status.replace('_', ' ')}, so it cannot be ${opts.verb}.`)
    return refuse('not_found', `There is no workout on ${weekdayName(fromDayKey(date))} ${formatShortDate(fromDayKey(date))}.`)
  }
  // No explicit reference: the one being discussed, then today's, then the only candidate.
  const discussed = opts.conversation?.context.lastWorkoutId ? state.workouts[opts.conversation.context.lastWorkoutId] : undefined
  if (discussed && allowed(discussed)) return { ok: true, value: discussed }
  const todays = all.find((w) => w.scheduledFor === today && allowed(w))
  if (todays) return { ok: true, value: todays }
  const upcoming = all.filter((w) => allowed(w) && w.scheduledFor >= today).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
  if (upcoming.length === 1) return { ok: true, value: upcoming[0] }
  if (!upcoming.length) return refuse('not_found', `There is no ${opts.statuses.includes('planned') ? 'planned ' : ''}workout to be ${opts.verb}.`)
  const windowEnd = dayKey(addDays(now, 6))
  const seen = new Set<number>()
  const candidates = upcoming.filter((w) => w.scheduledFor <= windowEnd && !seen.has(fromDayKey(w.scheduledFor).getDay()) && seen.add(fromDayKey(w.scheduledFor).getDay())).slice(0, 4)
  return refuse('ambiguous', `Several workouts could be ${opts.verb}; ask which one.`, (candidates.length ? candidates : upcoming.slice(0, 4)).map(workoutRef))
}

export function resolveMeal(args: { mealId?: string }, state: Pick<AppState, 'meals'>, conversation?: Conversation, now = new Date()): Resolved<LoggedMeal> {
  if (args.mealId) {
    const m = state.meals[args.mealId]
    return m ? { ok: true, value: m } : refuse('not_found', `No meal with id ${args.mealId}.`)
  }
  const discussed = conversation?.context.lastMealId ? state.meals[conversation.context.lastMealId] : undefined
  if (discussed) return { ok: true, value: discussed }
  const today = dayKey(now)
  const todays = Object.values(state.meals)
    .filter((m) => m.date === today)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  if (todays.length === 1) return { ok: true, value: todays[0] }
  if (!todays.length) return refuse('not_found', 'No meal has been logged today.')
  return refuse('ambiguous', 'Several meals were logged today; ask which one.', todays.slice(0, 5).map(mealRef))
}

export function resolveGoal(args: { goalId?: string }, state: Pick<AppState, 'goals'>): Resolved<Goal> {
  if (args.goalId) {
    const g = state.goals.find((x) => x.id === args.goalId)
    return g ? { ok: true, value: g } : refuse('not_found', `No goal with id ${args.goalId}.`)
  }
  if (state.goals.length === 1) return { ok: true, value: state.goals[0] }
  if (!state.goals.length) return refuse('not_found', 'There is no goal set.')
  return refuse('ambiguous', 'Several goals exist; ask which one.', state.goals.map(goalRef))
}

export { todayKey }

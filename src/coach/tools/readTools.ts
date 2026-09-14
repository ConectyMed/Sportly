import type { DayKey, MemoryCategory } from '@/domain/types'
import { exerciseName } from '@/domain/labels'
import { t } from '@/i18n'
import { todayKey } from '@/lib/dates'
import { getKnowledge } from '@/knowledge'
import type { KnowledgeHit } from '@/knowledge'
import { selectDailyNutrition, type DailyNutrition } from '@/store/selectors'
import type { AppState } from '@/store/useStore'
import { buildContextSnapshot, selectDaySummary, workoutSnapshot, type CoachContextSnapshot, type DaySummary, type WorkoutSnapshot } from '../context'
import { isExpired } from '../memory'
import { buildTemporalContext } from '../time'
import { fail, ok, type ToolResult } from './contracts'

/**
 * Read tools: typed questions a coach can ask about the user's state. They
 * never mutate anything and always answer from the store, so a future model
 * can retrieve rather than remember.
 */

export type ReadQuery =
  | { tool: 'get_user_context' }
  | { tool: 'get_profile' }
  | { tool: 'get_goals' }
  | { tool: 'get_goal'; goalId?: string }
  | { tool: 'get_today' }
  | { tool: 'get_tomorrow' }
  | { tool: 'get_day'; date: DayKey }
  | { tool: 'get_workout'; workoutId?: string }
  | { tool: 'get_recent_workouts'; limit?: number }
  | { tool: 'get_progress' }
  | { tool: 'get_nutrition'; date?: DayKey }
  | { tool: 'get_today_meals' }
  | { tool: 'get_remaining_nutrition' }
  | { tool: 'get_calendar'; from?: DayKey; to?: DayKey }
  | { tool: 'get_program' }
  | { tool: 'get_memory'; category?: MemoryCategory }
  | { tool: 'get_preferences' }
  | { tool: 'get_readiness' }
  | { tool: 'search_knowledge'; query: string; limit?: number }

export type ReadToolName = ReadQuery['tool']

export interface ReadOutputs {
  get_user_context: CoachContextSnapshot
  get_profile: CoachContextSnapshot['profile']
  get_goals: CoachContextSnapshot['goals']
  get_goal: NonNullable<CoachContextSnapshot['goals']['primary']>
  get_today: DaySummary & { readiness: CoachContextSnapshot['readiness']; nutrition: DailyNutrition['remaining'] }
  get_tomorrow: DaySummary & { targets: DailyNutrition['targets'] }
  get_day: DaySummary
  get_workout: WorkoutSnapshot & { exercisesDetail: Array<{ id: string; exerciseId: string; name: string; sets: number; targetReps: number; targetWeightKg?: number; targetSeconds?: number }> }
  get_recent_workouts: WorkoutSnapshot[]
  get_progress: CoachContextSnapshot['progress']
  get_nutrition: DailyNutrition
  get_today_meals: CoachContextSnapshot['nutrition']['todayMeals']
  get_remaining_nutrition: DailyNutrition['remaining'] & { targets: DailyNutrition['targets']; consumed: DailyNutrition['consumed'] }
  get_calendar: CoachContextSnapshot['calendar']['upcoming']
  get_program: NonNullable<CoachContextSnapshot['program']> | null
  get_memory: CoachContextSnapshot['memory']
  get_preferences: AppState['preferences'] & { coachName: string; personality: AppState['coach']['personality'] }
  get_readiness: CoachContextSnapshot['readiness']
  search_knowledge: Array<{ title: string; excerpt: string; topics: string[]; source: string; score: number }>
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function runRead<Q extends ReadQuery>(query: Q, state: AppState, now = new Date()): ToolResult<ReadOutputs[Q['tool']]> {
  type Out = ReadOutputs[Q['tool']]
  const done = (data: unknown) => ok(data as Out)
  if (!state.user && query.tool !== 'search_knowledge') return fail('not_allowed', 'No profile yet: finish onboarding first.')
  const time = buildTemporalContext(now)
  try {
    switch (query.tool) {
      case 'get_user_context':
        return done(buildContextSnapshot(state, state.conversations.find((c) => c.id === state.activeConversationId), now))
      case 'get_profile':
        return done(buildContextSnapshot(state, undefined, now).profile)
      case 'get_goals':
        return done(buildContextSnapshot(state, undefined, now).goals)
      case 'get_goal': {
        const goals = buildContextSnapshot(state, undefined, now).goals
        const g = query.goalId ? [goals.primary, ...goals.secondary].find((x) => x?.id === query.goalId) : goals.primary
        return g ? done(g) : fail('not_found', query.goalId ? 'That goal does not exist.' : 'No primary goal set yet.')
      }
      case 'get_today': {
        const snap = buildContextSnapshot(state, undefined, now)
        return done({ ...selectDaySummary(state, time.today), readiness: snap.readiness, nutrition: snap.nutrition.remaining })
      }
      case 'get_tomorrow':
        return done({ ...selectDaySummary(state, time.tomorrow), targets: selectDailyNutrition(state, time.tomorrow).targets })
      case 'get_day':
        if (!DAY.test(query.date)) return fail('invalid_input', 'Date must be YYYY-MM-DD.')
        return done(selectDaySummary(state, query.date))
      case 'get_workout': {
        const w = query.workoutId
          ? state.workouts[query.workoutId]
          : (Object.values(state.workouts).find((x) => x.scheduledFor === time.today && x.status !== 'skipped') ??
            Object.values(state.workouts)
              .filter((x) => x.status === 'planned' && x.scheduledFor > time.today)
              .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0])
        if (!w) return fail('not_found', query.workoutId ? 'That workout does not exist.' : 'No workout planned today or coming up.')
        return done({ ...workoutSnapshot(w), exercisesDetail: w.exercises.map((e) => ({ id: e.id, exerciseId: e.exerciseId, name: exerciseName(e.exerciseId, e.name), sets: e.sets.length, targetReps: e.sets[0]?.targetReps ?? 0, targetWeightKg: e.sets[0]?.targetWeightKg, targetSeconds: e.sets[0]?.targetSeconds })) })
      }
      case 'get_recent_workouts': {
        const limit = Math.min(Math.max(query.limit ?? 5, 1), 30)
        return done(
          Object.values(state.workouts)
            .filter((w) => w.status === 'completed')
            .sort((a, b) => (b.completedAt ?? b.scheduledFor).localeCompare(a.completedAt ?? a.scheduledFor))
            .slice(0, limit)
            .map(workoutSnapshot),
        )
      }
      case 'get_progress':
        return done(buildContextSnapshot(state, undefined, now).progress)
      case 'get_nutrition':
        if (query.date && !DAY.test(query.date)) return fail('invalid_input', 'Date must be YYYY-MM-DD.')
        return done(selectDailyNutrition(state, query.date ?? time.today))
      case 'get_today_meals':
        return done(buildContextSnapshot(state, undefined, now).nutrition.todayMeals)
      case 'get_remaining_nutrition': {
        const d = selectDailyNutrition(state, time.today)
        return done({ ...d.remaining, targets: d.targets, consumed: d.consumed })
      }
      case 'get_calendar': {
        const from = query.from ?? time.today
        const to = query.to ?? time.nextWeekEnd
        if (!DAY.test(from) || !DAY.test(to)) return fail('invalid_input', 'Dates must be YYYY-MM-DD.')
        return done(
          state.events
            .filter((e) => e.date >= from && e.date <= to)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((e) => ({ id: e.id, date: e.date, title: e.title, type: e.type, status: e.status, workoutId: e.workoutId })),
        )
      }
      case 'get_program':
        return done(buildContextSnapshot(state, undefined, now).program ?? null)
      case 'get_memory': {
        const m = buildContextSnapshot(state, undefined, now).memory
        if (!query.category) return done(m)
        return done({ persistent: m.persistent.filter((x) => x.category === query.category), temporary: m.temporary.filter((x) => x.category === query.category) })
      }
      case 'get_preferences':
        return done({ ...state.preferences, coachName: state.coach.name, personality: state.coach.personality })
      case 'get_readiness':
        return done(buildContextSnapshot(state, undefined, now).readiness)
      case 'search_knowledge': {
        if (!query.query?.trim()) return fail('invalid_input', 'A search needs a query.')
        const hits: KnowledgeHit[] = getKnowledge().search(query.query, { limit: query.limit ?? 3 })
        return done(hits.map((h) => ({ title: h.document.title, excerpt: h.chunk.text, topics: h.chunk.topics, source: h.source.title, score: Math.round(h.score * 100) / 100 })))
      }
    }
  } catch (err) {
    return fail('failed', err instanceof Error ? err.message : t('tool.readUnexpected'))
  }
}

/** Memory that is still valid today (expired temporary items excluded). */
export function activeMemory(state: Pick<AppState, 'memory'>, now = new Date()) {
  return state.memory.filter((m) => !isExpired(m, now))
}

export const READ_TOOL_NAMES: ReadToolName[] = ['get_user_context', 'get_profile', 'get_goals', 'get_goal', 'get_today', 'get_tomorrow', 'get_day', 'get_workout', 'get_recent_workouts', 'get_progress', 'get_nutrition', 'get_today_meals', 'get_remaining_nutrition', 'get_calendar', 'get_program', 'get_memory', 'get_preferences', 'get_readiness', 'search_knowledge']

export { todayKey }

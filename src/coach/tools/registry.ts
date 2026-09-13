import type { ActionRecord } from '@/domain/types'
import { hashString, uid } from '@/lib/utils'
import { useStore } from '@/store/useStore'
import type { CoachAction, CoachActionType } from '../provider'
import { runAction, type ActionData } from './actionTools'
import type { ToolDescriptor, ToolResult } from './contracts'
import { runRead, type ReadOutputs, type ReadQuery } from './readTools'

/**
 * The tool registry: the single entry point the orchestrator (and later a
 * model adapter) uses to run tools. It adds two guarantees on top of the tools:
 *
 * 1. Idempotency: the same action repeated within a short window is recognised
 *    and not executed twice (on top of the per-entity checks inside each tool).
 * 2. Auditability: every action, successful or not, is recorded in the store's
 *    action log with what it targeted and what changed.
 */

export interface ExecuteOptions {
  source?: ActionRecord['source']
  /** Window in ms during which an identical call is treated as a repeat. */
  repeatWindowMs?: number
}

interface LedgerEntry {
  at: number
  record: ActionRecord
}

const ledger = new Map<string, LedgerEntry>()
const DEFAULT_WINDOW = 8_000

/** Stable key for an action: entity-bearing actions key on the entity, others on their content. */
export function actionKey(action: CoachAction): string {
  switch (action.type) {
    case 'create_workout':
    case 'update_workout':
      return `${action.type}:${action.workout.id}:${hashString(JSON.stringify(action.workout.exercises.map((e) => [e.exerciseId, e.sets.length])))}`
    case 'skip_workout':
    case 'remove_workout':
    case 'complete_workout':
      return `${action.type}:${action.workoutId}`
    case 'reschedule_workout':
      return `${action.type}:${action.workoutId}:${action.toDate}`
    case 'create_program':
      return `${action.type}:${action.program.id}`
    case 'cancel_program':
      return `${action.type}:${action.programId}`
    case 'create_nutrition_plan':
      return `${action.type}:${action.plan.id}`
    case 'log_meal':
    case 'update_meal':
      return `${action.type}:${action.meal.id}:${hashString(JSON.stringify([action.meal.status, action.meal.slot, action.meal.items.map((i) => [i.id, i.grams])]))}`
    case 'delete_meal':
      return `${action.type}:${action.mealId}`
    case 'remember':
      return `${action.type}:${hashString(action.item.text.toLowerCase())}`
    case 'forget':
      return `${action.type}:${action.memoryId}`
    case 'set_goal':
      return `${action.type}:${action.goal.id}:${hashString(JSON.stringify([action.goal.type, action.goal.targetValue, action.goal.metric]))}`
    case 'delete_goal':
      return `${action.type}:${action.goalId}`
    case 'move_event':
      return `${action.type}:${action.eventId}:${action.toDate}`
    case 'create_event':
      return `${action.type}:${action.event.id}`
    case 'update_event':
    case 'delete_event':
      return `${action.type}:${action.eventId}`
    default:
      return `${action.type}:${hashString(JSON.stringify(action))}`
  }
}

function recordOf(action: CoachAction, result: ToolResult<ActionData>, source: ActionRecord['source']): ActionRecord {
  const base = { id: uid('act'), tool: action.type, source, at: new Date().toISOString() }
  if (result.ok) return { ...base, ok: true, summary: result.data.summary, changes: result.changes, idempotent: result.idempotent }
  return { ...base, ok: false, summary: result.error.message, changes: [], error: result.error.code }
}

/** Execute one action through validation, idempotency and audit. Never throws. */
export function executeAction(action: CoachAction, opts: ExecuteOptions = {}): ActionRecord {
  const source = opts.source ?? 'coach'
  const key = actionKey(action)
  const now = Date.now()
  const window = opts.repeatWindowMs ?? DEFAULT_WINDOW
  const seen = ledger.get(key)
  if (seen && now - seen.at < window && seen.record.ok) {
    const repeat: ActionRecord = { ...seen.record, id: uid('act'), at: new Date().toISOString(), idempotent: true, changes: [] }
    useStore.getState().appendActionLog(repeat)
    return repeat
  }
  const result = runAction(action)
  const record = recordOf(action, result, source)
  ledger.set(key, { at: now, record })
  if (ledger.size > 200) {
    for (const [k, v] of ledger) if (now - v.at > window) ledger.delete(k)
  }
  useStore.getState().appendActionLog(record)
  return record
}

/** Execute several actions in order. Later actions see the state left by earlier ones. */
export function executeActions(actions: CoachAction[] | undefined, opts: ExecuteOptions = {}): ActionRecord[] {
  if (!actions?.length) return []
  return actions.map((a) => executeAction(a, opts))
}

/** Read tools go straight through; they cannot change anything. */
export function executeRead<Q extends ReadQuery>(query: Q): ToolResult<ReadOutputs[Q['tool']]> {
  return runRead(query, useStore.getState())
}

/** Forget the repeat window (tests, or after a reset). */
export function resetActionLedger(): void {
  ledger.clear()
}

/* ------------------------------------------------------------------ Descriptions for a model */

const ACTION_DESCRIPTORS: Record<CoachActionType, Omit<ToolDescriptor, 'name' | 'kind'>> = {
  create_workout: { description: 'Plan a workout for a date. Replaces any other planned coach workout on that day.', input: { workout: 'Workout', replaceWorkoutId: 'string?' } },
  update_workout: { description: 'Replace the content of an existing workout (exercises, sets, duration).', input: { workout: 'Workout' } },
  skip_workout: { description: 'Mark a planned workout as skipped.', input: { workoutId: 'string' } },
  remove_workout: { description: 'Delete a planned workout and its calendar entry.', input: { workoutId: 'string' } },
  complete_workout: { description: 'Mark a workout as completed; remaining sets count as done. Updates history, calendar and progress.', input: { workoutId: 'string' } },
  reschedule_workout: { description: 'Move a planned workout to another date.', input: { workoutId: 'string', toDate: 'YYYY-MM-DD' } },
  create_program: { description: 'Create a multi-week program with its sessions and calendar entries.', input: { program: 'Program', workouts: 'Workout[]', events: 'CalendarEvent[]', replaceProgramId: 'string?' } },
  cancel_program: { description: 'Cancel the active program and remove its future sessions.', input: { programId: 'string' } },
  create_nutrition_plan: { description: 'Set the day’s nutrition targets and suggested meals.', input: { plan: 'NutritionPlan' } },
  log_meal: { description: 'Add a meal (draft or logged) to the food journal.', input: { meal: 'LoggedMeal' } },
  update_meal: { description: 'Change a meal’s items, portion, slot or status.', input: { meal: 'LoggedMeal' } },
  delete_meal: { description: 'Remove a meal from the food journal.', input: { mealId: 'string' } },
  remember: { description: 'Save a durable fact about the user. Contradicting older memories are replaced.', input: { item: { category: 'MemoryCategory', text: 'string', source: 'conversation|inferred|user' } } },
  forget: { description: 'Delete a memory.', input: { memoryId: 'string' } },
  set_goal: { description: 'Create or update a goal (type, rank, optional target).', input: { goal: 'Goal' } },
  delete_goal: { description: 'Remove a goal.', input: { goalId: 'string' } },
  check_in: { description: 'Update today’s readiness check-in (fatigue, energy, sleep, soreness).', input: { patch: { fatigue: '1-10?', energy: '1-10?', sleepHours: 'number?', soreness: '1-10?' } } },
  move_event: { description: 'Move a calendar entry (and its workout) to another date.', input: { eventId: 'string', toDate: 'YYYY-MM-DD' } },
  create_event: { description: 'Add a calendar entry.', input: { event: 'CalendarEvent' } },
  update_event: { description: 'Change a calendar entry.', input: { eventId: 'string', patch: 'Partial<CalendarEvent>' } },
  delete_event: { description: 'Remove a calendar entry (and its planned workout).', input: { eventId: 'string' } },
  log_measurement: { description: 'Log a body measurement (weight, body fat, waist…).', input: { measurement: { type: 'MeasurementType', value: 'number', unit: 'string', date: 'YYYY-MM-DD' } } },
  update_coach: { description: 'Change the coach’s name or personality dials.', input: { patch: 'Partial<CoachConfig>' } },
  update_user: { description: 'Update profile fields (weight, equipment, diet, disliked exercises…).', input: { patch: 'Partial<UserProfile>' } },
  update_availability: { description: 'Change the persistent training schedule.', input: { patch: { daysPerWeek: 'number?', preferredDays: 'number[]?', sessionMinutes: 'number?' } } },
  notify: { description: 'Leave a note in the notification centre.', input: { title: 'string', body: 'string' } },
}

const READ_DESCRIPTORS: Array<{ name: ReadQuery['tool']; description: string; input: Record<string, unknown> }> = [
  { name: 'get_user_context', description: 'The full structured picture of the user: profile, goals, training, readiness, nutrition, progress, calendar, program, memory, conversation.', input: {} },
  { name: 'get_profile', description: 'Profile, equipment, availability and dietary preferences.', input: {} },
  { name: 'get_goals', description: 'Primary and secondary goals with progress.', input: {} },
  { name: 'get_goal', description: 'One goal by id, or the primary goal.', input: { goalId: 'string?' } },
  { name: 'get_today', description: 'What was planned, what happened, what was eaten and readiness today.', input: {} },
  { name: 'get_tomorrow', description: 'What is planned tomorrow and the targets.', input: {} },
  { name: 'get_day', description: 'Summary for any date.', input: { date: 'YYYY-MM-DD' } },
  { name: 'get_workout', description: 'A workout by id, or today’s / next planned one.', input: { workoutId: 'string?' } },
  { name: 'get_recent_workouts', description: 'Most recent completed workouts.', input: { limit: 'number?' } },
  { name: 'get_progress', description: 'Weight trend, consistency, weekly stats, personal records.', input: {} },
  { name: 'get_nutrition', description: 'Targets, consumed, remaining and meals for a date.', input: { date: 'YYYY-MM-DD?' } },
  { name: 'get_today_meals', description: 'Meals logged or drafted today.', input: {} },
  { name: 'get_remaining_nutrition', description: 'What is left of today’s calories and macros.', input: {} },
  { name: 'get_calendar', description: 'Calendar entries in a date range.', input: { from: 'YYYY-MM-DD?', to: 'YYYY-MM-DD?' } },
  { name: 'get_program', description: 'The active program, current week and next sessions.', input: {} },
  { name: 'get_memory', description: 'What the coach remembers, optionally by category.', input: { category: 'MemoryCategory?' } },
  { name: 'get_preferences', description: 'App preferences, coach name and personality.', input: {} },
  { name: 'get_readiness', description: 'Today’s readiness and check-in.', input: {} },
  { name: 'search_knowledge', description: 'Search the coaching knowledge base.', input: { query: 'string', limit: 'number?' } },
]

/** Every tool a model could be offered, as plain data. */
export function describeTools(): ToolDescriptor[] {
  return [
    ...READ_DESCRIPTORS.map((d) => ({ name: d.name, kind: 'read' as const, description: d.description, input: d.input })),
    ...(Object.keys(ACTION_DESCRIPTORS) as CoachActionType[]).map((name) => ({ name, kind: 'action' as const, ...ACTION_DESCRIPTORS[name] })),
  ]
}

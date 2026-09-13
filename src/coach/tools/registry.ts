import type { ActionRecord } from '@/domain/types'
import { hashString, uid } from '@/lib/utils'
import { useStore } from '@/store/useStore'
import { toolDefinitions } from '../model/toolDefinitions'
import type { CoachAction } from '../provider'
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
  /** Provenance when the call comes from the model loop. */
  toolCallId?: string
  via?: string
  arguments?: Record<string, unknown>
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
      return `${action.type}:${action.workout.id}:${hashString(JSON.stringify([action.workout.estimatedMinutes, action.workout.scheduledFor, action.workout.exercises.map((e) => [e.exerciseId, e.sets.map((x) => [x.targetReps, x.targetWeightKg, x.targetSeconds])])]))}`
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

function provenance(opts: ExecuteOptions): Pick<ActionRecord, 'toolCallId' | 'via' | 'arguments'> {
  const out: Pick<ActionRecord, 'toolCallId' | 'via' | 'arguments'> = {}
  if (opts.toolCallId) out.toolCallId = opts.toolCallId
  if (opts.via) out.via = opts.via
  if (opts.arguments && Object.keys(opts.arguments).length) {
    // Keep the audit log small: arguments are capped, never secrets (tools never receive keys).
    const json = JSON.stringify(opts.arguments)
    out.arguments = json.length > 2_000 ? { truncated: json.slice(0, 2_000) } : opts.arguments
  }
  return out
}

function recordOf(action: CoachAction, result: ToolResult<ActionData>, opts: ExecuteOptions): ActionRecord {
  const base = { id: uid('act'), tool: action.type, source: opts.source ?? 'coach', at: new Date().toISOString(), ...provenance(opts) }
  if (result.ok) return { ...base, ok: true, summary: result.data.summary, changes: result.changes, idempotent: result.idempotent }
  return { ...base, ok: false, summary: result.error.message, changes: [], error: result.error.code }
}

/** Execute one action through validation, idempotency and audit. Never throws. */
export function executeAction(action: CoachAction, opts: ExecuteOptions = {}): ActionRecord {
  const key = actionKey(action)
  const now = Date.now()
  const window = opts.repeatWindowMs ?? DEFAULT_WINDOW
  const seen = ledger.get(key)
  if (seen && now - seen.at < window && seen.record.ok) {
    const repeat: ActionRecord = { ...seen.record, id: uid('act'), at: new Date().toISOString(), idempotent: true, changes: [], ...provenance(opts) }
    useStore.getState().appendActionLog(repeat)
    return repeat
  }
  const result = runAction(action)
  const record = recordOf(action, result, opts)
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

/**
 * Every tool a model could be offered, as plain data. The definitions live in
 * one place (src/coach/model/toolDefinitions.ts); this is the same list in the
 * registry's descriptor shape.
 */
export function describeTools(): ToolDescriptor[] {
  return toolDefinitions().map((t) => ({ name: t.name, kind: t.kind, description: t.description, input: t.inputSchema as Record<string, unknown>, constraints: t.constraints }))
}

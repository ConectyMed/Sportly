import type { ActionRecord, CoachCard, Conversation, EntityRef } from '@/domain/types'
import { useStore } from '@/store/useStore'
import type { CoachReply } from '../provider'
import type { CoachModelOutput, ModelProvider, ModelStep, ToolCallResult } from './contract'
import { ProviderError } from './contract'
import { normalizeToolCall, runToolCall } from './modelTools'
import { buildModelInput, type ModelTurnRequest } from './prompt'

/**
 * The agentic loop, owned by Sportly (not by any provider):
 *
 *   input (fresh context) → model → tool calls → validate + execute + record
 *   → tool results → input (context rebuilt from the store) → model → … → final message
 *
 * Bounded by a maximum number of rounds and tool calls, and by a timeout per
 * model call. Whatever happens, the caller gets a reply plus the exact list of
 * actions that were really executed.
 */

export interface ModelTurnOptions {
  /** Model rounds per turn (each may carry several tool calls). */
  maxIterations?: number
  /** Total tool calls per turn. */
  maxToolCalls?: number
  /** Per model call. */
  timeoutMs?: number
  now?: Date
  onStatus?: (status: string) => void
}

export interface ModelTurnResult {
  reply: CoachReply
  /** Every action executed during the turn, in order. */
  records: ActionRecord[]
  steps: ModelStep[]
  iterations: number
  /** True when the loop stopped because a limit was reached rather than because the model finished. */
  limitReached: boolean
}

export const DEFAULT_LIMITS = { maxIterations: 6, maxToolCalls: 12, timeoutMs: 30_000 }

/** Make an untrusted provider result well-formed, or refuse it. */
export function normalizeModelOutput(raw: unknown): CoachModelOutput {
  if (!raw || typeof raw !== 'object') throw new ProviderError('malformed', 'The model returned no usable output.')
  const r = raw as Record<string, unknown>
  const message = typeof r.message === 'string' ? r.message.trim() : typeof r.text === 'string' ? r.text.trim() : ''
  const rawCalls = Array.isArray(r.toolCalls) ? r.toolCalls : Array.isArray(r.tool_calls) ? r.tool_calls : []
  const toolCalls = rawCalls.map((c, i) => normalizeToolCall(c, i)).filter((c): c is NonNullable<typeof c> => c !== null)
  if (!message && !toolCalls.length) throw new ProviderError('malformed', 'The model returned neither a message nor a tool call.')
  const references = Array.isArray(r.references) ? (r.references as EntityRef[]).filter((x) => x && typeof x.id === 'string' && typeof x.type === 'string') : undefined
  const suggestedFollowups = Array.isArray(r.suggestedFollowups) ? (r.suggestedFollowups as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 4) : undefined
  const stop = r.stop === 'tool_calls' || (r.stop === undefined && toolCalls.length) ? 'tool_calls' : 'end'
  return { message, toolCalls, references, suggestedFollowups, expects: typeof r.expects === 'string' ? (r.expects as CoachModelOutput['expects']) : undefined, stop }
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new ProviderError('timeout', `The model did not answer within ${Math.round(ms / 1000)} s.`))
    }, ms)
  })
  try {
    return await Promise.race([run(controller.signal), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function summarise(records: ActionRecord[]): string {
  const done = records.filter((r) => r.ok && !r.idempotent).map((r) => r.summary.replace(/\.$/, ''))
  return done.length ? `Done so far: ${done.join('; ')}.` : ''
}

export async function runModelTurn(provider: ModelProvider, conversationId: string | undefined, req: ModelTurnRequest, opts: ModelTurnOptions = {}): Promise<ModelTurnResult> {
  const limits = { ...DEFAULT_LIMITS, ...opts }
  const now = opts.now ?? new Date()
  const steps: ModelStep[] = []
  const records: ActionRecord[] = []
  const cards: CoachCard[] = []
  const references: EntityRef[] = []
  let calls = 0
  let lastMessage = ''

  const conversation = (): Conversation | undefined => {
    const s = useStore.getState()
    return conversationId ? s.conversations.find((c) => c.id === conversationId) : undefined
  }
  const finish = (output: Partial<CoachModelOutput>, limitReached: boolean, iterations: number): ModelTurnResult => {
    const failedLast = steps.at(-1)?.results.filter((r) => !r.ok) ?? []
    const text = output.message?.trim() || [summarise(records), limitReached ? 'I stopped there to keep things safe. Tell me what to do next.' : ''].filter(Boolean).join(' ') || 'I could not finish that. Nothing else was changed.'
    return {
      reply: { text, cards: cards.length ? cards : undefined, references: [...references, ...(output.references ?? [])], suggestions: output.suggestedFollowups, expects: output.expects, actions: [] },
      records,
      steps,
      iterations,
      limitReached: limitReached || failedLast.some((r) => r.error?.code === 'limit_reached'),
    }
  }

  for (let i = 0; i < limits.maxIterations; i++) {
    // Context is rebuilt from the store on every round: the model always sees the new reality.
    const input = buildModelInput(useStore.getState(), conversation(), req, steps, now)
    opts.onStatus?.(i === 0 ? 'Thinking' : 'Checking the result')
    const raw = await withTimeout((signal) => provider.complete(input, { signal }), limits.timeoutMs)
    const output = normalizeModelOutput(raw)
    lastMessage = output.message || lastMessage
    // Tool calls are executed whenever present; `stop` is informational (adapters set it from the calls).
    if (!output.toolCalls.length) return finish({ ...output, message: output.message || lastMessage }, false, i + 1)

    const results: ToolCallResult[] = []
    let halted = false
    for (const call of output.toolCalls) {
      if (halted) {
        results.push({ toolCallId: call.id, name: call.name, ok: false, error: { code: 'skipped', message: 'Not run because an earlier call in this batch failed.' }, affectedEntities: [], changes: [] })
        continue
      }
      if (calls >= limits.maxToolCalls) {
        results.push({ toolCallId: call.id, name: call.name, ok: false, error: { code: 'limit_reached', message: `Tool call limit (${limits.maxToolCalls}) reached for this turn.` }, affectedEntities: [], changes: [] })
        halted = true
        continue
      }
      calls++
      opts.onStatus?.(statusFor(call.name))
      const outcome = runToolCall(call, { conversation: conversation(), now })
      results.push(outcome.result)
      records.push(...outcome.records)
      if (outcome.contextPatch && conversationId) useStore.getState().updateConversationContext(conversationId, outcome.contextPatch)
      if (outcome.cards) cards.push(...outcome.cards)
      for (const e of outcome.result.affectedEntities) if (!references.some((r) => r.type === e.type && r.id === e.id)) references.push(e)
      // Dependencies: a failed call invalidates the rest of the batch (the model re-plans with the results).
      if (!outcome.result.ok) halted = true
    }
    steps.push({ assistant: { message: output.message, toolCalls: output.toolCalls }, results })
    if (results.some((r) => r.error?.code === 'limit_reached')) return finish({ message: lastMessage }, true, i + 1)
  }
  return finish({ message: lastMessage }, true, limits.maxIterations)
}

function statusFor(tool: string): string {
  if (tool.startsWith('get_') || tool === 'search_knowledge') return 'Checking your data'
  if (tool.includes('workout') || tool === 'plan_week') return 'Working on your workout'
  if (tool.includes('program')) return 'Designing your program'
  if (tool.includes('meal') || tool.includes('nutrition')) return 'Working on your food'
  return 'Applying that'
}

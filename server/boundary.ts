import { randomUUID } from 'node:crypto'
import { admitCall, type BudgetVerdict } from './budget/check'
import { DEFAULT_HOLD_USD, HOLD_TTL_MS, type DailyCaps } from './budget/caps'
import { asBoundaryError, BoundaryError, isBoundaryError } from './errors'
import { writeCallLog } from './log/callLog'
import type { ProviderResult, ProviderUsage } from './provider'
import type { BoundaryStore, ModelCallLogRow, Route, TaskType } from './store/port'

/**
 * The one path every model call takes:
 *
 *   cap checked (before anything is sent)
 *     → provider called, with a bounded retry on transient failures
 *       → log row written, on success AND on failure
 *
 * Nothing else in the codebase may call a provider directly. Everything that
 * makes a call has to come through here, which is what makes the log complete
 * and the cap real.
 */

const ZERO_USAGE: ProviderUsage = { tokensIn: 0, tokensCached: 0, tokensOut: 0 }

/** Only these are worth a second attempt; the rest are answers, not hiccups. */
const RETRYABLE = new Set(['PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'RATE_LIMITED'])

export interface ModelCallDescriptor<T> {
  route: Route
  taskType: TaskType
  provider: string
  model: string
  /** The actual provider call. Called once per attempt. */
  invoke: () => Promise<ProviderResult<T>>
}

export interface RunModelCallContext {
  store: BoundaryStore
  subjectId: string
  caps: DailyCaps
  requestId?: string
  /** Attempts beyond the first, for transient provider failures. Default 1. */
  maxRetries?: number
  now?: () => Date
  /** Elapsed-time clock. Defaults to performance.now(), which wall-clock jumps cannot distort. */
  monotonic?: () => number
  /** Per-route worst-case cost held during a call. Defaults to DEFAULT_HOLD_USD. */
  holdUsd?: Partial<DailyCaps>
  holdTtlMs?: number
}

export interface ModelCallSuccess<T> {
  ok: true
  requestId: string
  output: T
  budget: BudgetVerdict
  log: ModelCallLogRow
}

/**
 * Run a model call through the boundary.
 *
 * Throws BoundaryError on every failure path. The log row is already written
 * by then — including when the provider failed, which is the case that matters
 * most for spotting an outage or a runaway retry.
 */
export async function runModelCall<T>(ctx: RunModelCallContext, call: ModelCallDescriptor<T>): Promise<ModelCallSuccess<T>> {
  const now = ctx.now ?? (() => new Date())
  const monotonic = ctx.monotonic ?? (() => performance.now())
  const requestId = ctx.requestId ?? randomUUID()
  const maxRetries = ctx.maxRetries ?? 1

  // 1. Admission first: the model must be priced, and the cap must have room.
  //    Nothing has been sent yet, and nothing will be if this throws. Admission
  //    also takes a hold, so concurrent calls cannot all pass the same check.
  const budget = await admitCall({
    store: ctx.store,
    subjectId: ctx.subjectId,
    route: call.route,
    model: call.model,
    caps: ctx.caps,
    holdUsd: ctx.holdUsd?.[call.route] ?? DEFAULT_HOLD_USD[call.route],
    holdTtlMs: ctx.holdTtlMs ?? HOLD_TTL_MS,
    now: now(),
  })

  // 2. Provider, with a bounded retry on transient failures only.
  const startedAt = monotonic()
  let retryCount = 0
  let result: ProviderResult<T> | undefined
  let failure: BoundaryError | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      result = await call.invoke()
      failure = undefined
      break
    } catch (err) {
      failure = asBoundaryError(err)
      if (attempt < maxRetries && RETRYABLE.has(failure.code)) {
        retryCount += 1
        continue
      }
      break
    }
  }

  const latencyMs = Math.max(0, monotonic() - startedAt)

  // 3. Log, whichever way it went, and release the hold with the row. A failed
  //    call still costs tokens sometimes, and always costs latency and a retry
  //    budget.
  //
  //    Known under-count: only the winning attempt's usage is reported. A
  //    retried attempt that burned input tokens upstream before failing has no
  //    way to tell us — ProviderResult only exists on success — so its tokens
  //    are missing from cost_usd. retry_count makes the gap visible in the log.
  const usage = result?.usage ?? ZERO_USAGE
  const log = await writeCallLog(ctx.store, budget.holdId, {
    subjectId: ctx.subjectId,
    requestId,
    route: call.route,
    provider: call.provider,
    model: result?.model ?? call.model,
    taskType: call.taskType,
    tokensIn: usage.tokensIn,
    tokensCached: usage.tokensCached,
    tokensOut: usage.tokensOut,
    latencyMs,
    retryCount,
    outcome: failure ? 'error' : 'success',
    errorCategory: failure ? failure.code : null,
    at: now(),
  })

  if (failure) throw failure
  if (!result) throw new BoundaryError('PROVIDER_UNAVAILABLE', 'The provider returned no result.')
  return { ok: true, requestId, output: result.output, budget, log }
}

export { isBoundaryError }

import { randomUUID } from 'node:crypto'
import { admitCall, type BudgetVerdict } from './budget/check'
import { DEFAULT_HOLD_USD, HOLD_TTL_MS, PROVIDER_DEADLINE_MS, type DailyCaps } from './budget/caps'
import { asBoundaryError, BoundaryError, isBoundaryError } from './errors'
import { writeCallLog } from './log/callLog'
import type { ProviderCallOptions, ProviderResult, ProviderUsage } from './provider'
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
  /**
   * The actual provider call. Called once per attempt, with an abort signal
   * that fires at the boundary's deadline; an adapter that ignores the signal
   * is still timed out, it just cannot stop its own request.
   */
  invoke: (options: ProviderCallOptions) => Promise<ProviderResult<T>>
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
  /** Whole provider phase, all attempts. Defaults to PROVIDER_DEADLINE_MS. */
  providerDeadlineMs?: number
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

  // 2. Provider, with a bounded retry on transient failures only, under one
  //    deadline for the whole phase. The deadline is what turns "the provider
  //    hung" into a settled row with PROVIDER_TIMEOUT rather than a hold left
  //    for the TTL — it sits inside the function's maximum duration so the
  //    settle below still has time to run. See server/budget/caps.ts.
  const startedAt = monotonic()
  const deadline = startedAt + (ctx.providerDeadlineMs ?? PROVIDER_DEADLINE_MS)
  let retryCount = 0
  let result: ProviderResult<T> | undefined
  let failure: BoundaryError | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    // The first attempt has the whole deadline by definition; only a retry
    // needs to ask the clock how much of it is left.
    const remainingMs = attempt === 0 ? deadline - startedAt : deadline - monotonic()
    if (remainingMs <= 0) {
      failure = new BoundaryError('PROVIDER_TIMEOUT', 'The provider did not answer within the boundary deadline.')
      break
    }
    try {
      result = await withDeadline(call.invoke, remainingMs)
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

  // Whole milliseconds: performance.now() is fractional, and latency_ms is an
  // integer column. An unrounded value made every real settle fail with
  // PERSISTENCE_FAILURE — no row, and a hold left standing until its TTL.
  const latencyMs = Math.max(0, Math.round(monotonic() - startedAt))

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

/**
 * Run one attempt under a deadline. The signal lets a cooperative adapter
 * cancel its HTTP request; the race is what bounds an adapter that does not.
 */
async function withDeadline<T>(invoke: (options: ProviderCallOptions) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  const timedOut = () => new BoundaryError('PROVIDER_TIMEOUT', 'The provider did not answer within the boundary deadline.')
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(timedOut())
    }, ms)
  })
  // An adapter that honours the signal rejects with its own abort error, and
  // usually before the timer's rejection lands. Once the signal has fired,
  // whatever the adapter threw *is* the timeout.
  const attempt = invoke({ signal: controller.signal }).catch((err: unknown) => {
    throw controller.signal.aborted ? timedOut() : err
  })
  try {
    return await Promise.race([attempt, expired])
  } finally {
    clearTimeout(timer)
  }
}

export { isBoundaryError }

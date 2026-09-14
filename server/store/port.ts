import type { BoundaryErrorCode } from '../errors'

/** Which product surface spent the money. Caps are configured per route. */
export type Route = 'food_scan' | 'coaching' | 'program'

export const ROUTES: readonly Route[] = ['food_scan', 'coaching', 'program']

export function isRoute(value: unknown): value is Route {
  return typeof value === 'string' && (ROUTES as readonly string[]).includes(value)
}

export type TaskType = 'vision' | 'text'

export type CallOutcome = 'success' | 'error'

/**
 * One row of the model-call log.
 *
 * Deliberately absent: the prompt, the image, the response, the API key, the
 * user's food, anything a person wrote. This table answers "what did we spend
 * and did it work", not "what did the user say".
 */
export interface ModelCallLogRow {
  /** ISO-8601 UTC. */
  ts: string
  subjectId: string
  requestId: string
  route: Route
  provider: string
  model: string
  taskType: TaskType
  tokensIn: number
  tokensCached: number
  tokensOut: number
  /** null when the model is not in the rate table — never 0 as a stand-in. */
  costUsd: number | null
  /** True exactly when costUsd is null because the model was unknown. */
  costUnknownModel: boolean
  latencyMs: number
  retryCount: number
  outcome: CallOutcome
  errorCategory: BoundaryErrorCode | null
}

export type BindSubjectResult = 'bound' | 'already_bound'

export interface SpendAdmissionRequest {
  subjectId: string
  route: Route
  /** UTC day the cap applies to. */
  day: string
  capUsd: number
  /** Worst case this one call is assumed to cost, held until it settles. */
  holdUsd: number
  nowMs: number
  /** Holds older than this are treated as abandoned and stop counting. */
  holdTtlMs: number
}

export interface SpendAdmission {
  admitted: boolean
  /** Committed spend plus live holds, at the moment of the decision. */
  spentUsd: number
  /** Pass back to settleSpend. Null when the call was refused. */
  holdId: string | null
}

/**
 * The storage port.
 *
 * Five operations, named after what the boundary actually does — not CRUD over
 * tables. Every one is scoped by subject, so a caller cannot express a
 * cross-subject read or write: isolation is a property of the port's shape,
 * not of a policy someone remembered to apply.
 *
 * Postgres, Neon and Supabase all sit behind this. Feature code never sees SQL.
 */
export interface BoundaryStore {
  /**
   * Bind a subject on first token mint. Returns 'already_bound' if this subject
   * has a token already — the server mints exactly one token per subject, which
   * is what keeps trust-on-first-use from becoming trust-on-every-request.
   */
  bindSubjectOnce(subjectId: string, atIso: string): Promise<BindSubjectResult>

  /** Rate-limit the mint endpoint; it creates rows. False means refuse. */
  admitMintAttempt(key: string, nowMs: number): Promise<boolean>

  /**
   * Decide and reserve in one atomic step, BEFORE the provider is called.
   *
   * A plain read-then-check cannot cap anything: N requests in flight all read
   * the same spend, all pass, and all spend. So admission counts committed
   * spend plus the holds taken by calls that have not settled yet, and takes a
   * hold of its own — which bounds concurrent spend to roughly cap + holdUsd
   * rather than to cap × concurrency.
   */
  admitSpend(request: SpendAdmissionRequest): Promise<SpendAdmission>

  /**
   * Write the call-log row and release its hold, together. Called on success
   * and on failure alike. `holdId` is null for a row written outside an
   * admission (tests, backfills).
   */
  settleSpend(holdId: string | null, row: ModelCallLogRow): Promise<void>

  /** A subject's own log rows, newest first. `day` filters to one UTC day. */
  readCallLog(subjectId: string, day?: string): Promise<ModelCallLogRow[]>

  /**
   * Committed spend for this subject, route and day, in USD — settled rows
   * only, no holds. Rows with a null cost (an unknown model) contribute
   * nothing; the boundary refuses to call an unpriced model on a capped route
   * precisely so that this cannot become a way to spend uncounted money.
   */
  spendTodayUsd(subjectId: string, route: Route, day: string): Promise<number>
}

/** UTC day key, `YYYY-MM-DD`. The unit the caps are expressed in. */
export function utcDay(at: Date | number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10)
}

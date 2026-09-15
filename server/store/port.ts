import type { BoundaryErrorCode } from '../errors.js'

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
  /**
   * Holds older than this are abandoned and stop counting. See "Hold
   * lifecycle" below and `HOLD_TTL_MS` in server/budget/caps.ts for how the
   * number is chosen.
   */
  holdTtlMs: number
}

/**
 * Hold lifecycle — what happens when a hold is never resolved.
 *
 * A hold is taken by one function invocation, before the provider is called,
 * and released by `settleSpend` in the same invocation. Three things can stop
 * the release from ever running:
 *
 *   - the platform kills the invocation at its maximum duration;
 *   - the provider call hangs past the boundary's own deadline (the boundary
 *     aborts it and still settles, but the abort itself can be what the
 *     platform kills);
 *   - the process dies between admission and the settle statement.
 *
 * In every case the hold row is orphaned with its money still counted in the
 * bucket. The contract every adapter has to honour:
 *
 *   1. **Holds expire.** A hold whose `taken_at` is older than `holdTtlMs` at
 *      the moment of an admission decision no longer counts toward that
 *      decision, and its reservation is given back to the bucket. The TTL is
 *      chosen above the function's maximum duration: past that point the
 *      invocation that took the hold cannot still be running, so nobody is
 *      left to settle it.
 *   2. **Reconciliation is idempotent.** `settleSpend` is keyed on the row's
 *      `requestId`. Settling the same call twice (a retried settle, a replayed
 *      request) writes one log row and commits its cost once. Settling a hold
 *      that expiry already reclaimed commits the cost but does not give the
 *      reservation back a second time.
 *
 * The in-memory adapter implements the same rules so the logic can be tested
 * without a database; only the Postgres adapter proves they hold under
 * concurrency — see "Storage engines" at the bottom of this file.
 */

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
  /** Which engine backs this store. See `requireRealStorageEngine`. */
  readonly engine: StorageEngine

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
   *
   * Idempotent on `row.requestId`: a second settle for the same request is a
   * no-op — no second row, no second charge, no second release.
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

/**
 * Storage engines, and what each one is allowed to prove.
 *
 * `memory` — the in-memory adapter. It exists to test *logic*: that the
 * boundary takes a hold before the call, releases it with the row, refuses an
 * unpriced model, expires a dead hold, settles idempotently. It proves nothing
 * about any property the storage engine itself provides — atomicity,
 * isolation, ordering, constraints. JavaScript is single-threaded, so twenty
 * "concurrent" admissions against a Map are serialised for free, and the
 * adapter would pass a concurrency test with a read-then-check gate that
 * Postgres admits 5, 14 and 7 of 20 through (measured; see the migration
 * header). A check constraint it does not enforce, a unique index it does not
 * have, a row lock it never takes — none of that is exercised.
 *
 * `postgres` — the deployed path. The only engine a test may use to claim
 * anything about concurrency, uniqueness or constraints.
 *
 * A test that asserts an engine property must call `requireRealStorageEngine`
 * on its store first, so that pointing it at the in-memory adapter fails
 * loudly instead of passing vacuously.
 */
export type StorageEngine = 'memory' | 'postgres'

export function requireRealStorageEngine(store: Pick<BoundaryStore, 'engine'>, what = 'this test'): void {
  if (store.engine === 'memory') {
    throw new Error(
      `${what} asserts a property of the storage engine (atomicity, isolation, ordering or constraints), ` +
        'and is pointed at the in-memory adapter, which provides none of them. It would pass no matter what the ' +
        'deployed path does. Run it against Postgres: set SPORTLY_TEST_DATABASE_URL (see server/__tests__/pg.ts).',
    )
  }
}

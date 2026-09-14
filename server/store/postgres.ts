import { BoundaryError } from '../errors'
import type { BindSubjectResult, BoundaryStore, ModelCallLogRow, Route } from './port'

/**
 * Postgres adapter.
 *
 * It talks to the database through a one-method `SqlExecutor` rather than
 * importing a driver. That keeps the driver choice (node-postgres, Neon's
 * serverless client, Supabase's pooler) out of the repo's dependency graph
 * until a deploy actually needs one, and it keeps this file testable without a
 * database.
 *
 * Wiring it up is a few lines at the deploy edge, e.g.:
 *
 *   import { neon } from '@neondatabase/serverless'
 *   const sql = neon(env.databaseUrl)
 *   const store = createPostgresStore((text, params) => sql.query(text, params))
 *
 * Every statement is parameterised and every one filters by subject_id. There
 * is no code path here that reads or writes across subjects.
 */
export interface SqlResult<Row> {
  rows: Row[]
}

export type SqlExecutor = <Row = Record<string, unknown>>(text: string, params: unknown[]) => Promise<SqlResult<Row>>

export interface PostgresStoreOptions {
  mintLimit?: number
  mintWindowMs?: number
}

interface LogRowShape {
  ts: Date | string
  subject_id: string
  request_id: string
  route: string
  provider: string
  model: string
  task_type: string
  tokens_in: number | string
  tokens_cached: number | string
  tokens_out: number | string
  cost_usd: number | string | null
  cost_unknown_model: boolean
  latency_ms: number | string
  retry_count: number | string
  outcome: string
  error_category: string | null
}

const int = (v: number | string): number => (typeof v === 'number' ? v : Number.parseInt(v, 10))

function toRow(r: LogRowShape): ModelCallLogRow {
  return {
    ts: typeof r.ts === 'string' ? r.ts : r.ts.toISOString(),
    subjectId: r.subject_id,
    requestId: r.request_id,
    route: r.route as ModelCallLogRow['route'],
    provider: r.provider,
    model: r.model,
    taskType: r.task_type as ModelCallLogRow['taskType'],
    tokensIn: int(r.tokens_in),
    tokensCached: int(r.tokens_cached),
    tokensOut: int(r.tokens_out),
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    costUnknownModel: r.cost_unknown_model,
    latencyMs: int(r.latency_ms),
    retryCount: int(r.retry_count),
    outcome: r.outcome as ModelCallLogRow['outcome'],
    errorCategory: r.error_category as ModelCallLogRow['errorCategory'],
  }
}

/**
 * A driver error is a persistence failure, not an unhandled crash.
 *
 * The message is kept for server-side logs but marked NOT client-safe: a
 * node-postgres or Neon error routinely carries the host, port, database and
 * user, and on an auth failure the connection string itself. `publicMessage`
 * replaces it with the category's opaque text on the way out.
 */
async function guard<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof BoundaryError) throw err
    throw new BoundaryError('PERSISTENCE_FAILURE', `${what} failed: ${err instanceof Error ? err.message : String(err)}`, undefined, false)
  }
}

export function createPostgresStore(sql: SqlExecutor, options: PostgresStoreOptions = {}): BoundaryStore {
  const mintLimit = options.mintLimit ?? 5
  const mintWindowMs = options.mintWindowMs ?? 60 * 60 * 1000

  return {
    async bindSubjectOnce(subjectId: string, atIso: string): Promise<BindSubjectResult> {
      // ON CONFLICT DO NOTHING makes the one-token-per-subject rule atomic:
      // two concurrent mints cannot both see an unbound subject.
      const res = await guard('bindSubjectOnce', () =>
        sql<{ subject_id: string }>('insert into sportly_subject (subject_id, bound_at) values ($1, $2) on conflict (subject_id) do nothing returning subject_id', [subjectId, atIso]),
      )
      return res.rows.length ? 'bound' : 'already_bound'
    },

    async admitMintAttempt(key: string, nowMs: number): Promise<boolean> {
      const since = new Date(nowMs - mintWindowMs).toISOString()
      // Every CTE in a statement reads one snapshot, so under READ COMMITTED
      // concurrent callers would all count the pre-insert state and all be
      // admitted. The transaction-scoped advisory lock serialises callers that
      // share a key, which is exactly the set that can race each other.
      const res = await guard('admitMintAttempt', () =>
        sql<{ admitted: boolean }>(
          `with locked as (
             select pg_advisory_xact_lock(hashtext('sportly_mint:' || $1)) as got
           ), pruned as (
             delete from sportly_mint_attempt
             where attempt_key = $1 and attempted_at <= $2 and (select got is not null from locked)
             returning 1
           ), recent as (
             select count(*)::int as n from sportly_mint_attempt
             where attempt_key = $1 and attempted_at > $2 and (select count(*) from pruned) >= 0
           ), ins as (
             insert into sportly_mint_attempt (attempt_key, attempted_at)
             select $1, $3 from recent where n < $4
             returning 1
           )
           select exists (select 1 from ins) as admitted`,
          [key, since, new Date(nowMs).toISOString(), mintLimit],
        ),
      )
      return res.rows[0]?.admitted === true
    },

    async admitSpend(request) {
      // Same serialisation problem, same remedy: one advisory lock per
      // (subject, route, day) so committed spend and live holds are counted
      // and the new hold is taken without another caller slipping between.
      const bucket = `sportly_spend:${request.subjectId}:${request.route}:${request.day}`
      const staleBefore = new Date(request.nowMs - request.holdTtlMs).toISOString()
      const res = await guard('admitSpend', () =>
        sql<{ admitted: boolean; spent: string | number | null; hold_id: string | null }>(
          `with locked as (
             select pg_advisory_xact_lock(hashtext($1)) as got
           ), expired as (
             delete from sportly_spend_hold
             where taken_at <= $2 and (select got is not null from locked)
             returning 1
           ), spent as (
             select
               coalesce((
                 select sum(cost_usd) from sportly_model_call_log
                 where subject_id = $3 and route = $4 and ts >= $5::timestamptz and ts < $5::timestamptz + interval '1 day'
               ), 0)
               + coalesce((
                 select sum(hold_usd) from sportly_spend_hold
                 where subject_id = $3 and route = $4 and day = $5::date
               ), 0)
               + (select count(*) from expired) * 0 as total
           ), ins as (
             insert into sportly_spend_hold (subject_id, route, day, hold_usd, taken_at)
             select $3, $4, $5::date, $6, $7 from spent where total < $8
             returning hold_id
           )
           select (select count(*) from ins) > 0 as admitted,
                  (select total from spent) as spent,
                  (select hold_id::text from ins) as hold_id`,
          [bucket, staleBefore, request.subjectId, request.route, request.day, request.holdUsd, new Date(request.nowMs).toISOString(), request.capUsd],
        ),
      )
      const row = res.rows[0]
      return { admitted: row?.admitted === true, spentUsd: Number(row?.spent ?? 0), holdId: row?.hold_id ?? null }
    },

    async settleSpend(holdId: string | null, row: ModelCallLogRow): Promise<void> {
      await guard('settleSpend', () =>
        sql(
          `with ins as (
             insert into sportly_model_call_log
             (ts, subject_id, request_id, route, provider, model, task_type,
              tokens_in, tokens_cached, tokens_out, cost_usd, cost_unknown_model,
              latency_ms, retry_count, outcome, error_category)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             returning 1
           )
           delete from sportly_spend_hold
           where $17::uuid is not null and hold_id = $17::uuid and (select count(*) from ins) = 1`,
          [
            row.ts, row.subjectId, row.requestId, row.route, row.provider, row.model, row.taskType,
            row.tokensIn, row.tokensCached, row.tokensOut, row.costUsd, row.costUnknownModel,
            row.latencyMs, row.retryCount, row.outcome, row.errorCategory, holdId,
          ],
        ),
      )
    },

    async readCallLog(subjectId: string, day?: string): Promise<ModelCallLogRow[]> {
      const res = await guard('readCallLog', () =>
        day === undefined
          ? sql<LogRowShape>('select * from sportly_model_call_log where subject_id = $1 order by ts desc', [subjectId])
          : sql<LogRowShape>("select * from sportly_model_call_log where subject_id = $1 and ts >= $2::timestamptz and ts < $2::timestamptz + interval '1 day' order by ts desc", [subjectId, day]),
      )
      return res.rows.map(toRow)
    },

    async spendTodayUsd(subjectId: string, route: Route, day: string): Promise<number> {
      // coalesce(sum(...), 0) sums only priced rows: a null cost_usd (unknown
      // model) is skipped by sum() rather than counted as zero spend.
      // A range predicate on ts, not a cast — an expression like
      // (ts at time zone 'UTC')::date cannot use the (subject_id, route, ts) index.
      const res = await guard('spendTodayUsd', () =>
        sql<{ spend: string | number | null }>(
          `select coalesce(sum(cost_usd), 0) as spend from sportly_model_call_log
           where subject_id = $1 and route = $2 and ts >= $3::timestamptz and ts < $3::timestamptz + interval '1 day'`,
          [subjectId, route, day],
        ),
      )
      return Number(res.rows[0]?.spend ?? 0)
    },
  }
}

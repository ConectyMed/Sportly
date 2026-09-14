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
      const now = new Date(nowMs).toISOString()
      const windowStart = new Date(nowMs - mintWindowMs).toISOString()
      await guard('admitMintAttempt.ensure', () =>
        sql('insert into sportly_mint_bucket (attempt_key, window_start, n) values ($1, $2, 0) on conflict (attempt_key) do nothing', [key, now]),
      )
      // The gate. One UPDATE, condition in the WHERE: a caller that blocks on
      // the row lock re-checks `n` against the committed row, so concurrent
      // callers cannot all pass the same count.
      const res = await guard('admitMintAttempt', () =>
        sql<{ n: number }>(
          `update sportly_mint_bucket
              set n = case when window_start <= $2 then 1 else n + 1 end,
                  window_start = case when window_start <= $2 then $3 else window_start end
            where attempt_key = $1 and (window_start <= $2 or n < $4)
            returning n`,
          [key, windowStart, now, mintLimit],
        ),
      )
      return res.rows.length > 0
    },

    async admitSpend(request) {
      const takenAt = new Date(request.nowMs).toISOString()
      const ensure = () =>
        guard('admitSpend.ensure', () =>
          sql('insert into sportly_spend_bucket (subject_id, route, day) values ($1, $2, $3::date) on conflict (subject_id, route, day) do nothing', [
            request.subjectId,
            request.route,
            request.day,
          ]),
        )

      /**
       * The gate, and the reason the cap survives concurrency.
       *
       * `held_usd + committed_usd < cap` lives in the UPDATE's WHERE clause,
       * not in a SELECT that ran beforehand. When two callers race, the second
       * blocks on the first's row lock and Postgres re-evaluates the condition
       * against the row the first committed. A read-then-check — including one
       * wrapped in an advisory lock — cannot do this: the statement snapshot
       * predates the lock, so the re-read sees stale state.
       *
       * The hold row is inserted in the same statement, from the gate's own
       * RETURNING, so a hold exists if and only if the bucket was charged.
       */
      const gate = () =>
        guard('admitSpend', () =>
          sql<{ admitted: boolean; spent: string | number | null; hold_id: string | null }>(
            `with gate as (
               update sportly_spend_bucket
                  set held_usd = held_usd + $4
                where subject_id = $1 and route = $2 and day = $3::date
                  and held_usd + committed_usd < $5
               returning held_usd, committed_usd
             ), ins as (
               insert into sportly_spend_hold (subject_id, route, day, hold_usd, taken_at)
               select $1, $2, $3::date, $4, $6 from gate
               returning hold_id
             )
             select (select count(*) from gate) > 0 as admitted,
                    coalesce(
                      (select held_usd + committed_usd - $4 from gate),
                      (select held_usd + committed_usd from sportly_spend_bucket where subject_id = $1 and route = $2 and day = $3::date),
                      0
                    ) as spent,
                    (select hold_id::text from ins) as hold_id`,
            [request.subjectId, request.route, request.day, request.holdUsd, request.capUsd, takenAt],
          ),
        )

      /** Give a dead request's reservation back to its bucket. */
      const reclaimStale = () =>
        guard('admitSpend.reclaim', () =>
          sql(
            `with expired as (
               delete from sportly_spend_hold where taken_at <= $1
               returning subject_id, route, day, hold_usd
             ), agg as (
               select subject_id, route, day, sum(hold_usd) as total from expired group by 1, 2, 3
             )
             update sportly_spend_bucket b
                set held_usd = greatest(0, b.held_usd - agg.total)
               from agg
              where b.subject_id = agg.subject_id and b.route = agg.route and b.day = agg.day`,
            [new Date(request.nowMs - request.holdTtlMs).toISOString()],
          ),
        )

      await ensure()
      let res = await gate()
      if (res.rows[0]?.admitted !== true) {
        // Only worth sweeping when we are actually at the cap, so the happy
        // path stays at two statements.
        await reclaimStale()
        res = await gate()
      }
      const row = res.rows[0]
      return { admitted: row?.admitted === true, spentUsd: Number(row?.spent ?? 0), holdId: row?.hold_id ?? null }
    },

    async settleSpend(holdId: string | null, row: ModelCallLogRow): Promise<void> {
      // One statement: the row lands, its reservation is returned to the
      // bucket, and the real cost is committed. The bucket update is relative
      // (+/-) and row-locked, so concurrent settles compose correctly.
      //
      // A null cost (an unknown model) commits nothing — which is safe only
      // because admission refuses unpriced models up front; see
      // server/budget/check.ts.
      await guard('settleSpend', () =>
        sql(
          `with ins as (
             insert into sportly_model_call_log
               (ts, subject_id, request_id, route, provider, model, task_type,
                tokens_in, tokens_cached, tokens_out, cost_usd, cost_unknown_model,
                latency_ms, retry_count, outcome, error_category)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             returning 1
           ), rel as (
             delete from sportly_spend_hold
             where $17::uuid is not null and hold_id = $17::uuid
             returning hold_usd
           )
           update sportly_spend_bucket b
              set held_usd = greatest(0, b.held_usd - coalesce((select hold_usd from rel), 0)),
                  committed_usd = b.committed_usd + coalesce($11, 0)
            where b.subject_id = $2 and b.route = $4
              and b.day = ($1::timestamptz at time zone 'UTC')::date
              and (select count(*) from ins) = 1`,
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

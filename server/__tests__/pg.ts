import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { createPostgresStore, type SqlExecutor } from '../store/postgres.js'
import { requireRealStorageEngine, type BoundaryStore } from '../store/port.js'

/**
 * Real-Postgres test suites.
 *
 * These are not opt-in. CI runs them on every push against a Postgres service
 * container (.github/workflows/ci.yml), and a checkout without a database
 * FAILS them rather than skipping: a suite that silently skips the one
 * property the in-memory adapter cannot prove — that the cap holds under
 * concurrency — would let that property drift back to broken unnoticed.
 *
 * Locally:
 *
 *   createdb sportly_test
 *   for f in migrations/*.sql; do psql -d sportly_test -v ON_ERROR_STOP=1 -f "$f"; done
 *   export SPORTLY_TEST_DATABASE_URL=postgres://…/sportly_test
 *   node scripts/ingest-ciqual.mjs apply --in data/ciqual
 *   node scripts/seed-food-synonyms.mjs apply --in data/food-matching/synonyms.fr.json
 *   pnpm test:unit
 *
 * To skip them knowingly — and only then — set SPORTLY_SKIP_POSTGRES_TESTS=1.
 * The skip is visible in the run summary; CI never sets it.
 *
 * One database, several suites, parallel workers: every suite truncates
 * tables before each test, so two suites running at once would truncate each
 * other's rows mid-test. A session-level advisory lock, taken for the whole
 * suite, serialises them at the database — the one place all the workers
 * meet — rather than depending on how vitest happens to schedule files.
 */
export const TEST_DATABASE_URL = process.env.SPORTLY_TEST_DATABASE_URL

const SKIP_EXPLICITLY = process.env.SPORTLY_SKIP_POSTGRES_TESTS === '1'

export interface PgFixture {
  pool: Pool
  sql: SqlExecutor
  store: BoundaryStore
}

/** Any fixed key; every real-Postgres suite takes the same one. */
const SUITE_LOCK_KEY = 0x5b0071
/** Waiting for the suites ahead in the queue, each a few seconds long. */
const SUITE_LOCK_TIMEOUT_MS = 180_000

/**
 * Declare a suite that runs against the real database. The fixture's tables
 * are truncated before every test, and the store is checked to be a real
 * engine before any test runs, so this file can never be pointed at the
 * in-memory adapter by a later refactor and keep passing.
 */
export function describePostgres(name: string, suite: (pg: PgFixture) => void): void {
  if (!TEST_DATABASE_URL) {
    if (SKIP_EXPLICITLY) {
      describe.skip(`${name} (skipped: SPORTLY_SKIP_POSTGRES_TESTS=1)`, () => {})
      return
    }
    describe(name, () => {
      it('runs against a real Postgres', () => {
        throw new Error(
          'SPORTLY_TEST_DATABASE_URL is not set. This suite proves a property of the storage engine and refuses to ' +
            'pass without one. Point it at a database with migrations/*.sql applied, or set SPORTLY_SKIP_POSTGRES_TESTS=1 ' +
            'to skip it knowingly (never in CI).',
        )
      })
    })
    return
  }

  describe(name, () => {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 25 })
    const sql = (async (text: string, params: unknown[]) => pool.query(text, params)) as SqlExecutor
    const store = createPostgresStore(sql)
    const fixture: PgFixture = { pool, sql, store }
    let lockHolder: PoolClient | undefined

    beforeAll(async () => {
      requireRealStorageEngine(store, name)
      // Held on its own connection for the suite's lifetime; released in afterAll or when the session ends.
      lockHolder = await pool.connect()
      await lockHolder.query('select pg_advisory_lock($1)', [SUITE_LOCK_KEY])
    }, SUITE_LOCK_TIMEOUT_MS)
    afterAll(async () => {
      try {
        await lockHolder?.query('select pg_advisory_unlock($1)', [SUITE_LOCK_KEY])
      } finally {
        lockHolder?.release()
        await pool.end()
      }
    })
    beforeEach(async () => {
      await pool.query('truncate sportly_spend_hold, sportly_model_call_log, sportly_spend_bucket, sportly_mint_bucket, sportly_subject')
    })

    suite(fixture)
  })
}

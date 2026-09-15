import { Pool } from 'pg'
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
 *   psql -d sportly_test -f migrations/0001_model_call_log.sql
 *   psql -d sportly_test -f migrations/0002_hold_lifecycle.sql
 *   SPORTLY_TEST_DATABASE_URL=postgres://…/sportly_test pnpm test:unit
 *
 * To skip them knowingly — and only then — set SPORTLY_SKIP_POSTGRES_TESTS=1.
 * The skip is visible in the run summary; CI never sets it.
 */
export const TEST_DATABASE_URL = process.env.SPORTLY_TEST_DATABASE_URL

const SKIP_EXPLICITLY = process.env.SPORTLY_SKIP_POSTGRES_TESTS === '1'

export interface PgFixture {
  pool: Pool
  sql: SqlExecutor
  store: BoundaryStore
}

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

    beforeAll(() => requireRealStorageEngine(store, name))
    afterAll(() => pool.end())
    beforeEach(async () => {
      await pool.query('truncate sportly_spend_hold, sportly_model_call_log, sportly_spend_bucket, sportly_mint_bucket, sportly_subject')
    })

    suite(fixture)
  })
}

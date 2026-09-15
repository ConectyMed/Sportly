import { neon } from '@neondatabase/serverless'
import { Pool } from 'pg'
import type { SqlExecutor } from './postgres.js'

/**
 * The one place a Postgres driver is named.
 *
 * Two drivers, chosen by the connection string, because a serverless function
 * and a long-lived process want opposite things:
 *
 * - **Neon (HTTP).** `neon()` sends each statement as a stateless HTTPS
 *   request. No socket is opened, nothing is held between invocations, and a
 *   burst of concurrent function instances cannot exhaust the database's
 *   connection limit. This is the right default on Vercel, and it is only
 *   viable because every operation in `postgres.ts` is a single statement —
 *   HTTP mode gives each one its own implicit transaction and cannot span
 *   several. Keep it that way: an operation that needs a multi-statement
 *   transaction must not be added without moving to the WebSocket pool.
 *
 * - **Everything else (TCP pool).** Plain Postgres and Supabase get
 *   node-postgres. The pool is module-scoped so a warm function instance
 *   reuses it rather than opening a connection per invocation. Point this at a
 *   *pooled* endpoint (PgBouncer in transaction mode, e.g. Supabase's `:6543`
 *   pooler) — a direct endpoint will run out of connections under
 *   concurrency. Transaction-mode pooling is safe here for the same reason:
 *   one statement, one transaction, no session state carried across requests.
 */
let pool: Pool | undefined

const isNeonHttpUrl = (url: string): boolean => /(^|[@.])neon\.tech[:/]?/i.test(url) || /\.neon\.build[:/]?/i.test(url)

export function createPgExecutor(connectionString: string, options: { max?: number; forceTcp?: boolean } = {}): SqlExecutor {
  if (isNeonHttpUrl(connectionString) && !options.forceTcp) {
    const query = neon(connectionString)
    return (async (text: string, params: unknown[]) => ({ rows: (await query.query(text, params)) as never[] })) as SqlExecutor
  }
  pool ??= new Pool({ connectionString, max: options.max ?? 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 })
  const active = pool
  return (async (text: string, params: unknown[]) => {
    const result = await active.query(text, params)
    return { rows: result.rows }
  }) as SqlExecutor
}

/** Tests and local tooling drop the pool between configurations. */
export async function closePgPool(): Promise<void> {
  await pool?.end()
  pool = undefined
}

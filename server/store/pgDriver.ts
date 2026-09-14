import { Pool } from 'pg'
import type { SqlExecutor } from './postgres'

/**
 * The one place a Postgres driver is named.
 *
 * Everything above this file talks to `SqlExecutor`, so swapping node-postgres
 * for Neon's serverless client or Supabase's pooler is a change here and
 * nowhere else. The pool is module-scoped because a serverless function is
 * reused across invocations and a per-request pool would exhaust connections.
 */
let pool: Pool | undefined

export function createPgExecutor(connectionString: string, max = 1): SqlExecutor {
  pool ??= new Pool({ connectionString, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 })
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

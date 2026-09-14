import { describe, expect, it } from 'vitest'
import { createPostgresStore, type SqlExecutor } from '../store/postgres'
import { SUBJECT_A } from './helpers'

/**
 * The Postgres adapter against a recording executor. This is not a database
 * test — it checks the two things that matter for a boundary: every statement
 * is parameterised and subject-scoped, and a driver error becomes a
 * PERSISTENCE_FAILURE rather than an unhandled crash.
 */
function recorder(rowsFor: (text: string) => unknown[] = () => []) {
  const calls: Array<{ text: string; params: unknown[] }> = []
  const sql = (async (text: string, params: unknown[]) => {
    calls.push({ text, params })
    return { rows: rowsFor(text) }
  }) as SqlExecutor
  return { sql, calls }
}

describe('postgres adapter', () => {
  it('binds a subject once, atomically', async () => {
    const bound = recorder((t) => (t.includes('insert into sportly_subject') ? [{ subject_id: SUBJECT_A }] : []))
    expect(await createPostgresStore(bound.sql).bindSubjectOnce(SUBJECT_A, '2026-01-01T00:00:00.000Z')).toBe('bound')
    expect(bound.calls[0].text).toContain('on conflict (subject_id) do nothing')
    expect(bound.calls[0].params).toEqual([SUBJECT_A, '2026-01-01T00:00:00.000Z'])

    const taken = recorder(() => [])
    expect(await createPostgresStore(taken.sql).bindSubjectOnce(SUBJECT_A, '2026-01-01T00:00:00.000Z')).toBe('already_bound')
  })

  it('scopes every read and write by subject, always as a parameter', async () => {
    const rec = recorder((t) => (t.includes('sum(cost_usd)') ? [{ spend: '0.42' }] : []))
    const store = createPostgresStore(rec.sql)

    await store.readCallLog(SUBJECT_A)
    await store.readCallLog(SUBJECT_A, '2026-01-01')
    await store.spendTodayUsd(SUBJECT_A, 'coaching', '2026-01-01')
    await store.settleSpend('44444444-4444-4444-8444-444444444444', {
      ts: '2026-01-01T00:00:00.000Z', subjectId: SUBJECT_A, requestId: 'r', route: 'coaching', provider: 'anthropic',
      model: 'claude-sonnet-5', taskType: 'text', tokensIn: 1, tokensCached: 0, tokensOut: 2, costUsd: 0.01,
      costUnknownModel: false, latencyMs: 5, retryCount: 0, outcome: 'success', errorCategory: null,
    })

    for (const call of rec.calls) {
      expect(call.params).toContain(SUBJECT_A)
      // No interpolation: the subject never appears inside the SQL text.
      expect(call.text).not.toContain(SUBJECT_A)
    }
    for (const call of rec.calls.filter((c) => c.text.startsWith('select'))) {
      expect(call.text).toContain('subject_id = $1')
    }
  })

  it('reads a spend of 0.42 back as a number', async () => {
    const rec = recorder(() => [{ spend: '0.42' }])
    expect(await createPostgresStore(rec.sql).spendTodayUsd(SUBJECT_A, 'coaching', '2026-01-01')).toBe(0.42)
  })

  it('maps a row back to the port shape, keeping a null cost null', async () => {
    const rec = recorder(() => [
      {
        ts: '2026-01-01T00:00:00.000Z', subject_id: SUBJECT_A, request_id: 'r', route: 'food_scan', provider: 'anthropic',
        model: 'mystery', task_type: 'vision', tokens_in: '10', tokens_cached: '0', tokens_out: '5', cost_usd: null,
        cost_unknown_model: true, latency_ms: '120', retry_count: '1', outcome: 'success', error_category: null,
      },
    ])
    const [row] = await createPostgresStore(rec.sql).readCallLog(SUBJECT_A)
    expect(row).toMatchObject({ tokensIn: 10, tokensOut: 5, latencyMs: 120, retryCount: 1, costUsd: null, costUnknownModel: true })
  })

  it('turns a driver error into PERSISTENCE_FAILURE', async () => {
    const failing = (async () => {
      throw new Error('connection refused')
    }) as SqlExecutor
    await expect(createPostgresStore(failing).readCallLog(SUBJECT_A)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILURE' })
    await expect(createPostgresStore(failing).spendTodayUsd(SUBJECT_A, 'coaching', '2026-01-01')).rejects.toMatchObject({ code: 'PERSISTENCE_FAILURE' })
  })

  it('rate-limits mint attempts in one atomic statement', async () => {
    const rec = recorder(() => [{ admitted: true }])
    expect(await createPostgresStore(rec.sql).admitMintAttempt('ip', 1_700_000_000_000)).toBe(true)
    expect(rec.calls[0].text).toContain('sportly_mint_attempt')
    expect(rec.calls[0].params[0]).toBe('ip')

    const refused = recorder(() => [{ admitted: false }])
    expect(await createPostgresStore(refused.sql).admitMintAttempt('ip', 1_700_000_000_000)).toBe(false)
  })
})

describe('driver errors never reach the client', () => {
  it('keeps the connection string out of the response body', async () => {
    // The real leak path: node-postgres and Neon errors carry the host, port,
    // database and — on an auth failure — the user. A test that throws a plain
    // Error exercises asBoundaryError instead, which is the one path that
    // cannot leak, so this goes through the Postgres adapter's own guard().
    const { createBoundaryApp } = await import('../app')
    const { errorResponse } = await import('../http')
    const { fakeProviders, fakeVisionProvider, readJson, SECRET, testEnv } = await import('./helpers')
    const { mintToken } = await import('../identity/token')

    const leaky = (async () => {
      throw new Error('connect ECONNREFUSED postgres://sportly:hunter2@ep-secret-db.neon.tech:5432/main')
    }) as SqlExecutor

    const app = createBoundaryApp({ envSource: testEnv(), sql: leaky, providers: fakeProviders(fakeVisionProvider()) })
    const res = await app.handleModelCall(
      new Request('https://x/api/model/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${mintToken(SUBJECT_A, SECRET)}` },
        body: JSON.stringify({ route: 'food_scan', taskType: 'vision', imageBase64: 'aGVsbG8=', mediaType: 'image/jpeg', instruction: 'what is this' }),
      }),
    )

    expect(res.status).toBe(500)
    const body = JSON.stringify(await readJson<unknown>(res))
    expect(body).not.toContain('hunter2')
    expect(body).not.toContain('neon.tech')
    expect(body).not.toContain('postgres://')
    expect(body).toContain('PERSISTENCE_FAILURE')

    // The full message is still available server-side for the deploy log.
    const raw = await createPostgresStore(leaky).readCallLog(SUBJECT_A).catch((e: unknown) => e)
    expect((raw as Error).message).toContain('hunter2')
    expect(JSON.stringify(await (await errorResponse(raw)).json())).not.toContain('hunter2')
  })
})

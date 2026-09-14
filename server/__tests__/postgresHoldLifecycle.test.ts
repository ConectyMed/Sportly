import { expect, it } from 'vitest'
import { runModelCall } from '../boundary'
import { DEFAULT_DAILY_CAPS_USD, HOLD_TTL_MS } from '../budget/caps'
import type { ModelCallLogRow } from '../store/port'
import { describePostgres } from './pg'
import { fakeVisionProvider, SUBJECT_A } from './helpers'

/**
 * The hold lifecycle against a real Postgres: what happens when a hold is
 * never resolved — the function killed at its timeout, the provider hanging,
 * a crash between the hold and the spend record — and what happens when a
 * settle arrives twice or too late.
 *
 * These rules are also implemented by the in-memory adapter and tested there
 * for logic; this suite is the proof that the Postgres statements — the
 * expiry sweep, the `on conflict` on request_id, the gated release — do the
 * same thing, and that the unique index the idempotency rests on exists.
 */
const DAY = '2026-01-01'
const T0 = Date.parse('2026-01-01T12:00:00Z')
const caps = { ...DEFAULT_DAILY_CAPS_USD, food_scan: 0.25 }
const fullHold = { food_scan: 0.25, coaching: 0.25, program: 0.25 }

const logRow = (requestId: string, costUsd = 0.003): ModelCallLogRow => ({
  ts: '2026-01-01T12:00:00.000Z', subjectId: SUBJECT_A, requestId,
  route: 'food_scan', provider: 'anthropic', model: 'claude-sonnet-5', taskType: 'vision',
  tokensIn: 1000, tokensCached: 0, tokensOut: 100, costUsd, costUnknownModel: false,
  latencyMs: 120, retryCount: 0, outcome: 'success', errorCategory: null,
})

describePostgres('postgres hold lifecycle', ({ pool, store }) => {
  const bucket = async () => {
    const r = await pool.query<{ held_usd: string; committed_usd: string }>('select held_usd, committed_usd from sportly_spend_bucket where subject_id = $1', [SUBJECT_A])
    return { held: Number(r.rows[0]?.held_usd ?? 0), committed: Number(r.rows[0]?.committed_usd ?? 0) }
  }
  const holdRows = async () => (await pool.query('select 1 from sportly_spend_hold where subject_id = $1', [SUBJECT_A])).rowCount ?? 0
  const logRows = async () => (await pool.query('select 1 from sportly_model_call_log where subject_id = $1', [SUBJECT_A])).rowCount ?? 0
  const admit = (nowMs: number, holdUsd = 0.25) => store.admitSpend({ subjectId: SUBJECT_A, route: 'food_scan', day: DAY, capUsd: 0.25, holdUsd, nowMs, holdTtlMs: HOLD_TTL_MS })

  it('a hold that is never resolved stops counting after the TTL, and the subject is admitted again', async () => {
    // The boundary takes the hold and the provider never answers — the shape
    // of an invocation the platform killed at its maximum duration, or of a
    // crash between admission and the settle. The call is not awaited: it
    // never settles, by construction.
    const hanging = fakeVisionProvider()
    hanging.analyzeImage = () => new Promise(() => {})
    let clock = T0
    const ctx = { store, subjectId: SUBJECT_A, caps, holdUsd: fullHold, now: () => new Date(clock), providerDeadlineMs: 24 * 60 * 60 * 1000 }
    void runModelCall(ctx, { route: 'food_scan', taskType: 'vision', provider: 'fake', model: 'claude-sonnet-5', invoke: (o) => hanging.analyzeImage({ imageBase64: 'x', mediaType: 'image/jpeg', instruction: 'x' }, o) })
    await new Promise((r) => setTimeout(r, 50))
    expect(await holdRows()).toBe(1)
    expect((await bucket()).held).toBeCloseTo(0.25, 6)

    // Before the TTL the reservation is real: the subject is refused.
    clock = T0 + HOLD_TTL_MS - 1000
    await expect(runModelCall(ctx, { route: 'food_scan', taskType: 'vision', provider: 'fake', model: 'claude-sonnet-5', invoke: () => fakeVisionProvider().analyzeImage({ imageBase64: 'x', mediaType: 'image/jpeg', instruction: 'x' }) })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' })

    // Past the TTL the dead hold is reclaimed in the same admission decision,
    // the subject is admitted, and the orphaned hold row is gone.
    clock = T0 + HOLD_TTL_MS + 1000
    const again = await runModelCall(ctx, { route: 'food_scan', taskType: 'vision', provider: 'fake', model: 'claude-sonnet-5', invoke: () => fakeVisionProvider().analyzeImage({ imageBase64: 'x', mediaType: 'image/jpeg', instruction: 'x' }) })
    expect(again.ok).toBe(true)
    expect(await holdRows()).toBe(0)
    const after = await bucket()
    expect(after.held).toBeCloseTo(0, 6)
    expect(after.committed).toBeCloseTo(again.log.costUsd ?? 0, 6)
    expect(await logRows()).toBe(1)
  })

  it('a hanging provider is timed out by the boundary, so its hold is released with the row rather than left to the TTL', async () => {
    const hanging = fakeVisionProvider()
    let sawAbort = false
    hanging.analyzeImage = (_req, options) =>
      new Promise((_, reject) => options?.signal?.addEventListener('abort', () => { sawAbort = true; reject(new Error('aborted')) }))
    const ctx = { store, subjectId: SUBJECT_A, caps, holdUsd: fullHold, providerDeadlineMs: 50, maxRetries: 0 }
    await expect(runModelCall(ctx, { route: 'food_scan', taskType: 'vision', provider: 'fake', model: 'claude-sonnet-5', invoke: (o) => hanging.analyzeImage({ imageBase64: 'x', mediaType: 'image/jpeg', instruction: 'x' }, o) })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
    expect(sawAbort).toBe(true)
    expect(await holdRows()).toBe(0)
    expect((await bucket()).held).toBeCloseTo(0, 6)
    const rows = await store.readCallLog(SUBJECT_A)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ outcome: 'error', errorCategory: 'PROVIDER_TIMEOUT' })
  })

  it('a late settle of a hold that expiry already reclaimed commits the cost but does not release twice', async () => {
    const stuck = await admit(T0)
    expect(stuck.admitted).toBe(true)
    // Expiry reclaims it during a later admission…
    const later = await admit(T0 + HOLD_TTL_MS + 1000)
    expect(later.admitted).toBe(true)
    expect((await bucket()).held).toBeCloseTo(0.25, 6) // only the live hold

    // …and then the dead invocation turns out to be alive and settles anyway.
    await store.settleSpend(stuck.holdId, logRow('55555555-5555-4555-8555-555555555555'))
    const b = await bucket()
    expect(b.held).toBeCloseTo(0.25, 6) // the live hold is untouched: nothing was released twice
    expect(b.committed).toBeCloseTo(0.003, 6)
    expect(await holdRows()).toBe(1)
  })

  it('settling the same call twice writes one row and charges once', async () => {
    const a = await admit(T0, 0.05)
    const row = logRow('66666666-6666-4666-8666-666666666666', 0.01)
    await store.settleSpend(a.holdId, row)
    await store.settleSpend(a.holdId, row)
    // And a third time with a *different* hold id, as a confused retry might.
    const b = await admit(T0, 0.05)
    await store.settleSpend(b.holdId, row)

    expect(await logRows()).toBe(1)
    const state = await bucket()
    expect(state.committed).toBeCloseTo(0.01, 6)
    // Hold a was released once; hold b was not released by the replay and still stands.
    expect(state.held).toBeCloseTo(0.05, 6)
    expect(await holdRows()).toBe(1)
    expect(await store.spendTodayUsd(SUBJECT_A, 'food_scan', DAY)).toBeCloseTo(0.01, 6)
  })

  it('concurrent settles of the same call also charge once', async () => {
    const a = await admit(T0, 0.05)
    const row = logRow('77777777-7777-4777-8777-777777777777', 0.02)
    await Promise.all(Array.from({ length: 10 }, () => store.settleSpend(a.holdId, row)))
    expect(await logRows()).toBe(1)
    const state = await bucket()
    expect(state.committed).toBeCloseTo(0.02, 6)
    expect(state.held).toBeCloseTo(0, 6)
  })

  it('the database enforces one row per request', async () => {
    const idx = await pool.query("select 1 from pg_indexes where indexname = 'sportly_model_call_log_request'")
    expect(idx.rowCount).toBe(1)
    const r = logRow('88888888-8888-4888-8888-888888888888')
    await store.settleSpend(null, r)
    await expect(
      pool.query(
        `insert into sportly_model_call_log (ts, subject_id, request_id, route, provider, model, task_type, outcome, cost_usd)
         values ($1, $2, $3, 'food_scan', 'anthropic', 'claude-sonnet-5', 'vision', 'success', 0)`,
        [r.ts, r.subjectId, r.requestId],
      ),
    ).rejects.toThrow(/sportly_model_call_log_request/)
  })
})

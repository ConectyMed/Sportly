import { expect, it } from 'vitest'
import { describePostgres } from './pg'

/**
 * The admission path against a real Postgres.
 *
 * The in-memory store is single-threaded JavaScript and therefore atomic for
 * free, which means an in-memory concurrency test proves nothing whatsoever
 * about the deployed path. This suite is the only proof that the cap holds
 * under load, so it runs on every push in CI and fails — never skips — when
 * no database is configured. See ./pg.ts for the local setup.
 */
const SUBJECT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const DAY = '2026-01-01'
const AT = Date.parse('2026-01-01T12:00:00Z')

describePostgres('postgres admission under concurrency', ({ pool, store }) => {
  const admit = (subjectId = SUBJECT, holdUsd = 0.05, capUsd = 0.25) =>
    store.admitSpend({ subjectId, route: 'food_scan', day: DAY, capUsd, holdUsd, nowMs: AT, holdTtlMs: 120_000 })

  it('admits exactly cap/hold calls when 20 arrive at once', async () => {
    // The bug this pins: with a read-then-check cap — including one wrapped in
    // an advisory lock, whose statement snapshot predates the lock — this
    // measured 5, 14 and 7 admissions on consecutive runs, holding $0.70
    // against a $0.25 cap.
    const results = await Promise.all(Array.from({ length: 20 }, () => admit()))
    expect(results.filter((r) => r.admitted)).toHaveLength(5)

    const held = await pool.query<{ total: string }>('select coalesce(sum(hold_usd), 0)::text total from sportly_spend_hold')
    expect(Number(held.rows[0].total)).toBeCloseTo(0.25, 6)

    // A hold exists if and only if the bucket was charged for it.
    const bucket = await pool.query<{ held_usd: string }>('select held_usd from sportly_spend_bucket where subject_id = $1', [SUBJECT])
    expect(Number(bucket.rows[0].held_usd)).toBeCloseTo(0.25, 6)
    expect(results.filter((r) => r.holdId !== null)).toHaveLength(5)
  })

  it('rate-limits concurrent mint attempts to the configured limit', async () => {
    // Previously 19-20 of 20 were admitted against a limit of 5.
    const results = await Promise.all(Array.from({ length: 20 }, () => store.admitMintAttempt('one-ip', AT)))
    expect(results.filter(Boolean)).toHaveLength(5)
    const n = await pool.query<{ n: number }>('select n from sportly_mint_bucket where attempt_key = $1', ['one-ip'])
    expect(n.rows[0].n).toBe(5)
  })

  it('keeps buckets separate per subject under concurrency', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 20 }, () => admit(SUBJECT)),
      ...Array.from({ length: 20 }, () => admit(OTHER)),
    ])
    expect(results.filter((r) => r.admitted)).toHaveLength(10)
    const rows = await pool.query<{ subject_id: string; held_usd: string }>('select subject_id, held_usd from sportly_spend_bucket order by subject_id')
    expect(rows.rows.map((r) => Number(r.held_usd))).toEqual([0.25, 0.25])
  })

  it('settling returns the hold and commits the real cost, so the next call is admitted', async () => {
    const first = await admit(SUBJECT, 0.25)
    expect(first.admitted).toBe(true)
    // The whole cap is held, so nothing else gets in…
    expect((await admit(SUBJECT, 0.25)).admitted).toBe(false)

    await store.settleSpend(first.holdId, {
      ts: '2026-01-01T12:00:00.000Z', subjectId: SUBJECT, requestId: '33333333-3333-4333-8333-333333333333',
      route: 'food_scan', provider: 'anthropic', model: 'claude-sonnet-5', taskType: 'vision',
      tokensIn: 1000, tokensCached: 0, tokensOut: 100, costUsd: 0.003, costUnknownModel: false,
      latencyMs: 120, retryCount: 0, outcome: 'success', errorCategory: null,
    })

    const bucket = await pool.query<{ held_usd: string; committed_usd: string }>('select held_usd, committed_usd from sportly_spend_bucket where subject_id = $1', [SUBJECT])
    expect(Number(bucket.rows[0].held_usd)).toBeCloseTo(0, 6)
    // …and once it settles, only the real cost stays committed.
    expect(Number(bucket.rows[0].committed_usd)).toBeCloseTo(0.003, 6)
    expect(await store.spendTodayUsd(SUBJECT, 'food_scan', DAY)).toBeCloseTo(0.003, 6)
    expect((await admit(SUBJECT, 0.25)).admitted).toBe(true)
    expect(await pool.query('select 1 from sportly_spend_hold where hold_id = $1', [first.holdId]).then((r) => r.rowCount)).toBe(0)
  })

  it('the committed counter and the call log agree', async () => {
    for (let i = 0; i < 6; i += 1) {
      const a = await admit(SUBJECT, 0.01)
      await store.settleSpend(a.holdId, {
        ts: '2026-01-01T12:00:00.000Z', subjectId: SUBJECT, requestId: `4444444${i}-4444-4444-8444-444444444444`,
        route: 'food_scan', provider: 'anthropic', model: 'claude-sonnet-5', taskType: 'vision',
        tokensIn: 1000, tokensCached: 0, tokensOut: 100, costUsd: 0.002, costUnknownModel: false,
        latencyMs: 10, retryCount: 0, outcome: 'success', errorCategory: null,
      })
    }
    const bucket = await pool.query<{ committed_usd: string }>('select committed_usd from sportly_spend_bucket where subject_id = $1', [SUBJECT])
    expect(Number(bucket.rows[0].committed_usd)).toBeCloseTo(await store.spendTodayUsd(SUBJECT, 'food_scan', DAY), 6)
  })

  it('reclaims a hold whose request died, so a crash cannot wedge the cap', async () => {
    const stuck = await admit(SUBJECT, 0.25)
    expect(stuck.admitted).toBe(true)
    expect((await admit(SUBJECT, 0.25)).admitted).toBe(false)

    // Same call, later than the hold's TTL: the sweep gives the money back.
    const later = await store.admitSpend({ subjectId: SUBJECT, route: 'food_scan', day: DAY, capUsd: 0.25, holdUsd: 0.25, nowMs: AT + 300_000, holdTtlMs: 120_000 })
    expect(later.admitted).toBe(true)
  })
})

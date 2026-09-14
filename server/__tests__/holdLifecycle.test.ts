import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runModelCall } from '../boundary'
import { DEFAULT_DAILY_CAPS_USD, FUNCTION_MAX_DURATION_MS, HOLD_TTL_MS, PROVIDER_DEADLINE_MS } from '../budget/caps'
import { createMemoryStore } from '../store/memory'
import { requireRealStorageEngine, type ModelCallLogRow } from '../store/port'
import { createPostgresStore, type SqlExecutor } from '../store/postgres'
import { fakeVisionProvider, SUBJECT_A } from './helpers'

/**
 * Hold lifecycle — the logic, against the in-memory adapter.
 *
 * Everything here is a rule the boundary and the adapters implement in code.
 * Whether the *Postgres statements* honour the same rules under concurrency is
 * a different question, answered only by postgresHoldLifecycle.test.ts.
 */
const caps = { ...DEFAULT_DAILY_CAPS_USD, food_scan: 0.25 }
const fullHold = { food_scan: 0.25, coaching: 0.25, program: 0.25 }
const vision = (p = fakeVisionProvider()) => ({
  route: 'food_scan' as const, taskType: 'vision' as const, provider: 'fake', model: 'claude-sonnet-5',
  invoke: (o: { signal?: AbortSignal }) => p.analyzeImage({ imageBase64: 'x', mediaType: 'image/jpeg', instruction: 'x' }, o),
})
const logRow = (requestId: string, costUsd = 0.01): ModelCallLogRow => ({
  ts: '2026-01-01T12:00:00.000Z', subjectId: SUBJECT_A, requestId, route: 'food_scan', provider: 'anthropic', model: 'claude-sonnet-5',
  taskType: 'vision', tokensIn: 1, tokensCached: 0, tokensOut: 1, costUsd, costUnknownModel: false, latencyMs: 1, retryCount: 0, outcome: 'success', errorCategory: null,
})

describe('hold lifecycle: timing', () => {
  it('the hold TTL sits above the function maximum, and the provider deadline inside it', () => {
    expect(HOLD_TTL_MS).toBeGreaterThan(FUNCTION_MAX_DURATION_MS)
    // Not absurdly above: a dead hold should not freeze cap room for long.
    expect(HOLD_TTL_MS).toBeLessThanOrEqual(FUNCTION_MAX_DURATION_MS * 2)
    expect(PROVIDER_DEADLINE_MS).toBeLessThan(FUNCTION_MAX_DURATION_MS)
  })

  it('FUNCTION_MAX_DURATION_MS is what vercel.json actually deploys', () => {
    const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as { functions?: Record<string, { maxDuration?: number }> }
    const durations = Object.values(vercel.functions ?? {}).map((f) => f.maxDuration)
    expect(durations).toEqual([FUNCTION_MAX_DURATION_MS / 1000])
  })
})

describe('hold lifecycle: boundary', () => {
  it('a provider that hangs is timed out at the deadline, and the row lands with the hold released', async () => {
    const store = createMemoryStore()
    const hanging = fakeVisionProvider()
    hanging.analyzeImage = () => new Promise(() => {})
    const ctx = { store, subjectId: SUBJECT_A, caps, holdUsd: fullHold, providerDeadlineMs: 30, maxRetries: 1 }
    await expect(runModelCall(ctx, vision(hanging))).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
    const [row] = store.rows
    expect(row).toMatchObject({ outcome: 'error', errorCategory: 'PROVIDER_TIMEOUT' })
    // The hold is gone: the next call is admitted at once.
    expect((await runModelCall(ctx, vision())).ok).toBe(true)
  })

  it('the deadline covers all attempts together, so a retry cannot double it', async () => {
    const store = createMemoryStore()
    const slow = fakeVisionProvider()
    slow.analyzeImage = () => new Promise(() => {})
    const started = performance.now()
    await expect(runModelCall({ store, subjectId: SUBJECT_A, caps, providerDeadlineMs: 40, maxRetries: 3 }, vision(slow))).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
    expect(performance.now() - started).toBeLessThan(400)
    expect(store.rows[0].retryCount).toBeLessThanOrEqual(3)
  })

  it('a hold never resolved stops counting after the TTL (in-memory logic)', async () => {
    const store = createMemoryStore()
    let clock = 1_000_000
    const ctx = { store, subjectId: SUBJECT_A, caps, holdUsd: fullHold, now: () => new Date(clock), providerDeadlineMs: 10 ** 9 }
    const hanging = fakeVisionProvider()
    hanging.analyzeImage = () => new Promise(() => {})
    void runModelCall(ctx, vision(hanging))
    await new Promise((r) => setTimeout(r, 10))
    await expect(runModelCall(ctx, vision())).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' })
    clock += HOLD_TTL_MS + 1
    expect((await runModelCall(ctx, vision())).ok).toBe(true)
  })
})

describe('hold lifecycle: idempotent settle (in-memory logic)', () => {
  it('settling the same request twice writes one row and charges once', async () => {
    const store = createMemoryStore()
    const day = '2026-01-01'
    const a = await store.admitSpend({ subjectId: SUBJECT_A, route: 'food_scan', day, capUsd: 0.25, holdUsd: 0.05, nowMs: 0, holdTtlMs: HOLD_TTL_MS })
    await store.settleSpend(a.holdId, logRow('r1'))
    await store.settleSpend(a.holdId, logRow('r1'))
    expect(store.rows).toHaveLength(1)
    expect(await store.spendTodayUsd(SUBJECT_A, 'food_scan', day)).toBeCloseTo(0.01, 6)
  })
})

describe('storage engine guard rail', () => {
  it('refuses the in-memory adapter for a test that asserts an engine property', () => {
    expect(() => requireRealStorageEngine(createMemoryStore(), 'a concurrency test')).toThrow(/in-memory adapter/)
  })

  it('accepts the Postgres adapter', () => {
    const sql = (async () => ({ rows: [] })) as SqlExecutor
    expect(createPostgresStore(sql).engine).toBe('postgres')
    expect(() => requireRealStorageEngine(createPostgresStore(sql))).not.toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { runModelCall } from '../boundary'
import { DEFAULT_DAILY_CAPS_USD, resolveDailyCaps } from '../budget/caps'
import { BoundaryError, isBoundaryError } from '../errors'
import { createMemoryStore } from '../store/memory'
import { fakeVisionProvider, SUBJECT_A } from './helpers'

const caps = { ...DEFAULT_DAILY_CAPS_USD }

function callFor(provider: ReturnType<typeof fakeVisionProvider>, route: 'food_scan' | 'coaching' | 'program' = 'food_scan') {
  return {
    route,
    taskType: 'vision' as const,
    provider: provider.id,
    model: provider.model,
    invoke: () => provider.analyzeImage({ imageBase64: 'x', mediaType: 'image/jpeg' as const, instruction: 'what is this' }),
  }
}

describe('spend cap', () => {
  it('allows a call when the subject is under budget', async () => {
    const store = createMemoryStore()
    const provider = fakeVisionProvider()
    const result = await runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(provider))
    expect(result.ok).toBe(true)
    expect(provider.calls).toBe(1)
    expect(result.budget.spentUsd).toBe(0)
    expect(result.budget.capUsd).toBe(caps.food_scan)
  })

  it('blocks BEFORE the request is sent once the cap is reached', async () => {
    const store = createMemoryStore()
    // One expensive call takes the subject to the food_scan cap.
    const expensive = fakeVisionProvider({ model: 'claude-opus-5', tokensIn: 20_000_000, tokensOut: 0 })
    await runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(expensive))
    expect(await store.spendTodayUsd(SUBJECT_A, 'food_scan', new Date().toISOString().slice(0, 10))).toBeGreaterThanOrEqual(caps.food_scan)

    const next = fakeVisionProvider()
    await expect(runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(next))).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' })

    // The proof that the cap is pre-call: the provider was never invoked, and
    // no row was written for the refused attempt.
    expect(next.calls).toBe(0)
    expect(await store.readCallLog(SUBJECT_A)).toHaveLength(1)
  })

  it('caps are per route — food_scan being spent does not block coaching', async () => {
    const store = createMemoryStore()
    const expensive = fakeVisionProvider({ model: 'claude-opus-5', tokensIn: 20_000_000, tokensOut: 0 })
    await runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(expensive, 'food_scan'))

    await expect(runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(fakeVisionProvider(), 'food_scan'))).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' })

    const coaching = fakeVisionProvider()
    const ok = await runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(coaching, 'coaching'))
    expect(ok.ok).toBe(true)
    expect(coaching.calls).toBe(1)
  })

  it('caps are per subject — one subject spending does not block another', async () => {
    const store = createMemoryStore()
    const expensive = fakeVisionProvider({ model: 'claude-opus-5', tokensIn: 20_000_000, tokensOut: 0 })
    await runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(expensive))

    const other = fakeVisionProvider()
    const ok = await runModelCall({ store, subjectId: '22222222-2222-4222-8222-222222222222', caps }, callFor(other))
    expect(ok.ok).toBe(true)
  })

  it('refuses to call an unpriced model on a capped route, rather than letting it spend uncounted', async () => {
    // An unpriced model logs cost_usd = null, which is honest — but a null adds
    // nothing to the day's spend, so allowing the call would mean unlimited
    // spend under a cap that never fires. The boundary fails closed instead.
    const store = createMemoryStore()
    const unpriced = fakeVisionProvider({ model: 'mystery-model', tokensIn: 5_000_000, tokensOut: 500_000 })
    await expect(runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(unpriced))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(unpriced.calls).toBe(0)
  })

  it('bounds concurrent spend — parallel calls cannot all pass the same check', async () => {
    // The bug this pins: a read-then-check cap is bypassed by concurrency,
    // because every in-flight request reads the same spend and all pass.
    const store = createMemoryStore()
    const provider = fakeVisionProvider({ model: 'claude-opus-5', tokensIn: 2_000_000, tokensOut: 0 })
    const ctx = { store, subjectId: SUBJECT_A, caps, holdUsd: { food_scan: 0.05, coaching: 0.05, program: 0.05 } }

    const settled = await Promise.allSettled(Array.from({ length: 20 }, () => runModelCall(ctx, callFor(provider))))
    const admitted = settled.filter((r) => r.status === 'fulfilled').length

    // cap 0.25 / hold 0.05 = at most 5 concurrent admissions, not 20.
    expect(admitted).toBeLessThanOrEqual(5)
    expect(admitted).toBeGreaterThan(0)
    expect(provider.calls).toBe(admitted)
    expect(settled.filter((r) => r.status === 'rejected').length).toBe(20 - admitted)
  })

  it('releases the hold when a call settles, so sequential calls are not blocked by their predecessors', async () => {
    const store = createMemoryStore()
    const cheap = fakeVisionProvider({ tokensIn: 10, tokensOut: 10 })
    const ctx = { store, subjectId: SUBJECT_A, caps, holdUsd: { food_scan: 0.1, coaching: 0.1, program: 0.1 } }
    for (let i = 0; i < 8; i += 1) await runModelCall(ctx, callFor(cheap))
    expect(cheap.calls).toBe(8)
  })

  it('stops counting a hold whose request died, so a crash cannot wedge the cap', async () => {
    const store = createMemoryStore()
    const ctx = { store, subjectId: SUBJECT_A, caps, holdTtlMs: 1000, holdUsd: { food_scan: 0.25, coaching: 0.25, program: 0.25 } }
    let clock = 1_000_000

    // A hold big enough to fill the cap on its own, taken and never settled.
    await store.admitSpend({ subjectId: SUBJECT_A, route: 'food_scan', day: new Date(clock).toISOString().slice(0, 10), capUsd: caps.food_scan, holdUsd: 0.25, nowMs: clock, holdTtlMs: 1000 })
    await expect(runModelCall({ ...ctx, now: () => new Date(clock) }, callFor(fakeVisionProvider()))).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' })

    clock += 5000
    const after = await runModelCall({ ...ctx, now: () => new Date(clock) }, callFor(fakeVisionProvider()))
    expect(after.ok).toBe(true)
  })

  it('still logs an unpriced model as null and flagged when the provider answers with an unexpected one', async () => {
    // Configuration is refused up front; a *surprise* model in the response is
    // a different case, and must be recorded honestly rather than zeroed.
    const store = createMemoryStore()
    const surprising = fakeVisionProvider({ tokensIn: 1000, tokensOut: 100 })
    surprising.analyzeImage = async () => ({ output: { text: 'x' }, usage: { tokensIn: 1000, tokensCached: 0, tokensOut: 100 }, model: 'claude-sonnet-5-preview-unreleased' })
    await runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(surprising))
    const [row] = await store.readCallLog(SUBJECT_A)
    expect(row.model).toBe('claude-sonnet-5-preview-unreleased')
    expect(row.costUsd).toBeNull()
    expect(row.costUnknownModel).toBe(true)
  })

  it('reads caps from configuration, with env overrides applied', () => {
    expect(resolveDailyCaps({ capOverridesUsd: {} })).toEqual(DEFAULT_DAILY_CAPS_USD)
    expect(resolveDailyCaps({ capOverridesUsd: { coaching: 4.5 } }).coaching).toBe(4.5)
    expect(resolveDailyCaps({ capOverridesUsd: { coaching: 4.5 } }).food_scan).toBe(DEFAULT_DAILY_CAPS_USD.food_scan)
  })
})

describe('call log', () => {
  it('writes a row on success', async () => {
    const store = createMemoryStore()
    const provider = fakeVisionProvider({ tokensIn: 1500, tokensCached: 200, tokensOut: 320 })
    const result = await runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(provider))

    const rows = await store.readCallLog(SUBJECT_A)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      subjectId: SUBJECT_A,
      requestId: result.requestId,
      route: 'food_scan',
      provider: 'fake',
      model: 'claude-sonnet-5',
      taskType: 'vision',
      tokensIn: 1500,
      tokensCached: 200,
      tokensOut: 320,
      retryCount: 0,
      outcome: 'success',
      errorCategory: null,
      costUnknownModel: false,
    })
    expect(rows[0].costUsd).toBeGreaterThan(0)
  })

  it('writes a row on provider failure, with the error category', async () => {
    const store = createMemoryStore()
    const provider = fakeVisionProvider({ fail: () => new BoundaryError('PROVIDER_UNAVAILABLE', 'upstream down') })

    await expect(runModelCall({ store, subjectId: SUBJECT_A, caps, maxRetries: 0 }, callFor(provider))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })

    const rows = await store.readCallLog(SUBJECT_A)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ outcome: 'error', errorCategory: 'PROVIDER_UNAVAILABLE', tokensIn: 0, tokensOut: 0, costUsd: 0 })
  })

  it('records each error category it is given', async () => {
    const store = createMemoryStore()
    for (const code of ['PROVIDER_TIMEOUT', 'INVALID_MODEL_OUTPUT', 'RATE_LIMITED'] as const) {
      const provider = fakeVisionProvider({ fail: () => new BoundaryError(code, code) })
      await expect(runModelCall({ store, subjectId: SUBJECT_A, caps, maxRetries: 0 }, callFor(provider))).rejects.toMatchObject({ code })
    }
    // Rows can share a millisecond, so compare as a set rather than a sequence.
    const categories = (await store.readCallLog(SUBJECT_A)).map((r) => r.errorCategory).sort()
    expect(categories).toEqual(['INVALID_MODEL_OUTPUT', 'PROVIDER_TIMEOUT', 'RATE_LIMITED'])
  })

  it('counts retries and reports the attempt that finally succeeded', async () => {
    const store = createMemoryStore()
    const provider = fakeVisionProvider({ failFirst: 1 })
    const result = await runModelCall({ store, subjectId: SUBJECT_A, caps, maxRetries: 2 }, callFor(provider))
    expect(result.ok).toBe(true)
    expect(provider.calls).toBe(2)
    expect((await store.readCallLog(SUBJECT_A))[0]).toMatchObject({ retryCount: 1, outcome: 'success' })
  })

  it('does not retry a non-transient failure', async () => {
    const store = createMemoryStore()
    const provider = fakeVisionProvider({ fail: () => new BoundaryError('INVALID_MODEL_OUTPUT', 'garbage') })
    await expect(runModelCall({ store, subjectId: SUBJECT_A, caps, maxRetries: 3 }, callFor(provider))).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' })
    expect(provider.calls).toBe(1)
    expect((await store.readCallLog(SUBJECT_A))[0].retryCount).toBe(0)
  })

  it('records latency', async () => {
    const store = createMemoryStore()
    let t = 1000
    const result = await runModelCall(
      { store, subjectId: SUBJECT_A, caps, monotonic: () => (t += 250) },
      callFor(fakeVisionProvider()),
    )
    expect(result.log.latencyMs).toBe(250)
  })

  it('surfaces a storage failure as PERSISTENCE_FAILURE rather than losing the row silently', async () => {
    const store = createMemoryStore()
    store.settleSpend = async () => {
      throw new Error('disk on fire')
    }
    const err = await runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(fakeVisionProvider())).catch((e: unknown) => e)
    expect(isBoundaryError(err)).toBe(true)
    expect((err as BoundaryError).code).toBe('PERSISTENCE_FAILURE')
  })

  it('never records secrets or user content', async () => {
    const store = createMemoryStore()
    await runModelCall({ store, subjectId: SUBJECT_A, caps }, callFor(fakeVisionProvider()))
    const serialised = JSON.stringify(await store.readCallLog(SUBJECT_A))
    expect(serialised).not.toContain('sk-ant')
    expect(serialised).not.toContain('a plate of food')
    expect(serialised).not.toContain('what is this')
    // The recorded keys are exactly the agreed log fields.
    expect(Object.keys((await store.readCallLog(SUBJECT_A))[0]).sort()).toEqual(
      ['costUnknownModel', 'costUsd', 'errorCategory', 'latencyMs', 'model', 'outcome', 'provider', 'requestId', 'retryCount', 'route', 'subjectId', 'taskType', 'tokensCached', 'tokensIn', 'tokensOut', 'ts'],
    )
  })
})

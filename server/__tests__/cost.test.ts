import { describe, expect, it } from 'vitest'
import { computeCostUsd } from '../cost/compute'
import { MODEL_RATES, isKnownModel, rateFor } from '../cost/rates'
import { buildCallLogRow } from '../log/callLog'

describe('cost accounting', () => {
  it('derives cost from token counts and the rate table', () => {
    // Sonnet 5: $2/MTok in, $0.20/MTok cached, $10/MTok out.
    const { costUsd, unknownModel } = computeCostUsd('claude-sonnet-5', { tokensIn: 1_000_000, tokensCached: 1_000_000, tokensOut: 1_000_000 })
    expect(unknownModel).toBe(false)
    expect(costUsd).toBeCloseTo(2 + 0.2 + 10, 6)
  })

  it('prices cached input at a tenth of uncached input', () => {
    const uncached = computeCostUsd('claude-opus-5', { tokensIn: 100_000, tokensCached: 0, tokensOut: 0 }).costUsd!
    const cached = computeCostUsd('claude-opus-5', { tokensIn: 0, tokensCached: 100_000, tokensOut: 0 }).costUsd!
    expect(cached).toBeCloseTo(uncached * 0.1, 8)
  })

  it('records null and flags an unknown model — never a silent zero', () => {
    const result = computeCostUsd('some-model-we-do-not-price', { tokensIn: 5000, tokensCached: 0, tokensOut: 900 })
    expect(result.costUsd).toBeNull()
    expect(result.unknownModel).toBe(true)
    expect(result.costUsd).not.toBe(0)
  })

  it('flags the unknown model on the log row itself', () => {
    const row = buildCallLogRow({
      subjectId: 'a', requestId: 'r', route: 'food_scan', provider: 'p', model: 'mystery-model', taskType: 'vision',
      tokensIn: 1200, tokensCached: 0, tokensOut: 300, latencyMs: 10, retryCount: 0, outcome: 'success', errorCategory: null,
    })
    expect(row.costUsd).toBeNull()
    expect(row.costUnknownModel).toBe(true)

    const known = buildCallLogRow({ ...row, model: 'claude-sonnet-5' } as never)
    expect(known.costUnknownModel).toBe(false)
    expect(known.costUsd).toBeGreaterThan(0)
  })

  it('a zero-token call on a known model is genuinely zero, and is not flagged', () => {
    const result = computeCostUsd('claude-sonnet-5', { tokensIn: 0, tokensCached: 0, tokensOut: 0 })
    expect(result.costUsd).toBe(0)
    expect(result.unknownModel).toBe(false)
  })

  it('every rate in the table is coherent', () => {
    for (const [model, rate] of Object.entries(MODEL_RATES)) {
      expect(isKnownModel(model)).toBe(true)
      expect(rateFor(model)).toEqual(rate)
      expect(rate.inputPerMTok).toBeGreaterThan(0)
      expect(rate.outputPerMTok).toBeGreaterThan(rate.inputPerMTok)
      expect(rate.cachedInputPerMTok).toBeLessThan(rate.inputPerMTok)
    }
  })
})

import { rateFor } from './rates'

export interface TokenUsage {
  tokensIn: number
  tokensCached: number
  tokensOut: number
}

export interface CostResult {
  /** null when the model has no rate — never 0 standing in for "unknown". */
  costUsd: number | null
  /** True exactly when costUsd is null because the model is not in the table. */
  unknownModel: boolean
}

const PER_MTOK = 1_000_000

/** Six decimal places: a single cheap call is fractions of a cent. */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/**
 * Derive cost from token counts and the rate table.
 *
 * `tokensIn` is the uncached input; `tokensCached` is billed at the cache-read
 * rate. An unknown model yields { costUsd: null, unknownModel: true } so the
 * row is visibly unpriced instead of silently free.
 */
export function computeCostUsd(model: string, usage: TokenUsage): CostResult {
  const rate = rateFor(model)
  if (!rate) return { costUsd: null, unknownModel: true }
  const cost =
    (usage.tokensIn / PER_MTOK) * rate.inputPerMTok +
    (usage.tokensCached / PER_MTOK) * rate.cachedInputPerMTok +
    (usage.tokensOut / PER_MTOK) * rate.outputPerMTok
  return { costUsd: round6(cost), unknownModel: false }
}

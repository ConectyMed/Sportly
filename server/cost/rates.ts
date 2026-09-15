/**
 * Per-model rates, USD per million tokens.
 *
 * A model that is not in this table is not free — it is unpriced. Callers get
 * `cost_usd = null` and a flag, never a zero. See ./compute.ts.
 *
 * Cached input is billed at a tenth of the input rate on the Anthropic API, so
 * the cached column is derived from the input column rather than typed out
 * separately and left to drift.
 */
export interface ModelRate {
  inputPerMTok: number
  cachedInputPerMTok: number
  outputPerMTok: number
}

const CACHE_READ_DISCOUNT = 0.1

const rate = (inputPerMTok: number, outputPerMTok: number): ModelRate => ({
  inputPerMTok,
  cachedInputPerMTok: inputPerMTok * CACHE_READ_DISCOUNT,
  outputPerMTok,
})

/** Rates as published for the Anthropic first-party API. */
export const MODEL_RATES: Readonly<Record<string, ModelRate>> = Object.freeze({
  'claude-opus-5': rate(5, 25),
  'claude-opus-4-8': rate(5, 25),
  'claude-opus-4-7': rate(5, 25),
  'claude-opus-4-6': rate(5, 25),
  'claude-sonnet-5': rate(2, 10),
  'claude-sonnet-4-6': rate(3, 15),
  'claude-haiku-4-5': rate(1, 5),
})

export function rateFor(model: string): ModelRate | undefined {
  return MODEL_RATES[model]
}

export function isKnownModel(model: string): boolean {
  return Object.hasOwn(MODEL_RATES, model)
}

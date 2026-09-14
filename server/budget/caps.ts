import type { ServerEnv } from '../env'
import type { Route } from '../store/port'

/**
 * Daily spend caps, USD per subject per route, per UTC day.
 *
 * Per-route rather than one global number because the routes have different
 * shapes: a food scan is one small vision call, a coaching turn is a tool loop,
 * a program generation is a long single call. One cap for all three would be
 * either too tight for coaching or too loose for food scan.
 */
export type DailyCaps = Record<Route, number>

export const DEFAULT_DAILY_CAPS_USD: Readonly<DailyCaps> = Object.freeze({
  food_scan: 0.25,
  coaching: 1.0,
  program: 0.5,
})

/**
 * What one call on a route is assumed to cost at worst, held from the moment it
 * is admitted until it settles. This is what bounds concurrent spend: at most
 * ceil(cap / hold) calls can be in flight on a route at once.
 */
export const DEFAULT_HOLD_USD: Readonly<DailyCaps> = Object.freeze({
  food_scan: 0.02,
  coaching: 0.08,
  program: 0.05,
})

/** A hold older than this belonged to a request that died; it stops counting. */
export const HOLD_TTL_MS = 2 * 60 * 1000

/** Defaults, with any per-route override from the server environment applied. */
export function resolveDailyCaps(env: Pick<ServerEnv, 'capOverridesUsd'>): DailyCaps {
  return {
    food_scan: env.capOverridesUsd.food_scan ?? DEFAULT_DAILY_CAPS_USD.food_scan,
    coaching: env.capOverridesUsd.coaching ?? DEFAULT_DAILY_CAPS_USD.coaching,
    program: env.capOverridesUsd.program ?? DEFAULT_DAILY_CAPS_USD.program,
  }
}

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

/**
 * How long one invocation of the boundary may run. Mirrors `maxDuration` in
 * vercel.json (a test keeps the two in step): after this the platform kills
 * the invocation, whatever it is doing. 60 s is what every Vercel plan allows
 * for a Node function, so the number holds on Hobby and Pro alike.
 */
export const FUNCTION_MAX_DURATION_MS = 60 * 1000

/**
 * The boundary's own deadline for the provider phase of a call — all attempts
 * together. Well inside the function's maximum, so that a hanging provider is
 * aborted with time left to write the log row and release the hold. A provider
 * that hangs *past* the function's maximum would otherwise leave its hold to
 * the TTL every time, which is a recovery path, not a plan.
 */
export const PROVIDER_DEADLINE_MS = 45 * 1000

/**
 * A hold older than this belonged to a request that died; it stops counting.
 *
 * Why this number: a hold is taken by one invocation and can only be settled
 * by that invocation. Once the invocation is older than the function's maximum
 * duration it is dead — the platform killed it — and nobody is left to settle.
 * So the TTL is that maximum plus a margin, and nothing more: the margin
 * covers clock skew between the instance that took the hold and the one
 * deciding expiry (both stamp their own `Date.now()`), and the settle
 * statement's own round trip at the very end of a long invocation. Below the
 * maximum, a live call's reservation could be reclaimed while its provider
 * request is still out, and the cap would be over-admitted by that hold.
 * Much above it, a crashed call holds cap room hostage for longer than it has
 * to — at $0.25/day and a $0.02 hold that is nearly a tenth of the day's
 * food-scan budget frozen for no reason.
 */
export const HOLD_TTL_MS = FUNCTION_MAX_DURATION_MS + 15 * 1000

/** Defaults, with any per-route override from the server environment applied. */
export function resolveDailyCaps(env: Pick<ServerEnv, 'capOverridesUsd'>): DailyCaps {
  return {
    food_scan: env.capOverridesUsd.food_scan ?? DEFAULT_DAILY_CAPS_USD.food_scan,
    coaching: env.capOverridesUsd.coaching ?? DEFAULT_DAILY_CAPS_USD.coaching,
    program: env.capOverridesUsd.program ?? DEFAULT_DAILY_CAPS_USD.program,
  }
}

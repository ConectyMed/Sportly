import { boundaryError } from '../errors.js'
import { isKnownModel } from '../cost/rates.js'
import type { BoundaryStore, Route } from '../store/port.js'
import { utcDay } from '../store/port.js'
import type { DailyCaps } from './caps.js'

export interface BudgetVerdict {
  route: Route
  capUsd: number
  spentUsd: number
  remainingUsd: number
  /** Pass to settleSpend so the reservation is released with the row. */
  holdId: string | null
}

export interface BudgetCheckOptions {
  store: BoundaryStore
  subjectId: string
  route: Route
  /** The model about to be called. Refused outright when it has no rate. */
  model: string
  caps: DailyCaps
  holdUsd: number
  holdTtlMs: number
  now?: Date
}

/**
 * Admit or refuse a call BEFORE the provider request goes out.
 *
 * Two rules, both of which have to hold or the cap is decorative:
 *
 * 1. **The model must be priced.** An unpriced model records `cost_usd = null`,
 *    which is the honest thing to log — but a null contributes nothing to the
 *    day's spend, so a mispointed `SPORTLY_VISION_MODEL` would otherwise mean
 *    unlimited spend under a cap that never fires. The boundary fails closed:
 *    add the model to the rate table, or it does not get called on a capped
 *    route. (A *response* that names an unexpected model is still logged as
 *    unpriced and flagged — that case is a surprise, not a configuration.)
 *
 * 2. **Admission is atomic.** A read-then-check cannot cap anything under
 *    concurrency, so the store counts committed spend plus live holds and takes
 *    a hold in one step. See `BoundaryStore.admitSpend`.
 *
 * The check is "have you already spent the cap", not "will this call exceed
 * it": a call's cost is not knowable until the tokens come back. One call can
 * therefore carry a subject past the cap by up to its hold, and the next is
 * refused.
 */
export async function admitCall(options: BudgetCheckOptions): Promise<BudgetVerdict> {
  const { store, subjectId, route, caps, model } = options
  const capUsd = caps[route]

  if (!isKnownModel(model)) {
    throw boundaryError.invalidRequest(
      `No rate is configured for model ${model}, so its spend could not be counted against the ${route} cap.`,
      { route, model },
    )
  }

  const now = options.now ?? new Date()
  const admission = await store.admitSpend({
    subjectId,
    route,
    day: utcDay(now),
    capUsd,
    holdUsd: options.holdUsd,
    nowMs: now.getTime(),
    holdTtlMs: options.holdTtlMs,
  })

  if (!admission.admitted) {
    throw boundaryError.budgetExceeded(`Daily ${route} budget reached.`, { route, capUsd, spentUsd: admission.spentUsd })
  }

  return { route, capUsd, spentUsd: admission.spentUsd, remainingUsd: Math.max(0, capUsd - admission.spentUsd), holdId: admission.holdId }
}

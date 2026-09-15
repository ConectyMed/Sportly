import { asBoundaryError, type BoundaryErrorCode } from '../errors.js'
import { computeCostUsd } from '../cost/compute.js'
import type { BoundaryStore, CallOutcome, ModelCallLogRow, Route, TaskType } from '../store/port.js'

/**
 * The call-log writer.
 *
 * It derives cost from tokens rather than accepting a cost, so no caller can
 * report a price the rate table does not agree with, and an unknown model is
 * always flagged rather than zeroed.
 */
export interface CallLogFacts {
  subjectId: string
  requestId: string
  route: Route
  provider: string
  model: string
  taskType: TaskType
  tokensIn: number
  tokensCached: number
  tokensOut: number
  latencyMs: number
  retryCount: number
  outcome: CallOutcome
  errorCategory: BoundaryErrorCode | null
  at?: Date
}

export function buildCallLogRow(facts: CallLogFacts): ModelCallLogRow {
  const { costUsd, unknownModel } = computeCostUsd(facts.model, {
    tokensIn: facts.tokensIn,
    tokensCached: facts.tokensCached,
    tokensOut: facts.tokensOut,
  })
  return {
    ts: (facts.at ?? new Date()).toISOString(),
    subjectId: facts.subjectId,
    requestId: facts.requestId,
    route: facts.route,
    provider: facts.provider,
    model: facts.model,
    taskType: facts.taskType,
    tokensIn: facts.tokensIn,
    tokensCached: facts.tokensCached,
    tokensOut: facts.tokensOut,
    costUsd,
    costUnknownModel: unknownModel,
    latencyMs: facts.latencyMs,
    retryCount: facts.retryCount,
    outcome: facts.outcome,
    errorCategory: facts.errorCategory,
  }
}

/**
 * Write one row and release its spend hold, together.
 *
 * A storage failure here is reported as PERSISTENCE_FAILURE rather than
 * swallowed: an unrecorded spend is a hole in the cap. The hold is what limits
 * the damage — a settle that never lands leaves the reservation standing until
 * its TTL, so the money stays counted against the cap in the meantime instead
 * of vanishing.
 */
export async function writeCallLog(store: BoundaryStore, holdId: string | null, facts: CallLogFacts): Promise<ModelCallLogRow> {
  const row = buildCallLogRow(facts)
  try {
    await store.settleSpend(holdId, row)
  } catch (err) {
    throw asBoundaryError(err, 'PERSISTENCE_FAILURE')
  }
  return row
}

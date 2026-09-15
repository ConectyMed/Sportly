import { boundaryError } from '../errors.js'
import type { BoundaryStore } from '../store/port.js'
import { isSubjectIdShape, mintToken } from './token.js'

/**
 * Trust-on-first-use subject minting.
 *
 * The client proposes the id it already uses on-device, and the server adopts
 * it as the subject. That is what keeps a user's existing local data — the Alex
 * demo, memories, workouts, meals, goals, the calendar — attached to the same
 * identity instead of orphaned behind a freshly invented server id.
 *
 * This is trust-on-first-use, with all that implies. It holds only because:
 *
 *   1. the id is an unguessable v4 UUID, so claiming someone else's subject
 *      means guessing 122 bits; and
 *   2. a subject can be bound exactly once. The second mint for a subject is
 *      refused, so an attacker who did guess an id still cannot get a token
 *      for it once the real client has one.
 *
 * Both halves are load-bearing. Drop (2) and this degrades to "the client says
 * who it is", which is precisely the model the signed token exists to replace.
 */

export interface MintRequest {
  subjectId: unknown
  /** Rate-limit bucket — the caller's IP in production. */
  rateLimitKey: string
}

export interface MintResult {
  token: string
  subjectId: string
}

export interface MintContext {
  store: BoundaryStore
  secret: string
  nowMs?: number
}

export async function mintSubjectToken(ctx: MintContext, request: MintRequest): Promise<MintResult> {
  const nowMs = ctx.nowMs ?? Date.now()
  const { subjectId } = request

  if (!isSubjectIdShape(subjectId)) {
    throw boundaryError.invalidRequest('subjectId must be a UUID.')
  }

  // Rate-limited before the write, because minting creates rows.
  if (!(await ctx.store.admitMintAttempt(request.rateLimitKey, nowMs))) {
    throw boundaryError.rateLimited('Too many token requests. Try again later.')
  }

  const bound = await ctx.store.bindSubjectOnce(subjectId, new Date(nowMs).toISOString())
  if (bound === 'already_bound') {
    throw boundaryError.unauthorized('This subject already has a token. V8a mints one token per subject and has no rotation flow.')
  }

  return { token: mintToken(subjectId, ctx.secret, nowMs), subjectId }
}

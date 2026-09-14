import { createHmac, timingSafeEqual } from 'node:crypto'
import { boundaryError } from '../errors'

/**
 * Subject tokens.
 *
 * V8a has no accounts. Identity is a signed bearer token minted by the server
 * and verified by the server; the client never sends a bare subject id in a
 * request body, and the server never reads one from there.
 *
 * The subject is adopted, not invented — see `server/identity/mint.ts` for the
 * trust-on-first-use rule. The field is called `sub` (and the column
 * `subject_id`) rather than `device_id` because when real accounts land this
 * subject gets linked to an account, not replaced by one.
 *
 * No refresh, no rotation, no revocation list, no device management. Those are
 * a later session's problem; pretending to have them here would be worse than
 * not having them.
 */

export const TOKEN_VERSION = 1

export interface SubjectClaims {
  /** Token format version. Bumped if the payload shape ever changes. */
  v: number
  /** The subject this token speaks for. */
  sub: string
  /** Issued-at, seconds since epoch. */
  iat: number
}

/**
 * Subject ids must be UUIDs. The whole trust-on-first-use story rests on the id
 * being unguessable, so an id that is not UUID-shaped is refused before it can
 * be bound.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isSubjectIdShape(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

const b64url = (buf: Buffer): string => buf.toString('base64url')

function sign(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest())
}

export function mintToken(subjectId: string, secret: string, nowMs: number = Date.now()): string {
  if (!isSubjectIdShape(subjectId)) throw boundaryError.invalidRequest('Subject id must be a UUID.')
  const claims: SubjectClaims = { v: TOKEN_VERSION, sub: subjectId, iat: Math.floor(nowMs / 1000) }
  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'))
  return `${payload}.${sign(payload, secret)}`
}

/**
 * Verify a token and return its claims. Throws UNAUTHORIZED for anything that
 * is not a well-formed token signed by this secret — a tampered payload, a
 * swapped signature, an unknown version, or a subject that is not UUID-shaped.
 */
export function verifyToken(token: unknown, secret: string): SubjectClaims {
  if (typeof token !== 'string' || !token) throw boundaryError.unauthorized('Missing subject token.')
  const parts = token.split('.')
  if (parts.length !== 2) throw boundaryError.unauthorized('Malformed subject token.')
  const [payload, signature] = parts

  const expected = Buffer.from(sign(payload, secret), 'utf8')
  const actual = Buffer.from(signature, 'utf8')
  // Compare in constant time, and only when the lengths already match —
  // timingSafeEqual throws on a length mismatch, which would itself be a signal.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw boundaryError.unauthorized('Subject token signature does not verify.')
  }

  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw boundaryError.unauthorized('Subject token payload is not readable.')
  }
  if (typeof claims !== 'object' || claims === null) throw boundaryError.unauthorized('Subject token payload is not an object.')
  const { v, sub, iat } = claims as Record<string, unknown>
  if (v !== TOKEN_VERSION) throw boundaryError.unauthorized(`Unsupported subject token version ${String(v)}.`)
  if (!isSubjectIdShape(sub)) throw boundaryError.unauthorized('Subject token carries no usable subject.')
  if (typeof iat !== 'number' || !Number.isFinite(iat)) throw boundaryError.unauthorized('Subject token carries no issued-at.')
  return { v, sub, iat }
}

/** Pull the token out of an `Authorization: Bearer …` header. */
export function bearerToken(header: string | undefined | null): string {
  const match = /^Bearer\s+(.+)$/i.exec((header ?? '').trim())
  if (!match) throw boundaryError.unauthorized('Expected an Authorization: Bearer header.')
  return match[1].trim()
}

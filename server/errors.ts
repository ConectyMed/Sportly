/**
 * The boundary's error vocabulary. Every failure that crosses the provider
 * boundary is one of these, so the call log's `error_category` is a closed set
 * and callers never have to parse a message.
 *
 * The first six are the categories the V8a brief requires. UNAUTHORIZED and
 * INVALID_REQUEST are added because a real HTTP boundary cannot express a bad
 * token or a malformed body with any of the six without lying about what
 * happened.
 */
export type BoundaryErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'INVALID_MODEL_OUTPUT'
  | 'BUDGET_EXCEEDED'
  | 'RATE_LIMITED'
  | 'PERSISTENCE_FAILURE'
  | 'UNAUTHORIZED'
  | 'INVALID_REQUEST'

export const BOUNDARY_ERROR_CODES: readonly BoundaryErrorCode[] = [
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'INVALID_MODEL_OUTPUT',
  'BUDGET_EXCEEDED',
  'RATE_LIMITED',
  'PERSISTENCE_FAILURE',
  'UNAUTHORIZED',
  'INVALID_REQUEST',
]

const STATUS: Record<BoundaryErrorCode, number> = {
  PROVIDER_UNAVAILABLE: 502,
  PROVIDER_TIMEOUT: 504,
  INVALID_MODEL_OUTPUT: 502,
  BUDGET_EXCEEDED: 402,
  RATE_LIMITED: 429,
  PERSISTENCE_FAILURE: 500,
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
}

/** Shown to the client in place of a message we did not write ourselves. */
export const OPAQUE_MESSAGE: Record<BoundaryErrorCode, string> = {
  PROVIDER_UNAVAILABLE: 'The model provider is unavailable.',
  PROVIDER_TIMEOUT: 'The model provider timed out.',
  INVALID_MODEL_OUTPUT: 'The model returned something unusable.',
  BUDGET_EXCEEDED: 'Daily budget reached.',
  RATE_LIMITED: 'Too many requests.',
  PERSISTENCE_FAILURE: 'Unexpected server error.',
  UNAUTHORIZED: 'Not authorised.',
  INVALID_REQUEST: 'Malformed request.',
}

/**
 * `detail` is returned to the client, so it carries only facts the client may
 * see (a cap, a route, a model name) — never provider payloads, never user
 * content, never credentials.
 *
 * `clientSafe` marks whether `message` was written here or wrapped from a throw
 * we did not author. A driver's message can carry a connection string and a
 * network error can carry an internal hostname, so a wrapped message is
 * replaced by `OPAQUE_MESSAGE[code]` on its way out. The full message is still
 * on the error for server-side logging.
 */
export class BoundaryError extends Error {
  readonly code: BoundaryErrorCode
  readonly detail: Record<string, unknown> | undefined
  readonly clientSafe: boolean

  constructor(code: BoundaryErrorCode, message: string, detail?: Record<string, unknown>, clientSafe = true) {
    super(message)
    this.name = 'BoundaryError'
    this.code = code
    this.detail = detail
    this.clientSafe = clientSafe
  }

  get status(): number {
    return STATUS[this.code]
  }

  /** The message the client is allowed to see. */
  get publicMessage(): string {
    return this.clientSafe ? this.message : OPAQUE_MESSAGE[this.code]
  }
}

export function isBoundaryError(err: unknown): err is BoundaryError {
  return err instanceof BoundaryError
}

/**
 * Anything a provider adapter or a driver throws that is not already
 * categorised is a boundary failure, not a crash. The wrapped message is kept
 * for server-side logs but marked not client-safe.
 */
export function asBoundaryError(err: unknown, fallback: BoundaryErrorCode = 'PROVIDER_UNAVAILABLE'): BoundaryError {
  if (isBoundaryError(err)) return err
  const message = err instanceof Error ? err.message : String(err)
  return new BoundaryError(fallback, message, undefined, false)
}

export const boundaryError = {
  providerUnavailable: (m: string, d?: Record<string, unknown>) => new BoundaryError('PROVIDER_UNAVAILABLE', m, d),
  providerTimeout: (m: string, d?: Record<string, unknown>) => new BoundaryError('PROVIDER_TIMEOUT', m, d),
  invalidModelOutput: (m: string, d?: Record<string, unknown>) => new BoundaryError('INVALID_MODEL_OUTPUT', m, d),
  budgetExceeded: (m: string, d?: Record<string, unknown>) => new BoundaryError('BUDGET_EXCEEDED', m, d),
  rateLimited: (m: string, d?: Record<string, unknown>) => new BoundaryError('RATE_LIMITED', m, d),
  persistenceFailure: (m: string, d?: Record<string, unknown>) => new BoundaryError('PERSISTENCE_FAILURE', m, d),
  unauthorized: (m: string, d?: Record<string, unknown>) => new BoundaryError('UNAUTHORIZED', m, d),
  invalidRequest: (m: string, d?: Record<string, unknown>) => new BoundaryError('INVALID_REQUEST', m, d),
}

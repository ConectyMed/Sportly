import { BoundaryError, boundaryError, type BoundaryErrorCode } from '../errors'

/**
 * The only place a server adapter touches the network, injected so adapters can
 * be exercised with no key and no socket. Mirrors the client-side seam in
 * `src/coach/model/adapters/transport.ts` on purpose: same idea, server side.
 */
export interface TransportResponse {
  status: number
  text(): Promise<string>
}

export type Transport = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
  signal?: AbortSignal,
) => Promise<TransportResponse>

export const fetchTransport: Transport = async (url, init, signal) => {
  try {
    const res = await fetch(url, { ...init, signal })
    return { status: res.status, text: () => res.text() }
  } catch (err) {
    if (signal?.aborted) throw boundaryError.providerTimeout('The provider request timed out.')
    // A fetch failure can name an internal host; keep it for the server log only.
    throw new BoundaryError('PROVIDER_UNAVAILABLE', err instanceof Error ? err.message : 'Network error.', undefined, false)
  }
}

/**
 * Map a provider HTTP status onto the boundary's error vocabulary.
 *
 * The messages name the vendor and, for a 401, say its credentials were
 * rejected — useful in a server log, and not the client's business. They are
 * marked not client-safe so the caller sees the category's opaque text: a
 * client should not learn which vendor is behind the boundary, nor that the
 * server's key has stopped working.
 */
export function statusToBoundaryError(status: number, provider: string): BoundaryError {
  const opaque = (code: BoundaryErrorCode, message: string) => new BoundaryError(code, message, { status }, false)
  if (status === 401 || status === 403) return opaque('PROVIDER_UNAVAILABLE', `${provider} rejected the server credentials.`)
  if (status === 408 || status === 504) return opaque('PROVIDER_TIMEOUT', `${provider} timed out (${status}).`)
  if (status === 429) return opaque('RATE_LIMITED', `${provider} rate-limited the request.`)
  if (status >= 500) return opaque('PROVIDER_UNAVAILABLE', `${provider} is unavailable (${status}).`)
  return opaque('INVALID_MODEL_OUTPUT', `${provider} answered with status ${status}.`)
}

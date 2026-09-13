import { ProviderError } from '../contract'

/**
 * The only place an adapter touches the network. Injected so tests run with a
 * fake and no adapter ever needs a key or an endpoint to be exercised.
 */
export interface TransportResponse {
  status: number
  json(): Promise<unknown>
}

export type Transport = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }, signal?: AbortSignal) => Promise<TransportResponse>

export const fetchTransport: Transport = async (url, init, signal) => {
  try {
    const res = await fetch(url, { ...init, signal })
    return { status: res.status, json: () => res.json() }
  } catch (err) {
    if (signal?.aborted) throw new ProviderError('timeout', 'The request was cancelled.')
    throw new ProviderError('network', err instanceof Error ? err.message : 'Network error.')
  }
}

/** Map an HTTP status to a structured provider failure. */
export function statusError(status: number, provider: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('unauthorized', `${provider} rejected the credentials.`)
  if (status === 429 || status >= 500) return new ProviderError('unavailable', `${provider} is unavailable right now (${status}).`)
  return new ProviderError('malformed', `${provider} answered with status ${status}.`)
}

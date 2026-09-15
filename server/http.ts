import { isBoundaryError } from './errors.js'

/**
 * A small fetch-style HTTP shim.
 *
 * Handlers are written against the Web `Request`/`Response` types so they stay
 * portable, and `toNodeHandler` bridges them to the Node request/response pair
 * that Vercel's Node runtime passes in. That means the existing `vercel.json`
 * deploys `api/*` with no new configuration, and the same handler can be
 * mounted anywhere else later without being rewritten.
 */

export type FetchHandler = (request: Request) => Promise<Response>

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Map a thrown error to a response. A BoundaryError becomes its code, its
 * client-safe message and its (client-safe) detail; anything else becomes an
 * opaque 500, because an unexpected error's message may carry internals.
 */
export function errorResponse(err: unknown): Response {
  if (isBoundaryError(err)) {
    return jsonResponse(err.status, { error: { code: err.code, message: err.publicMessage, ...(err.detail ? { detail: err.detail } : {}) } })
  }
  return jsonResponse(500, { error: { code: 'PERSISTENCE_FAILURE', message: 'Unexpected server error.' } })
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return {}
  }
  if (!raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * The caller's address, for rate limiting.
 *
 * NOT the left-most X-Forwarded-For entry: under an appending proxy that entry
 * is whatever the client sent, so a client that sets its own header gets a
 * fresh rate-limit bucket on every request. Prefer the headers the platform
 * writes itself, and fall back to the RIGHT-most forwarded entry — the one the
 * nearest trusted proxy appended.
 */
export function clientIp(request: Request): string {
  const platform = request.headers.get('x-vercel-forwarded-for')?.trim() || request.headers.get('x-real-ip')?.trim()
  if (platform) return platform
  const forwarded = request.headers.get('x-forwarded-for')
  const hops = forwarded?.split(',').map((h) => h.trim()).filter(Boolean) ?? []
  return hops.at(-1) ?? 'unknown'
}

interface NodeLikeRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  on(event: string, listener: (chunk?: unknown) => void): unknown
}

interface NodeLikeResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(body?: string): unknown
}

function toWebRequest(req: NodeLikeRequest, body: string): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }
  const method = req.method ?? 'GET'
  const url = new URL(req.url ?? '/', `https://${headers.get('host') ?? 'localhost'}`)
  return new Request(url, { method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body }) })
}

/**
 * Largest request body the boundary will buffer. A vision call carries a
 * base64 image, so it is not small — but it is bounded, and the bound is
 * enforced while reading rather than after, because the body is buffered
 * before any authentication runs.
 */
export const MAX_BODY_BYTES = 6 * 1024 * 1024

/** Bridge a fetch-style handler to Vercel's Node signature. */
export function toNodeHandler(handler: FetchHandler, maxBodyBytes = MAX_BODY_BYTES) {
  return async (req: NodeLikeRequest, res: NodeLikeResponse): Promise<void> => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      return writeResponse(res, jsonResponse(413, { error: { code: 'INVALID_REQUEST', message: 'Request body is too large.' } }))
    }

    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk) => {
        if (tooLarge) return
        const buf = Buffer.from(chunk as Uint8Array)
        size += buf.byteLength
        // Stop accumulating the moment the cap is passed: an unauthenticated
        // caller must not be able to fill memory before the token is checked.
        if (size > maxBodyBytes) {
          tooLarge = true
          chunks.length = 0
          return
        }
        chunks.push(buf)
      })
      req.on('end', () => resolve())
      req.on('error', (err) => reject(err))
    })

    if (tooLarge) {
      return writeResponse(res, jsonResponse(413, { error: { code: 'INVALID_REQUEST', message: 'Request body is too large.' } }))
    }
    return writeResponse(res, await handler(toWebRequest(req, Buffer.concat(chunks).toString('utf8'))))
  }
}

async function writeResponse(res: NodeLikeResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(await response.text())
}

export function methodNotAllowed(allowed: string): Response {
  return jsonResponse(405, { error: { code: 'INVALID_REQUEST', message: `Only ${allowed} is allowed here.` } })
}

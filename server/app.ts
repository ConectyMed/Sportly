import { resolveDailyCaps, type DailyCaps } from './budget/caps.js'
import { runModelCall } from './boundary.js'
import { loadServerEnv, type EnvSource, type ServerEnv } from './env.js'
import { BoundaryError, boundaryError } from './errors.js'
import { bearerToken, verifyToken } from './identity/token.js'
import { mintSubjectToken } from './identity/mint.js'
import { clientIp, errorResponse, jsonResponse, methodNotAllowed, readJsonBody, type FetchHandler } from './http.js'
import { createProviders, type Providers } from './provider/index.js'
import { createPgExecutor } from './store/pgDriver.js'
import { createPostgresStore, type SqlExecutor } from './store/postgres.js'
import { createMemoryStore } from './store/memory.js'
import type { BoundaryStore } from './store/port.js'
import { isRoute } from './store/port.js'

/**
 * Assembly. Everything above this file is a part; this is where the parts are
 * wired into the two handlers `api/` exposes.
 *
 * The env is loaded here, once, so a missing signing secret fails at
 * construction rather than at the first request that happens to need it.
 */

/** ~3.7 MB of image once decoded — comfortably above a phone photo, well under the body cap. */
export const MAX_IMAGE_BASE64_CHARS = 5_000_000
export const MAX_INSTRUCTION_CHARS = 4_000
export const MAX_PROMPT_CHARS = 40_000

const instructionTooLong = (value: unknown): boolean => typeof value === 'string' && value.length > MAX_INSTRUCTION_CHARS

export interface BoundaryApp {
  env: ServerEnv
  store: BoundaryStore
  providers: Providers
  caps: DailyCaps
  handleMintToken: FetchHandler
  handleModelCall: FetchHandler
}

export interface CreateAppOptions {
  envSource?: EnvSource
  /** Injected in tests; production passes a Postgres executor. */
  store?: BoundaryStore
  sql?: SqlExecutor
  providers?: Providers
  now?: () => Date
}

/**
 * A per-process store makes the daily cap meaningless — every cold start resets
 * the spend to zero, and the one-token-per-subject rule with it — so it is
 * never the silent default. Order: an injected store, an injected executor, the
 * configured database, and only then an ephemeral store the deployment asked
 * for in so many words.
 */
function resolveStore(options: CreateAppOptions, env: ServerEnv): BoundaryStore {
  if (options.store) return options.store
  if (options.sql) return createPostgresStore(options.sql)
  if (env.databaseUrl) return createPostgresStore(createPgExecutor(env.databaseUrl))
  if (env.allowEphemeralStore) return createMemoryStore()
  throw new BoundaryError(
    'PERSISTENCE_FAILURE',
    'No storage is configured. Set SPORTLY_DATABASE_URL, or set SPORTLY_ALLOW_EPHEMERAL_STORE=1 to accept a per-process store — which resets the spend cap on every cold start and is for local development only.',
    undefined,
    // Names a server-only variable, and specifically the one that downgrades
    // the cap. That belongs in the deploy log, not in an HTTP body.
    false,
  )
}

export function createBoundaryApp(options: CreateAppOptions = {}): BoundaryApp {
  const env = loadServerEnv(options.envSource)
  const store = resolveStore(options, env)
  const providers = options.providers ?? createProviders(env)
  const caps = resolveDailyCaps(env)
  const now = options.now ?? (() => new Date())

  /** POST /api/identity/token — trust-on-first-use mint. */
  const handleMintToken: FetchHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    try {
      const body = await readJsonBody(request)
      const result = await mintSubjectToken({ store, secret: env.tokenSecret, nowMs: now().getTime() }, { subjectId: body.subjectId, rateLimitKey: clientIp(request) })
      return jsonResponse(200, result)
    } catch (err) {
      return errorResponse(err)
    }
  }

  /**
   * POST /api/model/call — the single server-side entry point for model calls.
   *
   * The subject comes from the verified token and only from there. A
   * `subjectId` in the body is ignored, not honoured, so a client cannot spend
   * or read under another subject.
   */
  const handleModelCall: FetchHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    try {
      const claims = verifyToken(bearerToken(request.headers.get('authorization')), env.tokenSecret)
      const body = await readJsonBody(request)

      const route = body.route
      if (!isRoute(route)) throw boundaryError.invalidRequest('route must be one of food_scan, coaching, program.')

      const taskType = body.taskType
      if (taskType !== 'vision' && taskType !== 'text') throw boundaryError.invalidRequest('taskType must be vision or text.')

      const ctx = { store, subjectId: claims.sub, caps, now }

      if (taskType === 'vision') {
        const image = body.imageBase64
        const mediaType = body.mediaType
        const instruction = body.instruction
        if (typeof image !== 'string' || !image) throw boundaryError.invalidRequest('imageBase64 is required for a vision call.')
        // Bounded before anything is sent: input tokens scale with image size,
        // and the cap is "have you already spent", never "will this spend".
        if (image.length > MAX_IMAGE_BASE64_CHARS) throw boundaryError.invalidRequest('Image is too large.', { maxBase64Chars: MAX_IMAGE_BASE64_CHARS })
        if (instructionTooLong(body.instruction)) throw boundaryError.invalidRequest('Instruction is too long.', { maxChars: MAX_INSTRUCTION_CHARS })
        if (mediaType !== 'image/jpeg' && mediaType !== 'image/png' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
          throw boundaryError.invalidRequest('mediaType must be image/jpeg, image/png, image/webp or image/gif.')
        }
        if (typeof instruction !== 'string' || !instruction.trim()) throw boundaryError.invalidRequest('instruction is required for a vision call.')
        const result = await runModelCall(ctx, {
          route,
          taskType: 'vision',
          provider: providers.vision.id,
          model: providers.vision.model,
          invoke: (options) => providers.vision.analyzeImage({ imageBase64: image, mediaType, instruction }, options),
        })
        return jsonResponse(200, { requestId: result.requestId, output: result.output })
      }

      const system = typeof body.system === 'string' ? body.system : ''
      const prompt = body.prompt
      if (typeof prompt !== 'string' || !prompt.trim()) throw boundaryError.invalidRequest('prompt is required for a text call.')
      if (prompt.length > MAX_PROMPT_CHARS) throw boundaryError.invalidRequest('Prompt is too long.', { maxChars: MAX_PROMPT_CHARS })
      const result = await runModelCall(ctx, {
        route,
        taskType: 'text',
        provider: providers.text.id,
        model: providers.text.model,
        invoke: (options) => providers.text.generateText({ system, prompt }, options),
      })
      return jsonResponse(200, { requestId: result.requestId, output: result.output })
    } catch (err) {
      return errorResponse(err)
    }
  }

  return { env, store, providers, caps, handleMintToken, handleModelCall }
}

/**
 * Lazily built singleton for the deployed handlers. Built on first request so a
 * configuration error surfaces as a 500 with a category rather than a module
 * that fails to import.
 */
let app: BoundaryApp | undefined

export function boundaryApp(): BoundaryApp {
  app ??= createBoundaryApp()
  return app
}

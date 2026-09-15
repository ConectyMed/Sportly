import { BoundaryError } from './errors.js'

/**
 * Server-only configuration.
 *
 * Every name here carries the `SPORTLY_` prefix. That is not decoration: it is
 * the contract `scripts/check-bundle-secrets.mjs` relies on when it scans the
 * built client bundle. Vite only inlines `VITE_`-prefixed variables, so a
 * `SPORTLY_` name can never reach the client by accident — and if one ever
 * does, the scanner fails the build.
 *
 * The token secret has no default and no dev fallback. A boundary that accepts
 * unsigned tokens "just in development" is a boundary that trusts a
 * client-supplied user id, which is exactly what V8a exists to prevent.
 */
export const SERVER_ONLY_ENV_VARS = [
  'SPORTLY_TOKEN_SECRET',
  'SPORTLY_ANTHROPIC_API_KEY',
  'SPORTLY_DATABASE_URL',
  'SPORTLY_VISION_MODEL',
  'SPORTLY_DAILY_CAP_FOOD_SCAN_USD',
  'SPORTLY_DAILY_CAP_COACHING_USD',
  'SPORTLY_DAILY_CAP_PROGRAM_USD',
  'SPORTLY_ALLOW_EPHEMERAL_STORE',
] as const

export type ServerOnlyEnvVar = (typeof SERVER_ONLY_ENV_VARS)[number]

/** The prefix `scripts/check-bundle-secrets.mjs` scans the bundle for. */
export const SERVER_ENV_PREFIX = 'SPORTLY_'

/** Short secrets make the HMAC cheap to brute-force; refuse them outright. */
export const MIN_TOKEN_SECRET_LENGTH = 32

export interface ServerEnv {
  tokenSecret: string
  anthropicApiKey?: string
  databaseUrl?: string
  visionModel: string
  /** Opt-in to a per-process store. Local development only — see server/app.ts. */
  allowEphemeralStore: boolean
  capOverridesUsd: Partial<Record<'food_scan' | 'coaching' | 'program', number>>
}

export type EnvSource = Record<string, string | undefined>

function positiveNumber(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new BoundaryError('PERSISTENCE_FAILURE', `${name} must be a non-negative number; got ${JSON.stringify(raw)}.`, undefined, false)
  return n
}

/**
 * Read and validate server configuration. Throws — loudly, at startup — when
 * the signing secret is missing or too short. Never returns a partly-valid
 * environment.
 */
export function loadServerEnv(source: EnvSource = process.env): ServerEnv {
  const secret = source.SPORTLY_TOKEN_SECRET?.trim()
  if (!secret) {
    throw new BoundaryError(
      'PERSISTENCE_FAILURE',
      'SPORTLY_TOKEN_SECRET is not set. The boundary refuses to start without it: without a signing secret it could only trust a client-supplied subject id.',
      undefined,
      // Configuration messages name server-only variables. They belong in the
      // deploy log, not in an HTTP body that tells a caller which variable
      // downgrades the cap.
      false,
    )
  }
  if (secret.length < MIN_TOKEN_SECRET_LENGTH) {
    throw new BoundaryError('PERSISTENCE_FAILURE', `SPORTLY_TOKEN_SECRET must be at least ${MIN_TOKEN_SECRET_LENGTH} characters; got ${secret.length}.`, undefined, false)
  }
  return {
    tokenSecret: secret,
    anthropicApiKey: source.SPORTLY_ANTHROPIC_API_KEY?.trim() || undefined,
    databaseUrl: source.SPORTLY_DATABASE_URL?.trim() || undefined,
    visionModel: source.SPORTLY_VISION_MODEL?.trim() || 'claude-sonnet-5',
    allowEphemeralStore: source.SPORTLY_ALLOW_EPHEMERAL_STORE === '1',
    capOverridesUsd: {
      food_scan: positiveNumber(source.SPORTLY_DAILY_CAP_FOOD_SCAN_USD, 'SPORTLY_DAILY_CAP_FOOD_SCAN_USD'),
      coaching: positiveNumber(source.SPORTLY_DAILY_CAP_COACHING_USD, 'SPORTLY_DAILY_CAP_COACHING_USD'),
      program: positiveNumber(source.SPORTLY_DAILY_CAP_PROGRAM_USD, 'SPORTLY_DAILY_CAP_PROGRAM_USD'),
    },
  }
}

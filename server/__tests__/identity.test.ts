import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadServerEnv, MIN_TOKEN_SECRET_LENGTH, SERVER_ENV_PREFIX, SERVER_ONLY_ENV_VARS } from '../env'
import { mintSubjectToken } from '../identity/mint'
import { bearerToken, isSubjectIdShape, mintToken, TOKEN_VERSION, verifyToken } from '../identity/token'
import { createMemoryStore } from '../store/memory'
import { SECRET, SUBJECT_A, SUBJECT_B, testEnv } from './helpers'

describe('server env', () => {
  it('fails loudly when the signing secret is absent — no unsigned fallback', () => {
    expect(() => loadServerEnv({})).toThrow(/SPORTLY_TOKEN_SECRET is not set/)
    expect(() => loadServerEnv({ SPORTLY_TOKEN_SECRET: '   ' })).toThrow(/SPORTLY_TOKEN_SECRET is not set/)
  })

  it('refuses a secret short enough to brute-force', () => {
    expect(() => loadServerEnv({ SPORTLY_TOKEN_SECRET: 'short' })).toThrow(new RegExp(`at least ${MIN_TOKEN_SECRET_LENGTH}`))
  })

  it('every server-only name carries the prefix the bundle scanner looks for', () => {
    // This is what makes the prefix scan in scripts/check-bundle-secrets.mjs a
    // complete check rather than a sample of names someone remembered.
    for (const name of SERVER_ONLY_ENV_VARS) expect(name.startsWith(SERVER_ENV_PREFIX)).toBe(true)
    // Vite only inlines VITE_-prefixed vars, so none of these can be inlined.
    for (const name of SERVER_ONLY_ENV_VARS) expect(name.startsWith('VITE_')).toBe(false)
  })

  it('rejects a malformed cap override instead of falling back to a default', () => {
    expect(() => loadServerEnv(testEnv({ SPORTLY_DAILY_CAP_COACHING_USD: 'free' }))).toThrow(/must be a non-negative number/)
    expect(() => loadServerEnv(testEnv({ SPORTLY_DAILY_CAP_COACHING_USD: '-1' }))).toThrow(/must be a non-negative number/)
    expect(loadServerEnv(testEnv({ SPORTLY_DAILY_CAP_COACHING_USD: '3' })).capOverridesUsd.coaching).toBe(3)
  })
})

describe('subject tokens', () => {
  it('round-trips a minted token', () => {
    const token = mintToken(SUBJECT_A, SECRET, 1_700_000_000_000)
    expect(verifyToken(token, SECRET)).toEqual({ v: TOKEN_VERSION, sub: SUBJECT_A, iat: 1_700_000_000 })
  })

  it('rejects a tampered payload', () => {
    const token = mintToken(SUBJECT_A, SECRET)
    const [, signature] = token.split('.')
    // Re-encode the payload with someone else's subject, keep the signature.
    const forgedPayload = Buffer.from(JSON.stringify({ v: TOKEN_VERSION, sub: SUBJECT_B, iat: 1 }), 'utf8').toString('base64url')
    expect(() => verifyToken(`${forgedPayload}.${signature}`, SECRET)).toThrow(/signature does not verify/)
  })

  it('rejects a token signed with a different secret', () => {
    const token = mintToken(SUBJECT_A, 'a-completely-different-secret-32-chars')
    expect(() => verifyToken(token, SECRET)).toThrow(/signature does not verify/)
  })

  it('rejects a token with the signature stripped or replaced', () => {
    const token = mintToken(SUBJECT_A, SECRET)
    const [payload] = token.split('.')
    expect(() => verifyToken(payload, SECRET)).toThrow(/Malformed/)
    expect(() => verifyToken(`${payload}.`, SECRET)).toThrow(/signature does not verify/)
    expect(() => verifyToken(`${payload}.AAAA`, SECRET)).toThrow(/signature does not verify/)
    expect(() => verifyToken('', SECRET)).toThrow(/Missing/)
    expect(() => verifyToken(undefined, SECRET)).toThrow(/Missing/)
  })

  it('rejects an unknown token version', () => {
    const payload = Buffer.from(JSON.stringify({ v: 99, sub: SUBJECT_A, iat: 1 }), 'utf8').toString('base64url')
    const signature = createHmac('sha256', SECRET).update(payload).digest('base64url')
    expect(() => verifyToken(`${payload}.${signature}`, SECRET)).toThrow(/Unsupported subject token version/)
  })

  it('refuses to mint for anything that is not a UUID', () => {
    expect(isSubjectIdShape('not-a-uuid')).toBe(false)
    expect(isSubjectIdShape(SUBJECT_A)).toBe(true)
    expect(() => mintToken('alex', SECRET)).toThrow(/must be a UUID/)
  })

  it('parses the Authorization header and refuses anything else', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def')
    expect(bearerToken('bearer abc.def')).toBe('abc.def')
    expect(() => bearerToken(undefined)).toThrow(/Authorization: Bearer/)
    expect(() => bearerToken('Basic abc')).toThrow(/Authorization: Bearer/)
  })
})

describe('trust-on-first-use minting', () => {
  it('adopts the client’s existing local id as the subject', async () => {
    const store = createMemoryStore()
    const result = await mintSubjectToken({ store, secret: SECRET }, { subjectId: SUBJECT_A, rateLimitKey: 'ip-1' })
    expect(result.subjectId).toBe(SUBJECT_A)
    expect(verifyToken(result.token, SECRET).sub).toBe(SUBJECT_A)
  })

  it('refuses a second token for a subject it has already bound', async () => {
    const store = createMemoryStore()
    await mintSubjectToken({ store, secret: SECRET }, { subjectId: SUBJECT_A, rateLimitKey: 'ip-1' })
    await expect(mintSubjectToken({ store, secret: SECRET }, { subjectId: SUBJECT_A, rateLimitKey: 'ip-2' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('refuses a subject id that is not UUID-shaped', async () => {
    const store = createMemoryStore()
    await expect(mintSubjectToken({ store, secret: SECRET }, { subjectId: 'alex', rateLimitKey: 'ip-1' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(mintSubjectToken({ store, secret: SECRET }, { subjectId: 42, rateLimitKey: 'ip-1' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('rate-limits the mint endpoint, since minting creates rows', async () => {
    const store = createMemoryStore({ mintLimit: 3 })
    const uuid = (n: number) => `3333333${n}-3333-4333-8333-333333333333`
    for (let i = 0; i < 3; i += 1) {
      await mintSubjectToken({ store, secret: SECRET }, { subjectId: uuid(i), rateLimitKey: 'same-ip' })
    }
    await expect(mintSubjectToken({ store, secret: SECRET }, { subjectId: uuid(4), rateLimitKey: 'same-ip' })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    // A different caller is unaffected.
    await expect(mintSubjectToken({ store, secret: SECRET }, { subjectId: uuid(5), rateLimitKey: 'other-ip' })).resolves.toMatchObject({ subjectId: uuid(5) })
  })

  it('does not burn a rate-limit slot on a request it rejects outright', async () => {
    const store = createMemoryStore({ mintLimit: 1 })
    await expect(mintSubjectToken({ store, secret: SECRET }, { subjectId: 'nope', rateLimitKey: 'ip' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(mintSubjectToken({ store, secret: SECRET }, { subjectId: SUBJECT_A, rateLimitKey: 'ip' })).resolves.toMatchObject({ subjectId: SUBJECT_A })
  })
})

describe('storage configuration', () => {
  it('refuses to run on a per-process store unless the deployment opts in', async () => {
    const { createBoundaryApp } = await import('../app')
    const { fakeProviders, fakeVisionProvider } = await import('./helpers')
    const providers = fakeProviders(fakeVisionProvider())

    // A cap backed by a store that empties on every cold start is not a cap.
    expect(() => createBoundaryApp({ envSource: testEnv(), providers })).toThrow(/No storage is configured/)

    const opted = createBoundaryApp({ envSource: testEnv({ SPORTLY_ALLOW_EPHEMERAL_STORE: '1' }), providers })
    expect(opted.store).toBeDefined()
  })

  it('uses the Postgres adapter when a SQL executor is supplied', async () => {
    const { createBoundaryApp } = await import('../app')
    const { fakeProviders, fakeVisionProvider } = await import('./helpers')
    const calls: string[] = []
    const app = createBoundaryApp({
      envSource: testEnv(),
      sql: (async (text: string) => {
        calls.push(text)
        return { rows: [] }
      }) as never,
      providers: fakeProviders(fakeVisionProvider()),
    })
    await app.store.readCallLog(SUBJECT_A)
    expect(calls[0]).toContain('sportly_model_call_log')
  })
})

describe('rate-limit bucketing cannot be chosen by the caller', () => {
  it('ignores a client-supplied X-Forwarded-For in favour of the platform header', async () => {
    const { clientIp } = await import('../http')
    const req = (headers: Record<string, string>) => new Request('https://x/api/identity/token', { method: 'POST', headers })

    // Left-most XFF is whatever the client sent under an appending proxy.
    expect(clientIp(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }))).toBe('203.0.113.7')
    // A platform header wins outright.
    expect(clientIp(req({ 'x-forwarded-for': '9.9.9.9', 'x-vercel-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(clientIp(req({ 'x-forwarded-for': '9.9.9.9', 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('a spoofed X-Forwarded-For does not buy a fresh mint bucket', async () => {
    const { createBoundaryApp } = await import('../app')
    const { fakeProviders, fakeVisionProvider } = await import('./helpers')
    const store = createMemoryStore({ mintLimit: 2 })
    const app = createBoundaryApp({ envSource: testEnv({ SPORTLY_ALLOW_EPHEMERAL_STORE: '1' }), store, providers: fakeProviders(fakeVisionProvider()) })

    const uuid = (n: number) => `5555555${n}-5555-4555-8555-555555555555`
    const statuses: number[] = []
    for (let i = 0; i < 6; i += 1) {
      const res = await app.handleMintToken(
        new Request('https://x/api/identity/token', {
          method: 'POST',
          // A different forged left-most hop every time, behind one real proxy.
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` },
          body: JSON.stringify({ subjectId: uuid(i) }),
        }),
      )
      statuses.push(res.status)
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(2)
    expect(statuses.filter((s) => s === 429)).toHaveLength(4)
  })
})

describe('configuration details stay out of HTTP responses', () => {
  it('does not name server-only variables in an error body', async () => {
    const { errorResponse } = await import('../http')
    const { createBoundaryApp } = await import('../app')
    const { fakeProviders, fakeVisionProvider } = await import('./helpers')

    for (const source of [{}, testEnv()]) {
      const err = (() => {
        try {
          createBoundaryApp({ envSource: source, providers: fakeProviders(fakeVisionProvider()) })
          return undefined
        } catch (e) {
          return e
        }
      })()
      expect(err).toBeDefined()
      const body = JSON.stringify(await (await errorResponse(err)).json())
      expect(body).not.toContain('SPORTLY_')
      expect(body).toContain('PERSISTENCE_FAILURE')
      // The operator still gets the real message, in the deploy log.
      expect((err as Error).message).toContain('SPORTLY_')
    }
  })
})

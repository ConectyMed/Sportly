import { describe, expect, it } from 'vitest'
import { createBoundaryApp } from '../app.js'
import { createMemoryStore } from '../store/memory.js'
import { mintToken } from '../identity/token.js'
import { fakeProviders, fakeVisionProvider, readJson, SECRET, SUBJECT_A, SUBJECT_B, testEnv, type ErrorEnvelope } from './helpers.js'

/**
 * Scope isolation has to prove two separate things, and a test that proves only
 * the first would pass just as happily under a trusted client-sent user id —
 * which would make it worthless as evidence:
 *
 *   1. a token for subject A cannot read or write subject B's rows, AND
 *   2. a forged or tampered token is rejected outright.
 */

const visionBody = (extra: Record<string, unknown> = {}) => ({
  route: 'food_scan',
  taskType: 'vision',
  imageBase64: 'aGVsbG8=',
  mediaType: 'image/jpeg',
  instruction: 'what is on this plate',
  ...extra,
})

function post(url: string, body: unknown, token?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

function appWith(store = createMemoryStore(), vision = fakeVisionProvider()) {
  const app = createBoundaryApp({ envSource: testEnv(), store, providers: fakeProviders(vision) })
  return { app, store, vision }
}

describe('user scope isolation — writes', () => {
  it('logs the call under the token’s subject, not one supplied in the body', async () => {
    const { app, store } = appWith()
    // The body tries to claim B while the token says A.
    const res = await app.handleModelCall(post('https://x/api/model/call', visionBody({ subjectId: SUBJECT_B, userId: SUBJECT_B }), mintToken(SUBJECT_A, SECRET)))
    expect(res.status).toBe(200)

    expect(await store.readCallLog(SUBJECT_A)).toHaveLength(1)
    expect(await store.readCallLog(SUBJECT_B)).toHaveLength(0)
  })

  it('spend accrues to the token’s subject only', async () => {
    const { app, store } = appWith()
    await app.handleModelCall(post('https://x/api/model/call', visionBody(), mintToken(SUBJECT_A, SECRET)))
    const day = new Date().toISOString().slice(0, 10)
    expect(await store.spendTodayUsd(SUBJECT_A, 'food_scan', day)).toBeGreaterThan(0)
    expect(await store.spendTodayUsd(SUBJECT_B, 'food_scan', day)).toBe(0)
  })
})

describe('user scope isolation — reads', () => {
  it('a subject reads only its own rows', async () => {
    const { app, store } = appWith()
    await app.handleModelCall(post('https://x/api/model/call', visionBody(), mintToken(SUBJECT_A, SECRET)))
    await app.handleModelCall(post('https://x/api/model/call', visionBody({ route: 'coaching' }), mintToken(SUBJECT_B, SECRET)))

    const a = await store.readCallLog(SUBJECT_A)
    const b = await store.readCallLog(SUBJECT_B)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a.every((r) => r.subjectId === SUBJECT_A)).toBe(true)
    expect(b.every((r) => r.subjectId === SUBJECT_B)).toBe(true)
    expect(a[0].route).toBe('food_scan')
    expect(b[0].route).toBe('coaching')
  })

  it('the HTTP surface exposes no read path at all, so a cross-subject read cannot even be requested', async () => {
    const { app } = appWith()
    // Only two handlers exist, both POST-only, and neither returns log rows.
    // readCallLog is reachable from tests and tooling, never from a request.
    expect(Object.keys(app).filter((k) => k.startsWith('handle')).sort()).toEqual(['handleMintToken', 'handleModelCall'])
    const res = await app.handleModelCall(post('https://x/api/model/call', visionBody(), mintToken(SUBJECT_A, SECRET)))
    expect(Object.keys(await res.json() as object).sort()).toEqual(['output', 'requestId'])
  })

  it('a row written for one subject is invisible to another through every port operation', async () => {
    const store = createMemoryStore()
    await store.settleSpend(null, {
      ts: new Date().toISOString(), subjectId: SUBJECT_B, requestId: 'r', route: 'coaching', provider: 'p', model: 'claude-sonnet-5',
      taskType: 'text', tokensIn: 10, tokensCached: 0, tokensOut: 10, costUsd: 0.01, costUnknownModel: false,
      latencyMs: 1, retryCount: 0, outcome: 'success', errorCategory: null,
    })
    expect(await store.readCallLog(SUBJECT_A)).toEqual([])
    expect(await store.spendTodayUsd(SUBJECT_A, 'coaching', new Date().toISOString().slice(0, 10))).toBe(0)
  })
})

describe('user scope isolation — forged tokens', () => {
  it('rejects a request with no token', async () => {
    const { app, store, vision } = appWith()
    const res = await app.handleModelCall(post('https://x/api/model/call', visionBody()))
    expect(res.status).toBe(401)
    expect((await readJson<ErrorEnvelope>(res)).error.code).toBe('UNAUTHORIZED')
    expect(vision.calls).toBe(0)
    expect(store.rows).toHaveLength(0)
  })

  it('rejects a token signed with the wrong secret', async () => {
    const { app, vision } = appWith()
    const res = await app.handleModelCall(post('https://x/api/model/call', visionBody(), mintToken(SUBJECT_A, 'attacker-secret-long-enough-to-sign')))
    expect(res.status).toBe(401)
    expect(vision.calls).toBe(0)
  })

  it('rejects a token whose payload was swapped to another subject', async () => {
    const { app, store, vision } = appWith()
    const [, signature] = mintToken(SUBJECT_A, SECRET).split('.')
    const forged = `${Buffer.from(JSON.stringify({ v: 1, sub: SUBJECT_B, iat: 1 }), 'utf8').toString('base64url')}.${signature}`

    const res = await app.handleModelCall(post('https://x/api/model/call', visionBody(), forged))
    expect(res.status).toBe(401)
    expect(vision.calls).toBe(0)
    // No row was written under either subject.
    expect(await store.readCallLog(SUBJECT_A)).toHaveLength(0)
    expect(await store.readCallLog(SUBJECT_B)).toHaveLength(0)
  })

  it('rejects an unsigned "token" that just names a subject', async () => {
    const { app, vision } = appWith()
    for (const bogus of [SUBJECT_A, `${SUBJECT_A}.`, Buffer.from(SUBJECT_A).toString('base64url')]) {
      const res = await app.handleModelCall(post('https://x/api/model/call', visionBody(), bogus))
      expect(res.status).toBe(401)
    }
    expect(vision.calls).toBe(0)
  })
})

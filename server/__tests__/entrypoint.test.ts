import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createBoundaryApp, MAX_IMAGE_BASE64_CHARS, MAX_INSTRUCTION_CHARS, MAX_PROMPT_CHARS } from '../app.js'
import { BoundaryError } from '../errors.js'
import { mintToken } from '../identity/token.js'
import { createMemoryStore } from '../store/memory.js'
import { fakeProviders, fakeVisionProvider, readJson, SECRET, SUBJECT_A, testEnv, type CallEnvelope, type ErrorEnvelope } from './helpers.js'

const post = (body: unknown, token?: string) =>
  new Request('https://x/api/model/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })

const visionBody = (extra: Record<string, unknown> = {}) => ({ route: 'food_scan', taskType: 'vision', imageBase64: 'aGVsbG8=', mediaType: 'image/jpeg', instruction: 'what is this', ...extra })

describe('the single model-call entry point', () => {
  it('answers a well-formed vision call and writes one row', async () => {
    const store = createMemoryStore()
    const app = createBoundaryApp({ envSource: testEnv(), store, providers: fakeProviders(fakeVisionProvider()) })
    const res = await app.handleModelCall(post(visionBody(), mintToken(SUBJECT_A, SECRET)))
    expect(res.status).toBe(200)
    const json = await readJson<CallEnvelope>(res)
    expect(json.output.text).toBe('a plate of food')
    expect(json.requestId).toEqual(expect.any(String))
    expect(store.rows).toHaveLength(1)
  })

  it('routes a text call to the not-implemented adapter and still logs the failure', async () => {
    const store = createMemoryStore()
    const app = createBoundaryApp({ envSource: testEnv(), store, providers: fakeProviders(fakeVisionProvider()) })
    // Swap in the real not-implemented text provider for this assertion.
    const real = createBoundaryApp({ envSource: testEnv(), store, providers: { vision: app.providers.vision, text: (await import('../provider/adapters/notImplementedText.js')).createNotImplementedTextProvider() } })
    const res = await real.handleModelCall(post({ route: 'coaching', taskType: 'text', prompt: 'hello' }, mintToken(SUBJECT_A, SECRET)))
    expect(res.status).toBe(502)
    expect((await readJson<ErrorEnvelope>(res)).error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({ taskType: 'text', outcome: 'error', errorCategory: 'PROVIDER_UNAVAILABLE' })
  })

  it('rejects a malformed request before touching a provider', async () => {
    const store = createMemoryStore()
    const vision = fakeVisionProvider()
    const app = createBoundaryApp({ envSource: testEnv(), store, providers: fakeProviders(vision) })
    const token = mintToken(SUBJECT_A, SECRET)

    for (const body of [
      visionBody({ route: 'not_a_route' }),
      visionBody({ taskType: 'audio' }),
      visionBody({ imageBase64: '' }),
      visionBody({ mediaType: 'image/tiff' }),
      visionBody({ instruction: '  ' }),
      { route: 'coaching', taskType: 'text' },
    ]) {
      const res = await app.handleModelCall(post(body, token))
      expect(res.status).toBe(400)
      expect((await readJson<ErrorEnvelope>(res)).error.code).toBe('INVALID_REQUEST')
    }
    expect(vision.calls).toBe(0)
    expect(store.rows).toHaveLength(0)
  })

  it('refuses anything but POST', async () => {
    const app = createBoundaryApp({ envSource: testEnv(), store: createMemoryStore(), providers: fakeProviders(fakeVisionProvider()) })
    const res = await app.handleModelCall(new Request('https://x/api/model/call', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('returns the budget error as a structured code', async () => {
    const store = createMemoryStore()
    const app = createBoundaryApp({ envSource: testEnv({ SPORTLY_DAILY_CAP_FOOD_SCAN_USD: '0' }), store, providers: fakeProviders(fakeVisionProvider()) })
    const res = await app.handleModelCall(post(visionBody(), mintToken(SUBJECT_A, SECRET)))
    expect(res.status).toBe(402)
    expect((await readJson<ErrorEnvelope>(res)).error).toMatchObject({ code: 'BUDGET_EXCEEDED', detail: { route: 'food_scan', capUsd: 0 } })
  })

  it('never echoes an internal error message to the client', async () => {
    const store = createMemoryStore()
    store.settleSpend = async () => {
      throw new Error('connection string postgres://user:hunter2@db/internal')
    }
    const app = createBoundaryApp({ envSource: testEnv(), store, providers: fakeProviders(fakeVisionProvider()) })
    const res = await app.handleModelCall(post(visionBody(), mintToken(SUBJECT_A, SECRET)))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await readJson<ErrorEnvelope>(res))).not.toContain('hunter2')
  })

  it('the mint endpoint is reachable and enforces one token per subject', async () => {
    const app = createBoundaryApp({ envSource: testEnv(), store: createMemoryStore(), providers: fakeProviders(fakeVisionProvider()) })
    const mint = (subjectId: unknown) => app.handleMintToken(new Request('https://x/api/identity/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subjectId }) }))

    const first = await mint(SUBJECT_A)
    expect(first.status).toBe(200)
    expect((await readJson<{ token: string }>(first)).token).toEqual(expect.any(String))

    const second = await mint(SUBJECT_A)
    expect(second.status).toBe(401)

    const bad = await mint('alex')
    expect(bad.status).toBe(400)
  })

  it('refuses to construct without a signing secret', () => {
    expect(() => createBoundaryApp({ envSource: {}, store: createMemoryStore() })).toThrow(/SPORTLY_TOKEN_SECRET is not set/)
  })
})

describe('the client cannot reach a provider directly', () => {
  it('no file under src/ imports the server boundary or an api handler', async () => {
    const { execSync } = await import('node:child_process')
    const hits = execSync(`grep -rn --include=*.ts --include=*.tsx -E "from '[^']*(\\.\\./)*(server|api)/" src || true`, { encoding: 'utf8' })
      .split('\n')
      .filter((line) => /from '[^']*(\.\.\/)+(server|api)\//.test(line))
    expect(hits).toEqual([])
  })

  it('every server-only env var is absent from the client source tree', async () => {
    const { execSync } = await import('node:child_process')
    const { SERVER_ONLY_ENV_VARS } = await import('../env.js')
    for (const name of SERVER_ONLY_ENV_VARS) {
      const hits = execSync(`grep -rn --include=*.ts --include=*.tsx --include=*.html "${name}" src index.html || true`, { encoding: 'utf8' }).trim()
      expect(hits, `${name} must not appear in client source`).toBe('')
    }
  })

  it('the bundle scanner looks for the prefix the server actually uses', async () => {
    const script = await readFile('scripts/check-bundle-secrets.mjs', 'utf8')
    const { SERVER_ENV_PREFIX, SERVER_ONLY_ENV_VARS } = await import('../env.js')
    expect(script).toContain(SERVER_ENV_PREFIX)
    expect(SERVER_ONLY_ENV_VARS.every((n) => n.startsWith(SERVER_ENV_PREFIX))).toBe(true)
  })
})

describe('error vocabulary', () => {
  it('maps every code to a distinct, sensible status', () => {
    const expected: Record<string, number> = {
      PROVIDER_UNAVAILABLE: 502, PROVIDER_TIMEOUT: 504, INVALID_MODEL_OUTPUT: 502,
      BUDGET_EXCEEDED: 402, RATE_LIMITED: 429, PERSISTENCE_FAILURE: 500,
      UNAUTHORIZED: 401, INVALID_REQUEST: 400,
    }
    for (const [code, status] of Object.entries(expected)) {
      expect(new BoundaryError(code as never, 'x').status).toBe(status)
    }
  })
})

describe('fail-closed pricing at the entry point', () => {
  it('refuses a call whose configured model has no rate, before reaching a provider', async () => {
    const store = createMemoryStore()
    const vision = fakeVisionProvider({ model: 'some-unreleased-model' })
    const app = createBoundaryApp({ envSource: testEnv(), store, providers: fakeProviders(vision) })

    const res = await app.handleModelCall(post(visionBody(), mintToken(SUBJECT_A, SECRET)))
    expect(res.status).toBe(400)
    expect((await readJson<ErrorEnvelope>(res)).error).toMatchObject({ code: 'INVALID_REQUEST', detail: { model: 'some-unreleased-model' } })
    expect(vision.calls).toBe(0)
    expect(store.rows).toHaveLength(0)
  })
})

describe('payload limits', () => {
  it('rejects an oversized image and an overlong prompt before any provider call', async () => {
    const store = createMemoryStore()
    const vision = fakeVisionProvider()
    const app = createBoundaryApp({ envSource: testEnv(), store, providers: fakeProviders(vision) })
    const token = mintToken(SUBJECT_A, SECRET)

    const big = await app.handleModelCall(post(visionBody({ imageBase64: 'A'.repeat(MAX_IMAGE_BASE64_CHARS + 1) }), token))
    expect(big.status).toBe(400)
    expect((await readJson<ErrorEnvelope>(big)).error.code).toBe('INVALID_REQUEST')

    const wordy = await app.handleModelCall(post(visionBody({ instruction: 'x'.repeat(MAX_INSTRUCTION_CHARS + 1) }), token))
    expect(wordy.status).toBe(400)

    const prompt = await app.handleModelCall(post({ route: 'coaching', taskType: 'text', prompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) }, token))
    expect(prompt.status).toBe(400)

    expect(vision.calls).toBe(0)
  })
})

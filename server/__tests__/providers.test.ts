import { describe, expect, it } from 'vitest'
import { createAnthropicVisionProvider, fromAnthropicResponse, toAnthropicRequest } from '../provider/adapters/anthropicVision'
import { createNotImplementedTextProvider } from '../provider/adapters/notImplementedText'
import { createProviders } from '../provider'
import type { TextProvider, Transport, VisionProvider } from '../provider'
import { statusToBoundaryError } from '../provider/transport'
import { loadServerEnv } from '../env'
import { testEnv } from './helpers'

const request = { imageBase64: 'aGVsbG8=', mediaType: 'image/jpeg' as const, instruction: 'what is on this plate' }

const transportReturning = (status: number, body: unknown): Transport => async () => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })

const okBody = {
  model: 'claude-sonnet-5',
  content: [{ type: 'text', text: 'grilled chicken and rice' }],
  usage: { input_tokens: 1200, output_tokens: 90, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 },
}

describe('both adapters conform to the neutral interface', () => {
  it('the vision adapter satisfies VisionProvider', () => {
    const provider: VisionProvider = createAnthropicVisionProvider({ apiKey: 'k', model: 'claude-sonnet-5' })
    expect(provider.taskType).toBe('vision')
    expect(provider.id).toBe('anthropic')
    expect(typeof provider.analyzeImage).toBe('function')
  })

  it('the text adapter satisfies TextProvider and throws NotImplemented', async () => {
    const provider: TextProvider = createNotImplementedTextProvider()
    expect(provider.taskType).toBe('text')
    expect(typeof provider.generateText).toBe('function')
    await expect(provider.generateText({ system: 's', prompt: 'p' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      detail: { reason: 'not_implemented' },
    })
  })

  it('createProviders builds both from server-only config and refuses without a key', () => {
    const providers = createProviders(loadServerEnv(testEnv()))
    expect(providers.vision.taskType).toBe('vision')
    expect(providers.text.taskType).toBe('text')
    expect(() => createProviders(loadServerEnv(testEnv({ SPORTLY_ANTHROPIC_API_KEY: '' })))).toThrow(/No server API key/)
  })
})

describe('anthropic vision adapter', () => {
  it('builds the native request without leaking it into the interface', () => {
    const native = toAnthropicRequest(request, 'claude-sonnet-5', 512) as Record<string, never>
    expect(native.model).toBe('claude-sonnet-5')
    expect(native.max_tokens).toBe(512)
    const content = (native.messages as unknown as Array<{ content: Array<Record<string, unknown>> }>)[0].content
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' } })
    expect(content[1]).toEqual({ type: 'text', text: 'what is on this plate' })
  })

  it('reads usage counters the cost table can price', () => {
    const result = fromAnthropicResponse(okBody, 'claude-sonnet-5')
    expect(result.output.text).toBe('grilled chicken and rice')
    // cache *creation* is billed above the input rate, so it counts as uncached.
    expect(result.usage).toEqual({ tokensIn: 1240, tokensCached: 300, tokensOut: 90 })
    expect(result.model).toBe('claude-sonnet-5')
  })

  it('sends the key in the header and never in the body', async () => {
    let seen: { headers: Record<string, string>; body: string } | undefined
    const transport: Transport = async (_url, init) => {
      seen = { headers: init.headers, body: init.body }
      return { status: 200, text: async () => JSON.stringify(okBody) }
    }
    const provider = createAnthropicVisionProvider({ apiKey: 'sk-ant-secret', model: 'claude-sonnet-5', transport })
    await provider.analyzeImage(request)
    expect(seen!.headers['x-api-key']).toBe('sk-ant-secret')
    expect(seen!.body).not.toContain('sk-ant-secret')
  })

  it('maps provider statuses onto the boundary error vocabulary', async () => {
    const cases: Array<[number, string]> = [
      [401, 'PROVIDER_UNAVAILABLE'],
      [429, 'RATE_LIMITED'],
      [500, 'PROVIDER_UNAVAILABLE'],
      [503, 'PROVIDER_UNAVAILABLE'],
      [504, 'PROVIDER_TIMEOUT'],
      [418, 'INVALID_MODEL_OUTPUT'],
    ]
    for (const [status, code] of cases) {
      expect(statusToBoundaryError(status, 'Anthropic').code).toBe(code)
      const provider = createAnthropicVisionProvider({ apiKey: 'k', model: 'claude-sonnet-5', transport: transportReturning(status, {}) })
      await expect(provider.analyzeImage(request)).rejects.toMatchObject({ code })
    }
  })

  it('treats an unreadable or empty answer as INVALID_MODEL_OUTPUT', async () => {
    const garbage = createAnthropicVisionProvider({ apiKey: 'k', model: 'claude-sonnet-5', transport: transportReturning(200, 'not json') })
    await expect(garbage.analyzeImage(request)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' })

    const empty = createAnthropicVisionProvider({ apiKey: 'k', model: 'claude-sonnet-5', transport: transportReturning(200, { content: [] }) })
    await expect(empty.analyzeImage(request)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' })

    const noContent = createAnthropicVisionProvider({ apiKey: 'k', model: 'claude-sonnet-5', transport: transportReturning(200, {}) })
    await expect(noContent.analyzeImage(request)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' })
  })

  it('refuses to call without a server key', async () => {
    const provider = createAnthropicVisionProvider({ apiKey: '', model: 'claude-sonnet-5', transport: transportReturning(200, okBody) })
    await expect(provider.analyzeImage(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })
})

describe('the vendor does not leak to the client', () => {
  it('keeps the provider name and its credential state out of the response body', async () => {
    const { errorResponse } = await import('../http')
    for (const status of [401, 429, 500, 504, 418]) {
      const err = statusToBoundaryError(status, 'Anthropic')
      // The operator's log gets the real message…
      expect(err.message).toContain('Anthropic')
      // …the client gets the category, and learns neither the vendor nor that
      // the server's key has stopped working.
      const body = JSON.stringify(await (await errorResponse(err)).json())
      expect(body).not.toContain('Anthropic')
      expect(body).not.toContain('credentials')
      expect(body).toContain(err.code)
    }
  })
})

import { boundaryError } from '../../errors.js'
import type { ProviderCallOptions, ProviderResult, VisionOutput, VisionProvider, VisionRequest } from '../contract.js'
import { fetchTransport, statusToBoundaryError, type Transport } from '../transport.js'

/**
 * Anthropic Messages API, image input. A real adapter: it builds the real
 * request, reads the real usage counters, and maps real failures.
 *
 * Nothing in this file is exported into feature code — callers hold a
 * `VisionProvider`. The native request and response shapes below stop here.
 *
 * V8a does not wire this into Food Scan; that is a later session. What it does
 * is prove the boundary's shape end to end: one entry point, a neutral
 * interface, usage the cost table can price.
 */

const API_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 1024

export interface AnthropicVisionConfig {
  apiKey: string
  model: string
  baseUrl?: string
  transport?: Transport
  maxTokens?: number
}

/* --------------------------------------------------------- Native shapes */

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface AnthropicResponse {
  model?: string
  content?: Array<{ type?: string; text?: string }>
  usage?: AnthropicUsage
}

export function toAnthropicRequest(request: VisionRequest, model: string, maxTokens: number): Record<string, unknown> {
  return {
    model,
    max_tokens: request.maxTokens ?? maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: request.mediaType, data: request.imageBase64 } },
          { type: 'text', text: request.instruction },
        ],
      },
    ],
  }
}

/**
 * Cache *creation* tokens are billed above the input rate, not below it, so
 * they are counted as uncached input rather than folded into `tokensCached`.
 * Treating them as cached reads would under-report cost.
 */
export function fromAnthropicResponse(json: unknown, fallbackModel: string): ProviderResult<VisionOutput> {
  const res = json as AnthropicResponse
  if (!res || !Array.isArray(res.content)) throw boundaryError.invalidModelOutput('Anthropic returned no content block.')
  const text = res.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim()
  if (!text) throw boundaryError.invalidModelOutput('Anthropic returned an empty vision response.')
  const usage = res.usage ?? {}
  return {
    output: { text },
    usage: {
      tokensIn: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      tokensCached: usage.cache_read_input_tokens ?? 0,
      tokensOut: usage.output_tokens ?? 0,
    },
    model: res.model ?? fallbackModel,
  }
}

/* --------------------------------------------------------- Provider */

export function createAnthropicVisionProvider(config: AnthropicVisionConfig): VisionProvider {
  const transport = config.transport ?? fetchTransport
  const baseUrl = (config.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS

  return {
    id: 'anthropic',
    model: config.model,
    taskType: 'vision',

    async analyzeImage(request: VisionRequest, options: ProviderCallOptions = {}): Promise<ProviderResult<VisionOutput>> {
      if (!config.apiKey) throw boundaryError.providerUnavailable('No server API key configured for Anthropic.')
      const res = await transport(
        `${baseUrl}/v1/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': API_VERSION },
          body: JSON.stringify(toAnthropicRequest(request, config.model, maxTokens)),
        },
        options.signal,
      )
      const body = await res.text()
      if (res.status !== 200) throw statusToBoundaryError(res.status, 'Anthropic')
      let json: unknown
      try {
        json = JSON.parse(body)
      } catch {
        throw boundaryError.invalidModelOutput('Anthropic returned invalid JSON.')
      }
      return fromAnthropicResponse(json, config.model)
    },
  }
}

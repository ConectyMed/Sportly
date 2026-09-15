
import type { EnvSource } from '../env.js'
import type { ProviderResult, Providers, TextProvider, VisionOutput, VisionProvider } from '../provider/index.js'

export const SECRET = 'test-secret-that-is-long-enough-to-pass-32'
export const SUBJECT_A = '11111111-1111-4111-8111-111111111111'
export const SUBJECT_B = '22222222-2222-4222-8222-222222222222'

export function testEnv(overrides: EnvSource = {}): EnvSource {
  return { SPORTLY_TOKEN_SECRET: SECRET, SPORTLY_ANTHROPIC_API_KEY: 'sk-ant-test-key', SPORTLY_VISION_MODEL: 'claude-sonnet-5', ...overrides }
}

export interface FakeVisionOptions {
  model?: string
  tokensIn?: number
  tokensCached?: number
  tokensOut?: number
  /** When set, every attempt throws this instead of answering. */
  fail?: () => Error
  /** Throw on the first N attempts, then succeed. */
  failFirst?: number
}

export function fakeVisionProvider(options: FakeVisionOptions = {}): VisionProvider & { calls: number } {
  const provider = {
    id: 'fake',
    model: options.model ?? 'claude-sonnet-5',
    taskType: 'vision' as const,
    calls: 0,
    async analyzeImage(): Promise<ProviderResult<VisionOutput>> {
      provider.calls += 1
      if (options.fail) throw options.fail()
      if (options.failFirst && provider.calls <= options.failFirst) throw new Error('transient')
      return {
        output: { text: 'a plate of food' },
        usage: { tokensIn: options.tokensIn ?? 1000, tokensCached: options.tokensCached ?? 0, tokensOut: options.tokensOut ?? 100 },
        model: options.model ?? 'claude-sonnet-5',
      }
    },
  }
  return provider
}

export function fakeTextProvider(): TextProvider {
  return {
    id: 'fake_text',
    model: 'claude-sonnet-5',
    taskType: 'text',
    async generateText() {
      throw new Error('not used')
    },
  }
}

export function fakeProviders(vision: VisionProvider): Providers {
  return { vision, text: fakeTextProvider() }
}


export interface ErrorEnvelope {
  error: { code: string; message: string; detail?: Record<string, unknown> }
}

export interface CallEnvelope {
  requestId: string
  output: { text: string }
}

export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

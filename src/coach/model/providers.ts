import type { CoachConfig } from '@/domain/types'
import type { ModelProvider, ProviderId } from './contract'

/**
 * Provider configuration. The app always works with the built-in coach; a
 * model is used only when the user has configured one completely. No key or
 * endpoint is ever bundled, and an incomplete configuration falls back to the
 * built-in coach instead of breaking anything.
 */

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  local: 'Built-in coach',
  anthropic: 'Claude',
  openai: 'OpenAI',
  local_llm: 'Local model',
}

export const PROVIDER_IDS: ProviderId[] = ['local', 'anthropic', 'openai', 'local_llm']

export const DEFAULT_LOCAL_LLM_URL = 'http://localhost:11434/v1'

export interface ProviderStatus {
  id: ProviderId
  label: string
  /** Whether the configuration is complete enough to try the provider. */
  ready: boolean
  /** Which engine actually answers: a model, or the built-in coach as fallback. */
  active: ProviderId
  reason?: string
}

export function isProviderId(x: unknown): x is ProviderId {
  return typeof x === 'string' && (PROVIDER_IDS as string[]).includes(x)
}

export function providerStatus(coach: CoachConfig): ProviderStatus {
  const id: ProviderId = isProviderId(coach.provider) ? coach.provider : 'local'
  const label = PROVIDER_LABELS[id]
  const fallback = (reason: string): ProviderStatus => ({ id, label, ready: false, active: 'local', reason })
  switch (id) {
    case 'local':
      return { id, label, ready: true, active: 'local' }
    case 'anthropic':
      return coach.anthropicApiKey ? { id, label, ready: true, active: id } : fallback('No API key saved; the built-in coach answers.')
    case 'openai':
      return coach.openaiApiKey ? { id, label, ready: true, active: id } : fallback('No API key saved; the built-in coach answers.')
    case 'local_llm':
      return coach.localLlmModel?.trim() ? { id, label, ready: true, active: id } : fallback('No model name set; the built-in coach answers.')
  }
}

/**
 * Build the configured model provider, or undefined when the built-in coach
 * should answer. Adapters are loaded lazily so the default bundle carries no
 * provider code.
 */
export async function resolveModelProvider(coach: CoachConfig): Promise<ModelProvider | undefined> {
  const status = providerStatus(coach)
  if (!status.ready || status.active === 'local') return undefined
  switch (status.active) {
    case 'anthropic': {
      const { AnthropicProvider } = await import('./adapters/anthropic')
      return new AnthropicProvider({ apiKey: coach.anthropicApiKey, model: coach.anthropicModel || 'claude-sonnet-5' })
    }
    case 'openai': {
      const { OpenAICompatibleProvider } = await import('./adapters/openaiCompatible')
      return new OpenAICompatibleProvider({ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: coach.openaiModel || 'gpt-4.1-mini', apiKey: coach.openaiApiKey })
    }
    case 'local_llm': {
      const { OpenAICompatibleProvider } = await import('./adapters/openaiCompatible')
      return new OpenAICompatibleProvider({ id: 'local_llm', label: 'Local model', baseUrl: coach.localLlmUrl?.trim() || DEFAULT_LOCAL_LLM_URL, model: coach.localLlmModel!.trim() })
    }
    default:
      return undefined
  }
}

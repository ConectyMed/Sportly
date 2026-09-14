/**
 * The provider seam. Feature code imports from here and nowhere deeper — the
 * vendor adapters under ./adapters are reached only through `createProviders`.
 */
export type {
  AnyProvider,
  ProviderCallOptions,
  ProviderResult,
  ProviderUsage,
  TextOutput,
  TextProvider,
  TextRequest,
  VisionOutput,
  VisionProvider,
  VisionRequest,
} from './contract'
export { fetchTransport, statusToBoundaryError, type Transport, type TransportResponse } from './transport'

import type { ServerEnv } from '../env'
import { boundaryError } from '../errors'
import type { TextProvider, VisionProvider } from './contract'
import { createAnthropicVisionProvider } from './adapters/anthropicVision'
import { createNotImplementedTextProvider } from './adapters/notImplementedText'
import type { Transport } from './transport'

export interface Providers {
  vision: VisionProvider
  text: TextProvider
}

export interface ProviderFactoryOptions {
  transport?: Transport
}

/**
 * Build the providers for this deployment from server-only configuration. The
 * key is read here and handed to the adapter; it is never returned, logged or
 * echoed.
 */
export function createProviders(env: ServerEnv, options: ProviderFactoryOptions = {}): Providers {
  if (!env.anthropicApiKey) throw boundaryError.providerUnavailable('No server API key configured for Anthropic.')
  return {
    vision: createAnthropicVisionProvider({ apiKey: env.anthropicApiKey, model: env.visionModel, transport: options.transport }),
    text: createNotImplementedTextProvider(),
  }
}

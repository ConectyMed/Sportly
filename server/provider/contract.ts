import type { TaskType } from '../store/port'

/**
 * The neutral provider interface.
 *
 * Feature code imports from `server/provider` and sees only these types. No
 * vendor name, no vendor SDK, no vendor request shape crosses this file —
 * translation lives inside each adapter, the way `src/coach/model/adapters`
 * already does it on the client.
 */

/** What the boundary needs back from every provider, whatever the task. */
export interface ProviderUsage {
  /** Uncached input tokens. */
  tokensIn: number
  /** Input tokens served from the provider's prompt cache. */
  tokensCached: number
  tokensOut: number
}

export interface ProviderResult<T> {
  output: T
  usage: ProviderUsage
  /** The model that actually answered, as the provider reported it. */
  model: string
}

export interface ProviderCallOptions {
  signal?: AbortSignal
}

export interface VisionRequest {
  /** Base64 image data, no data: prefix. */
  imageBase64: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  /** What the caller wants read out of the image. */
  instruction: string
  maxTokens?: number
}

export interface VisionOutput {
  text: string
}

export interface TextRequest {
  system: string
  prompt: string
  maxTokens?: number
}

export interface TextOutput {
  text: string
}

interface ProviderIdentity {
  /** Stable id recorded in the call log's `provider` column. */
  readonly id: string
  /** Default model this provider calls, recorded in `model`. */
  readonly model: string
  readonly taskType: TaskType
}

export interface VisionProvider extends ProviderIdentity {
  readonly taskType: 'vision'
  analyzeImage(request: VisionRequest, options?: ProviderCallOptions): Promise<ProviderResult<VisionOutput>>
}

export interface TextProvider extends ProviderIdentity {
  readonly taskType: 'text'
  generateText(request: TextRequest, options?: ProviderCallOptions): Promise<ProviderResult<TextOutput>>
}

export type AnyProvider = VisionProvider | TextProvider

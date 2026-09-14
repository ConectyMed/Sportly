import { BoundaryError } from '../../errors'
import type { ProviderResult, TextOutput, TextProvider, TextRequest } from '../contract'

/**
 * The text side of the interface, deliberately unimplemented.
 *
 * V8a's scope excludes the coaching model, but shipping the vision adapter
 * alone would leave the interface unproven: one implementation is a shape a
 * single vendor happens to fit. This adapter conforms to `TextProvider` in
 * full and refuses at the call, so the boundary, the registry and the log
 * writer are all exercised against a second provider without a coaching model
 * existing yet.
 *
 * It throws PROVIDER_UNAVAILABLE (detail `reason: 'not_implemented'`) because
 * that is what it is from the caller's side: a provider that cannot serve the
 * request. The call still produces a log row, with `outcome: 'error'`.
 */
/**
 * `model` defaults to the model a coaching provider would actually call. It has
 * to be one the rate table prices, because admission refuses an unpriced model
 * before the adapter is reached — so a placeholder id would mean this adapter
 * never got exercised through the entry point at all.
 */
export function createNotImplementedTextProvider(model = 'claude-sonnet-5'): TextProvider {
  return {
    id: 'not_implemented',
    model,
    taskType: 'text',

    async generateText(_request: TextRequest): Promise<ProviderResult<TextOutput>> {
      throw new BoundaryError('PROVIDER_UNAVAILABLE', 'The text provider is not implemented in V8a.', { reason: 'not_implemented' })
    },
  }
}

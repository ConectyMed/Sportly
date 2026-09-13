/**
 * The provider seam. A real model plugs in here:
 *
 *   ModelProvider.complete(CoachModelInput) → CoachModelOutput { message, toolCalls }
 *   runModelTurn → runToolCall (allowlist → schema → resolve → materialise → registry) → ToolCallResult
 *
 * Adapters live in ./adapters and are loaded lazily by resolveModelProvider.
 */
export type { CoachModelInput, CoachModelOutput, CompleteOptions, ModelMessage, ModelProvider, ModelStep, ProviderId, ToolCall, ToolCallErrorCode, ToolCallResult, ToolDefinition } from './contract'
export { ProviderError } from './contract'
export { normalizeToolCall, resetModelToolLedger, runToolCall, type ToolRunContext, type ToolRunOutcome } from './modelTools'
export { DEFAULT_LIMITS, normalizeModelOutput, runModelTurn, type ModelTurnOptions, type ModelTurnResult } from './loop'
export { buildModelInput, buildSystemPrompt, type ModelTurnRequest } from './prompt'
export { parseArguments, type JsonSchema } from './schema'
export { ACTION_TOOLS, READ_TOOLS, TOOL_NAMES, findToolDefinition, toolDefinitions } from './toolDefinitions'
export { DEFAULT_LOCAL_LLM_URL, PROVIDER_IDS, PROVIDER_LABELS, isProviderId, providerStatus, resolveModelProvider, type ProviderStatus } from './providers'
export { resolveDate, resolveGoal, resolveMeal, resolveWorkout } from './resolve'

import type { ActionRecord, Attachment, CoachPersonality, DomainChange, EntityRef, ExpectSlot } from '@/domain/types'
import type { Language } from '@/i18n/types'
import type { CoachContextSnapshot } from '../context'
import type { ToolErrorCode } from '../tools/contracts'
import type { JsonSchema } from './schema'

/**
 * The provider-neutral contract between Sportly and any model.
 *
 *   MODEL DECIDES  →  CoachModelOutput { message, toolCalls }
 *   SPORTLY EXECUTES  →  ToolCallResult (validated, executed, audited)
 *   MODEL SEES THE NEW REALITY  →  next CoachModelInput (context rebuilt from the store)
 *
 * Nothing here knows about OpenAI, Anthropic or the local engine. Adapters
 * translate to and from native formats behind `ModelProvider`.
 */

export type ProviderId = 'local' | 'anthropic' | 'openai' | 'local_llm'

/** One tool as a model sees it. Built once, converted per provider. */
export interface ToolDefinition {
  name: string
  kind: 'read' | 'action'
  description: string
  inputSchema: JsonSchema
  /** Human-readable rules the model should respect (also validated by Sportly). */
  constraints?: string[]
}

/** A request from the model. Arguments are structured, untrusted data. */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type ToolCallErrorCode = ToolErrorCode | 'unknown_tool' | 'invalid_arguments' | 'skipped' | 'limit_reached'

/** What Sportly reports back after (not) running a tool call. Always factual. */
export interface ToolCallResult {
  toolCallId: string
  name: string
  ok: boolean
  /** The real state after the call (e.g. the goal as stored), never “OK”. */
  data?: unknown
  error?: { code: ToolCallErrorCode; message: string; candidates?: EntityRef[] }
  affectedEntities: EntityRef[]
  changes: DomainChange[]
}

export interface ModelMessage {
  role: 'user' | 'assistant'
  text: string
  at?: string
}

/** One round of the tool loop: what the model asked, what Sportly answered. */
export interface ModelStep {
  assistant: { message: string; toolCalls: ToolCall[] }
  results: ToolCallResult[]
}

export interface RelevantKnowledge {
  title: string
  excerpt: string
  source: string
  topics: string[]
}

export interface CoachModelInput {
  /** Instructions: who the coach is, the rules of the house, how to use tools. */
  system: string
  persona: { name: string; personality: CoachPersonality; description: string }
  /** The user's selected language. The model must answer in it, whatever the language of the message. */
  language: { code: Language; name: string; locale: string; instruction: string }
  context: {
    /** CURRENT: the structured state right now (rebuilt every step). */
    current: CoachContextSnapshot
    /** RELEVANT: memories and knowledge selected for this message. */
    relevant: { memory: Array<{ id: string; category: string; text: string }>; knowledge: RelevantKnowledge[] }
    /** HISTORICAL data is not sent; the model retrieves it with read tools. */
  }
  /** RECENT conversation, oldest first, excluding the current message. */
  conversation: ModelMessage[]
  userMessage: {
    text: string
    attachments: Array<{ id: string; kind: Attachment['kind']; name: string }>
    /** Sportly's own estimate of an attached food photo/description, if any. */
    foodEstimate?: { name: string; analysis: string; items: Array<{ name: string; grams: number; calories: number }> }
  }
  tools: ToolDefinition[]
  /** Earlier rounds of this same turn (tool calls and their real results). */
  steps: ModelStep[]
}

export interface CoachModelOutput {
  message: string
  toolCalls: ToolCall[]
  references?: EntityRef[]
  suggestedFollowups?: string[]
  expects?: ExpectSlot
  /** 'tool_calls' means the model expects results back; 'end' means the message is final. */
  stop: 'end' | 'tool_calls'
}

export interface CompleteOptions {
  signal?: AbortSignal
}

/** Anything that can play the role of the brain. Implemented by adapters and by test fakes. */
export interface ModelProvider {
  id: ProviderId | string
  label: string
  complete(input: CoachModelInput, opts?: CompleteOptions): Promise<CoachModelOutput>
}

export type ProviderErrorKind = 'unavailable' | 'unauthorized' | 'timeout' | 'malformed' | 'network'

export class ProviderError extends Error {
  kind: ProviderErrorKind
  constructor(kind: ProviderErrorKind, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
  }
}

/** Records executed during a model turn, tagged with the tool call that requested them. */
export type ModelActionRecord = ActionRecord & { toolCallId?: string }

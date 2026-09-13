import type { CoachModelInput, CoachModelOutput, CompleteOptions, ModelProvider, ToolCall, ToolDefinition } from '../contract'
import { ProviderError } from '../contract'
import { normalizeToolCall } from '../modelTools'
import { fetchTransport, statusError, type Transport } from './transport'

/**
 * OpenAI-compatible chat completions with tool calling. One adapter covers
 * OpenAI itself and any local OpenAI-compatible endpoint (Ollama, LM Studio):
 * only the base URL, the model name and whether a key is sent differ.
 *
 * The translation functions are pure and exported so the boundary can be
 * tested without a network or a key.
 */

export interface OpenAICompatibleConfig {
  id: 'openai' | 'local_llm'
  label: string
  baseUrl: string
  model: string
  apiKey?: string
  transport?: Transport
  maxTokens?: number
}

/* ------------------------------------------------------------------ Native shapes (kept here, never in the domain) */

export interface OpenAITool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export interface OpenAIChatRequest {
  model: string
  messages: OpenAIMessage[]
  tools?: OpenAITool[]
  tool_choice?: 'auto'
  max_tokens?: number
}

export interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>
}

/* ------------------------------------------------------------------ Translation */

export function toOpenAITools(defs: ToolDefinition[]): OpenAITool[] {
  return defs.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.constraints?.length ? `${t.description} Constraints: ${t.constraints.join(' ')}` : t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }))
}

/** Everything the model must know that is not conversation: the rules, then the structured context. */
function systemContent(input: CoachModelInput): string {
  const ctx = { context: input.context.current, relevant: input.context.relevant }
  return `${input.system}\n\nCONTEXT (authoritative, JSON):\n${JSON.stringify(ctx)}`
}

function userContent(input: CoachModelInput): string {
  const parts = [input.userMessage.text]
  if (input.userMessage.attachments.length) parts.push(`[attachments: ${input.userMessage.attachments.map((a) => `${a.kind} ${a.name}`).join(', ')}]`)
  if (input.userMessage.foodEstimate) parts.push(`[food estimate: ${JSON.stringify(input.userMessage.foodEstimate)}]`)
  return parts.join('\n')
}

export function toOpenAIRequest(input: CoachModelInput, model: string, maxTokens = 700): OpenAIChatRequest {
  const messages: OpenAIMessage[] = [{ role: 'system', content: systemContent(input) }]
  for (const m of input.conversation) messages.push({ role: m.role, content: m.text || '(attachment)' })
  messages.push({ role: 'user', content: userContent(input) })
  for (const step of input.steps) {
    messages.push({
      role: 'assistant',
      content: step.assistant.message || null,
      tool_calls: step.assistant.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })),
    })
    for (const r of step.results) messages.push({ role: 'tool', tool_call_id: r.toolCallId, content: JSON.stringify(r.ok ? { ok: true, data: r.data, changes: r.changes.map((c) => c.summary) } : { ok: false, error: r.error }) })
  }
  return { model, messages, tools: toOpenAITools(input.tools), tool_choice: 'auto', max_tokens: maxTokens }
}

/** Native tool calls → Sportly's neutral ToolCall. */
export function fromOpenAIToolCalls(calls: NonNullable<NonNullable<OpenAIChatResponse['choices']>[number]['message']>['tool_calls']): ToolCall[] {
  return (calls ?? []).map((c, i) => normalizeToolCall({ id: c.id, name: c.function?.name, arguments: c.function?.arguments }, i)).filter((c): c is ToolCall => c !== null)
}

export function fromOpenAIResponse(json: unknown): CoachModelOutput {
  const res = json as OpenAIChatResponse
  const choice = res?.choices?.[0]
  if (!choice?.message) throw new ProviderError('malformed', 'No choices in the response.')
  const toolCalls = fromOpenAIToolCalls(choice.message.tool_calls)
  const message = (choice.message.content ?? '').trim()
  if (!message && !toolCalls.length) throw new ProviderError('malformed', 'Empty response.')
  return { message, toolCalls, stop: toolCalls.length ? 'tool_calls' : 'end' }
}

/* ------------------------------------------------------------------ Provider */

export class OpenAICompatibleProvider implements ModelProvider {
  id: 'openai' | 'local_llm'
  label: string
  private config: OpenAICompatibleConfig
  private transport: Transport

  constructor(config: OpenAICompatibleConfig) {
    this.id = config.id
    this.label = config.label
    this.config = config
    this.transport = config.transport ?? fetchTransport
  }

  async complete(input: CoachModelInput, opts: CompleteOptions = {}): Promise<CoachModelOutput> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`
    const res = await this.transport(url, { method: 'POST', headers, body: JSON.stringify(toOpenAIRequest(input, this.config.model, this.config.maxTokens)) }, opts.signal)
    if (res.status !== 200) throw statusError(res.status, this.label)
    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new ProviderError('malformed', `${this.label} returned invalid JSON.`)
    }
    return fromOpenAIResponse(json)
  }
}

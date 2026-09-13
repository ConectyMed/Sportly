import type { CoachModelInput, CoachModelOutput, CompleteOptions, ModelProvider, ToolCall, ToolDefinition } from '../contract'
import { ProviderError } from '../contract'
import { normalizeToolCall } from '../modelTools'
import { fetchTransport, statusError, type Transport } from './transport'

/**
 * Anthropic Messages API with tool use. Pure translation functions plus a
 * thin transport; nothing here leaks into the domain.
 */

export interface AnthropicConfig {
  model: string
  apiKey?: string
  baseUrl?: string
  transport?: Transport
  maxTokens?: number
}

/* ------------------------------------------------------------------ Native shapes */

export interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicRequest {
  model: string
  max_tokens: number
  system: string
  tools: AnthropicTool[]
  messages: AnthropicMessage[]
}

export interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>
  stop_reason?: string
}

/* ------------------------------------------------------------------ Translation */

export function toAnthropicTools(defs: ToolDefinition[]): AnthropicTool[] {
  return defs.map((t) => ({
    name: t.name,
    description: t.constraints?.length ? `${t.description} Constraints: ${t.constraints.join(' ')}` : t.description,
    input_schema: t.inputSchema as Record<string, unknown>,
  }))
}

function userContent(input: CoachModelInput): string {
  const parts = [input.userMessage.text]
  if (input.userMessage.attachments.length) parts.push(`[attachments: ${input.userMessage.attachments.map((a) => `${a.kind} ${a.name}`).join(', ')}]`)
  if (input.userMessage.foodEstimate) parts.push(`[food estimate: ${JSON.stringify(input.userMessage.foodEstimate)}]`)
  return parts.join('\n') || '(attachment)'
}

export function toAnthropicRequest(input: CoachModelInput, model: string, maxTokens = 700): AnthropicRequest {
  const system = `${input.system}\n\nCONTEXT (authoritative, JSON):\n${JSON.stringify({ context: input.context.current, relevant: input.context.relevant })}`
  const messages: AnthropicMessage[] = []
  for (const m of input.conversation) messages.push({ role: m.role, content: m.text || '(attachment)' })
  messages.push({ role: 'user', content: userContent(input) })
  for (const step of input.steps) {
    const blocks: AnthropicContentBlock[] = []
    if (step.assistant.message) blocks.push({ type: 'text', text: step.assistant.message })
    for (const c of step.assistant.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments })
    messages.push({ role: 'assistant', content: blocks })
    messages.push({
      role: 'user',
      content: step.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.toolCallId, content: JSON.stringify(r.ok ? { ok: true, data: r.data, changes: r.changes.map((c) => c.summary) } : { ok: false, error: r.error }), is_error: !r.ok })),
    })
  }
  // Consecutive same-role messages are merged so the transcript stays valid whatever the history looks like.
  const merged: AnthropicMessage[] = []
  for (const m of messages) {
    const last = merged.at(-1)
    if (last && last.role === m.role) {
      const a = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : last.content
      const b = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content
      last.content = [...a, ...b]
    } else merged.push({ ...m })
  }
  return { model, max_tokens: maxTokens, system, tools: toAnthropicTools(input.tools), messages: merged }
}

export function fromAnthropicResponse(json: unknown): CoachModelOutput {
  const res = json as AnthropicResponse
  if (!Array.isArray(res?.content)) throw new ProviderError('malformed', 'No content in the response.')
  const message = res.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim()
  const toolCalls = res.content
    .filter((c) => c.type === 'tool_use')
    .map((c, i) => normalizeToolCall({ id: c.id, name: c.name, arguments: c.input }, i))
    .filter((c): c is ToolCall => c !== null)
  if (!message && !toolCalls.length) throw new ProviderError('malformed', 'Empty response.')
  return { message, toolCalls, stop: res.stop_reason === 'tool_use' || toolCalls.length ? 'tool_calls' : 'end' }
}

/* ------------------------------------------------------------------ Provider */

export class AnthropicProvider implements ModelProvider {
  id = 'anthropic' as const
  label = 'Claude'
  private config: AnthropicConfig
  private transport: Transport

  constructor(config: AnthropicConfig) {
    this.config = config
    this.transport = config.transport ?? fetchTransport
  }

  async complete(input: CoachModelInput, opts: CompleteOptions = {}): Promise<CoachModelOutput> {
    if (!this.config.apiKey) throw new ProviderError('unauthorized', 'No API key configured for Claude.')
    const url = `${(this.config.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`
    const res = await this.transport(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.config.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify(toAnthropicRequest(input, this.config.model, this.config.maxTokens)),
      },
      opts.signal,
    )
    if (res.status !== 200) throw statusError(res.status, this.label)
    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new ProviderError('malformed', 'Claude returned invalid JSON.')
    }
    return fromAnthropicResponse(json)
  }
}

import { beforeEach, describe, expect, it } from 'vitest'
import type { CoachModelInput } from '@/coach/model'
import { ProviderError, buildModelInput, resetModelToolLedger, runModelTurn, toolDefinitions } from '@/coach/model'
import { AnthropicProvider, fromAnthropicResponse, toAnthropicRequest, toAnthropicTools } from '@/coach/model/adapters/anthropic'
import { OpenAICompatibleProvider, fromOpenAIResponse, toOpenAIRequest, toOpenAITools } from '@/coach/model/adapters/openaiCompatible'
import type { Transport } from '@/coach/model/adapters/transport'
import { providerStatus, resolveModelProvider } from '@/coach/model/providers'
import { resetActionLedger } from '@/coach/tools/registry'
import { buildDemoSeed } from '@/domain/demo'
import { useStore } from '@/store/useStore'

/**
 * Provider adapters, exercised with mocked native responses: no network, no
 * key. Each adapter must translate its native tool-call format into Sportly's
 * neutral ToolCall and nothing provider-specific may leak into the domain.
 */

const state = () => useStore.getState()

/** Every source file as text (bundler-resolved), for the architecture and secret scans. */
const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function reset() {
  state().resetAll()
  state().seed(buildDemoSeed())
  resetActionLedger()
  resetModelToolLedger()
  const conv = state().createConversation('Adapters')
  state().setActiveConversation(conv.id)
  return conv.id
}

function input(text = 'I want to train three days a week'): CoachModelInput {
  return buildModelInput(state(), state().conversations[0], { text, attachments: [] }, [])
}

/** A transport that answers with a canned JSON body and records what was sent. */
function fakeTransport(body: unknown, status = 200): { transport: Transport; sent: Array<{ url: string; headers: Record<string, string>; body: unknown }> } {
  const sent: Array<{ url: string; headers: Record<string, string>; body: unknown }> = []
  const transport: Transport = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    return { status, json: async () => body }
  }
  return { transport, sent }
}

describe('tool schemas: one source, three shapes', () => {
  it('OpenAI-style and Anthropic-style tools are derived from the same definitions', () => {
    const defs = toolDefinitions()
    const oa = toOpenAITools(defs)
    const an = toAnthropicTools(defs)
    expect(oa.length).toBe(defs.length)
    expect(an.length).toBe(defs.length)
    expect(oa.map((t) => t.function.name)).toEqual(defs.map((d) => d.name))
    expect(an.map((t) => t.name)).toEqual(defs.map((d) => d.name))
    const plan = defs.find((d) => d.name === 'plan_workout')!
    expect(oa.find((t) => t.function.name === 'plan_workout')!.function.parameters).toEqual(plan.inputSchema)
    expect(an.find((t) => t.name === 'plan_workout')!.input_schema).toEqual(plan.inputSchema)
    expect(oa.find((t) => t.function.name === 'plan_workout')!.function.description).toContain('Constraints:')
    // Every schema is a strict object schema with described properties.
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object')
      expect(d.inputSchema.additionalProperties).toBe(false)
      for (const [k, p] of Object.entries(d.inputSchema.properties ?? {})) expect(p.description, `${d.name}.${k}`).toBeTruthy()
    }
    expect(new Set(defs.map((d) => d.name)).size).toBe(defs.length)
  })
})

describe('OpenAI-compatible adapter', () => {
  beforeEach(reset)

  it('builds a chat request with system + context, conversation, tools and the tool transcript', () => {
    const inp = input()
    inp.steps.push({
      assistant: { message: '', toolCalls: [{ id: 'call_1', name: 'update_availability', arguments: { daysPerWeek: 3 } }] },
      results: [{ toolCallId: 'call_1', name: 'update_availability', ok: true, data: { daysPerWeek: 3 }, affectedEntities: [], changes: [] }],
    })
    const req = toOpenAIRequest(inp, 'test-model')
    expect(req.model).toBe('test-model')
    expect(req.messages[0].role).toBe('system')
    expect(req.messages[0].content).toContain('CONTEXT')
    expect(req.messages[0].content).toContain('"daysPerWeek":4')
    expect(req.tools!.length).toBe(toolDefinitions().length)
    const assistant = req.messages.find((m) => m.role === 'assistant' && m.tool_calls)!
    expect(assistant.tool_calls![0]).toEqual({ id: 'call_1', type: 'function', function: { name: 'update_availability', arguments: '{"daysPerWeek":3}' } })
    const tool = req.messages.find((m) => m.role === 'tool')!
    expect(tool.tool_call_id).toBe('call_1')
    expect(JSON.parse(tool.content!)).toEqual({ ok: true, data: { daysPerWeek: 3 }, changes: [] })
  })

  it('OpenAI-style tool call → Sportly ToolCall', () => {
    const out = fromOpenAIResponse({ choices: [{ message: { content: null, tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'update_availability', arguments: '{"daysPerWeek": 3}' } }] }, finish_reason: 'tool_calls' }] })
    expect(out.stop).toBe('tool_calls')
    expect(out.toolCalls).toEqual([{ id: 'call_abc', name: 'update_availability', arguments: { daysPerWeek: 3 } }])
    const text = fromOpenAIResponse({ choices: [{ message: { content: 'Rest today.' } }] })
    expect(text).toMatchObject({ message: 'Rest today.', toolCalls: [], stop: 'end' })
    expect(() => fromOpenAIResponse({})).toThrow(ProviderError)
    expect(() => fromOpenAIResponse({ choices: [{ message: { content: '' } }] })).toThrow(/Empty/)
  })

  it('OpenAI-compatible local endpoint (Ollama / LM Studio shape) drives the real tool layer end to end', async () => {
    const conv = reset()
    let turn = 0
    const transport: Transport = async (url, init) => {
      const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: string | null }> }
      expect(url).toBe('http://localhost:11434/v1/chat/completions')
      expect(init.headers.authorization).toBeUndefined()
      turn++
      if (turn === 1) return { status: 200, json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'call_local_1', type: 'function', function: { name: 'update_availability', arguments: '{"daysPerWeek":3}' } }] } }] }) }
      const toolMsg = body.messages.find((m) => m.role === 'tool')!
      const result = JSON.parse(toolMsg.content!) as { ok: boolean; data: { daysPerWeek: number } }
      return { status: 200, json: async () => ({ choices: [{ message: { content: `Got it — I'll plan around ${result.data.daysPerWeek} training days per week.` } }] }) }
    }
    const provider = new OpenAICompatibleProvider({ id: 'local_llm', label: 'Local model', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', transport })
    const r = await runModelTurn(provider, conv, { text: 'I want to train three days a week', attachments: [] })
    expect(state().user!.availability.daysPerWeek).toBe(3)
    expect(r.reply.text).toContain('3 training days')
    expect(r.records[0].via).toBe('update_availability')
    expect(r.records[0].toolCallId).toBe('call_local_1')
  })

  it('sends the key only as a bearer header when configured, and maps HTTP failures to provider errors', async () => {
    const ok = fakeTransport({ choices: [{ message: { content: 'hi' } }] })
    const p = new OpenAICompatibleProvider({ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKey: 'sk-test', transport: ok.transport })
    await p.complete(input())
    expect(ok.sent[0].headers.authorization).toBe('Bearer sk-test')
    expect(JSON.stringify(ok.sent[0].body)).not.toContain('sk-test')
    const denied = new OpenAICompatibleProvider({ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKey: 'bad', transport: fakeTransport({}, 401).transport })
    await expect(denied.complete(input())).rejects.toMatchObject({ kind: 'unauthorized' })
    const down = new OpenAICompatibleProvider({ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKey: 'k', transport: fakeTransport({}, 503).transport })
    await expect(down.complete(input())).rejects.toMatchObject({ kind: 'unavailable' })
  })
})

describe('Anthropic adapter', () => {
  beforeEach(reset)

  it('builds a messages request with system, tools and tool_use / tool_result blocks', () => {
    const inp = input()
    inp.steps.push({
      assistant: { message: 'Let me check.', toolCalls: [{ id: 'toolu_1', name: 'get_today', arguments: {} }] },
      results: [{ toolCallId: 'toolu_1', name: 'get_today', ok: false, error: { code: 'failed', message: 'boom' }, affectedEntities: [], changes: [] }],
    })
    const req = toAnthropicRequest(inp, 'claude-test')
    expect(req.system).toContain('CONTEXT')
    expect(req.tools[0]).toHaveProperty('input_schema')
    const assistant = req.messages.find((m) => m.role === 'assistant' && Array.isArray(m.content))!
    expect(assistant.content).toEqual([
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_today', input: {} },
    ])
    const last = req.messages.at(-1)!
    expect(last.role).toBe('user')
    expect((last.content as Array<{ type: string; is_error?: boolean }>)[0]).toMatchObject({ type: 'tool_result', is_error: true })
    // Roles alternate.
    for (let i = 1; i < req.messages.length; i++) expect(req.messages[i].role).not.toBe(req.messages[i - 1].role)
  })

  it('Anthropic-style tool call → Sportly ToolCall', () => {
    const out = fromAnthropicResponse({ content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'toolu_01', name: 'set_goal', input: { goal: 'strength' } }], stop_reason: 'tool_use' })
    expect(out.message).toBe('On it.')
    expect(out.toolCalls).toEqual([{ id: 'toolu_01', name: 'set_goal', arguments: { goal: 'strength' } }])
    expect(out.stop).toBe('tool_calls')
    expect(() => fromAnthropicResponse({ error: 'x' })).toThrow(ProviderError)
  })

  it('runs the tool loop through the Sportly registry with a mocked Claude', async () => {
    const conv = reset()
    let turn = 0
    const transport: Transport = async (url, init) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      expect(init.headers['x-api-key']).toBe('sk-ant-test')
      turn++
      if (turn === 1) return { status: 200, json: async () => ({ content: [{ type: 'tool_use', id: 'toolu_a', name: 'set_goal', input: { goal: 'lose_fat', metric: 'body_weight', target: 70 } }], stop_reason: 'tool_use' }) }
      const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: unknown }> }
      const results = body.messages.at(-1)!.content as Array<{ type: string; content: string }>
      const data = JSON.parse(results[0].content) as { ok: boolean; data: { targetValue: number } }
      return { status: 200, json: async () => ({ content: [{ type: 'text', text: `Goal set: lose fat, target ${data.data.targetValue} kg.` }], stop_reason: 'end_turn' }) }
    }
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', model: 'claude-test', transport })
    const r = await runModelTurn(provider, conv, { text: 'I want to get to 70 kg', attachments: [] })
    expect(r.reply.text).toBe('Goal set: lose fat, target 70 kg.')
    expect(state().goals.find((g) => g.rank === 'primary')).toMatchObject({ type: 'lose_fat', targetValue: 70 })
  })

  it('refuses to run without a key', async () => {
    const p = new AnthropicProvider({ model: 'x', transport: fakeTransport({}).transport })
    await expect(p.complete(input())).rejects.toMatchObject({ kind: 'unauthorized' })
  })
})

describe('configuration', () => {
  beforeEach(reset)

  it('defaults to the built-in coach and never breaks when a provider is selected without credentials', async () => {
    expect(providerStatus(state().coach)).toMatchObject({ id: 'local', active: 'local', ready: true })
    state().updateCoach({ provider: 'openai' })
    expect(providerStatus(state().coach)).toMatchObject({ id: 'openai', active: 'local', ready: false })
    expect(await resolveModelProvider(state().coach)).toBeUndefined()
    state().updateCoach({ provider: 'local_llm' })
    expect(await resolveModelProvider(state().coach)).toBeUndefined()
    state().updateCoach({ provider: 'local_llm', localLlmModel: 'llama3.1' })
    const p = await resolveModelProvider(state().coach)
    expect(p?.id).toBe('local_llm')
    state().updateCoach({ provider: 'anthropic', anthropicApiKey: 'sk-ant-x' })
    expect((await resolveModelProvider(state().coach))?.id).toBe('anthropic')
    state().updateCoach({ provider: 'openai', openaiApiKey: 'sk-x' })
    expect((await resolveModelProvider(state().coach))?.id).toBe('openai')
  })

  it('migration: an older snapshot with an unknown provider falls back to local and keeps everything else', () => {
    const persisted = JSON.parse(localStorage.getItem('sportly.v1')!)
    expect(persisted.version).toBe(4)
    const older = { ...persisted, version: 3, state: { ...persisted.state, coach: { ...persisted.state.coach, provider: 'mystery-cloud' } } }
    localStorage.setItem('sportly.v1', JSON.stringify(older))
    void useStore.persist.rehydrate()
    expect(state().coach.provider).toBe('local')
    expect(state().user?.name).toBe('Alex')
    expect(Object.keys(state().workouts).length).toBe(Object.keys(persisted.state.workouts).length)
  })

  it('no secret is bundled: the source tree contains no API key literal', () => {
    // Built at runtime so this file does not itself contain the literal shapes it scans for.
    const keyShapes = new RegExp(['sk-' + 'ant-api', 'sk-' + 'proj-[A-Za-z0-9]{10,}', 'sk-' + '[A-Za-z0-9]{40,}'].join('|'))
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
    for (const [f, text] of Object.entries(SOURCES)) expect(text, f).not.toMatch(keyShapes)
  })
})

describe('architecture: the domain does not know the provider', () => {
  it('no domain, store, tool or engine module imports an adapter or a provider format', () => {
    const forbidden = /model\/adapters|openaiCompatible|adapters\/anthropic|tool_use|function_call|choices\[/
    const dirs = ['/src/domain/', '/src/store/', '/src/coach/tools/', '/src/screens/', '/src/components/']
    const files = ['/src/coach/localProvider.ts', '/src/coach/coachService.ts', '/src/coach/context.ts', '/src/coach/model/loop.ts', '/src/coach/model/modelTools.ts', '/src/coach/model/contract.ts', '/src/coach/model/toolDefinitions.ts']
    const checked = Object.keys(SOURCES).filter((f) => files.includes(f) || dirs.some((d) => f.startsWith(d)))
    expect(checked.length).toBeGreaterThan(20)
    for (const f of checked) expect(SOURCES[f], f).not.toMatch(forbidden)
  })
})

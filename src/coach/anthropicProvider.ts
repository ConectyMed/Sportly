import { GOAL_LABELS } from '@/domain/labels'
import { formatMinutes } from '@/lib/utils'
import type { Intent } from './intents'
import { parseIntent } from './intents'
import { respondToIntent } from './localProvider'
import { describePersonality } from './personality'
import type { CoachProvider, CoachReply, CoachRequest } from './provider'

/**
 * Optional remote provider. Uses a user-supplied Anthropic API key (stored only on-device).
 * The model decides *what* to do via tools; Sportly's local engine materialises the
 * actual workouts, programs and plans so state stays consistent and deterministic.
 * Falls back to the local provider on any failure.
 */
export class AnthropicCoachProvider implements CoachProvider {
  id = 'anthropic' as const
  private apiKey: string
  private model: string | undefined
  private fallback: CoachProvider
  constructor(apiKey: string, model: string | undefined, fallback: CoachProvider) {
    this.apiKey = apiKey
    this.model = model
    this.fallback = fallback
  }

  async respond(req: CoachRequest): Promise<CoachReply> {
    try {
      return await this.run(req)
    } catch (err) {
      console.warn('[coach] anthropic provider failed, using local engine', err)
      return this.fallback.respond(req)
    }
  }

  private async run(req: CoachRequest): Promise<CoachReply> {
    const { context: ctx } = req
    const system = buildSystemPrompt(ctx)
    const messages = [
      ...ctx.history.slice(-10).map((m) => ({ role: m.role === 'coach' ? 'assistant' : 'user', content: m.text || '(attachment)' })),
      { role: 'user', content: req.text || `(sent ${req.attachments.map((a) => a.kind).join(', ')})` },
    ]
    const body = {
      model: this.model || 'claude-sonnet-5',
      max_tokens: 600,
      system,
      tools: TOOLS,
      messages,
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    const data = (await res.json()) as { content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> }
    const text = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
    const tool = data.content.find((c) => c.type === 'tool_use')
    if (!tool?.name) return { text: text || 'Okay.', suggestions: ['Build today’s workout', 'What should I eat?'] }
    const intent = toolToIntent(tool.name, tool.input ?? {}, req)
    const local = respondToIntent(intent, req, ctx)
    // Prefer the model's words, keep the engine's cards/actions/suggestions.
    return { ...local, text: text ? `${text}` : local.text }
  }
}

function buildSystemPrompt(ctx: CoachContext_): string {
  const u = ctx.user
  const goals = ctx.goals.map((g) => `${g.rank}: ${GOAL_LABELS[g.type]}${g.targetValue ? ` (target ${g.targetValue} ${g.targetUnit ?? ''})` : ''}`).join('; ')
  const memory = ctx.memory.slice(0, 20).map((m) => `- ${m.text}`).join('\n')
  const tw = ctx.todayWorkout
  return [
    `You are ${ctx.coach.name}, the user's personal AI coach inside Sportly ("Your Coach Daily"). You are text-first, warm, precise, never a medical professional. You never diagnose; for serious pain or symptoms you recommend professional evaluation. Never encourage dangerous dieting or unsafe training.`,
    `Personality: ${describePersonality(ctx.coach.personality)}. Match it in tone and length.`,
    `User: ${u.name}, ${u.age}, ${u.heightCm} cm, ${u.weightKg} kg, level ${u.level}, trains ${u.availability.daysPerWeek}x/week for ${formatMinutes(u.availability.sessionMinutes)}, equipment: ${u.equipment.join(', ') || 'bodyweight'}, diet: ${u.diet}.`,
    `Goals: ${goals || 'none set'}.`,
    `Readiness today: ${ctx.readiness.score}% (${ctx.readiness.label}); recommendation: ${ctx.readiness.recommendation}.`,
    tw ? `Today's workout: ${tw.title} (${tw.status}, ${formatMinutes(tw.estimatedMinutes)}, ${tw.exercises.map((e) => e.name).join(', ')}).` : 'No workout planned today.',
    ctx.activeProgram ? `Active program: ${ctx.activeProgram.name}.` : 'No active program.',
    memory ? `What you remember about the user:\n${memory}` : '',
    `Use tools to take actions in the app (build/modify workouts, programs, nutrition, memory, goals, schedule). Keep replies under 90 words unless the personality is detailed.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

type CoachContext_ = CoachRequest['context']

const TOOLS = [
  { name: 'build_workout', description: 'Create or replace today’s (or tomorrow’s) workout with optional constraints.', input_schema: { type: 'object', properties: { minutes: { type: 'number' }, equipment: { type: 'array', items: { type: 'string' } }, no_cardio: { type: 'boolean' }, focus: { type: 'string' }, intensity: { type: 'string', enum: ['light', 'moderate', 'hard'] }, tomorrow: { type: 'boolean' } } } },
  { name: 'modify_workout', description: 'Modify the current workout: shorter, longer, replace an exercise, restrict equipment, remove cardio, lighter, harder, regenerate.', input_schema: { type: 'object', properties: { change: { type: 'string', enum: ['shorter', 'longer', 'replace', 'equipment', 'no_cardio', 'lighter', 'harder', 'regenerate'] }, minutes: { type: 'number' }, exercise: { type: 'string' }, equipment: { type: 'array', items: { type: 'string' } } }, required: ['change'] } },
  { name: 'create_program', description: 'Create a multi-week training program.', input_schema: { type: 'object', properties: { weeks: { type: 'number' }, days_per_week: { type: 'number' }, goal: { type: 'string' } }, required: ['weeks'] } },
  { name: 'nutrition_plan', description: 'Generate today’s nutrition plan, optionally adjusted for a restaurant dinner.', input_schema: { type: 'object', properties: { restaurant: { type: 'boolean' }, lower_carb: { type: 'boolean' } } } },
  { name: 'remember', description: 'Store a long-term fact about the user.', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'set_goal', description: 'Set or update the user’s goal.', input_schema: { type: 'object', properties: { goal: { type: 'string' }, metric: { type: 'string' }, target: { type: 'number' } } } },
  { name: 'log_weight', description: 'Log a body-weight measurement in kg.', input_schema: { type: 'object', properties: { kg: { type: 'number' } }, required: ['kg'] } },
  { name: 'check_in', description: 'Log fatigue (1-10) or sleep hours for today and adapt the day.', input_schema: { type: 'object', properties: { fatigue: { type: 'number' }, sleep_hours: { type: 'number' } } } },
  { name: 'reschedule', description: 'Move a planned workout from one weekday to another (0=Sunday).', input_schema: { type: 'object', properties: { from: { type: 'number' }, to: { type: 'number' } } } },
  { name: 'analyze_progress', description: 'Summarise progress and insights.', input_schema: { type: 'object', properties: {} } },
  { name: 'plan_week', description: 'Plan the coming week of sessions.', input_schema: { type: 'object', properties: {} } },
]

function toolToIntent(name: string, input: Record<string, unknown>, req: CoachRequest): Intent {
  const num = (k: string) => (typeof input[k] === 'number' ? (input[k] as number) : undefined)
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  switch (name) {
    case 'build_workout':
      return { kind: 'make_workout', constraints: { minutes: num('minutes'), equipment: input.equipment as never, noCardio: Boolean(input.no_cardio), focus: str('focus') as never, intensity: str('intensity') as never, forDate: input.tomorrow ? 'tomorrow' : undefined } }
    case 'modify_workout': {
      const change = str('change')
      if (change === 'replace') return { kind: 'modify_workout', change: { type: 'replace', query: str('exercise') } }
      if (change === 'equipment') return { kind: 'modify_workout', change: { type: 'equipment', equipment: (input.equipment as never) ?? ['dumbbell'] } }
      if (change === 'shorter' || change === 'longer') return { kind: 'modify_workout', change: { type: change, minutes: num('minutes') } }
      return { kind: 'modify_workout', change: { type: (change as 'no_cardio' | 'lighter' | 'harder' | 'regenerate') ?? 'regenerate' } }
    }
    case 'create_program':
      return { kind: 'create_program', weeks: num('weeks'), daysPerWeek: num('days_per_week'), goalType: str('goal') as never }
    case 'nutrition_plan':
      return input.restaurant ? { kind: 'restaurant' } : { kind: 'nutrition', lowerCarb: Boolean(input.lower_carb) }
    case 'remember':
      return { kind: 'remember', text: str('text') ?? req.text }
    case 'set_goal':
      return { kind: 'set_goal', goalType: str('goal') as never, metric: str('metric') as never, target: num('target') }
    case 'log_weight':
      return { kind: 'log_weight', kg: num('kg') ?? 0 }
    case 'check_in':
      return num('sleep_hours') !== undefined ? { kind: 'hours_answer', value: num('sleep_hours')! } : { kind: 'scale_answer', value: num('fatigue') ?? 5 }
    case 'reschedule':
      return { kind: 'reschedule', from: num('from'), to: num('to') }
    case 'analyze_progress':
      return { kind: 'analyze_progress' }
    case 'plan_week':
      return { kind: 'plan_week' }
    default:
      return parseIntent(req.text, {})
  }
}

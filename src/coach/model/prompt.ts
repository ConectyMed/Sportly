import type { Attachment, Conversation } from '@/domain/types'
import { getKnowledge } from '@/knowledge'
import { formatMinutes } from '@/lib/utils'
import type { AppState } from '@/store/useStore'
import { buildContextSnapshot, type CoachContextSnapshot } from '../context'
import type { FoodAnalysis } from '../food/foodAnalysis'
import { isExpired, memorySubjects } from '../memory'
import { describePersonality } from '../personality'
import type { CoachModelInput, ModelStep, RelevantKnowledge } from './contract'
import { toolDefinitions } from './toolDefinitions'

/**
 * Builds what a model receives for one step of a turn. Everything is derived
 * from the store at call time: CURRENT state in the snapshot, RECENT
 * conversation and actions, RELEVANT memory and knowledge for this message.
 * HISTORICAL data stays behind read tools so the prompt does not grow with the
 * user's history.
 */

export interface ModelTurnRequest {
  text: string
  attachments: Attachment[]
  foodAnalysis?: FoodAnalysis
}

const RECENT_MESSAGES = 10
const MEMORY_CAP = 20
const RELEVANT_MEMORY = 6
const KNOWLEDGE_HITS = 3

/** The house rules. Provider-neutral: the same text goes to any model. */
export function buildSystemPrompt(snapshot: CoachContextSnapshot, coach: AppState['coach']): string {
  const p = snapshot.profile
  return [
    `You are ${coach.name}, the user's personal coach inside Sportly ("Your Coach Daily"). Text-first, warm, precise. You are not a medical professional: never diagnose; for pain, injury or symptoms recommend professional evaluation. Never encourage dangerous dieting or unsafe training.`,
    `Personality: ${describePersonality(coach.personality)}. Match it in tone and length. Keep replies under 90 words unless the personality is detailed.`,
    `The user: ${p.name}, ${p.age}, ${p.weightKg} kg, level ${p.level}, trains ${p.availability.daysPerWeek}x/week for ${formatMinutes(p.availability.sessionMinutes)}.`,
    'How this works:',
    '- The CONTEXT is the truth about the user right now (weight, meals, workouts, goals, calendar, progress). Reason over it; do not restate it from memory. Use read tools for anything not in it.',
    '- To change anything in the app, call an action tool. Sportly validates and executes it and tells you what really happened. Never say something was added, saved, moved, deleted, logged or completed unless a tool result confirms it.',
    '- A failed tool result explains why; tell the user honestly and offer the next step. An "ambiguous" result lists candidates: ask which one, do not guess.',
    '- After a tool changes state, the context you see next is already refreshed.',
    '- Memory: ask save_memory for durable facts about the person; Sportly decides how to store it. Passing states go to check_in.',
    '- Keep the user in control: when a request is unclear, ask one short question.',
  ].join('\n')
}

function relevantMemory(state: AppState, text: string, now: Date) {
  const subjects = new Set(memorySubjects(text))
  const live = state.memory.filter((m) => !isExpired(m, now))
  if (!subjects.size) return []
  return live
    .filter((m) => (m.subjects ?? memorySubjects(m.text)).some((s) => subjects.has(s)))
    .slice(0, RELEVANT_MEMORY)
    .map((m) => ({ id: m.id, category: m.category, text: m.text }))
}

function relevantKnowledge(text: string): RelevantKnowledge[] {
  if (text.trim().split(/\s+/).length < 3) return []
  try {
    return getKnowledge()
      .search(text, { limit: KNOWLEDGE_HITS })
      .filter((h) => h.score > 0)
      .map((h) => ({ title: h.document.title, excerpt: h.chunk.text.slice(0, 400), source: h.source.title, topics: h.chunk.topics }))
  } catch {
    return []
  }
}

/** Trim the snapshot to what a prompt needs: memory capped, conversation carried separately. */
function compactSnapshot(snapshot: CoachContextSnapshot): CoachContextSnapshot {
  return {
    ...snapshot,
    memory: { persistent: snapshot.memory.persistent.slice(0, MEMORY_CAP), temporary: snapshot.memory.temporary.slice(0, 10) },
    conversation: { ...snapshot.conversation, recent: [] },
  }
}

export function buildModelInput(state: AppState, conversation: Conversation | undefined, req: ModelTurnRequest, steps: ModelStep[], now = new Date()): CoachModelInput {
  const snapshot = buildContextSnapshot(state, conversation, now)
  const history = (conversation ? (state.messages[conversation.id] ?? []) : []).filter((m) => m.role !== 'system').slice(-RECENT_MESSAGES)
  return {
    system: buildSystemPrompt(snapshot, state.coach),
    persona: { name: state.coach.name, personality: state.coach.personality, description: describePersonality(state.coach.personality) },
    context: {
      current: compactSnapshot(snapshot),
      relevant: { memory: relevantMemory(state, req.text, now), knowledge: relevantKnowledge(req.text) },
    },
    conversation: history.map((m) => ({ role: m.role === 'coach' ? 'assistant' : 'user', text: m.text, at: m.createdAt })),
    userMessage: {
      text: req.text,
      attachments: req.attachments.map((a) => ({ id: a.id, kind: a.kind, name: a.name })),
      foodEstimate: req.foodAnalysis?.items.length ? { name: req.foodAnalysis.name, analysis: req.foodAnalysis.analysis, items: req.foodAnalysis.items.map((i) => ({ name: i.name, grams: i.grams, calories: i.calories })) } : undefined,
    },
    tools: toolDefinitions(),
    steps,
  }
}

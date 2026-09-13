import type { MemoryCategory, MemoryItem } from '@/domain/types'

/**
 * Memory is what the coach knows about the person, not what happened today.
 * This module decides whether a statement is worth keeping, how long it should
 * live, and whether it contradicts something already remembered.
 *
 * Conflict rule: new explicit information beats old information.
 */

const STOP = new Set(
  'a an the i me my mine we our you your it its is am are was were be been being do does did have has had of to in on at for from with without and or but so if then than that this these those there here not no yes very really just also too as by about into over under again more less most least some any all every each both few many much own same other such only than when where why how what which who whom whose can could should would will shall may might must dont don t cant wont im ive id like love hate prefer enjoy want dislike avoid never always usually sometimes often rarely please actually honestly kind kinda sort day days week weeks today tonight tomorrow morning evening user prefers'.split(
    /\s+/,
  ),
)

function stem(word: string): string {
  // running → run, swimming → swim, lunges → lunge, burpees → burpee
  return word
    .replace(/ies$/, 'y')
    .replace(/(ing|ed)$/, '')
    .replace(/([b-df-hj-np-tv-z])\1$/, '$1')
    .replace(/(?<=[a-z]{3})s$/, '')
}

/** Content words that identify what a memory is about (“running”, “burpees”, “shoulder”). */
export function memorySubjects(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/'s$/, '').replace(/'/g, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length >= 3)
  return [...new Set(words)].slice(0, 8)
}

export type Polarity = 'positive' | 'negative' | 'neutral'

export function memoryPolarity(text: string): Polarity {
  const t = text.toLowerCase().replace(/[’‘]/g, "'")
  if (/\b(hate|hates|dislike|dislikes|can'?t stand|don'?t (like|want|enjoy)|do not (like|want|enjoy)|not a fan|avoid|avoids|never (give|want|do|include)s?|no more|stop|stops|sick of|tired of|allergic)\b/.test(t)) return 'negative'
  if (/\b(love|loves|like|likes|prefer|prefers|enjoy|enjoys|favou?rite|want|wants|keen on|into)\b/.test(t)) return 'positive'
  return 'neutral'
}

/** Passing situations are temporary; statements about the person are persistent. */
export function classifyPersistence(text: string): MemoryItem['persistence'] {
  return /\b(today|tonight|this week|right now|at the moment|currently|for now|this weekend|next week)\b/i.test(text) ? 'temporary' : 'persistent'
}

export function normalizeMemoryText(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function isExpired(m: MemoryItem, now = new Date()): boolean {
  return Boolean(m.expiresAt && new Date(m.expiresAt).getTime() < now.getTime())
}

export interface MemoryCandidate {
  text: string
  category: MemoryCategory
  subjects?: string[]
}

/** The same fact already stored (after normalisation). */
export function findDuplicateMemory(memory: MemoryItem[], candidate: MemoryCandidate): MemoryItem | undefined {
  const n = normalizeMemoryText(candidate.text)
  return memory.find((m) => normalizeMemoryText(m.text) === n)
}

/**
 * Memories the candidate contradicts. Two statements conflict when they share a
 * subject and pull in opposite directions (“prefers running” vs “hates running”),
 * or when they compete for a single-valued fact (availability, primary goal).
 */
/** Words too generic to prove two memories are about the same thing. */
const GENERIC = new Set(['cardio', 'train', 'workout', 'exercise', 'session', 'food', 'meal', 'morning', 'evening', 'gym', 'week', 'goal', 'body', 'weight'])

export function findConflictingMemories(memory: MemoryItem[], candidate: MemoryCandidate): MemoryItem[] {
  const subjects = candidate.subjects ?? memorySubjects(candidate.text)
  if (!subjects.length) return []
  const polarity = memoryPolarity(candidate.text)
  const singleValued: MemoryCategory[] = ['availability', 'goal', 'communication']
  return memory.filter((m) => {
    const theirs = m.subjects ?? memorySubjects(m.text)
    const shared = theirs.filter((s) => subjects.includes(s))
    const specific = shared.filter((s) => !GENERIC.has(s))
    if (!shared.length) return false
    // Opposite polarity needs a specific shared subject (“running”), not just “cardio”.
    if (!specific.length && !singleValued.includes(candidate.category)) return false
    const theirPolarity = memoryPolarity(m.text)
    if (polarity !== 'neutral' && theirPolarity !== 'neutral' && polarity !== theirPolarity) return true
    return singleValued.includes(candidate.category) && m.category === candidate.category
  })
}

/** Cheap guard against remembering noise. */
export function isWorthRemembering(text: string): boolean {
  const t = text.trim()
  return t.length >= 4 && t.length <= 240 && memorySubjects(t).length > 0
}

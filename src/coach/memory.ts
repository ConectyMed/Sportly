import type { MemoryCategory, MemoryItem } from '@/domain/types'
import { normalizeForMatching } from '@/lib/text'

/**
 * Memory is what the coach knows about the person, not what happened today.
 * This module decides whether a statement is worth keeping, how long it should
 * live, and whether it contradicts something already remembered. Statements
 * are understood in English and French; the rules are the same for both.
 *
 * Conflict rule: new explicit information beats old information.
 */

const STOP = new Set(
  (
    'a an the i me my mine we our you your it its is am are was were be been being do does did have has had of to in on at for from with without and or but so if then than that this these those there here not no yes very really just also too as by about into over under again more less most least some any all every each both few many much own same other such only than when where why how what which who whom whose can could should would will shall may might must dont don t cant wont im ive id like love hate prefer enjoy want dislike avoid never always usually sometimes often rarely please actually honestly kind kinda sort day days week weeks today tonight tomorrow morning evening user prefers ' +
    // French function words and the same “about myself” verbs
    'je tu il elle on nous vous ils elles me te se moi toi lui leur mon ma mes ton ta tes son sa ses notre votre leurs ce cet cette ces ca cela ceci le la les un une des du de dau aux au en y ne pas plus jamais rien que qui quoi dont ou et mais donc car ni si pour par sur sous dans avec sans chez vers entre est sont suis es etes sommes etait etaient ete etre avoir ai as avons avez ont avais avait fait faire faut peux peut veux veut voudrais aime adore deteste prefere evite kiffe tres trop tout tous toute toutes assez bien mal aussi encore toujours souvent parfois rarement jamais deja aujourd hui demain hier soir matin midi semaine jour jours ce mois retiens retiens-que apres avant plutot vraiment franchement seulement'
  ).split(/\s+/),
)

function stem(word: string): string {
  // running → run, swimming → swim, lunges → lunge, burpees → burpee, séances → seance
  return word
    .replace(/ies$/, 'y')
    .replace(/(ing|ed)$/, '')
    .replace(/([b-df-hj-np-tv-z])\1$/, '$1')
    .replace(/(?<=[a-z]{3})s$/, '')
}

/** Content words that identify what a memory is about (“running”, “burpees”, “shoulder”, “épaule”). Accent-folded. */
export function memorySubjects(text: string): string[] {
  const words = normalizeForMatching(text)
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .flatMap((w) => w.split("'"))
    .map((w) => w.replace(/'s$/, '').replace(/'/g, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length >= 3)
  return [...new Set(words)].slice(0, 8)
}

export type Polarity = 'positive' | 'negative' | 'neutral'

export function memoryPolarity(text: string): Polarity {
  const t = normalizeForMatching(text)
  if (/\b(hate|hates|dislike|dislikes|can'?t stand|don'?t (like|want|enjoy)|do not (like|want|enjoy)|not a fan|avoid|avoids|never (give|want|do|include)s?|no more|stop|stops|sick of|tired of|allergic|deteste|n'aime pas|aime pas|ne supporte pas|supporte pas|evite|jamais|plus de|marre|allergique|pas fan|ne veut (pas|plus)|veut plus)\b/.test(t)) return 'negative'
  if (/\b(love|loves|like|likes|prefer|prefers|enjoy|enjoys|favou?rite|want|wants|keen on|into|adore|aime|prefere|kiffe|fan de|apprecie|veut)\b/.test(t)) return 'positive'
  return 'neutral'
}

/** Passing situations are temporary; statements about the person are persistent. */
export function classifyPersistence(text: string): MemoryItem['persistence'] {
  return /\b(today|tonight|this week|right now|at the moment|currently|for now|this weekend|next week|aujourd'hui|ce soir|cette semaine|en ce moment|pour l'instant|pour le moment|actuellement|ce week-end|ce weekend|la semaine prochaine|cette fois)\b/i.test(normalizeForMatching(text)) ? 'temporary' : 'persistent'
}

export function normalizeMemoryText(text: string): string {
  return normalizeForMatching(text).replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
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

/** Words too generic to prove two memories are about the same thing. */
const GENERIC = new Set(['cardio', 'train', 'workout', 'exercise', 'session', 'food', 'meal', 'morning', 'evening', 'gym', 'week', 'goal', 'body', 'weight', 'seance', 'entrainement', 'exercice', 'repas', 'salle', 'semaine', 'objectif', 'corps', 'poids', 'sport'])

/**
 * Memories the candidate contradicts. Two statements conflict when they share a
 * subject and pull in opposite directions (“prefers running” vs “hates running”),
 * or when they compete for a single-valued fact (availability, primary goal).
 */
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

/** Sportly, not the model, decides what kind of memory a statement is. */
export function categorizeMemory(text: string): MemoryCategory {
  const t = normalizeForMatching(text)
  if (/goal|want to|aim|objectif|\bbut\b|je veux|je vise/.test(t)) return 'goal'
  if (/dumbbell|barbell|kettlebell|bands?|gym|equipment|bench|machine|haltere|barre|elastique|salle|materiel|equipement|banc/.test(t)) return 'equipment'
  if (/monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|am\b|pm\b|o'?clock|schedule|available|busy|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|matin|soir|\d+h\b|heures?|dispo|disponible|occupe|planning|horaire/.test(t)) return 'availability'
  if (/eat|food|vegan|vegetarian|allerg|lactose|gluten|protein|meal|snack|coffee|hate|love|dislike|mange|nourriture|vegetarien|vegan|proteine|repas|collation|cafe|deteste|adore|aime pas/.test(t)) return 'nutrition'
  if (/knee|back|shoulder|injur|pain|hurt|surgery|asthma|condition|doctor|physio|genou|dos|epaule|blessure|douleur|mal au|mal a|operation|asthme|medecin|kine/.test(t)) return 'health'
  if (/prefer|like|don'?t like|enjoy|favourite|favorite|hate|prefere|aime|kiffe|deteste|supporte pas/.test(t)) return 'preference'
  if (/sleep|wake|walk|steps|habit|usually|always|never|dors|dort|sommeil|reveil|marche|pas par jour|habitude|d'habitude|toujours|jamais/.test(t)) return 'habit'
  if (/talk|tone|direct|gentle|short|detailed|joke|parle|ton\b|direct|doux|court|detaille|blague/.test(t)) return 'communication'
  return 'note'
}

/** Cheap guard against remembering noise. */
export function isWorthRemembering(text: string): boolean {
  const t = text.trim()
  return t.length >= 4 && t.length <= 240 && memorySubjects(t).length > 0
}

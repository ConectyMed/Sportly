import type { CoachPersonality } from '@/domain/types'
import { hashString } from '@/lib/utils'

/**
 * The coach's voice. Every response is composed from parts and shaped by the
 * four personality dials so that changing a slider genuinely changes how the
 * coach talks — not just what it says.
 */
export interface VoiceParts {
  /** The essential message. Always shown. */
  core: string
  /** Why — shown when communication leans detailed. */
  reason?: string
  /** A gentle framing — shown when tone leans gentle. */
  soft?: string
  /** A motivational push — shown when motivation leans intense. */
  push?: string
  /** A light quip — shown when humor leans playful. */
  quip?: string
  /** A calm closer — shown when motivation leans calm. */
  calm?: string
  /** Extra detail shown only in detailed mode. */
  extra?: string
}

export interface Voice {
  compose: (parts: VoiceParts, seed?: string) => string
  isDetailed: boolean
  isConcise: boolean
  isIntense: boolean
  isCalm: boolean
  isDirect: boolean
  isGentle: boolean
  isPlayful: boolean
  pick: <T>(seed: string, options: T[]) => T
  greeting: (name: string, timeOfDay: string) => string
  cheer: (seed: string) => string
}

const PUSHES = ['Let’s go.', 'No excuses today.', 'Attack it.', 'Show up hard.', 'Earn it.', 'This is the work.']
const CALMS = ['Take it steady.', 'No rush.', 'One set at a time.', 'Enjoy it.', 'Breathe and move.', 'Steady wins.']
const QUIPS = [
  'Your future self is already grateful. Slightly sore, but grateful.',
  'Gravity is not going to lift itself.',
  'Consider this your permission slip to feel powerful.',
  'The barbell has no opinion of you. Yet.',
  'Rest days are training days for your couch.',
  'I would say “trust the process” but I know how that sounds.',
  'Muscles are just opinions the body has about weights.',
]
export const SOFTS = ['If you are up for it,', 'No pressure, but', 'Whenever you are ready,', 'When it suits you,', 'Only if it feels right,']
const CHEERS_INTENSE = ['Big session.', 'That is how it is done.', 'Strong.', 'You brought it today.']
const CHEERS_CALM = ['Nicely done.', 'Good work today.', 'That was solid.', 'Well done.']

export function buildVoice(p: CoachPersonality): Voice {
  const isDetailed = p.communication >= 60
  const isConcise = p.communication <= 35
  const isIntense = p.motivation >= 62
  const isCalm = p.motivation <= 35
  const isDirect = p.tone >= 62
  const isGentle = p.tone <= 38
  const isPlayful = p.humor >= 58

  const pick = <T,>(seed: string, options: T[]): T => options[hashString(seed) % options.length]

  const compose = (parts: VoiceParts, seed = parts.core): string => {
    const out: string[] = []
    let core = parts.core
    if (isGentle && parts.soft) core = `${parts.soft} ${lowerFirst(core)}`
    if (isDirect) core = core.replace(/\b(maybe|perhaps|I think|I’d suggest|I would suggest)\b\s?/gi, '').replace(/\s{2,}/g, ' ')
    out.push(core)
    if (!isConcise && parts.reason) out.push(parts.reason)
    if (isDetailed && parts.extra) out.push(parts.extra)
    if (isIntense) out.push(parts.push ?? pick(seed + 'push', PUSHES))
    else if (isCalm && (parts.calm || hashString(seed) % 3 === 0)) out.push(parts.calm ?? pick(seed + 'calm', CALMS))
    if (isPlayful && (parts.quip || hashString(seed + 'q') % (p.humor >= 80 ? 2 : 3) === 0)) out.push(parts.quip ?? pick(seed + 'quip', QUIPS))
    return out.filter(Boolean).join(' ')
  }

  const greeting = (name: string, timeOfDay: string) => {
    if (isIntense) return isDirect ? `${name}. Let’s work.` : `${timeOfDay}, ${name}. Ready when you are.`
    if (isGentle) return `${timeOfDay}, ${name}. Good to see you.`
    return `${timeOfDay}, ${name}.`
  }

  const cheer = (seed: string) => (isIntense ? pick(seed, CHEERS_INTENSE) : pick(seed, CHEERS_CALM))

  return { compose, isDetailed, isConcise, isIntense, isCalm, isDirect, isGentle, isPlayful, pick, greeting, cheer }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

export function describePersonality(p: CoachPersonality): string {
  const bits: string[] = []
  bits.push(p.motivation >= 62 ? 'intense' : p.motivation <= 35 ? 'calm' : 'balanced')
  bits.push(p.tone >= 62 ? 'direct' : p.tone <= 38 ? 'gentle' : 'even-handed')
  bits.push(p.humor >= 58 ? 'playful' : p.humor <= 30 ? 'serious' : 'lightly warm')
  bits.push(p.communication >= 60 ? 'detailed' : p.communication <= 35 ? 'concise' : 'to the point')
  return bits.join(' · ')
}

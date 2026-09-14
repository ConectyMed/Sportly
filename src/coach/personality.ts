import type { CoachPersonality } from '@/domain/types'
import { t as translate } from '@/i18n'
import { getLanguage } from '@/i18n/runtime'
import type { Language } from '@/i18n/types'
import { hashString } from '@/lib/utils'

/**
 * The coach's voice. Every response is composed from parts and shaped by the
 * four personality dials so that changing a slider genuinely changes how the
 * coach talks — not just what it says. The phrase banks exist per language so
 * the French coach sounds French, not translated.
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
  lang: Language
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
  /** A gentle opener in the voice's language (“If you are up for it,” · “Si tu le sens,”). */
  soft: (seed: string) => string
}

interface PhraseBank {
  pushes: string[]
  calms: string[]
  quips: string[]
  softs: string[]
  cheersIntense: string[]
  cheersCalm: string[]
  /** Hedges a direct coach strips out. */
  hedges: RegExp
}

const BANKS: Record<Language, PhraseBank> = {
  en: {
    pushes: ['Let’s go.', 'No excuses today.', 'Attack it.', 'Show up hard.', 'Earn it.', 'This is the work.'],
    calms: ['Take it steady.', 'No rush.', 'One set at a time.', 'Enjoy it.', 'Breathe and move.', 'Steady wins.'],
    quips: [
      'Your future self is already grateful. Slightly sore, but grateful.',
      'Gravity is not going to lift itself.',
      'Consider this your permission slip to feel powerful.',
      'The barbell has no opinion of you. Yet.',
      'Rest days are training days for your couch.',
      'I would say “trust the process” but I know how that sounds.',
      'Muscles are just opinions the body has about weights.',
    ],
    softs: ['If you are up for it,', 'No pressure, but', 'Whenever you are ready,', 'When it suits you,', 'Only if it feels right,'],
    cheersIntense: ['Big session.', 'That is how it is done.', 'Strong.', 'You brought it today.'],
    cheersCalm: ['Nicely done.', 'Good work today.', 'That was solid.', 'Well done.'],
    hedges: /\b(maybe|perhaps|I think|I’d suggest|I would suggest)\b\s?/gi,
  },
  fr: {
    pushes: ['On y va.', 'Pas d’excuses aujourd’hui.', 'Attaque.', 'Donne tout.', 'Va le chercher.', 'C’est là que ça se joue.'],
    calms: ['Prends ton temps.', 'Rien ne presse.', 'Une série à la fois.', 'Profite.', 'Respire et bouge.', 'La régularité gagne toujours.'],
    quips: [
      'Ton toi du futur te dit déjà merci. Un peu courbaturé, mais reconnaissant.',
      'La gravité ne va pas se soulever toute seule.',
      'Considère ça comme ton autorisation officielle de te sentir puissant.',
      'La barre n’a aucune opinion sur toi. Pour l’instant.',
      'Les jours de repos, c’est ton canapé qui s’entraîne.',
      'Je dirais bien « fais confiance au process », mais je sais comment ça sonne.',
      'Un muscle, c’est juste l’avis du corps sur les poids.',
    ],
    softs: ['Si tu le sens,', 'Sans pression, mais', 'Quand tu es prêt·e,', 'Quand ça t’arrange,', 'Seulement si ça te parle,'],
    cheersIntense: ['Grosse séance.', 'C’est comme ça qu’on fait.', 'Solide.', 'Tu as tout donné aujourd’hui.'],
    cheersCalm: ['Bien joué.', 'Bon travail aujourd’hui.', 'C’était propre.', 'Beau boulot.'],
    hedges: /\b(peut-être|je pense que|je pense qu’|je pense qu'|je te suggère de|je te suggérerais de|je dirais que|je dirais qu’|je dirais qu')\s?/gi,
  },
}

/** English soft openers, kept for callers that build sentences by hand. */
export const SOFTS = BANKS.en.softs

export function buildVoice(p: CoachPersonality, lang: Language = getLanguage()): Voice {
  const bank = BANKS[lang] ?? BANKS.en
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
    if (isDirect) core = core.replace(bank.hedges, '').replace(/\s{2,}/g, ' ').replace(/^\s*,\s*/, '')
    out.push(core)
    if (!isConcise && parts.reason) out.push(parts.reason)
    if (isDetailed && parts.extra) out.push(parts.extra)
    if (isIntense) out.push(parts.push ?? pick(seed + 'push', bank.pushes))
    else if (isCalm && (parts.calm || hashString(seed) % 3 === 0)) out.push(parts.calm ?? pick(seed + 'calm', bank.calms))
    if (isPlayful && (parts.quip || hashString(seed + 'q') % (p.humor >= 80 ? 2 : 3) === 0)) out.push(parts.quip ?? pick(seed + 'quip', bank.quips))
    return out.filter(Boolean).join(' ')
  }

  const greeting = (name: string, timeOfDay: string) => {
    if (lang === 'fr') {
      if (isIntense) return isDirect ? `${name}. Au boulot.` : `${timeOfDay}, ${name}. Prêt·e quand tu veux.`
      if (isGentle) return `${timeOfDay}, ${name}. Content de te voir.`
      return `${timeOfDay}, ${name}.`
    }
    if (isIntense) return isDirect ? `${name}. Let’s work.` : `${timeOfDay}, ${name}. Ready when you are.`
    if (isGentle) return `${timeOfDay}, ${name}. Good to see you.`
    return `${timeOfDay}, ${name}.`
  }

  const cheer = (seed: string) => (isIntense ? pick(seed, bank.cheersIntense) : pick(seed, bank.cheersCalm))
  const soft = (seed: string) => pick(seed, bank.softs)

  return { lang, compose, isDetailed, isConcise, isIntense, isCalm, isDirect, isGentle, isPlayful, pick, greeting, cheer, soft }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

export function describePersonality(p: CoachPersonality, lang: Language = getLanguage()): string {
  const key = (k: string) => translate(`personality.${k}` as 'personality.intense', undefined, lang)
  const bits: string[] = []
  bits.push(key(p.motivation >= 62 ? 'intense' : p.motivation <= 35 ? 'calm' : 'balanced'))
  bits.push(key(p.tone >= 62 ? 'direct' : p.tone <= 38 ? 'gentle' : 'evenHanded'))
  bits.push(key(p.humor >= 58 ? 'playful' : p.humor <= 30 ? 'serious' : 'lightlyWarm'))
  bits.push(key(p.communication >= 60 ? 'detailed' : p.communication <= 35 ? 'concise' : 'toThePoint'))
  return bits.join(' · ')
}

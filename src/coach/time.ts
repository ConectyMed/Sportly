import type { DayKey, ISODate } from '@/domain/types'
import { t as translate } from '@/i18n'
import { getLanguage } from '@/i18n/runtime'
import type { Language } from '@/i18n/types'
import { addDays, dayKey, startOfWeek } from '@/lib/dates'
import { normalizeForMatching } from '@/lib/text'

/**
 * Temporal context: one place that knows what “today”, “tomorrow”, “this week”
 * and “yesterday” mean for the current turn, so the coach never confuses what
 * was planned with what actually happened. Time words are understood in
 * English and French; the frames themselves are language-independent.
 */
export interface TemporalContext {
  now: ISODate
  today: DayKey
  yesterday: DayKey
  tomorrow: DayKey
  /** Monday-based week that contains today. */
  weekStart: DayKey
  weekEnd: DayKey
  nextWeekStart: DayKey
  nextWeekEnd: DayKey
  lastWeekStart: DayKey
  lastWeekEnd: DayKey
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  hour: number
  /** Days of the current week still ahead, today included. */
  remainingWeekDays: DayKey[]
}

export type TimeFrame = 'today' | 'yesterday' | 'tomorrow' | 'this_week' | 'next_week' | 'last_week'

/**
 * What the user is asking about within a timeframe:
 * - did:      what actually happened (completed workouts, logged meals)
 * - planned:  what was on the schedule, whether or not it happened
 * - upcoming: what is still to come
 */
export type TimeMode = 'did' | 'planned' | 'upcoming'

export interface TimeReference {
  frame: TimeFrame
  mode: TimeMode
}

export function buildTemporalContext(now = new Date()): TemporalContext {
  const ws = startOfWeek(now)
  const today = dayKey(now)
  const remainingWeekDays: DayKey[] = []
  for (let i = 0; i < 7; i++) {
    const k = dayKey(addDays(ws, i))
    if (k >= today) remainingWeekDays.push(k)
  }
  return {
    now: now.toISOString(),
    today,
    yesterday: dayKey(addDays(now, -1)),
    tomorrow: dayKey(addDays(now, 1)),
    weekStart: dayKey(ws),
    weekEnd: dayKey(addDays(ws, 6)),
    nextWeekStart: dayKey(addDays(ws, 7)),
    nextWeekEnd: dayKey(addDays(ws, 13)),
    lastWeekStart: dayKey(addDays(ws, -7)),
    lastWeekEnd: dayKey(addDays(ws, -1)),
    weekday: now.getDay(),
    hour: now.getHours(),
    remainingWeekDays,
  }
}

/** Inclusive day range for a timeframe. */
export function rangeFor(frame: TimeFrame, t: TemporalContext): { from: DayKey; to: DayKey } {
  switch (frame) {
    case 'today':
      return { from: t.today, to: t.today }
    case 'yesterday':
      return { from: t.yesterday, to: t.yesterday }
    case 'tomorrow':
      return { from: t.tomorrow, to: t.tomorrow }
    case 'this_week':
      return { from: t.weekStart, to: t.weekEnd }
    case 'next_week':
      return { from: t.nextWeekStart, to: t.nextWeekEnd }
    case 'last_week':
      return { from: t.lastWeekStart, to: t.lastWeekEnd }
  }
}

/** Frames in the past can only be reported as “did” or “planned”; future frames as “upcoming”. */
export function defaultModeFor(frame: TimeFrame): TimeMode {
  return frame === 'tomorrow' || frame === 'next_week' ? 'upcoming' : 'did'
}

/**
 * Read a timeframe and mode from free text (English or French). Returns
 * undefined when the text does not talk about a period at all, so callers can
 * fall back to their own default.
 */
export function resolveTimeReference(text: string): TimeReference | undefined {
  const t = normalizeForMatching(text)
  let frame: TimeFrame | undefined
  if (/\byesterday\b|\bhier\b/.test(t)) frame = 'yesterday'
  else if (/\btomorrow\b|\bdemain\b/.test(t)) frame = 'tomorrow'
  else if (/\bnext week\b|\bla semaine prochaine\b|\bsemaine pro\b|\bsemaine prochaine\b/.test(t)) frame = 'next_week'
  else if (/\blast week\b|\bla semaine derniere\b|\bsemaine derniere\b|\bla semaine passee\b|\bsemaine passee\b/.test(t)) frame = 'last_week'
  else if (/\bthis week\b|\bthe week\b|\bcette semaine\b|\bla semaine\b|\bma semaine\b/.test(t)) frame = 'this_week'
  else if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b|\baujourd'hui\b|\bce soir\b|\bce matin\b|\bcet apres-midi\b|\bce midi\b|\bdu jour\b/.test(t)) frame = 'today'
  if (!frame) return undefined
  const planned = /\b(was|were|is|are)\s+(planned|scheduled|on the (plan|schedule|calendar))\b|\bplanned for\b|\bsupposed to\b|\bon the plan\b|\bwhat'?s (planned|scheduled)\b|\b(etait|etaient|est|sont|avais|avait) (prevu|prevue|prevus|prevues|programme|programmee|au programme|au planning)\b|\bprevu pour\b|\bcense\b|\bcensee\b|\bqu'est-ce qui (etait|est) prevu\b|\bqu'est-ce que j'avais (de )?prevu\b|\bj'avais quoi\b|\bc'etait quoi le programme\b/.test(t)
  const did = /\b(did|have|had)\b.*\b(do|done|train|trained|eat|eaten|ate|log|logged|complete|completed)\b|\bwhat did i\b|\bhow did\b|\bwhat have i\b|\bj'ai (fait|mange|pris|fini|termine|bouge|couru)\b|\bj'ai fait quoi\b|\bj'ai mange quoi\b|\bcomment (s'est|ca s'est|c'etait)\b|\bqu'ai-je\b|\best-ce que je me suis\b/.test(t)
  const mode: TimeMode = planned ? 'planned' : did ? 'did' : defaultModeFor(frame)
  return { frame, mode }
}

/** Human label for a frame in the given language: “yesterday” · “hier”. */
export function labelForFrame(frame: TimeFrame, lang: Language = getLanguage()): string {
  const key = { today: 'common.today', yesterday: 'common.yesterday', tomorrow: 'common.tomorrow', this_week: 'common.thisWeek', next_week: 'common.nextWeek', last_week: 'common.lastWeek' }[frame] as 'common.today'
  return translate(key, undefined, lang).toLowerCase()
}

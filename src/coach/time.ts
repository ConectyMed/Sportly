import type { DayKey, ISODate } from '@/domain/types'
import { addDays, dayKey, startOfWeek } from '@/lib/dates'

/**
 * Temporal context: one place that knows what “today”, “tomorrow”, “this week”
 * and “yesterday” mean for the current turn, so the coach never confuses what
 * was planned with what actually happened.
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
 * Read a timeframe and mode from free text. Returns undefined when the text does
 * not talk about a period at all, so callers can fall back to their own default.
 */
export function resolveTimeReference(text: string): TimeReference | undefined {
  const t = text.toLowerCase().replace(/[’‘]/g, "'")
  let frame: TimeFrame | undefined
  if (/\byesterday\b/.test(t)) frame = 'yesterday'
  else if (/\btomorrow\b/.test(t)) frame = 'tomorrow'
  else if (/\bnext week\b/.test(t)) frame = 'next_week'
  else if (/\blast week\b/.test(t)) frame = 'last_week'
  else if (/\bthis week\b|\bthe week\b/.test(t)) frame = 'this_week'
  else if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/.test(t)) frame = 'today'
  if (!frame) return undefined
  const planned = /\b(was|were|is|are)\s+(planned|scheduled|on the (plan|schedule|calendar))\b|\bplanned for\b|\bsupposed to\b|\bon the plan\b|\bwhat'?s (planned|scheduled)\b/.test(t)
  const did = /\b(did|have|had)\b.*\b(do|done|train|trained|eat|eaten|ate|log|logged|complete|completed)\b|\bwhat did i\b|\bhow did\b|\bwhat have i\b/.test(t)
  const mode: TimeMode = planned ? 'planned' : did ? 'did' : defaultModeFor(frame)
  return { frame, mode }
}

export function labelForFrame(frame: TimeFrame): string {
  return { today: 'today', yesterday: 'yesterday', tomorrow: 'tomorrow', this_week: 'this week', next_week: 'next week', last_week: 'last week' }[frame]
}

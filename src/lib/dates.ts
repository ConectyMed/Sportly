import { capitalizeFirst, formatDateIntl, weekdayNameByIndex } from '@/i18n/format'
import { getLanguage } from '@/i18n/runtime'
import { t } from '@/i18n'
import type { Language } from '@/i18n/types'

/**
 * Lightweight date helpers. All dates are handled in local time. ISO day keys
 * are `YYYY-MM-DD` and never change with the language; every human-readable
 * form below is produced through Intl in the user's selected language.
 */

export type DayKey = string

/** English canonical names, used for parsing and as stable identifiers; never for display. */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

export function now(): Date {
  return new Date()
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000)
}

export function dayKey(d: Date | string | number = new Date()): DayKey {
  const x = new Date(d)
  const y = x.getFullYear()
  const m = (x.getMonth() + 1).toString().padStart(2, '0')
  const day = x.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromDayKey(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayKey(): DayKey {
  return dayKey(new Date())
}

export function isSameDay(a: Date | string, b: Date | string): boolean {
  return dayKey(a) === dayKey(b)
}

export function isToday(d: Date | string): boolean {
  return dayKey(d) === todayKey()
}

export function diffDays(a: Date | string, b: Date | string): number {
  const x = startOfDay(new Date(a)).getTime()
  const y = startOfDay(new Date(b)).getTime()
  return Math.round((x - y) / 86_400_000)
}

/** Monday-based start of week. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d)
  const day = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - day)
  return x
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/** Localised weekday name ("Monday" · "lundi"; short "Mon" · "lun"). */
export function weekdayName(d: Date | string, short = false, lang: Language = getLanguage()): string {
  return weekdayNameByIndex(new Date(d).getDay(), short, lang)
}

/** Localised month name ("September" · "septembre"). */
export function monthName(d: Date | string, short = false, lang: Language = getLanguage()): string {
  return formatDateIntl(new Date(d), short ? 'month-short' : 'month-long', lang)
}

/** "September 14" · "14 septembre"; with weekday "Monday, September 14" · "lundi 14 septembre". */
export function formatDate(d: Date | string, opts: { weekday?: boolean; year?: boolean } = {}, lang: Language = getLanguage()): string {
  const x = new Date(d)
  if (opts.weekday) return formatDateIntl(x, 'date-weekday', lang)
  return formatDateIntl(x, opts.year ? 'date-year' : 'date', lang)
}

/** "Sep 14" · "14 sept". */
export function formatShortDate(d: Date | string, lang: Language = getLanguage()): string {
  return formatDateIntl(new Date(d), 'date-short', lang)
}

/** "6:30 PM" · "18:30". */
export function formatTime(d: Date | string, lang: Language = getLanguage()): string {
  return formatDateIntl(new Date(d), 'time', lang)
}

export function relativeDay(d: Date | string, lang: Language = getLanguage()): string {
  const diff = diffDays(new Date(), d)
  if (diff === 0) return t('common.today', undefined, lang)
  if (diff === 1) return t('common.yesterday', undefined, lang)
  if (diff === -1) return t('common.tomorrow', undefined, lang)
  if (diff > 1 && diff < 7) return t('common.daysAgo', { count: diff }, lang)
  if (diff < -1 && diff > -7) return capitalizeFirst(weekdayName(d, false, lang))
  return formatShortDate(d, lang)
}

export function relativeTime(d: Date | string, lang: Language = getLanguage()): string {
  const ms = Date.now() - new Date(d).getTime()
  const min = Math.round(ms / 60_000)
  if (min < 1) return t('common.justNow', undefined, lang)
  if (min < 60) return t('common.minutesAgo', { count: min }, lang)
  const h = Math.round(min / 60)
  if (h < 24) return t('common.hoursAgo', { count: h }, lang)
  return relativeDay(d, lang)
}

export function timeOfDayGreeting(d: Date = new Date(), lang: Language = getLanguage()): string {
  const h = d.getHours()
  if (h < 5) return t('common.goodNight', undefined, lang)
  if (h < 12) return t('common.goodMorning', undefined, lang)
  if (h < 17) return t('common.goodAfternoon', undefined, lang)
  if (h < 22) return t('common.goodEvening', undefined, lang)
  return t('common.goodNight', undefined, lang)
}

/** Period of the day as a stable token (for logic, not display). */
export function timeOfDay(d: Date = new Date()): 'night' | 'morning' | 'afternoon' | 'evening' {
  const h = d.getHours()
  if (h < 5) return 'night'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  if (h < 22) return 'evening'
  return 'night'
}

/** Read a weekday from an English or French word ("mon", "Monday", "lundi", "lun."). Accent-tolerant. */
export function parseWeekday(word: string): number | null {
  const w = word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.$/, '')
  const en = w.slice(0, 3)
  const idx = WEEKDAYS_SHORT.findIndex((n) => n.toLowerCase() === en)
  if (idx !== -1) return idx
  const fr = WEEKDAYS_FR.findIndex((n) => n.startsWith(w) && w.length >= 3)
  return fr === -1 ? null : fr
}

/** Next date (today or later) that falls on the given weekday (0 = Sunday). */
export function nextWeekday(weekday: number, from = new Date(), allowToday = true): Date {
  const start = startOfDay(from)
  for (let i = allowToday ? 0 : 1; i < 8; i++) {
    const d = addDays(start, i)
    if (d.getDay() === weekday) return d
  }
  return start
}

/** English canonical weekday names (identifiers for parsing and tests). Use weekdayName() for anything shown. */
export const WEEKDAY_NAMES = WEEKDAYS
export const WEEKDAY_SHORT = WEEKDAYS_SHORT

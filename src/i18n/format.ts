import { getLanguage } from './runtime'
import { LOCALES, type Language } from './types'

/**
 * Locale-aware presentation of numbers and dates. Values are stored as plain
 * numbers and ISO strings; only the presentation changes with the language.
 */

const numberFormats = new Map<string, Intl.NumberFormat>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()
const pluralRules = new Map<string, Intl.PluralRules>()

function numberFormat(lang: Language, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}:${JSON.stringify(opts)}`
  let f = numberFormats.get(key)
  if (!f) {
    f = new Intl.NumberFormat(LOCALES[lang], opts)
    numberFormats.set(key, f)
  }
  return f
}

function dateFormat(lang: Language, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}:${JSON.stringify(opts)}`
  let f = dateFormats.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALES[lang], opts)
    dateFormats.set(key, f)
  }
  return f
}

/** Whole number with locale grouping: 2,340 (en) · 2 340 (fr). */
export function formatInt(n: number, lang: Language = getLanguage()): string {
  return numberFormat(lang, { maximumFractionDigits: 0 }).format(Math.round(n))
}

/** Decimal with a fixed number of digits: 74.2 (en) · 74,2 (fr). */
export function formatDecimal(n: number, digits = 1, lang: Language = getLanguage()): string {
  return numberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
}

/** Decimal with up to `digits` digits, trailing zeros dropped: 74.2 · 74 · 0.5. */
export function formatNumber(n: number, digits = 1, lang: Language = getLanguage()): string {
  return numberFormat(lang, { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(n)
}

/** Signed change: +1.2 · −0,4. */
export function formatSigned(n: number, digits = 1, lang: Language = getLanguage()): string {
  return numberFormat(lang, { minimumFractionDigits: 0, maximumFractionDigits: digits, signDisplay: 'exceptZero' }).format(n)
}

export function pluralCategory(n: number, lang: Language = getLanguage()): Intl.LDMLPluralRule {
  let r = pluralRules.get(lang)
  if (!r) {
    r = new Intl.PluralRules(LOCALES[lang])
    pluralRules.set(lang, r)
  }
  return r.select(n)
}

export type DateStyle = 'weekday-long' | 'weekday-short' | 'month-long' | 'month-short' | 'date' | 'date-year' | 'date-weekday' | 'date-short' | 'time' | 'day-month-short'

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  'weekday-long': { weekday: 'long' },
  'weekday-short': { weekday: 'short' },
  'month-long': { month: 'long' },
  'month-short': { month: 'short' },
  date: { month: 'long', day: 'numeric' },
  'date-year': { month: 'long', day: 'numeric', year: 'numeric' },
  'date-weekday': { weekday: 'long', month: 'long', day: 'numeric' },
  'date-short': { month: 'short', day: 'numeric' },
  'day-month-short': { day: 'numeric', month: 'short' },
  time: { hour: 'numeric', minute: '2-digit' },
}

/** Locale date formatting. English keeps "Monday, September 14"; French gives "lundi 14 septembre". */
export function formatDateIntl(d: Date, style: DateStyle, lang: Language = getLanguage()): string {
  const out = dateFormat(lang, DATE_OPTIONS[style]).format(d)
  // French short weekday/month names come with a trailing dot ("lun.", "sept."); the UI uses them as compact tokens.
  if (style === 'weekday-short' || style === 'month-short' || style === 'date-short' || style === 'day-month-short') return out.replace(/\./g, '')
  return out
}

/** Weekday name for a weekday index (0 = Sunday). Uses a fixed reference week so no date maths is needed. */
export function weekdayNameByIndex(weekday: number, short = false, lang: Language = getLanguage()): string {
  // 7 January 2024 was a Sunday.
  return formatDateIntl(new Date(2024, 0, 7 + ((weekday % 7) + 7) % 7), short ? 'weekday-short' : 'weekday-long', lang)
}

/** Two-letter weekday token for compact grids ("Mo" · "Lu"). */
export function weekdayInitials(weekday: number, lang: Language = getLanguage()): string {
  const name = weekdayNameByIndex(weekday, false, lang)
  return name.charAt(0).toUpperCase() + name.slice(1, 2)
}

/** Capitalise the first letter (French date names are lowercase; sentence starts are not). */
export function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

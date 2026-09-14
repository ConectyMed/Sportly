import { en } from './en'
import { fr } from './fr'
import { formatDateIntl, formatDecimal, formatInt, formatNumber, formatSigned, pluralCategory, weekdayNameByIndex, type DateStyle } from './format'
import { getLanguage } from './runtime'
import { LOCALES, type Language } from './types'

/**
 * Sportly's translation system.
 *
 *  - One source of truth for keys: the English dictionary. French must carry
 *    exactly the same keys (enforced by TypeScript and by a test).
 *  - Keys are typed: t('home.today') compiles, t('home.tday') does not.
 *  - Deterministic fallback: a missing French value falls back to English; a
 *    missing English value falls back to a humanised key. The user never sees
 *    "undefined" or "translation.key.name".
 *  - Plurals use Intl.PluralRules with `_one` / `_other` variants, so French
 *    ("0 séance", "1 séance", "2 séances") and English ("0 sessions", "1 session")
 *    each follow their own grammar.
 *  - Numbers and dates are formatted through Intl at presentation time.
 */

export type Messages = typeof en
export type MessageKey = keyof Messages
type PluralBase<K> = K extends `${infer B}_other` ? B : never
export type PluralKey = PluralBase<MessageKey>
export type Params = Record<string, string | number | undefined>

const DICTIONARIES: Record<Language, Record<string, string>> = { en, fr }

/** Keys requested but absent from the dictionary, so tests can assert none were hit. */
const missing = new Set<string>()
export function missingKeys(): string[] {
  return [...missing]
}
export function resetMissingKeys(): void {
  missing.clear()
}

function humanise(key: string): string {
  const leaf = key.split('.').pop() ?? key
  return leaf.replace(/_(one|other|zero)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function raw(key: string, lang: Language): string {
  const own = DICTIONARIES[lang][key]
  if (typeof own === 'string' && own.length) return own
  const fallback = DICTIONARIES.en[key]
  if (lang !== 'en' && typeof fallback === 'string' && fallback.length) {
    missing.add(`${lang}:${key}`)
    return fallback
  }
  missing.add(`${lang}:${key}`)
  return humanise(key)
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name]
    return v === undefined || v === null ? m : String(v)
  })
}

export function hasKey(key: string): key is MessageKey {
  return typeof (en as Record<string, string>)[key] === 'string'
}

/** Translate a key in the given (or active) language. */
export function t(key: MessageKey, params?: Params, lang: Language = getLanguage()): string {
  return interpolate(raw(key, lang), params)
}

/** Plural-aware translation: looks up `${key}_one` / `${key}_other` (and `_zero` when present) and injects {count}. */
export function tn(key: PluralKey, count: number, params?: Params, lang: Language = getLanguage()): string {
  const category = pluralCategory(count, lang)
  const dict = DICTIONARIES[lang]
  const candidate = `${key}_${category}`
  const resolved = typeof dict[candidate] === 'string' ? candidate : category === 'zero' && typeof dict[`${key}_one`] === 'string' ? `${key}_one` : `${key}_other`
  return interpolate(raw(resolved, lang), { count, ...(params ?? {}) })
}

export interface Translator {
  lang: Language
  locale: string
  t: (key: MessageKey, params?: Params) => string
  tn: (key: PluralKey, count: number, params?: Params) => string
  int: (n: number) => string
  num: (n: number, digits?: number) => string
  dec: (n: number, digits?: number) => string
  signed: (n: number, digits?: number) => string
  date: (d: Date | string, style: DateStyle) => string
  weekday: (index: number, short?: boolean) => string
  /** "a, b and c" / "a, b et c" */
  list: (parts: string[]) => string
}

/** A translator bound to one language, for code that speaks for a specific turn (the coach, the model prompt). */
export function translator(lang: Language = getLanguage()): Translator {
  return {
    lang,
    locale: LOCALES[lang],
    t: (key, params) => t(key, params, lang),
    tn: (key, count, params) => tn(key, count, params, lang),
    int: (n) => formatInt(n, lang),
    num: (n, digits = 1) => formatNumber(n, digits, lang),
    dec: (n, digits = 1) => formatDecimal(n, digits, lang),
    signed: (n, digits = 1) => formatSigned(n, digits, lang),
    date: (d, style) => formatDateIntl(typeof d === 'string' ? new Date(d) : d, style, lang),
    weekday: (index, short = false) => weekdayNameByIndex(index, short, lang),
    list: (parts) => {
      if (parts.length <= 1) return parts.join('')
      return `${parts.slice(0, -1).join(', ')} ${t('common.and', undefined, lang)} ${parts[parts.length - 1]}`
    },
  }
}

export { detectBrowserLanguage, isLanguage, LANGUAGE_NAMES, LANGUAGES, LOCALES, DEFAULT_LANGUAGE, type Language } from './types'
export { getLanguage, onLanguageChange, setActiveLanguage } from './runtime'
export { capitalizeFirst, formatDateIntl, formatDecimal, formatInt, formatNumber, formatSigned, pluralCategory, weekdayInitials, weekdayNameByIndex, type DateStyle } from './format'
export { en, fr }

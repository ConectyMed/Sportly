/**
 * Language is user state. This module only knows which languages exist and how
 * to detect a sensible default; the selected language itself lives in the store
 * (preferences.language) and is mirrored into the i18n runtime.
 */

export type Language = 'en' | 'fr'

export const LANGUAGES: Language[] = ['en', 'fr']

export const DEFAULT_LANGUAGE: Language = 'en'

/** BCP 47 locale used for Intl formatting (dates, numbers, plural rules). */
export const LOCALES: Record<Language, string> = { en: 'en-US', fr: 'fr-FR' }

/** Native names, shown in the language selector. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', fr: 'Français' }

export function isLanguage(x: unknown): x is Language {
  return x === 'en' || x === 'fr'
}

/**
 * Initial language for a FIRST-TIME user: French browser → French, anything
 * else → English. Once the user has a persisted preference this is never
 * consulted again, so an explicit choice always wins.
 */
export function detectBrowserLanguage(candidates: readonly string[] | undefined = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : undefined): Language {
  for (const c of candidates ?? []) {
    const tag = String(c ?? '').toLowerCase()
    if (!tag) continue
    if (tag.startsWith('fr')) return 'fr'
    if (tag.startsWith('en')) return 'en'
  }
  return DEFAULT_LANGUAGE
}

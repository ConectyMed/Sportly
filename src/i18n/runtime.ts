import { DEFAULT_LANGUAGE, type Language } from './types'

/**
 * The active-language mirror. The store is the source of truth
 * (preferences.language); it pushes every change here so that code with no
 * React and no store access (date formatting, tool summaries, generators) can
 * still speak the user's language without importing the store.
 */

let active: Language = DEFAULT_LANGUAGE
const listeners = new Set<(lang: Language) => void>()

export function getLanguage(): Language {
  return active
}

export function setActiveLanguage(lang: Language): void {
  if (lang === active) return
  active = lang
  for (const l of listeners) l(lang)
}

export function onLanguageChange(listener: (lang: Language) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

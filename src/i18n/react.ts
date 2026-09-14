import { useMemo } from 'react'
import { useStore } from '@/store/useStore'
import { translator, type Translator } from './index'
import type { Language } from './types'

/** The user's selected language, reactive. */
export function useLanguage(): Language {
  return useStore((s) => s.preferences.language)
}

/** A translator bound to the selected language; components re-render when it changes. */
export function useT(): Translator {
  const lang = useLanguage()
  return useMemo(() => translator(lang), [lang])
}

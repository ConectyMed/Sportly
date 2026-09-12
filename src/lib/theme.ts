import { useEffect } from 'react'
import { useStore } from '@/store/useStore'

export function resolveTheme(pref: 'dark' | 'light' | 'system'): 'dark' | 'light' {
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  metas.forEach((m) => (m.content = theme === 'dark' ? '#050505' : '#ffffff'))
}

/** Keeps <html data-theme> in sync with preferences and the system setting. */
export function useThemeSync(): void {
  const pref = useStore((s) => s.preferences.theme)
  useEffect(() => {
    applyTheme(resolveTheme(pref))
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(resolveTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])
}

export function useReducedMotionPref(): void {
  const pref = useStore((s) => s.preferences.reducedMotion)
  useEffect(() => {
    const root = document.documentElement
    if (pref === 'on') root.style.setProperty('--motion-off', '1')
    else root.style.removeProperty('--motion-off')
    root.classList.toggle('reduce-motion', pref === 'on')
  }, [pref])
}

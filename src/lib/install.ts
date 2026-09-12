import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return Boolean(nav.standalone) || window.matchMedia('(display-mode: standalone)').matches
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream
}

/** Install affordance state: native prompt when available, iOS hint otherwise. */
export function useInstall(): { canPrompt: boolean; standalone: boolean; ios: boolean; prompt: () => Promise<boolean> } {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return {
    canPrompt: Boolean(deferred),
    standalone: isStandalone(),
    ios: isIOS(),
    prompt: async () => {
      if (!deferred) return false
      await deferred.prompt()
      const choice = await deferred.userChoice
      deferred = null
      force((n) => n + 1)
      return choice.outcome === 'accepted'
    },
  }
}

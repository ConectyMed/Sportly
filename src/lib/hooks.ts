import { useEffect, useRef, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false))
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    setMatches(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 900px)')
}

export function useInterval(cb: () => void, ms: number | null): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    if (ms === null) return
    const id = setInterval(() => ref.current(), ms)
    return () => clearInterval(id)
  }, [ms])
}

/** Ticks every `ms` while active; returns elapsed seconds since `since`. */
export function useElapsed(since: string | number | Date | undefined, active = true): number {
  const [, force] = useState(0)
  useInterval(() => force((n) => n + 1), active && since ? 1000 : null)
  if (!since) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000))
}

export function useNow(ms = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useInterval(() => setNow(new Date()), ms)
  return now
}

export function useIsStandalone(): boolean {
  const [standalone] = useState(() => {
    if (typeof window === 'undefined') return false
    const nav = window.navigator as Navigator & { standalone?: boolean }
    return Boolean(nav.standalone) || window.matchMedia('(display-mode: standalone)').matches
  })
  return standalone
}

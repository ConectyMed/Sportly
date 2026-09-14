import { t } from '@/i18n'
import { formatDecimal, formatInt } from '@/i18n/format'
import { getLanguage } from '@/i18n/runtime'
import type { Language } from '@/i18n/types'

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return prefix ? `${prefix}_${rand}` : rand
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function round(n: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

export function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0)
}

export function avg(arr: number[]): number {
  return arr.length ? sum(arr) / arr.length : 0
}

export function pick<T>(arr: readonly T[], seed?: number): T {
  if (seed === undefined) return arr[Math.floor(Math.random() * arr.length)]
  return arr[Math.abs(Math.floor(seed)) % arr.length]
}

export function shuffle<T>(arr: readonly T[], seed = Math.random()): T[] {
  const out = [...arr]
  let s = Math.floor(seed * 2 ** 31) || 1
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** English-only pluralisation for internal/log strings. User-facing counts go through tn() in @/i18n. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function haptic(pattern: number | number[] = 8): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern)
  } catch {
    /* noop */
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** "45 min" · "1h 15m" (en) · "1 h 15" (fr). */
export function formatMinutes(min: number, lang: Language = getLanguage()): string {
  if (min < 60) return `${formatInt(min, lang)} ${t('common.min', undefined, lang)}`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? t('common.hoursMinutes', { h, m: String(m).padStart(2, '0') }, lang) : t('common.hoursOnly', { h }, lang)
}

/** "74.2 kg" · "74,2 kg". */
export function formatKg(kg: number, decimals = 1, lang: Language = getLanguage()): string {
  return `${formatDecimal(round(kg, decimals), decimals, lang)} ${t('common.kg', undefined, lang)}`
}

/** Whole number with locale grouping: 2,340 · 2 340. */
export function formatNumber(n: number, lang: Language = getLanguage()): string {
  return formatInt(n, lang)
}

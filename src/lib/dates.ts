/** Lightweight date helpers. All dates are handled in local time. ISO day keys are `YYYY-MM-DD`. */

export type DayKey = string

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))

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

export function weekdayName(d: Date | string, short = false): string {
  const x = new Date(d)
  return short ? WEEKDAYS_SHORT[x.getDay()] : WEEKDAYS[x.getDay()]
}

export function monthName(d: Date | string, short = false): string {
  const x = new Date(d)
  return short ? MONTHS_SHORT[x.getMonth()] : MONTHS[x.getMonth()]
}

export function formatDate(d: Date | string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const x = new Date(d)
  const base = `${monthName(x)} ${x.getDate()}`
  const withYear = opts.year ? `${base}, ${x.getFullYear()}` : base
  return opts.weekday ? `${weekdayName(x)} · ${withYear}` : withYear
}

export function formatShortDate(d: Date | string): string {
  const x = new Date(d)
  return `${monthName(x, true)} ${x.getDate()}`
}

export function formatTime(d: Date | string): string {
  const x = new Date(d)
  let h = x.getHours()
  const m = x.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

export function relativeDay(d: Date | string): string {
  const diff = diffDays(new Date(), d)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff === -1) return 'Tomorrow'
  if (diff > 1 && diff < 7) return `${diff} days ago`
  if (diff < -1 && diff > -7) return weekdayName(d)
  return formatShortDate(d)
}

export function relativeTime(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime()
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  return relativeDay(d)
}

export function timeOfDayGreeting(d: Date = new Date()): string {
  const h = d.getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Good night'
}

export function parseWeekday(word: string): number | null {
  const w = word.toLowerCase().slice(0, 3)
  const idx = WEEKDAYS_SHORT.findIndex((n) => n.toLowerCase() === w)
  return idx === -1 ? null : idx
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

export const WEEKDAY_NAMES = WEEKDAYS
export const WEEKDAY_SHORT = WEEKDAYS_SHORT

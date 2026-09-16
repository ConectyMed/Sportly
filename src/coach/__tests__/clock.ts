import { vi } from 'vitest'

/**
 * A fixed "now" for the coach suites.
 *
 * The coach reads the system clock everywhere — `todayKey()`, `new Date()`,
 * the demo seed placing sessions by weekday relative to today — and the
 * journeys speak in relative dates ("demain", "cette semaine", "vendredi").
 * Read against the real clock, that made the same suite pass on the 14th and
 * fail on the 15th and again on the 16th with no code change. So the clock is
 * injected here instead: `Date` alone is faked, pinned to TEST_NOW, and still
 * advances in real time from there so `createdAt` ordering stays natural.
 * Timers are left real; the provider loop's timeout is a real setTimeout.
 *
 * Import this module first in every coach test file: `todayKey()` is read at
 * module load in several of them, before any hook could run.
 *
 * `SPORTLY_TEST_NOW=2026-09-14` (or a full ISO instant) overrides the pin, so
 * the family can be swept across dates:
 *
 *   for d in 14 15 16 17 18 19 20; do SPORTLY_TEST_NOW=2026-09-$d pnpm vitest run src/coach; done
 *
 * A date-only value pins 10:00 local, well inside the day: every day key in
 * the app is local time.
 */
// The app test program carries no Node types; the environment is read through globalThis on purpose.
const override = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SPORTLY_TEST_NOW
export const TEST_NOW: Date = new Date(override ? (/^\d{4}-\d{2}-\d{2}$/.test(override) ? `${override}T10:00:00` : override) : '2026-09-16T10:00:00')
if (Number.isNaN(TEST_NOW.getTime())) throw new Error(`SPORTLY_TEST_NOW is not a date: ${override}`)

vi.useFakeTimers({ toFake: ['Date'], now: TEST_NOW, shouldAdvanceTime: true })

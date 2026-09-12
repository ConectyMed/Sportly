import type { DailyCheckIn, DayKey, Workout } from '@/domain/types'
import { clamp, round } from '@/lib/utils'
import { diffDays, todayKey } from '@/lib/dates'

export interface Readiness {
  score: number
  label: 'Excellent' | 'Good' | 'Moderate' | 'Low'
  energy: number
  recovery: 'Excellent' | 'Good' | 'Moderate' | 'Low'
  recommendation: 'push' | 'normal' | 'lighter' | 'rest'
  factors: string[]
  hasCheckIn: boolean
  sleepHours?: number
  recentSessions: number
}

export function computeReadiness(
  checkIn: DailyCheckIn | undefined,
  workouts: Workout[],
  date: DayKey = todayKey(),
  typicalSleep = 7,
): Readiness {
  let score = 72
  const factors: string[] = []
  const completed = workouts.filter((w) => w.status === 'completed' && w.completedAt)
  const recentSessions = completed.filter((w) => {
    const d = diffDays(date, w.completedAt!)
    return d >= 0 && d <= 2
  }).length
  const last = completed.sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1))[0]
  const daysSinceLast = last ? diffDays(date, last.completedAt!) : 99

  const sleep = checkIn?.sleepHours
  if (sleep !== undefined) {
    if (sleep >= 7.5) {
      score += 12
      factors.push('Slept well')
    } else if (sleep >= 6.5) {
      score += 4
    } else if (sleep >= 5.5) {
      score -= 8
      factors.push('Short sleep')
    } else {
      score -= 16
      factors.push('Very short sleep')
    }
  } else if (typicalSleep < 6.5) {
    score -= 4
  }

  if (checkIn?.sleepQuality) score += (checkIn.sleepQuality - 3) * 3

  const energy = checkIn?.energy
  if (energy !== undefined) {
    score += (energy - 5.5) * 3.2
    if (energy >= 8) factors.push('High energy')
    if (energy <= 4) factors.push('Low energy')
  }
  if (checkIn?.fatigue !== undefined) {
    score -= (checkIn.fatigue - 5) * 3
    if (checkIn.fatigue >= 7) factors.push('Feeling tired')
  }
  if (checkIn?.soreness !== undefined) {
    score -= (checkIn.soreness - 4) * 2.2
    if (checkIn.soreness >= 7) factors.push('Sore')
  }

  if (recentSessions === 0 && daysSinceLast >= 2) {
    score += 5
    factors.push('Fresh legs')
  } else if (recentSessions >= 3) {
    score -= 14
    factors.push('Heavy recent load')
  } else if (recentSessions === 2) {
    score -= 7
    factors.push('Two sessions in 48h')
  }
  if (daysSinceLast >= 6 && daysSinceLast < 99) factors.push('A few days off')

  score = clamp(round(score), 18, 98)
  const label = score >= 85 ? 'Excellent' : score >= 68 ? 'Good' : score >= 50 ? 'Moderate' : 'Low'
  const recommendation = score >= 84 ? 'push' : score >= 60 ? 'normal' : score >= 42 ? 'lighter' : 'rest'
  const derivedEnergy = energy ?? clamp(round(score / 10), 1, 10)

  return {
    score,
    label,
    energy: derivedEnergy,
    recovery: label,
    recommendation,
    factors: factors.slice(0, 3),
    hasCheckIn: Boolean(checkIn && (checkIn.energy !== undefined || checkIn.sleepHours !== undefined)),
    sleepHours: sleep,
    recentSessions,
  }
}

import { e1rm, getExercise } from '@/domain/exercises'
import { exerciseName } from '@/domain/labels'
import type { DailyCheckIn, DayKey, Goal, Measurement, Workout } from '@/domain/types'
import { translator } from '@/i18n'
import { getLanguage } from '@/i18n/runtime'
import type { Language } from '@/i18n/types'
import { addDays, dayKey, diffDays, startOfWeek, todayKey } from '@/lib/dates'
import { avg, round } from '@/lib/utils'
import { workoutVolume } from './workoutGenerator'

export interface Insight {
  id: string
  kind: 'positive' | 'neutral' | 'watch'
  text: string
  detail?: string
}

export interface WeekStat {
  weekStart: DayKey
  sessions: number
  volume: number
  minutes: number
}

export interface PR {
  exerciseId: string
  name: string
  weightKg: number
  reps: number
  e1rm: number
  date: DayKey
}

export function completedWorkouts(workouts: Workout[]): Workout[] {
  return workouts.filter((w) => w.status === 'completed' && w.completedAt).sort((a, b) => (a.completedAt! < b.completedAt! ? -1 : 1))
}

export function weeklyStats(workouts: Workout[], weeks = 8, ref = new Date()): WeekStat[] {
  const done = completedWorkouts(workouts)
  const out: WeekStat[] = []
  const thisWeek = startOfWeek(ref)
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i)
    const end = addDays(start, 7)
    const inWeek = done.filter((w) => {
      const d = new Date(w.completedAt!)
      return d >= start && d < end
    })
    out.push({
      weekStart: dayKey(start),
      sessions: inWeek.length,
      volume: round(inWeek.reduce((a, w) => a + (w.summary?.totalVolumeKg ?? workoutVolume(w)), 0)),
      minutes: round(inWeek.reduce((a, w) => a + (w.summary?.durationSec ?? w.estimatedMinutes * 60) / 60, 0)),
    })
  }
  return out
}

/** Consecutive weeks (ending this week or last) hitting at least target-1 sessions. */
export function consistencyStreak(workouts: Workout[], targetPerWeek: number): { current: number; longest: number; thisWeek: number } {
  const stats = weeklyStats(workouts, 26)
  const need = Math.max(1, targetPerWeek - 1)
  let longest = 0
  let run = 0
  for (const s of stats) {
    if (s.sessions >= need) {
      run++
      longest = Math.max(longest, run)
    } else run = 0
  }
  // Current streak: count backwards, allowing this week to be in progress.
  let current = 0
  const last = stats[stats.length - 1]
  const startIdx = last.sessions >= need ? stats.length - 1 : stats.length - 2
  for (let i = startIdx; i >= 0; i--) {
    if (stats[i].sessions >= need) current++
    else break
  }
  return { current, longest: Math.max(longest, current), thisWeek: last.sessions }
}

export function personalRecords(workouts: Workout[]): PR[] {
  const best = new Map<string, PR>()
  for (const w of completedWorkouts(workouts)) {
    for (const e of w.exercises) {
      for (const s of e.sets) {
        if (!s.completed) continue
        const weight = s.actualWeightKg ?? s.targetWeightKg
        const reps = s.actualReps ?? s.targetReps
        if (!weight || !reps) continue
        const est = e1rm(weight, reps)
        const prev = best.get(e.exerciseId)
        if (!prev || est > prev.e1rm) best.set(e.exerciseId, { exerciseId: e.exerciseId, name: e.name, weightKg: weight, reps, e1rm: round(est, 1), date: dayKey(w.completedAt!) })
      }
    }
  }
  return [...best.values()].sort((a, b) => b.e1rm - a.e1rm)
}

/** Detect PRs achieved in one workout compared to all previous history. */
export function detectPRs(workout: Workout, history: Workout[]): PR[] {
  const previous = personalRecords(history.filter((w) => w.id !== workout.id && w.status === 'completed'))
  const prevMap = new Map(previous.map((p) => [p.exerciseId, p.e1rm]))
  const prs: PR[] = []
  for (const e of workout.exercises) {
    let bestSet: PR | undefined
    for (const s of e.sets) {
      if (!s.completed) continue
      const weight = s.actualWeightKg ?? s.targetWeightKg
      const reps = s.actualReps ?? s.targetReps
      if (!weight || !reps) continue
      const est = e1rm(weight, reps)
      if (!bestSet || est > bestSet.e1rm) bestSet = { exerciseId: e.exerciseId, name: e.name, weightKg: weight, reps, e1rm: round(est, 1), date: todayKey() }
    }
    if (bestSet && getExercise(e.exerciseId).compound && bestSet.e1rm > (prevMap.get(e.exerciseId) ?? 0) + 0.5 && prevMap.has(e.exerciseId)) prs.push(bestSet)
  }
  return prs
}

export function weightSeries(measurements: Measurement[]): Array<{ date: DayKey; value: number }> {
  return measurements.filter((m) => m.type === 'body_weight').sort((a, b) => a.date.localeCompare(b.date)).map((m) => ({ date: m.date, value: m.value }))
}

export function weightTrend(measurements: Measurement[]): { current?: number; start?: number; change30?: number; change7?: number; stalled: boolean; weeklyRate?: number } {
  const series = weightSeries(measurements)
  if (!series.length) return { stalled: false }
  const last = series[series.length - 1]
  const at = (daysAgo: number) => {
    const key = dayKey(addDays(new Date(), -daysAgo))
    const before = series.filter((s) => s.date <= key)
    return before[before.length - 1]?.value
  }
  const recent = series.slice(-4).map((s) => s.value)
  const current = round(avg(recent), 1)
  const w30 = at(30)
  const w7 = at(7)
  const w21 = at(21)
  const change30 = w30 !== undefined ? round(current - w30, 1) : undefined
  const change7 = w7 !== undefined ? round(last.value - w7, 1) : undefined
  const stalled = w21 !== undefined && Math.abs(current - w21) < 0.35 && series.length >= 6
  const weeklyRate = change30 !== undefined ? round(change30 / 4.3, 2) : undefined
  return { current, start: series[0].value, change30, change7, stalled, weeklyRate }
}

export interface InsightInput {
  workouts: Workout[]
  measurements: Measurement[]
  checkIns: Record<DayKey, DailyCheckIn>
  goals: Goal[]
  targetPerWeek: number
}

export function generateInsights(input: InsightInput, lang: Language = getLanguage()): Insight[] {
  const { workouts, measurements, checkIns, goals, targetPerWeek } = input
  const tr = translator(lang)
  const insights: Insight[] = []
  const stats = weeklyStats(workouts, 9)
  const thisMonth = stats.slice(-4)
  const lastMonth = stats.slice(-8, -4)
  const volNow = thisMonth.reduce((a, s) => a + s.volume, 0)
  const volPrev = lastMonth.reduce((a, s) => a + s.volume, 0)
  if (volPrev > 0 && volNow > 0) {
    const pct = round(((volNow - volPrev) / volPrev) * 100)
    if (Math.abs(pct) >= 4)
      insights.push({
        id: 'volume',
        kind: pct > 0 ? 'positive' : 'watch',
        text: pct > 0 ? tr.t('insight.volumeUp', { pct }) : tr.t('insight.volumeDown', { pct: Math.abs(pct) }),
        detail: tr.t(pct > 0 ? 'insight.volumeUp.detail' : 'insight.volumeDown.detail'),
      })
  }

  const streak = consistencyStreak(workouts, targetPerWeek)
  if (streak.current >= 2)
    insights.push({
      id: 'streak',
      kind: 'positive',
      text: tr.t('insight.streak', { weeks: streak.current }),
      detail: tr.t(streak.current >= 4 ? 'insight.streak.detail.long' : 'insight.streak.detail.short'),
    })
  else if (completedWorkouts(workouts).length > 0 && streak.thisWeek === 0 && new Date().getDay() >= 4)
    insights.push({ id: 'week', kind: 'watch', text: tr.t('insight.week'), detail: tr.t('insight.week.detail') })

  // Sleep vs missed sessions.
  const skipped = workouts.filter((w) => w.status === 'skipped')
  if (skipped.length >= 2) {
    const shortSleep = skipped.filter((w) => {
      const c = checkIns[w.scheduledFor]
      return c?.sleepHours !== undefined && c.sleepHours < 6.5
    })
    if (shortSleep.length >= Math.max(2, Math.ceil(skipped.length * 0.5)))
      insights.push({ id: 'sleep-miss', kind: 'watch', text: tr.t('insight.sleepMiss'), detail: tr.t('insight.sleepMiss.detail') })
  }

  // Sleep vs performance.
  const done = completedWorkouts(workouts)
  const withSleep = done.map((w) => ({ w, s: checkIns[dayKey(w.completedAt!)]?.sleepHours })).filter((x) => x.s !== undefined)
  if (withSleep.length >= 6) {
    const good = withSleep.filter((x) => x.s! >= 7).map((x) => x.w.summary?.totalVolumeKg ?? workoutVolume(x.w))
    const poor = withSleep.filter((x) => x.s! < 6.5).map((x) => x.w.summary?.totalVolumeKg ?? workoutVolume(x.w))
    if (good.length >= 3 && poor.length >= 2 && avg(good) > avg(poor) * 1.1)
      insights.push({ id: 'sleep-perf', kind: 'neutral', text: tr.t('insight.sleepPerf', { pct: round(((avg(good) - avg(poor)) / avg(poor)) * 100) }), detail: tr.t('insight.sleepPerf.detail') })
  }

  // Weight trend against goal.
  const trend = weightTrend(measurements)
  const primary = goals.find((g) => g.rank === 'primary')
  if (trend.change30 !== undefined && primary) {
    const wantsGain = primary.type === 'build_muscle' || primary.type === 'strength'
    const wantsLoss = primary.type === 'lose_fat'
    if (trend.stalled && (wantsGain || wantsLoss))
      insights.push({ id: 'stall', kind: 'watch', text: tr.t('insight.stall'), detail: tr.t(wantsGain ? 'insight.stall.detail.gain' : 'insight.stall.detail.loss') })
    else if (wantsGain && trend.change30 > 0)
      insights.push({ id: 'gain', kind: trend.weeklyRate! <= 0.5 ? 'positive' : 'watch', text: tr.t('insight.gain', { kg: tr.num(trend.change30), rate: tr.num(trend.weeklyRate ?? 0, 2) }), detail: tr.t(trend.weeklyRate! <= 0.5 ? 'insight.gain.detail.clean' : 'insight.gain.detail.fast') })
    else if (wantsLoss && trend.change30 < 0)
      insights.push({ id: 'loss', kind: 'positive', text: tr.t('insight.loss', { kg: tr.num(Math.abs(trend.change30)) }), detail: tr.t('insight.loss.detail') })
  }

  // Recent PR.
  const prs = personalRecords(workouts)
  const recentPR = prs.find((p) => diffDays(new Date(), p.date) <= 14)
  if (recentPR) insights.push({ id: 'pr', kind: 'positive', text: tr.t('insight.pr', { name: exerciseName(recentPR.exerciseId, recentPR.name, lang), kg: tr.num(recentPR.weightKg), reps: recentPR.reps }), detail: tr.t('insight.pr.detail', { kg: round(recentPR.e1rm) }) })

  // Time of day pattern.
  if (done.length >= 8) {
    const hours = done.map((w) => new Date(w.completedAt!).getHours())
    const morning = hours.filter((h) => h < 12).length
    if (morning / hours.length >= 0.7) insights.push({ id: 'morning', kind: 'neutral', text: tr.t('insight.morning'), detail: tr.t('insight.morning.detail') })
    else if (morning / hours.length <= 0.2) insights.push({ id: 'evening', kind: 'neutral', text: tr.t('insight.evening'), detail: tr.t('insight.evening.detail') })
  }

  return insights.slice(0, 5)
}

export function goalProgress(goal: Goal, measurements: Measurement[], workouts: Workout[], targetPerWeek: number, lang: Language = getLanguage()): { current?: number; pct: number; label: string } {
  const tr = translator(lang)
  if (!goal.metric || goal.targetValue === undefined) return { pct: 0, label: tr.t('goalProgress.noTarget') }
  const clampPct = (v: number) => Math.max(0, Math.min(1, v))
  switch (goal.metric) {
    case 'body_weight': {
      const trend = weightTrend(measurements)
      const current = trend.current
      if (current === undefined) return { pct: 0, label: tr.t('goalProgress.logWeight') }
      const start = goal.startValue ?? trend.start ?? current
      const total = goal.targetValue - start
      const pct = total === 0 ? 1 : clampPct((current - start) / total)
      return { current, pct, label: tr.t('goalProgress.weight', { current: tr.num(current), target: tr.num(goal.targetValue), unit: goal.targetUnit ?? 'kg' }) }
    }
    case 'bench_press':
    case 'squat':
    case 'deadlift': {
      const idMap = { bench_press: ['bench_press', 'db_bench_press'], squat: ['back_squat', 'front_squat', 'goblet_squat'], deadlift: ['deadlift', 'romanian_deadlift'] }
      const prs = personalRecords(workouts).filter((p) => idMap[goal.metric as keyof typeof idMap].includes(p.exerciseId))
      const current = prs[0] ? round(prs[0].e1rm) : undefined
      if (current === undefined) return { pct: 0, label: tr.t('goalProgress.noLifts') }
      const start = goal.startValue ?? current * 0.8
      const pct = clampPct((current - start) / (goal.targetValue - start || 1))
      return { current, pct, label: tr.t('goalProgress.lift', { current: tr.num(current), target: tr.num(goal.targetValue) }) }
    }
    case 'workouts_per_week': {
      const streak = consistencyStreak(workouts, targetPerWeek)
      const pct = clampPct(streak.thisWeek / goal.targetValue)
      return { current: streak.thisWeek, pct, label: tr.t('goalProgress.perWeek', { current: streak.thisWeek, target: goal.targetValue }) }
    }
    case 'steps_per_day': {
      const steps = measurements.filter((m) => m.type === 'steps').slice(-7).map((m) => m.value)
      const current = steps.length ? round(avg(steps)) : undefined
      if (current === undefined) return { pct: 0, label: tr.t('goalProgress.noSteps') }
      return { current, pct: clampPct(current / goal.targetValue), label: tr.t('goalProgress.steps', { current: tr.int(current), target: tr.int(goal.targetValue) }) }
    }
    default:
      return { pct: 0, label: goal.targetUnit ? `${tr.num(goal.targetValue)} ${goal.targetUnit}` : `${tr.num(goal.targetValue)}` }
  }
}

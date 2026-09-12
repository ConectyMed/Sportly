import { e1rm, getExercise } from '@/domain/exercises'
import type { DailyCheckIn, DayKey, Goal, Measurement, Workout } from '@/domain/types'
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

export function generateInsights(input: InsightInput): Insight[] {
  const { workouts, measurements, checkIns, goals, targetPerWeek } = input
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
        text: pct > 0 ? `You have increased your average training volume by ${pct}% this month.` : `Training volume is down ${Math.abs(pct)}% versus last month.`,
        detail: pct > 0 ? 'Progressive overload is working. Keep the jumps small.' : 'Not a problem if it was planned. If not, we can rebuild gradually.',
      })
  }

  const streak = consistencyStreak(workouts, targetPerWeek)
  if (streak.current >= 2)
    insights.push({
      id: 'streak',
      kind: 'positive',
      text: `You have trained consistently for ${streak.current} weeks.`,
      detail: streak.current >= 4 ? 'This is where results compound. Protect the habit.' : 'Two more weeks and it becomes a habit.',
    })
  else if (completedWorkouts(workouts).length > 0 && streak.thisWeek === 0 && new Date().getDay() >= 4)
    insights.push({ id: 'week', kind: 'watch', text: 'No sessions yet this week.', detail: 'Even a 25-minute session keeps the streak alive.' })

  // Sleep vs missed sessions.
  const skipped = workouts.filter((w) => w.status === 'skipped')
  if (skipped.length >= 2) {
    const shortSleep = skipped.filter((w) => {
      const c = checkIns[w.scheduledFor]
      return c?.sleepHours !== undefined && c.sleepHours < 6.5
    })
    if (shortSleep.length >= Math.max(2, Math.ceil(skipped.length * 0.5)))
      insights.push({ id: 'sleep-miss', kind: 'watch', text: 'You tend to miss workouts after poor sleep.', detail: 'On short-sleep days, I will suggest a lighter session instead of skipping.' })
  }

  // Sleep vs performance.
  const done = completedWorkouts(workouts)
  const withSleep = done.map((w) => ({ w, s: checkIns[dayKey(w.completedAt!)]?.sleepHours })).filter((x) => x.s !== undefined)
  if (withSleep.length >= 6) {
    const good = withSleep.filter((x) => x.s! >= 7).map((x) => x.w.summary?.totalVolumeKg ?? workoutVolume(x.w))
    const poor = withSleep.filter((x) => x.s! < 6.5).map((x) => x.w.summary?.totalVolumeKg ?? workoutVolume(x.w))
    if (good.length >= 3 && poor.length >= 2 && avg(good) > avg(poor) * 1.1)
      insights.push({ id: 'sleep-perf', kind: 'neutral', text: `You lift about ${round(((avg(good) - avg(poor)) / avg(poor)) * 100)}% more volume after 7+ hours of sleep.`, detail: 'Sleep is the cheapest performance enhancer you have.' })
  }

  // Weight trend against goal.
  const trend = weightTrend(measurements)
  const primary = goals.find((g) => g.rank === 'primary')
  if (trend.change30 !== undefined && primary) {
    const wantsGain = primary.type === 'build_muscle' || primary.type === 'strength'
    const wantsLoss = primary.type === 'lose_fat'
    if (trend.stalled && (wantsGain || wantsLoss))
      insights.push({ id: 'stall', kind: 'watch', text: 'Your weight has been flat for about three weeks.', detail: wantsGain ? 'Time to add roughly 150 kcal per day, mostly carbs around training.' : 'A small 150–200 kcal reduction or an extra 2,000 daily steps will restart it.' })
    else if (wantsGain && trend.change30 > 0)
      insights.push({ id: 'gain', kind: trend.weeklyRate! <= 0.5 ? 'positive' : 'watch', text: `Up ${trend.change30} kg this month (${trend.weeklyRate} kg/week).`, detail: trend.weeklyRate! <= 0.5 ? 'A clean rate for building muscle without much fat.' : 'A little fast. Trim 100 kcal so more of it is muscle.' })
    else if (wantsLoss && trend.change30 < 0)
      insights.push({ id: 'loss', kind: 'positive', text: `Down ${Math.abs(trend.change30)} kg this month.`, detail: 'Steady. Your strength is holding, which means the loss is mostly fat.' })
  }

  // Recent PR.
  const prs = personalRecords(workouts)
  const recentPR = prs.find((p) => diffDays(new Date(), p.date) <= 14)
  if (recentPR) insights.push({ id: 'pr', kind: 'positive', text: `New best on ${recentPR.name}: ${recentPR.weightKg} kg × ${recentPR.reps}.`, detail: `Estimated max ${round(recentPR.e1rm)} kg.` })

  // Time of day pattern.
  if (done.length >= 8) {
    const hours = done.map((w) => new Date(w.completedAt!).getHours())
    const morning = hours.filter((h) => h < 12).length
    if (morning / hours.length >= 0.7) insights.push({ id: 'morning', kind: 'neutral', text: 'You complete most sessions before noon.', detail: 'I will keep suggesting morning slots when your week gets busy.' })
    else if (morning / hours.length <= 0.2) insights.push({ id: 'evening', kind: 'neutral', text: 'You are an evening trainer.', detail: 'Pre-workout meals matter more for you. I plan them in.' })
  }

  return insights.slice(0, 5)
}

export function goalProgress(goal: Goal, measurements: Measurement[], workouts: Workout[], targetPerWeek: number): { current?: number; pct: number; label: string } {
  if (!goal.metric || goal.targetValue === undefined) return { pct: 0, label: 'No target set' }
  const clampPct = (v: number) => Math.max(0, Math.min(1, v))
  switch (goal.metric) {
    case 'body_weight': {
      const trend = weightTrend(measurements)
      const current = trend.current
      if (current === undefined) return { pct: 0, label: 'Log your weight to track this' }
      const start = goal.startValue ?? trend.start ?? current
      const total = goal.targetValue - start
      const pct = total === 0 ? 1 : clampPct((current - start) / total)
      return { current, pct, label: `${current} → ${goal.targetValue} ${goal.targetUnit ?? 'kg'}` }
    }
    case 'bench_press':
    case 'squat':
    case 'deadlift': {
      const idMap = { bench_press: ['bench_press', 'db_bench_press'], squat: ['back_squat', 'front_squat', 'goblet_squat'], deadlift: ['deadlift', 'romanian_deadlift'] }
      const prs = personalRecords(workouts).filter((p) => idMap[goal.metric as keyof typeof idMap].includes(p.exerciseId))
      const current = prs[0] ? round(prs[0].e1rm) : undefined
      if (current === undefined) return { pct: 0, label: 'No lifts logged yet' }
      const start = goal.startValue ?? current * 0.8
      const pct = clampPct((current - start) / (goal.targetValue - start || 1))
      return { current, pct, label: `${current} → ${goal.targetValue} kg (est. max)` }
    }
    case 'workouts_per_week': {
      const streak = consistencyStreak(workouts, targetPerWeek)
      const pct = clampPct(streak.thisWeek / goal.targetValue)
      return { current: streak.thisWeek, pct, label: `${streak.thisWeek} of ${goal.targetValue} this week` }
    }
    case 'steps_per_day': {
      const steps = measurements.filter((m) => m.type === 'steps').slice(-7).map((m) => m.value)
      const current = steps.length ? round(avg(steps)) : undefined
      if (current === undefined) return { pct: 0, label: 'No step data yet' }
      return { current, pct: clampPct(current / goal.targetValue), label: `${current.toLocaleString()} avg / ${goal.targetValue.toLocaleString()}` }
    }
    default:
      return { pct: 0, label: goal.targetUnit ? `${goal.targetValue} ${goal.targetUnit}` : `${goal.targetValue}` }
  }
}

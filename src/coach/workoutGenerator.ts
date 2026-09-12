import { EXERCISES, EXERCISE_MAP, getExercise } from '@/domain/exercises'
import { FOCUS_LABELS } from '@/domain/labels'
import type {
  EquipmentId,
  ExerciseDefinition,
  FitnessLevel,
  Goal,
  GoalType,
  MovementPattern,
  MuscleGroup,
  UserProfile,
  Workout,
  WorkoutConstraints,
  WorkoutExercise,
  WorkoutFocus,
  WorkoutSet,
} from '@/domain/types'
import { clamp, hashString, round, shuffle, uid } from '@/lib/utils'
import { todayKey } from '@/lib/dates'
import type { Readiness } from './readiness'

export interface GenerateWorkoutInput {
  user: UserProfile
  goals: Goal[]
  history: Workout[]
  readiness?: Readiness
  constraints?: WorkoutConstraints
  date?: string
  seed?: string
  source?: Workout['source']
  program?: { id: string; week: number; day: number; intensity: number; volume: number }
}

type Slot = { pattern?: MovementPattern; muscle?: MuscleGroup; compound?: boolean; optional?: boolean; timed?: boolean }

const FOCUS_SLOTS: Record<WorkoutFocus, Slot[]> = {
  upper: [
    { pattern: 'horizontal_push', compound: true },
    { pattern: 'horizontal_pull', compound: true },
    { pattern: 'vertical_push', compound: true },
    { pattern: 'vertical_pull', compound: true },
    { muscle: 'shoulders', compound: false },
    { muscle: 'triceps', compound: false, optional: true },
    { muscle: 'biceps', compound: false, optional: true },
  ],
  lower: [
    { pattern: 'squat', compound: true },
    { pattern: 'hinge', compound: true },
    { pattern: 'lunge', compound: true },
    { muscle: 'hamstrings', compound: false },
    { muscle: 'calves', compound: false, optional: true },
    { pattern: 'core', optional: true },
  ],
  push: [
    { pattern: 'horizontal_push', compound: true },
    { pattern: 'horizontal_push', compound: true },
    { pattern: 'vertical_push', compound: true },
    { muscle: 'shoulders', compound: false },
    { muscle: 'chest', compound: false, optional: true },
    { muscle: 'triceps', compound: false },
    { muscle: 'triceps', compound: false, optional: true },
  ],
  pull: [
    { pattern: 'vertical_pull', compound: true },
    { pattern: 'horizontal_pull', compound: true },
    { pattern: 'horizontal_pull', compound: true },
    { muscle: 'back', compound: false, optional: true },
    { muscle: 'shoulders', pattern: 'horizontal_pull', compound: false },
    { muscle: 'biceps', compound: false },
    { muscle: 'biceps', compound: false, optional: true },
  ],
  legs: [
    { pattern: 'squat', compound: true },
    { pattern: 'hinge', compound: true },
    { pattern: 'lunge', compound: true },
    { muscle: 'quads', compound: false, optional: true },
    { muscle: 'hamstrings', compound: false },
    { muscle: 'calves', compound: false, optional: true },
    { pattern: 'core', optional: true },
  ],
  full_body: [
    { pattern: 'squat', compound: true },
    { pattern: 'horizontal_push', compound: true },
    { pattern: 'horizontal_pull', compound: true },
    { pattern: 'hinge', compound: true },
    { pattern: 'vertical_push', compound: true, optional: true },
    { pattern: 'core', optional: true },
  ],
  conditioning: [
    { pattern: 'conditioning', timed: true },
    { pattern: 'hinge', muscle: 'glutes', compound: true },
    { pattern: 'conditioning' },
    { pattern: 'carry', optional: true },
    { pattern: 'core', optional: true },
  ],
  core_mobility: [
    { pattern: 'mobility' },
    { pattern: 'mobility' },
    { pattern: 'core' },
    { pattern: 'core' },
    { pattern: 'mobility', optional: true },
    { pattern: 'core', optional: true },
  ],
  recovery: [
    { pattern: 'mobility' },
    { pattern: 'mobility' },
    { pattern: 'conditioning', muscle: 'cardio', timed: true },
    { pattern: 'mobility', optional: true },
  ],
}

const LEVEL_NUM: Record<FitnessLevel, 1 | 2 | 3> = { beginner: 1, returning: 1, intermediate: 2, advanced: 3 }
const LEVEL_LOAD: Record<FitnessLevel, number> = { beginner: 0.65, returning: 0.75, intermediate: 1, advanced: 1.25 }

export function primaryGoal(goals: Goal[]): GoalType {
  return goals.find((g) => g.rank === 'primary')?.type ?? goals[0]?.type ?? 'general_fitness'
}

export function secondaryGoal(goals: Goal[]): GoalType | undefined {
  return goals.find((g) => g.rank === 'secondary')?.type
}

/** Which split does this person run given their frequency and goals. */
export function chooseSplit(daysPerWeek: number, goal: GoalType): 'full_body' | 'upper_lower' | 'push_pull_legs' | 'conditioning_hybrid' {
  if (goal === 'conditioning' || goal === 'endurance') return 'conditioning_hybrid'
  if (daysPerWeek <= 3) return 'full_body'
  if (daysPerWeek === 4) return 'upper_lower'
  return 'push_pull_legs'
}

export function splitRotation(split: ReturnType<typeof chooseSplit>, daysPerWeek: number): WorkoutFocus[] {
  switch (split) {
    case 'full_body':
      return Array.from({ length: Math.max(2, daysPerWeek) }, () => 'full_body' as WorkoutFocus)
    case 'upper_lower':
      return ['upper', 'lower', 'upper', 'lower']
    case 'push_pull_legs':
      return daysPerWeek >= 6 ? ['push', 'pull', 'legs', 'push', 'pull', 'legs'] : ['push', 'pull', 'legs', 'upper', 'lower']
    case 'conditioning_hybrid':
      return daysPerWeek <= 3 ? ['full_body', 'conditioning', 'full_body'] : ['upper', 'conditioning', 'lower', 'conditioning', 'full_body']
  }
}

/** Decide the next focus based on what was trained most recently. */
export function nextFocus(user: UserProfile, goals: Goal[], history: Workout[], secondary?: GoalType): WorkoutFocus {
  const goal = primaryGoal(goals)
  const split = chooseSplit(user.availability.daysPerWeek, goal)
  const rotation = splitRotation(split, user.availability.daysPerWeek)
  const recent = history
    .filter((w) => w.status === 'completed')
    .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1))
    .slice(0, 4)
    .map((w) => w.focus)
  const last = recent[0]
  if (!last) return rotation[0]
  const idx = rotation.lastIndexOf(last)
  let next = rotation[(idx + 1) % rotation.length]
  // Sprinkle conditioning for secondary conditioning goals.
  if (secondary === 'conditioning' && split !== 'conditioning_hybrid' && !recent.slice(0, 3).includes('conditioning') && recent.length >= 2) {
    next = 'conditioning'
  }
  return next
}

function available(ex: ExerciseDefinition, equipment: EquipmentId[]): boolean {
  if (ex.equipment.includes('bodyweight') && ex.equipment.length === 1) return true
  // Needs at least one of its listed equipment options (bench pairs are treated as optional).
  const core = ex.equipment.filter((e) => e !== 'bench')
  if (core.length === 0) return true
  return core.some((e) => equipment.includes(e) || e === 'bodyweight')
}

function matches(ex: ExerciseDefinition, slot: Slot, noCardio: boolean): boolean {
  if (noCardio && (ex.pattern === 'conditioning' || ex.primary === 'cardio')) return false
  if (slot.pattern && ex.pattern !== slot.pattern) return false
  if (slot.muscle && ex.primary !== slot.muscle && !(slot.muscle === 'shoulders' && ex.id === 'face_pull')) return false
  if (slot.compound !== undefined && ex.compound !== slot.compound && !slot.pattern) return false
  if (slot.timed && !ex.timed) return false
  return true
}

interface RepScheme {
  sets: number
  reps: number
  rest: number
  seconds?: number
}

function schemeFor(goal: GoalType, ex: ExerciseDefinition, level: FitnessLevel, intensity: WorkoutConstraints['intensity']): RepScheme {
  const lvl = LEVEL_NUM[level]
  let scheme: RepScheme
  if (ex.timed) {
    const seconds = ex.pattern === 'conditioning' ? (ex.id === 'incline_walk' ? 600 : 240) : ex.pattern === 'mobility' ? 60 : 40
    scheme = { sets: ex.pattern === 'conditioning' ? 1 : 3, reps: 0, seconds, rest: ex.pattern === 'mobility' ? 20 : 60 }
    if (ex.id === 'bike_intervals' || ex.id === 'rower_intervals' || ex.id === 'sprint') scheme = { sets: 6, reps: 0, seconds: 30, rest: 60 }
  } else if (ex.pattern === 'conditioning') {
    scheme = { sets: 4, reps: 12, rest: 45 }
  } else if (ex.pattern === 'core' || ex.pattern === 'mobility') {
    scheme = { sets: 3, reps: 12, rest: 45 }
  } else if (goal === 'strength') {
    scheme = ex.compound ? { sets: lvl >= 2 ? 4 : 3, reps: 5, rest: 150 } : { sets: 3, reps: 8, rest: 90 }
  } else if (goal === 'build_muscle' || goal === 'recomposition') {
    scheme = ex.compound ? { sets: lvl >= 2 ? 4 : 3, reps: 8, rest: 120 } : { sets: 3, reps: 12, rest: 75 }
  } else if (goal === 'lose_fat' || goal === 'conditioning' || goal === 'endurance') {
    scheme = ex.compound ? { sets: 3, reps: 10, rest: 75 } : { sets: 3, reps: 15, rest: 45 }
  } else {
    scheme = ex.compound ? { sets: 3, reps: 8, rest: 90 } : { sets: 3, reps: 12, rest: 60 }
  }
  if (intensity === 'light') scheme = { ...scheme, sets: Math.max(2, scheme.sets - 1), reps: scheme.reps ? scheme.reps + 2 : 0 }
  if (intensity === 'hard' && ex.compound) scheme = { ...scheme, sets: scheme.sets + 1 }
  return scheme
}

function roundLoad(kg: number, ex: ExerciseDefinition): number {
  if (kg <= 0) return 0
  const isDb = ex.equipment.includes('dumbbell') || ex.equipment.includes('kettlebell')
  const step = isDb ? 2 : 2.5
  return Math.max(step, round(Math.round(kg / step) * step, 1))
}

function lastPerformance(history: Workout[], exerciseId: string): { weight: number; reps: number; allDone: boolean } | undefined {
  const sessions = history
    .filter((w) => w.status === 'completed')
    .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1))
  for (const w of sessions) {
    const e = w.exercises.find((x) => x.exerciseId === exerciseId)
    if (!e) continue
    const done = e.sets.filter((s) => s.completed && (s.actualWeightKg ?? s.targetWeightKg) !== undefined)
    if (!done.length) continue
    const weight = Math.max(...done.map((s) => s.actualWeightKg ?? s.targetWeightKg ?? 0))
    const reps = Math.max(...done.map((s) => s.actualReps ?? s.targetReps))
    const allDone = e.sets.every((s) => s.completed && (s.actualReps ?? 0) >= s.targetReps)
    return { weight, reps, allDone }
  }
  return undefined
}

function suggestLoad(ex: ExerciseDefinition, user: UserProfile, history: Workout[], scheme: RepScheme, intensityMult: number): number | undefined {
  if (ex.timed || ex.loadRatio === undefined || ex.loadRatio === 0) return undefined
  const last = lastPerformance(history, ex.id)
  if (last) {
    let w = last.weight
    if (last.allDone) w *= 1.025
    // Adjust for rep-range differences relative to last time.
    if (scheme.reps && last.reps && Math.abs(scheme.reps - last.reps) >= 3) w *= scheme.reps < last.reps ? 1.08 : 0.92
    return roundLoad(w * intensityMult, ex)
  }
  const base = ex.loadRatio * user.weightKg * LEVEL_LOAD[user.level]
  const repAdj = scheme.reps <= 6 ? 1.1 : scheme.reps >= 12 ? 0.8 : 1
  return roundLoad(base * repAdj * intensityMult, ex)
}

function makeSets(scheme: RepScheme, load: number | undefined): WorkoutSet[] {
  return Array.from({ length: scheme.sets }, () => ({
    id: uid('set'),
    targetReps: scheme.reps,
    targetWeightKg: load,
    targetSeconds: scheme.seconds,
    completed: false,
  }))
}

function estimateMinutes(exercises: WorkoutExercise[]): number {
  let sec = 300 // warm-up
  for (const e of exercises) {
    const def = EXERCISE_MAP[e.exerciseId]
    for (const s of e.sets) {
      sec += (s.targetSeconds ?? (def?.unilateral ? 55 : 40)) + e.restSeconds
    }
    sec += 45 // transition
  }
  return Math.max(10, Math.round(sec / 60 / 5) * 5)
}

function titleFor(focus: WorkoutFocus, constraints?: WorkoutConstraints, seed = 0): string {
  const base = FOCUS_LABELS[focus]
  if (constraints?.intensity === 'light') return `${base} · Light`
  if (constraints?.minutes && constraints.minutes <= 30) return `${base} Express`
  if (focus === 'full_body') return ['Full Body A', 'Full Body B'][seed % 2]
  return base
}

export function generateWorkout(input: GenerateWorkoutInput): Workout {
  const { user, goals, history } = input
  const constraints: WorkoutConstraints = { ...(input.constraints ?? {}) }
  const goal = primaryGoal(goals)
  const secondary = secondaryGoal(goals)
  const seedStr = input.seed ?? `${input.date ?? todayKey()}-${history.length}`
  const seed = hashString(seedStr)
  const rnd = seed / 0xffffffff

  // Readiness shapes intensity unless explicitly set.
  if (!constraints.intensity && input.readiness) {
    if (input.readiness.recommendation === 'lighter') constraints.intensity = 'light'
    if (input.readiness.recommendation === 'push') constraints.intensity = 'hard'
  }
  let focus = constraints.focus ?? nextFocus(user, goals, history, secondary)
  if (input.readiness?.recommendation === 'rest' && !constraints.focus) focus = 'core_mobility'
  if (constraints.noCardio && (focus === 'conditioning' || focus === 'recovery')) focus = 'full_body'

  const equipment = constraints.equipment?.length ? constraints.equipment : user.equipment.length ? user.equipment : ['bodyweight']
  const minutes = constraints.minutes ?? user.availability.sessionMinutes
  const exclude = new Set(constraints.excludeExerciseIds ?? [])
  const lvl = LEVEL_NUM[user.level]
  const intensityMult = (input.program?.intensity ?? 1) * (constraints.intensity === 'light' ? 0.9 : 1)

  // Familiar compounds from history keep progression continuous.
  const familiar = new Map<string, number>()
  for (const w of history.filter((h) => h.status === 'completed').slice(-12)) {
    for (const e of w.exercises) familiar.set(e.exerciseId, (familiar.get(e.exerciseId) ?? 0) + 1)
  }

  const slots = FOCUS_SLOTS[focus]
  const perExerciseMin = focus === 'core_mobility' || focus === 'recovery' ? 4 : goal === 'strength' ? 9 : 7
  const maxExercises = clamp(Math.floor((minutes - 5) / perExerciseMin), 3, 8)

  const chosen: ExerciseDefinition[] = []
  const used = new Set<string>()
  const pool = shuffle(EXERCISES, rnd)
  for (const slot of slots) {
    if (chosen.length >= maxExercises) break
    if (slot.optional && chosen.length >= maxExercises - 1 && minutes < 40) continue
    const candidates = pool
      .filter((ex) => !used.has(ex.id) && !exclude.has(ex.id))
      .filter((ex) => available(ex, equipment as EquipmentId[]))
      .filter((ex) => ex.level <= Math.min(3, lvl + (goal === 'strength' ? 1 : 0)))
      .filter((ex) => matches(ex, slot, Boolean(constraints.noCardio)))
      // Avoid two big barbell hinges in one session.
      .filter((ex) => !(ex.id === 'deadlift' && chosen.some((c) => c.pattern === 'squat' && c.equipment.includes('barbell')) && goal !== 'strength'))
    if (!candidates.length) continue
    const scored = candidates
      .map((ex) => {
        let score = 0
        if (slot.compound && ex.compound) score += 2
        if (familiar.has(ex.id)) score += slot.compound ? 3 : 0.5
        if (ex.level === lvl) score += 1
        if (equipment.length > 2 && ex.equipment.includes('bodyweight') && ex.equipment.length === 1 && slot.compound) score -= 1.5
        if (goal === 'build_muscle' && (ex.equipment.includes('machine') || ex.equipment.includes('cable'))) score += 0.3
        score += ((hashString(ex.id + seedStr) % 100) / 100) * 1.2 // deterministic variety
        return { ex, score }
      })
      .sort((a, b) => b.score - a.score)
    const pickIdx = 0
    const ex = scored[pickIdx].ex
    chosen.push(ex)
    used.add(ex.id)
  }

  let exercises: WorkoutExercise[] = chosen.map((ex, i) => {
    const scheme = schemeFor(goal, ex, user.level, constraints.intensity)
    if (input.program) scheme.sets = Math.max(2, Math.round(scheme.sets * input.program.volume))
    const load = suggestLoad(ex, user, history, scheme, intensityMult)
    const isSuperset = focus !== 'conditioning' && !ex.compound && i >= chosen.length - 2 && chosen.length >= 6 && minutes <= 50
    return {
      id: uid('wex'),
      exerciseId: ex.id,
      name: ex.name,
      sets: makeSets(scheme, load),
      restSeconds: isSuperset ? Math.round(scheme.rest * 0.6) : scheme.rest,
      note: ex.cue,
      group: isSuperset ? 'A' : undefined,
    }
  })

  // Trim to the time budget.
  let est = estimateMinutes(exercises)
  while (est > minutes + 5 && exercises.length > 3) {
    exercises = exercises.slice(0, -1)
    est = estimateMinutes(exercises)
  }
  while (est > minutes + 5) {
    exercises = exercises.map((e) => ({ ...e, restSeconds: Math.max(30, Math.round(e.restSeconds * 0.8)), sets: e.sets.length > 2 ? e.sets.slice(0, -1) : e.sets }))
    const next = estimateMinutes(exercises)
    if (next >= est) break
    est = next
  }

  const readinessNote =
    constraints.intensity === 'light'
      ? 'Kept this one lighter so you recover well.'
      : constraints.intensity === 'hard'
        ? 'You are recovering well, so there is a little extra in the compounds.'
        : undefined

  return {
    id: uid('wk'),
    title: titleFor(focus, constraints, seed),
    focus,
    estimatedMinutes: est,
    exercises,
    scheduledFor: input.date ?? todayKey(),
    status: 'planned',
    source: input.source ?? (input.program ? 'program' : 'coach'),
    programId: input.program?.id,
    programWeek: input.program?.week,
    programDay: input.program?.day,
    constraints: Object.keys(constraints).length ? constraints : undefined,
    coachNote: readinessNote,
    createdAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Modifications
// ---------------------------------------------------------------------------

export function shortenWorkout(workout: Workout, targetMinutes: number): Workout {
  let exercises = workout.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s })) }))
  let est = estimateMinutes(exercises)
  // Drop accessories first (from the end), then reduce sets.
  while (est > targetMinutes && exercises.length > 3) {
    exercises = exercises.slice(0, -1)
    est = estimateMinutes(exercises)
  }
  let guard = 0
  while (est > targetMinutes && guard++ < 6) {
    exercises = exercises.map((e) => ({
      ...e,
      restSeconds: Math.max(30, Math.round(e.restSeconds * 0.8)),
      sets: e.sets.length > 2 ? e.sets.slice(0, -1) : e.sets,
    }))
    est = estimateMinutes(exercises)
  }
  return {
    ...workout,
    exercises,
    estimatedMinutes: est,
    title: workout.title.includes('Express') ? workout.title : `${workout.title.replace(/ · Light/, '')} Express`,
    constraints: { ...(workout.constraints ?? {}), minutes: targetMinutes },
    history: [...(workout.history ?? []), `Shortened to ${targetMinutes} min`],
  }
}

export function findSubstitute(exerciseId: string, equipment: EquipmentId[], exclude: string[] = [], level: FitnessLevel = 'intermediate'): ExerciseDefinition | undefined {
  const original = getExercise(exerciseId)
  const lvl = LEVEL_NUM[level]
  const candidates = EXERCISES.filter(
    (ex) =>
      ex.id !== exerciseId &&
      !exclude.includes(ex.id) &&
      available(ex, equipment) &&
      ex.level <= lvl + 1 &&
      (ex.pattern === original.pattern || ex.primary === original.primary),
  ).sort((a, b) => {
    const sa = (a.pattern === original.pattern ? 2 : 0) + (a.primary === original.primary ? 2 : 0) + (a.compound === original.compound ? 1 : 0)
    const sb = (b.pattern === original.pattern ? 2 : 0) + (b.primary === original.primary ? 2 : 0) + (b.compound === original.compound ? 1 : 0)
    return sb - sa
  })
  return candidates[0]
}

export function replaceExercise(workout: Workout, exerciseId: string, user: UserProfile, history: Workout[], equipmentOverride?: EquipmentId[]): { workout: Workout; replacedWith?: ExerciseDefinition; original: ExerciseDefinition } {
  const original = getExercise(exerciseId)
  const equipment = equipmentOverride ?? workout.constraints?.equipment ?? (user.equipment.length ? user.equipment : ['bodyweight'])
  const sub = findSubstitute(exerciseId, equipment, workout.exercises.map((e) => e.exerciseId), user.level)
  if (!sub) return { workout, original }
  const exercises = workout.exercises.map((e) => {
    if (e.exerciseId !== exerciseId) return e
    const scheme: RepScheme = { sets: e.sets.length, reps: e.sets[0]?.targetReps ?? 10, rest: e.restSeconds, seconds: sub.timed ? (e.sets[0]?.targetSeconds ?? 40) : undefined }
    const load = suggestLoad(sub, user, history, scheme, 1)
    return { ...e, exerciseId: sub.id, name: sub.name, note: sub.cue, sets: makeSets(scheme, load) }
  })
  return {
    workout: {
      ...workout,
      exercises,
      constraints: { ...(workout.constraints ?? {}), excludeExerciseIds: [...(workout.constraints?.excludeExerciseIds ?? []), exerciseId] },
      history: [...(workout.history ?? []), `Replaced ${original.name} with ${sub.name}`],
    },
    replacedWith: sub,
    original,
  }
}

export function restrictEquipment(workout: Workout, equipment: EquipmentId[], user: UserProfile, history: Workout[]): Workout {
  let out = { ...workout, exercises: [...workout.exercises] }
  for (const e of workout.exercises) {
    const def = getExercise(e.exerciseId)
    if (!available(def, equipment)) {
      const r = replaceExercise(out, e.exerciseId, user, history, equipment)
      out = r.workout
    }
  }
  return {
    ...out,
    constraints: { ...(out.constraints ?? {}), equipment },
    history: [...(workout.history ?? []), `Limited to ${equipment.join(', ')}`],
  }
}

export function removeCardio(workout: Workout): Workout {
  const exercises = workout.exercises.filter((e) => {
    const def = getExercise(e.exerciseId)
    return def.pattern !== 'conditioning' && def.primary !== 'cardio'
  })
  return {
    ...workout,
    exercises,
    estimatedMinutes: estimateMinutes(exercises),
    constraints: { ...(workout.constraints ?? {}), noCardio: true },
    history: [...(workout.history ?? []), 'Removed cardio'],
  }
}

export function scaleIntensity(workout: Workout, mode: 'lighter' | 'harder'): Workout {
  const mult = mode === 'lighter' ? 0.9 : 1.05
  const exercises = workout.exercises.map((e) => {
    const def = getExercise(e.exerciseId)
    let sets = e.sets.map((s) => ({ ...s, targetWeightKg: s.targetWeightKg ? roundLoad(s.targetWeightKg * mult, def) : s.targetWeightKg }))
    if (mode === 'lighter' && sets.length > 2) sets = sets.slice(0, -1)
    if (mode === 'harder' && def.compound && sets.length < 5) sets = [...sets, { ...sets[sets.length - 1], id: uid('set'), completed: false }]
    return { ...e, sets }
  })
  return {
    ...workout,
    exercises,
    estimatedMinutes: estimateMinutes(exercises),
    title: mode === 'lighter' ? `${workout.title.replace(/ · Light/, '')} · Light` : workout.title.replace(/ · Light/, ''),
    constraints: { ...(workout.constraints ?? {}), intensity: mode === 'lighter' ? 'light' : 'hard' },
    history: [...(workout.history ?? []), mode === 'lighter' ? 'Made lighter' : 'Made harder'],
  }
}

export function workoutVolume(workout: Workout): number {
  let vol = 0
  for (const e of workout.exercises) for (const s of e.sets) if (s.completed) vol += (s.actualWeightKg ?? s.targetWeightKg ?? 0) * (s.actualReps ?? s.targetReps ?? 0)
  return round(vol)
}

export function plannedVolume(workout: Workout): number {
  let vol = 0
  for (const e of workout.exercises) for (const s of e.sets) vol += (s.targetWeightKg ?? 0) * (s.targetReps ?? 0)
  return round(vol)
}

export { estimateMinutes }

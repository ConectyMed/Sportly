import { hasKey, t, type MessageKey } from '@/i18n'
import { getLanguage } from '@/i18n/runtime'
import type { Language } from '@/i18n/types'
import type { DietPreference, DietaryFlag, EquipmentId, FitnessLevel, GoalType, Meal, MemoryCategory, MuscleGroup, NutritionPlan, Program, ProgramWeek, Workout, WorkoutFocus } from './types'

/**
 * Presentation of domain identifiers. Everything here derives a label from a
 * stable identifier (goal type, exercise id, food id, focus…) in the selected
 * language. The identifiers are what the domain stores; labels are never data.
 */

export const GOAL_TYPES: GoalType[] = ['build_muscle', 'lose_fat', 'recomposition', 'strength', 'conditioning', 'consistency', 'general_fitness', 'mobility', 'endurance']
export const LEVELS: FitnessLevel[] = ['beginner', 'intermediate', 'advanced', 'returning']
export const DIETS: DietPreference[] = ['omnivore', 'vegetarian', 'vegan', 'pescatarian']
export const DIETARY_FLAGS: DietaryFlag[] = ['gluten_free', 'lactose_free', 'halal', 'kosher', 'no_nuts', 'low_carb']
export const MEAL_SLOTS: Meal['slot'][] = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout']

type L = Language | undefined
const lang = (l: L) => l ?? getLanguage()

export const goalLabel = (type: GoalType, l?: L) => t(`goal.${type}`, undefined, lang(l))
export const goalDescription = (type: GoalType, l?: L) => t(`goalDesc.${type}`, undefined, lang(l))
export const levelLabel = (level: FitnessLevel, l?: L) => t(`level.${level}`, undefined, lang(l))
export const levelDescription = (level: FitnessLevel, l?: L) => t(`levelDesc.${level}`, undefined, lang(l))
export const dietLabel = (diet: DietPreference, l?: L) => t(`diet.${diet}`, undefined, lang(l))
export const dietaryFlagLabel = (flag: DietaryFlag, l?: L) => t(`dietFlag.${flag}`, undefined, lang(l))
export const focusLabel = (focus: WorkoutFocus, l?: L) => t(`focus.${focus}`, undefined, lang(l))
export const mealSlotLabel = (slot: Meal['slot'], l?: L) => t(`slot.${slot}`, undefined, lang(l))
/** Lower-case, in-sentence form: "add it to lunch" · "ajoute-le au déjeuner". */
export const mealSlotIn = (slot: Meal['slot'], l?: L) => t(`slotIn.${slot}`, undefined, lang(l))
export const equipmentLabel = (id: EquipmentId, l?: L) => t(`equipment.${id}`, undefined, lang(l))
export const muscleLabel = (m: MuscleGroup, l?: L) => t(`muscle.${m}`, undefined, lang(l))
export const memoryCategoryLabel = (c: MemoryCategory, l?: L) => t(`memoryCategory.${c}`, undefined, lang(l))
export const phaseLabel = (p: ProgramWeek['phase'], l?: L) => t(`phase.${p}`, undefined, lang(l))
export const phaseNote = (p: ProgramWeek['phase'], l?: L) => t(`phaseNote.${p}`, undefined, lang(l))
export const splitLabel = (s: Program['split'], l?: L) => t(`split.${s}`, undefined, lang(l))
export const programStatusLabel = (s: Program['status'], l?: L) => t(`programStatus.${s}`, undefined, lang(l))
export const goalMetricLabel = (m: NonNullable<import('./types').Goal['metric']>, l?: L) => (m === 'custom' ? '' : t(`goalMetric.${m}`, undefined, lang(l)))

/** Exercise display name from its id; the stored English name is the fallback for ids the dictionary does not know. */
export function exerciseName(id: string, fallback = id, l?: L): string {
  const key = `exercise.${id}`
  return hasKey(key) ? t(key as MessageKey, undefined, lang(l)) : fallback
}

export function exerciseCue(id: string, fallback = '', l?: L): string {
  const key = `cue.${id}`
  return hasKey(key) ? t(key as MessageKey, undefined, lang(l)) : fallback
}

/** Food display name from its id; free-text foods (vision results) keep their own name. */
export function foodName(foodId: string | undefined, fallback: string, l?: L): string {
  const key = `food.${foodId ?? ''}`
  return foodId && hasKey(key) ? t(key as MessageKey, undefined, lang(l)) : fallback
}

/* ------------------------------------------------------------------ Workouts */

/**
 * Workout titles are structured: `focus:<focus>[:A|B][:express][:light][:logged]`
 * or `recovery_flow`. The stored `title` is the English canonical rendering
 * (kept for older data and as a stable label); every screen shows workoutTitle().
 */
export interface WorkoutTitleParts {
  focus?: WorkoutFocus
  variant?: 'A' | 'B'
  express?: boolean
  light?: boolean
  logged?: boolean
  recoveryFlow?: boolean
}

const FOCUS_IDS: WorkoutFocus[] = ['upper', 'lower', 'push', 'pull', 'legs', 'full_body', 'conditioning', 'core_mobility', 'recovery']

export function titleKeyOf(parts: WorkoutTitleParts): string {
  if (parts.recoveryFlow) return 'recovery_flow'
  const segs = [`focus:${parts.focus ?? 'full_body'}`]
  if (parts.variant) segs.push(parts.variant)
  if (parts.express) segs.push('express')
  if (parts.light) segs.push('light')
  if (parts.logged) segs.push('logged')
  return segs.join(':')
}

export function parseTitleKey(key: string | undefined): WorkoutTitleParts | undefined {
  if (!key) return undefined
  if (key === 'recovery_flow') return { recoveryFlow: true }
  const segs = key.split(':')
  if (segs[0] !== 'focus') return undefined
  const focus = segs[1] as WorkoutFocus
  if (!FOCUS_IDS.includes(focus)) return undefined
  const rest = segs.slice(2)
  return { focus, variant: rest.includes('A') ? 'A' : rest.includes('B') ? 'B' : undefined, express: rest.includes('express'), light: rest.includes('light'), logged: rest.includes('logged') }
}

/** Recover the structure of an English canonical title written before titles were structured. */
export function titlePartsFromLegacy(title: string): WorkoutTitleParts | undefined {
  if (title === 'Recovery Flow') return { recoveryFlow: true }
  const light = / · Light$/.test(title)
  const logged = / · logged$/.test(title)
  let base = title.replace(/ · Light$/, '').replace(/ · logged$/, '')
  const express = / Express$/.test(base)
  base = base.replace(/ Express$/, '')
  const variant = / A$/.test(base) ? 'A' : / B$/.test(base) ? 'B' : undefined
  base = base.replace(/ [AB]$/, '')
  const focus = FOCUS_IDS.find((f) => t(`focus.${f}`, undefined, 'en') === base)
  if (!focus) return undefined
  return { focus, variant, express, light, logged }
}

export function renderWorkoutTitle(parts: WorkoutTitleParts, l?: L): string {
  const L = lang(l)
  if (parts.recoveryFlow) return t('workoutTitle.recoveryFlow', undefined, L)
  let base = t(`focus.${parts.focus ?? 'full_body'}`, undefined, L)
  if (parts.variant === 'A') base = t('workoutTitle.variantA', { base }, L)
  if (parts.variant === 'B') base = t('workoutTitle.variantB', { base }, L)
  if (parts.express) base = t('workoutTitle.express', { base }, L)
  if (parts.light) base = t('workoutTitle.light', { base }, L)
  if (parts.logged) base = t('workoutTitle.logged', { base }, L)
  return base
}

/** The title to show for a workout, in the selected language. Custom titles are shown as they are. */
export function workoutTitle(w: Pick<Workout, 'title' | 'titleKey'>, l?: L): string {
  const parts = parseTitleKey(w.titleKey) ?? titlePartsFromLegacy(w.title)
  return parts ? renderWorkoutTitle(parts, l) : w.title
}

/** The coach's note on a workout: from its structured key when it has one, otherwise the stored text. */
export function workoutCoachNote(w: Pick<Workout, 'coachNote' | 'noteKey'>, l?: L): string | undefined {
  const key = w.noteKey
  if (key === 'light' || key === 'hard') return t(`workoutNote.${key}`, undefined, lang(l))
  if (key && (['foundation', 'build', 'intensify', 'peak', 'deload'] as string[]).includes(key)) return phaseNote(key as ProgramWeek['phase'], l)
  return w.coachNote
}

/* ------------------------------------------------------------------ Programs */

const PROGRAM_BASE: Record<GoalType, string> = {
  build_muscle: 'Muscle Builder',
  lose_fat: 'Lean & Strong',
  recomposition: 'Recomp Protocol',
  conditioning: 'Engine Builder',
  strength: 'Strength Foundation',
  consistency: 'Show Up',
  general_fitness: 'Everyday Athlete',
  mobility: 'Move Well',
  endurance: 'Long Road',
}

/** English canonical program name (stored). */
export function programCanonicalName(goal: GoalType, weeks: number): string {
  return `${weeks}-Week ${PROGRAM_BASE[goal]}`
}

export function programUploadedName(weeks: number): string {
  return `${weeks}-Week Uploaded Plan`
}

/** Localised program name; a custom name is shown as it is. */
export function programDisplayName(p: Pick<Program, 'name' | 'goalType' | 'weeks'>, l?: L): string {
  const L = lang(l)
  const m = p.name.match(/^(\d+)-Week (.+)$/)
  if (!m) return p.name
  const weeks = Number(m[1])
  if (m[2] === 'Uploaded Plan') return t('programName.uploaded', { weeks }, L)
  const goal = (Object.keys(PROGRAM_BASE) as GoalType[]).find((g) => PROGRAM_BASE[g] === m[2])
  if (!goal) return p.name
  return t('programName.weeks', { weeks, name: t(`programName.${goal}`, undefined, L) }, L)
}

export function programDescription(p: Pick<Program, 'goalType' | 'weeks' | 'daysPerWeek' | 'split'>, l?: L): string {
  const L = lang(l)
  return t('programDesc', { goal: goalLabel(p.goalType, L), weeks: p.weeks, days: p.daysPerWeek, split: splitLabel(p.split, L), tail: t(p.weeks >= 8 ? 'programDesc.deload' : 'programDesc.short', undefined, L) }, L)
}

/* ------------------------------------------------------------------ Nutrition */

export function mealTemplateName(templateId: string | undefined, fallback: string, l?: L): string {
  const key = `mealTpl.${templateId ?? ''}.name`
  if (templateId === 'restaurant') return t('nutrition.restaurant.name', undefined, lang(l))
  return templateId && hasKey(key) ? t(key as MessageKey, undefined, lang(l)) : fallback
}

export function mealTemplateItems(templateId: string | undefined, fallback: string[], l?: L): string[] {
  const key = `mealTpl.${templateId ?? ''}.items`
  if (templateId === 'restaurant') return t('nutrition.restaurant.items', undefined, lang(l)).split(' | ')
  return templateId && hasKey(key) ? t(key as MessageKey, undefined, lang(l)).split(' | ') : fallback
}

export function mealNote(meal: Pick<Meal, 'note' | 'templateId'>, l?: L): string | undefined {
  if (meal.templateId === 'restaurant') return t('nutrition.restaurant.note', undefined, lang(l))
  return meal.note
}

export function nutritionRationale(plan: Pick<NutritionPlan, 'rationale' | 'rationaleKey'>, l?: L): string {
  const key = `nutrition.rationale.${plan.rationaleKey ?? ''}`
  return plan.rationaleKey && hasKey(key) ? t(key as MessageKey, undefined, lang(l)) : plan.rationale
}

export function nutritionAdjustments(plan: Pick<NutritionPlan, 'adjustments' | 'adjustmentKeys'>, l?: L): string[] {
  if (plan.adjustmentKeys?.length) return plan.adjustmentKeys.map((k) => (hasKey(`nutrition.adj.${k}`) ? t(`nutrition.adj.${k}` as MessageKey, undefined, lang(l)) : k))
  return plan.adjustments ?? []
}

export const goalNutritionSummary = (goal: GoalType, l?: L) => t(`nutrition.goalSummary.${goal}`, undefined, lang(l))

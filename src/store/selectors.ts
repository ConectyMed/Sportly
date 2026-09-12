import { computeTargets } from '@/coach/nutritionGenerator'
import type { LoggedMeal, NutritionPlan } from '@/domain/types'
import { todayKey } from '@/lib/dates'
import { round } from '@/lib/utils'
import type { AppState } from './useStore'

/**
 * Derived nutrition for a day. Totals are never stored: they are always computed
 * from the logged meals, so the Coach, Nutrition and Home can never disagree.
 */
export interface DailyNutrition {
  date: string
  targets: { calories: number; proteinG: number; carbsG: number; fatG: number }
  consumed: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number }
  remaining: { calories: number; proteinG: number; carbsG: number; fatG: number }
  meals: LoggedMeal[]
  drafts: LoggedMeal[]
  plan?: NutritionPlan
  isTrainingDay: boolean
}

type NutritionState = Pick<AppState, 'meals' | 'nutritionPlans' | 'workouts' | 'user' | 'goals'>

export function selectMealsForDate(state: Pick<AppState, 'meals'>, date = todayKey()): LoggedMeal[] {
  return Object.values(state.meals)
    .filter((m) => m.date === date && m.status === 'logged')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function selectPlanForDate(state: Pick<AppState, 'nutritionPlans'>, date = todayKey()): NutritionPlan | undefined {
  return Object.values(state.nutritionPlans)
    .filter((p) => p.date === date)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
}

export function selectDailyNutrition(state: NutritionState, date = todayKey()): DailyNutrition {
  const meals = selectMealsForDate(state, date)
  const drafts = Object.values(state.meals).filter((m) => m.date === date && m.status === 'draft')
  const plan = selectPlanForDate(state, date)
  const isTrainingDay = Object.values(state.workouts).some((w) => w.scheduledFor === date && w.status !== 'skipped')
  const targets = plan
    ? { calories: plan.calories, proteinG: plan.proteinG, carbsG: plan.carbsG, fatG: plan.fatG }
    : state.user
      ? (() => {
          const t = computeTargets(state.user, state.goals, isTrainingDay)
          return { calories: t.calories, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG }
        })()
      : { calories: 2200, proteinG: 130, carbsG: 250, fatG: 70 }
  const consumed = {
    calories: round(meals.reduce((a, m) => a + m.calories, 0)),
    proteinG: round(meals.reduce((a, m) => a + m.proteinG, 0)),
    carbsG: round(meals.reduce((a, m) => a + m.carbsG, 0)),
    fatG: round(meals.reduce((a, m) => a + m.fatG, 0)),
    fiberG: round(meals.reduce((a, m) => a + (m.fiberG ?? 0), 0)),
  }
  return {
    date,
    targets,
    consumed,
    remaining: {
      calories: targets.calories - consumed.calories,
      proteinG: targets.proteinG - consumed.proteinG,
      carbsG: targets.carbsG - consumed.carbsG,
      fatG: targets.fatG - consumed.fatG,
    },
    meals,
    drafts,
    plan,
    isTrainingDay,
  }
}

/** Slots already covered today, so “what should I eat?” focuses on what is left. */
export function selectRemainingSlots(daily: DailyNutrition): Array<NutritionPlan['meals'][number]['slot']> {
  const eaten = new Set(daily.meals.map((m) => m.slot))
  const order: Array<NutritionPlan['meals'][number]['slot']> = ['breakfast', 'pre_workout', 'lunch', 'post_workout', 'snack', 'dinner']
  return order.filter((s) => !eaten.has(s))
}

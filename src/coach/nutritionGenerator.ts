import { goalNutritionSummary, mealNote, mealTemplateItems, mealTemplateName, nutritionAdjustments, nutritionRationale } from '@/domain/labels'
import type { DietPreference, DietaryFlag, Goal, Meal, NutritionPlan, UserProfile } from '@/domain/types'
import { foldText } from '@/lib/text'
import { clamp, hashString, round, uid } from '@/lib/utils'
import { todayKey } from '@/lib/dates'
import { primaryGoal } from './workoutGenerator'

export interface NutritionTargets {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  tdee: number
  /** English canonical explanation (stored); `rationaleKey` renders it in the user's language. */
  rationale: string
  rationaleKey: string
}

const ACTIVITY: Record<UserProfile['lifestyle'], number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 }

export function computeTargets(user: UserProfile, goals: Goal[], isTrainingDay: boolean): NutritionTargets {
  const goal = primaryGoal(goals)
  const bmr =
    10 * user.weightKg +
    6.25 * user.heightCm -
    5 * user.age +
    (user.sex === 'male' ? 5 : user.sex === 'female' ? -161 : -78)
  const tdee = bmr * ACTIVITY[user.lifestyle] + (isTrainingDay ? 180 : 0)
  let calories = tdee
  let proteinPerKg = 1.8
  let rationaleKey = 'default'
  switch (goal) {
    case 'build_muscle':
      calories = tdee + (isTrainingDay ? 300 : 150)
      proteinPerKg = 2.0
      rationaleKey = isTrainingDay ? 'build_muscle.training' : 'build_muscle.rest'
      break
    case 'lose_fat':
      calories = tdee - (isTrainingDay ? 400 : 500)
      proteinPerKg = 2.2
      rationaleKey = 'lose_fat'
      break
    case 'recomposition':
      calories = tdee + (isTrainingDay ? 150 : -250)
      proteinPerKg = 2.1
      rationaleKey = isTrainingDay ? 'recomposition.training' : 'recomposition.rest'
      break
    case 'strength':
      calories = tdee + 200
      proteinPerKg = 1.9
      rationaleKey = 'strength'
      break
    case 'conditioning':
    case 'endurance':
      calories = tdee + (isTrainingDay ? 100 : -100)
      proteinPerKg = 1.7
      rationaleKey = 'conditioning'
      break
    default:
      break
  }
  const floor = user.sex === 'female' ? 1400 : 1600
  calories = Math.max(floor, round(calories / 10) * 10)
  const proteinG = round(user.weightKg * proteinPerKg)
  const fatG = round(Math.max(user.weightKg * 0.8, (calories * 0.25) / 9))
  const carbsG = round(Math.max(80, (calories - proteinG * 4 - fatG * 9) / 4))
  return { calories, proteinG, carbsG, fatG, tdee: round(tdee), rationale: nutritionRationale({ rationale: '', rationaleKey }, 'en'), rationaleKey }
}

/**
 * Meal templates are identified by id; names and item lists are presentation
 * (mealTpl.<id>.name / .items in the dictionaries). The English rendering is
 * stored on the meal so older data and exports stay readable.
 */
interface MealTemplate {
  id: string
  diets: DietPreference[]
  flags?: DietaryFlag[] // incompatible flags
  ratio: { p: number; c: number; f: number } // share of calories
}

const BREAKFAST: MealTemplate[] = [
  { id: 'greek_yogurt_bowl', diets: ['omnivore', 'vegetarian', 'pescatarian'], flags: ['lactose_free'], ratio: { p: 0.3, c: 0.5, f: 0.2 } },
  { id: 'eggs_sourdough', diets: ['omnivore', 'vegetarian', 'pescatarian'], flags: ['gluten_free'], ratio: { p: 0.28, c: 0.37, f: 0.35 } },
  { id: 'protein_oats', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], flags: ['no_nuts'], ratio: { p: 0.3, c: 0.5, f: 0.2 } },
  { id: 'tofu_scramble', diets: ['vegan', 'vegetarian'], flags: ['gluten_free'], ratio: { p: 0.28, c: 0.4, f: 0.32 } },
  { id: 'smoked_salmon_plate', diets: ['omnivore', 'pescatarian'], flags: ['gluten_free', 'lactose_free'], ratio: { p: 0.32, c: 0.35, f: 0.33 } },
  { id: 'cottage_cheese_fruit', diets: ['omnivore', 'vegetarian', 'pescatarian'], flags: ['lactose_free', 'no_nuts'], ratio: { p: 0.35, c: 0.35, f: 0.3 } },
]

const LUNCH: MealTemplate[] = [
  { id: 'chicken_rice_bowl', diets: ['omnivore'], ratio: { p: 0.35, c: 0.42, f: 0.23 } },
  { id: 'tuna_white_bean_salad', diets: ['omnivore', 'pescatarian'], flags: ['gluten_free'], ratio: { p: 0.32, c: 0.4, f: 0.28 } },
  { id: 'lentil_halloumi_bowl', diets: ['vegetarian', 'omnivore'], flags: ['lactose_free'], ratio: { p: 0.28, c: 0.45, f: 0.27 } },
  { id: 'tempeh_stir_fry', diets: ['vegan', 'vegetarian', 'omnivore', 'pescatarian'], ratio: { p: 0.28, c: 0.47, f: 0.25 } },
  { id: 'turkey_wrap', diets: ['omnivore'], flags: ['gluten_free'], ratio: { p: 0.35, c: 0.42, f: 0.23 } },
  { id: 'chickpea_shawarma_bowl', diets: ['vegan', 'vegetarian', 'omnivore', 'pescatarian'], flags: ['gluten_free'], ratio: { p: 0.22, c: 0.5, f: 0.28 } },
]

const DINNER: MealTemplate[] = [
  { id: 'salmon_potatoes_greens', diets: ['omnivore', 'pescatarian'], ratio: { p: 0.32, c: 0.38, f: 0.3 } },
  { id: 'lean_beef_chili', diets: ['omnivore'], ratio: { p: 0.35, c: 0.42, f: 0.23 } },
  { id: 'chicken_pasta', diets: ['omnivore'], flags: ['gluten_free'], ratio: { p: 0.33, c: 0.47, f: 0.2 } },
  { id: 'tofu_green_curry', diets: ['vegan', 'vegetarian', 'omnivore', 'pescatarian'], ratio: { p: 0.22, c: 0.5, f: 0.28 } },
  { id: 'prawn_noodles', diets: ['omnivore', 'pescatarian'], flags: ['gluten_free'], ratio: { p: 0.33, c: 0.47, f: 0.2 } },
  { id: 'black_bean_tacos', diets: ['vegan', 'vegetarian', 'omnivore', 'pescatarian'], ratio: { p: 0.2, c: 0.52, f: 0.28 } },
  { id: 'paneer_tikka_rice', diets: ['vegetarian', 'omnivore'], flags: ['lactose_free'], ratio: { p: 0.27, c: 0.43, f: 0.3 } },
]

const SNACKS: MealTemplate[] = [
  { id: 'protein_shake_banana', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], ratio: { p: 0.5, c: 0.45, f: 0.05 } },
  { id: 'apple_almond_butter', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], flags: ['no_nuts'], ratio: { p: 0.1, c: 0.5, f: 0.4 } },
  { id: 'skyr_berries', diets: ['omnivore', 'vegetarian', 'pescatarian'], flags: ['lactose_free'], ratio: { p: 0.55, c: 0.4, f: 0.05 } },
  { id: 'rice_cakes_hummus', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], ratio: { p: 0.15, c: 0.6, f: 0.25 } },
  { id: 'edamame_dark_chocolate', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], ratio: { p: 0.3, c: 0.4, f: 0.3 } },
]

const PRE_WORKOUT: MealTemplate[] = [
  { id: 'pre_workout_fuel', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], ratio: { p: 0.08, c: 0.85, f: 0.07 } },
  { id: 'light_pre_workout', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], flags: ['gluten_free'], ratio: { p: 0.1, c: 0.8, f: 0.1 } },
]

const POST_WORKOUT: MealTemplate[] = [
  { id: 'post_workout_shake', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], ratio: { p: 0.55, c: 0.4, f: 0.05 } },
  { id: 'recovery_bowl', diets: ['omnivore', 'vegetarian', 'pescatarian'], flags: ['lactose_free'], ratio: { p: 0.35, c: 0.5, f: 0.15 } },
]

/** Items of a template in both languages, so "no mushrooms" works whether the user wrote it in English or French. */
function templateItems(id: string): string[] {
  return [...mealTemplateItems(id, [], 'en'), ...mealTemplateItems(id, [], 'fr')]
}

function choose(pool: MealTemplate[], user: UserProfile, seed: number): MealTemplate {
  const disliked = user.dislikedFoods.map((d) => foldText(d.toLowerCase()))
  const ok = pool.filter(
    (t) =>
      t.diets.includes(user.diet) &&
      !(t.flags ?? []).some((f) => user.dietaryFlags.includes(f)) &&
      !templateItems(t.id).some((i) => disliked.some((d) => d && foldText(i.toLowerCase()).includes(d))),
  )
  const list = ok.length ? ok : pool.filter((t) => t.diets.includes(user.diet))
  const final = list.length ? list : pool
  return final[seed % final.length]
}

function buildMeal(slot: Meal['slot'], template: MealTemplate, calories: number, note?: string): Meal {
  const cal = round(calories / 10) * 10
  return {
    id: uid('meal'),
    slot,
    name: mealTemplateName(template.id, template.id, 'en'),
    templateId: template.id,
    items: mealTemplateItems(template.id, [], 'en'),
    calories: cal,
    proteinG: round((cal * template.ratio.p) / 4),
    carbsG: round((cal * template.ratio.c) / 4),
    fatG: round((cal * template.ratio.f) / 9),
    note,
  }
}

export interface GenerateNutritionInput {
  user: UserProfile
  goals: Goal[]
  isTrainingDay: boolean
  date?: string
  restaurantDinner?: boolean
  lowerCarb?: boolean
  seed?: string
}

export function generateNutritionPlan(input: GenerateNutritionInput): NutritionPlan {
  const { user, goals, isTrainingDay } = input
  const date = input.date ?? todayKey()
  const targets = computeTargets(user, goals, isTrainingDay)
  const seed = hashString(input.seed ?? `${date}-${user.id}`)
  const adjustmentKeys: string[] = []
  const meals: Meal[] = []

  let shares: Array<{ slot: Meal['slot']; share: number; pool: MealTemplate[] }>
  if (isTrainingDay) {
    shares = [
      { slot: 'breakfast', share: 0.24, pool: BREAKFAST },
      { slot: 'pre_workout', share: 0.08, pool: PRE_WORKOUT },
      { slot: 'lunch', share: 0.27, pool: LUNCH },
      { slot: 'post_workout', share: 0.11, pool: POST_WORKOUT },
      { slot: 'dinner', share: 0.3, pool: DINNER },
    ]
  } else {
    shares = [
      { slot: 'breakfast', share: 0.26, pool: BREAKFAST },
      { slot: 'lunch', share: 0.31, pool: LUNCH },
      { slot: 'snack', share: 0.12, pool: SNACKS },
      { slot: 'dinner', share: 0.31, pool: DINNER },
    ]
  }

  if (input.restaurantDinner) {
    // Reserve a bigger, looser dinner and pull the rest of the day lighter & higher-protein.
    const dinnerShare = 0.42
    const rest = 1 - dinnerShare
    const others = shares.filter((s) => s.slot !== 'dinner')
    const otherTotal = others.reduce((a, s) => a + s.share, 0)
    shares = [
      ...others.map((s) => ({ ...s, share: (s.share / otherTotal) * rest })),
      { slot: 'dinner', share: dinnerShare, pool: DINNER },
    ]
    adjustmentKeys.push('restaurant')
  }

  shares.forEach((s, i) => {
    if (s.slot === 'dinner' && input.restaurantDinner) {
      const cal = round((targets.calories * s.share) / 10) * 10
      meals.push({
        id: uid('meal'),
        slot: 'dinner',
        name: mealTemplateName('restaurant', 'Restaurant dinner', 'en'),
        templateId: 'restaurant',
        items: mealTemplateItems('restaurant', [], 'en'),
        calories: cal,
        proteinG: round((cal * 0.3) / 4),
        carbsG: round((cal * 0.4) / 4),
        fatG: round((cal * 0.3) / 9),
        note: mealNote({ templateId: 'restaurant' }, 'en'),
        isRestaurant: true,
      })
      return
    }
    const template = choose(s.pool, user, seed + i * 7)
    meals.push(buildMeal(s.slot, template, targets.calories * s.share))
  })

  if (input.lowerCarb || user.dietaryFlags.includes('low_carb')) adjustmentKeys.push('lowCarb')

  // Reconcile macros to the targets (protein is the priority).
  const totalP = meals.reduce((a, m) => a + m.proteinG, 0)
  if (totalP < targets.proteinG) {
    const deficit = targets.proteinG - totalP
    const per = Math.ceil(deficit / meals.length)
    for (const m of meals) {
      if (m.isRestaurant) continue
      m.proteinG += per
      m.carbsG = Math.max(10, m.carbsG - Math.round(per * 0.8))
    }
  }

  return {
    id: uid('nut'),
    date,
    calories: targets.calories,
    proteinG: targets.proteinG,
    carbsG: targets.carbsG,
    fatG: targets.fatG,
    meals,
    isTrainingDay,
    rationale: targets.rationale,
    rationaleKey: targets.rationaleKey,
    adjustments: adjustmentKeys.length ? nutritionAdjustments({ adjustmentKeys }, 'en') : undefined,
    adjustmentKeys: adjustmentKeys.length ? adjustmentKeys : undefined,
    createdAt: new Date().toISOString(),
  }
}

export function macroSplit(plan: { calories: number; proteinG: number; carbsG: number; fatG: number }): { p: number; c: number; f: number } {
  const total = plan.proteinG * 4 + plan.carbsG * 4 + plan.fatG * 9 || 1
  return { p: clamp((plan.proteinG * 4) / total, 0, 1), c: clamp((plan.carbsG * 4) / total, 0, 1), f: clamp((plan.fatG * 9) / total, 0, 1) }
}

export { goalNutritionSummary }

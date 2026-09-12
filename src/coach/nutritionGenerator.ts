import type { DietPreference, DietaryFlag, Goal, GoalType, Meal, NutritionPlan, UserProfile } from '@/domain/types'
import { clamp, hashString, round, uid } from '@/lib/utils'
import { todayKey } from '@/lib/dates'
import { primaryGoal } from './workoutGenerator'

export interface NutritionTargets {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  tdee: number
  rationale: string
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
  let rationale = 'Maintenance calories with enough protein to support training.'
  switch (goal) {
    case 'build_muscle':
      calories = tdee + (isTrainingDay ? 300 : 150)
      proteinPerKg = 2.0
      rationale = isTrainingDay ? 'A modest surplus on training days to fuel growth without adding fat.' : 'A smaller surplus on rest days. Recovery still needs fuel.'
      break
    case 'lose_fat':
      calories = tdee - (isTrainingDay ? 400 : 500)
      proteinPerKg = 2.2
      rationale = 'A sustainable deficit with high protein so you keep muscle while losing fat.'
      break
    case 'recomposition':
      calories = tdee + (isTrainingDay ? 150 : -250)
      proteinPerKg = 2.1
      rationale = isTrainingDay ? 'Slightly above maintenance today to fuel the session.' : 'Slightly under maintenance on rest days. Recomp lives in the average.'
      break
    case 'strength':
      calories = tdee + 200
      proteinPerKg = 1.9
      rationale = 'A light surplus so strength keeps climbing.'
      break
    case 'conditioning':
    case 'endurance':
      calories = tdee + (isTrainingDay ? 100 : -100)
      proteinPerKg = 1.7
      rationale = 'Carbs lean higher on training days to fuel the engine.'
      break
    default:
      break
  }
  const floor = user.sex === 'female' ? 1400 : 1600
  calories = Math.max(floor, round(calories / 10) * 10)
  const proteinG = round(user.weightKg * proteinPerKg)
  const fatG = round(Math.max(user.weightKg * 0.8, (calories * 0.25) / 9))
  const carbsG = round(Math.max(80, (calories - proteinG * 4 - fatG * 9) / 4))
  return { calories, proteinG, carbsG, fatG, tdee: round(tdee), rationale }
}

interface MealTemplate {
  name: string
  items: string[]
  diets: DietPreference[]
  flags?: DietaryFlag[] // incompatible flags
  ratio: { p: number; c: number; f: number } // share of calories
}

const BREAKFAST: MealTemplate[] = [
  { name: 'Greek yogurt bowl', items: ['Greek yogurt', 'Berries', 'Granola', 'Honey'], diets: ['omnivore', 'vegetarian', 'pescatarian'], flags: ['lactose_free'], ratio: { p: 0.3, c: 0.5, f: 0.2 } },
  { name: 'Eggs & sourdough', items: ['3 eggs, scrambled', 'Sourdough toast', 'Avocado', 'Cherry tomatoes'], diets: ['omnivore', 'vegetarian', 'pescatarian'], flags: ['gluten_free'], ratio: { p: 0.28, c: 0.37, f: 0.35 } },
  { name: 'Protein oats', items: ['Rolled oats', 'Whey or plant protein', 'Banana', 'Peanut butter'], diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], flags: ['no_nuts'], ratio: { p: 0.3, c: 0.5, f: 0.2 } },
  { name: 'Tofu scramble', items: ['Tofu scramble with turmeric', 'Spinach', 'Whole-grain toast', 'Avocado'], diets: ['vegan', 'vegetarian'], flags: ['gluten_free'], ratio: { p: 0.28, c: 0.4, f: 0.32 } },
  { name: 'Smoked salmon plate', items: ['Smoked salmon', 'Rye bread', 'Cream cheese', 'Cucumber'], diets: ['omnivore', 'pescatarian'], flags: ['gluten_free', 'lactose_free'], ratio: { p: 0.32, c: 0.35, f: 0.33 } },
  { name: 'Cottage cheese & fruit', items: ['Cottage cheese', 'Pineapple', 'Walnuts', 'Cinnamon'], diets: ['omnivore', 'vegetarian', 'pescatarian'], flags: ['lactose_free', 'no_nuts'], ratio: { p: 0.35, c: 0.35, f: 0.3 } },
]

const LUNCH: MealTemplate[] = [
  { name: 'Chicken rice bowl', items: ['Grilled chicken thigh', 'Jasmine rice', 'Roasted broccoli', 'Sriracha mayo'], diets: ['omnivore'], ratio: { p: 0.35, c: 0.42, f: 0.23 } },
  { name: 'Tuna & white bean salad', items: ['Tuna', 'Cannellini beans', 'Rocket', 'Olive oil & lemon', 'Crusty bread'], diets: ['omnivore', 'pescatarian'], flags: ['gluten_free'], ratio: { p: 0.32, c: 0.4, f: 0.28 } },
  { name: 'Lentil & halloumi bowl', items: ['Puy lentils', 'Grilled halloumi', 'Roasted peppers', 'Quinoa'], diets: ['vegetarian', 'omnivore'], flags: ['lactose_free'], ratio: { p: 0.28, c: 0.45, f: 0.27 } },
  { name: 'Tempeh stir-fry', items: ['Tempeh', 'Brown rice', 'Mixed vegetables', 'Sesame & soy'], diets: ['vegan', 'vegetarian', 'omnivore', 'pescatarian'], ratio: { p: 0.28, c: 0.47, f: 0.25 } },
  { name: 'Turkey wrap', items: ['Turkey breast', 'Whole-wheat wrap', 'Hummus', 'Crunchy salad'], diets: ['omnivore'], flags: ['gluten_free'], ratio: { p: 0.35, c: 0.42, f: 0.23 } },
  { name: 'Chickpea shawarma bowl', items: ['Spiced chickpeas', 'Bulgur', 'Tahini', 'Pickled cabbage'], diets: ['vegan', 'vegetarian', 'omnivore', 'pescatarian'], flags: ['gluten_free'], ratio: { p: 0.22, c: 0.5, f: 0.28 } },
]

const DINNER: MealTemplate[] = [
  { name: 'Salmon, potatoes & greens', items: ['Baked salmon', 'Roast potatoes', 'Green beans', 'Lemon butter'], diets: ['omnivore', 'pescatarian'], ratio: { p: 0.32, c: 0.38, f: 0.3 } },
  { name: 'Lean beef chili', items: ['Lean beef chili', 'Basmati rice', 'Greek yogurt', 'Coriander'], diets: ['omnivore'], ratio: { p: 0.35, c: 0.42, f: 0.23 } },
  { name: 'Chicken pasta', items: ['Chicken breast', 'Wholewheat pasta', 'Tomato & basil sauce', 'Parmesan'], diets: ['omnivore'], flags: ['gluten_free'], ratio: { p: 0.33, c: 0.47, f: 0.2 } },
  { name: 'Tofu green curry', items: ['Tofu', 'Thai green curry', 'Jasmine rice', 'Bok choy'], diets: ['vegan', 'vegetarian', 'omnivore', 'pescatarian'], ratio: { p: 0.22, c: 0.5, f: 0.28 } },
  { name: 'Prawn stir-fry noodles', items: ['King prawns', 'Egg noodles', 'Pak choi', 'Ginger & garlic'], diets: ['omnivore', 'pescatarian'], flags: ['gluten_free'], ratio: { p: 0.33, c: 0.47, f: 0.2 } },
  { name: 'Black bean tacos', items: ['Black beans', 'Corn tortillas', 'Avocado', 'Salsa & lime'], diets: ['vegan', 'vegetarian', 'omnivore', 'pescatarian'], ratio: { p: 0.2, c: 0.52, f: 0.28 } },
  { name: 'Paneer tikka & rice', items: ['Paneer tikka', 'Basmati rice', 'Cucumber raita', 'Spinach'], diets: ['vegetarian', 'omnivore'], flags: ['lactose_free'], ratio: { p: 0.27, c: 0.43, f: 0.3 } },
]

const SNACKS: MealTemplate[] = [
  { name: 'Protein shake & banana', items: ['Whey or plant protein', 'Banana'], diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], ratio: { p: 0.5, c: 0.45, f: 0.05 } },
  { name: 'Apple & almond butter', items: ['Apple', 'Almond butter'], diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], flags: ['no_nuts'], ratio: { p: 0.1, c: 0.5, f: 0.4 } },
  { name: 'Skyr & berries', items: ['Skyr', 'Mixed berries'], diets: ['omnivore', 'vegetarian', 'pescatarian'], flags: ['lactose_free'], ratio: { p: 0.55, c: 0.4, f: 0.05 } },
  { name: 'Rice cakes & hummus', items: ['Rice cakes', 'Hummus', 'Cherry tomatoes'], diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], ratio: { p: 0.15, c: 0.6, f: 0.25 } },
  { name: 'Edamame & dark chocolate', items: ['Edamame', 'Two squares dark chocolate'], diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], ratio: { p: 0.3, c: 0.4, f: 0.3 } },
]

const PRE_WORKOUT: MealTemplate[] = [
  { name: 'Pre-workout fuel', items: ['Banana', 'Rice cakes with honey', 'Coffee'], diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], ratio: { p: 0.08, c: 0.85, f: 0.07 } },
  { name: 'Light pre-workout', items: ['Toast with jam', 'Espresso'], diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], flags: ['gluten_free'], ratio: { p: 0.1, c: 0.8, f: 0.1 } },
]

const POST_WORKOUT: MealTemplate[] = [
  { name: 'Post-workout shake', items: ['Whey or plant protein', 'Oat milk', 'Frozen berries'], diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'], ratio: { p: 0.55, c: 0.4, f: 0.05 } },
  { name: 'Recovery bowl', items: ['Greek yogurt', 'Granola', 'Honey'], diets: ['omnivore', 'vegetarian', 'pescatarian'], flags: ['lactose_free'], ratio: { p: 0.35, c: 0.5, f: 0.15 } },
]

function choose(pool: MealTemplate[], user: UserProfile, seed: number): MealTemplate {
  const disliked = user.dislikedFoods.map((d) => d.toLowerCase())
  const ok = pool.filter(
    (t) =>
      t.diets.includes(user.diet) &&
      !(t.flags ?? []).some((f) => user.dietaryFlags.includes(f)) &&
      !t.items.some((i) => disliked.some((d) => d && i.toLowerCase().includes(d))),
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
    name: template.name,
    items: template.items,
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
  const adjustments: string[] = []
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
    adjustments.push('Restaurant dinner: earlier meals are lighter and protein-forward so you can enjoy tonight.')
  }

  shares.forEach((s, i) => {
    if (s.slot === 'dinner' && input.restaurantDinner) {
      const cal = round((targets.calories * s.share) / 10) * 10
      meals.push({
        id: uid('meal'),
        slot: 'dinner',
        name: 'Restaurant dinner',
        items: ['Lead with a protein main (grilled fish, steak, chicken, tofu)', 'Add a vegetable side', 'One thing you really want: bread, dessert or a drink', 'Skip the second starch'],
        calories: cal,
        proteinG: round((cal * 0.3) / 4),
        carbsG: round((cal * 0.4) / 4),
        fatG: round((cal * 0.3) / 9),
        note: 'A loose target. Enjoy it. One meal never decides the week.',
        isRestaurant: true,
      })
      return
    }
    const template = choose(s.pool, user, seed + i * 7)
    meals.push(buildMeal(s.slot, template, targets.calories * s.share))
  })

  if (input.lowerCarb || user.dietaryFlags.includes('low_carb')) adjustments.push('Carbs are concentrated around training; other meals lean on protein and fats.')

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
    adjustments: adjustments.length ? adjustments : undefined,
    createdAt: new Date().toISOString(),
  }
}

export function macroSplit(plan: { calories: number; proteinG: number; carbsG: number; fatG: number }): { p: number; c: number; f: number } {
  const total = plan.proteinG * 4 + plan.carbsG * 4 + plan.fatG * 9 || 1
  return { p: clamp((plan.proteinG * 4) / total, 0, 1), c: clamp((plan.carbsG * 4) / total, 0, 1), f: clamp((plan.fatG * 9) / total, 0, 1) }
}

export function goalNutritionSummary(goal: GoalType): string {
  const map: Record<GoalType, string> = {
    build_muscle: 'small surplus, high protein',
    lose_fat: 'steady deficit, very high protein',
    recomposition: 'maintenance average, protein first',
    conditioning: 'fuel around sessions',
    strength: 'light surplus',
    consistency: 'maintenance, simple meals',
    general_fitness: 'maintenance, balanced',
    mobility: 'maintenance, balanced',
    endurance: 'carb-forward on long days',
  }
  return map[goal]
}

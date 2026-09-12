import type { DietPreference, DietaryFlag, FitnessLevel, GoalType, WorkoutFocus } from './types'

export const GOAL_LABELS: Record<GoalType, string> = {
  build_muscle: 'Build muscle',
  lose_fat: 'Lose fat',
  recomposition: 'Recomposition',
  conditioning: 'Improve conditioning',
  strength: 'Get stronger',
  consistency: 'Be consistent',
  general_fitness: 'General fitness',
  mobility: 'Move better',
  endurance: 'Build endurance',
}

export const GOAL_DESCRIPTIONS: Record<GoalType, string> = {
  build_muscle: 'Progressive strength training with enough food to grow.',
  lose_fat: 'A steady deficit, high protein, and training that protects muscle.',
  recomposition: 'Build muscle while slowly losing fat. Patience and precision.',
  conditioning: 'A stronger engine: intervals, tempo work, and recovery.',
  strength: 'Fewer reps, heavier loads, and patient progression.',
  consistency: 'Show up. The plan bends around your week so you never fall off.',
  general_fitness: 'Balanced training for feeling capable every day.',
  mobility: 'Range of motion, control, and joints that feel young.',
  endurance: 'Longer efforts, aerobic base, and durable legs.',
}

export const LEVEL_LABELS: Record<FitnessLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  returning: 'Returning',
}

export const LEVEL_DESCRIPTIONS: Record<FitnessLevel, string> = {
  beginner: 'New to structured training, or less than a year in.',
  intermediate: '1–3 years of consistent training.',
  advanced: '3+ years and I know my numbers.',
  returning: 'I used to train. Getting back into it.',
}

export const DIET_LABELS: Record<DietPreference, string> = {
  omnivore: 'Everything',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
}

export const DIETARY_FLAG_LABELS: Record<DietaryFlag, string> = {
  gluten_free: 'Gluten-free',
  lactose_free: 'Lactose-free',
  halal: 'Halal',
  kosher: 'Kosher',
  no_nuts: 'No nuts',
  low_carb: 'Lower carb',
}

export const FOCUS_LABELS: Record<WorkoutFocus, string> = {
  upper: 'Upper Body',
  lower: 'Lower Body',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  full_body: 'Full Body',
  conditioning: 'Conditioning',
  core_mobility: 'Core & Mobility',
  recovery: 'Recovery',
}

export const MEAL_SLOT_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  pre_workout: 'Pre-workout',
  post_workout: 'Post-workout',
} as const

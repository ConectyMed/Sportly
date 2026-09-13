/**
 * Sportly domain model.
 * Everything the coach knows about the user and everything the app renders lives here.
 * Kept framework-agnostic so it can move to React Native / Expo untouched.
 */

export type ISODate = string // full ISO timestamp
export type DayKey = string // YYYY-MM-DD

export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced' | 'returning'
export type Sex = 'male' | 'female' | 'other' | 'unspecified'

export type GoalType =
  | 'build_muscle'
  | 'lose_fat'
  | 'recomposition'
  | 'conditioning'
  | 'strength'
  | 'consistency'
  | 'general_fitness'
  | 'mobility'
  | 'endurance'

export type EquipmentId =
  | 'barbell'
  | 'dumbbell'
  | 'kettlebell'
  | 'cable'
  | 'machine'
  | 'bodyweight'
  | 'band'
  | 'pullup_bar'
  | 'bench'
  | 'cardio_machine'

export type DietPreference = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian'
export type DietaryFlag = 'gluten_free' | 'lactose_free' | 'halal' | 'kosher' | 'no_nuts' | 'low_carb'

export interface Goal {
  id: string
  type: GoalType
  rank: 'primary' | 'secondary'
  label: string
  /** Optional measurable target. */
  metric?: 'body_weight' | 'bench_press' | 'squat' | 'deadlift' | 'workouts_per_week' | 'steps_per_day' | 'custom'
  targetValue?: number
  targetUnit?: string
  startValue?: number
  targetDate?: DayKey
  createdAt: ISODate
}

export interface Availability {
  daysPerWeek: number
  /** 0 = Sunday ... 6 = Saturday */
  preferredDays: number[]
  sessionMinutes: number
  preferredTime: 'morning' | 'midday' | 'evening' | 'flexible'
}

export interface UserProfile {
  id: string
  name: string
  age: number
  sex: Sex
  heightCm: number
  weightKg: number
  level: FitnessLevel
  yearsTraining: number
  sports: string[]
  equipment: EquipmentId[]
  trainsAt: 'gym' | 'home' | 'both'
  availability: Availability
  diet: DietPreference
  dietaryFlags: DietaryFlag[]
  dislikedFoods: string[]
  /** Exercise ids or keywords the user has asked to avoid (persistent preference). */
  dislikedExercises?: string[]
  lifestyle: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
  sleepHoursTypical: number
  createdAt: ISODate
  onboardedAt?: ISODate
  isDemo?: boolean
}

export interface CoachPersonality {
  /** 0 = calm, 100 = intense */
  motivation: number
  /** 0 = gentle, 100 = direct */
  tone: number
  /** 0 = serious, 100 = playful */
  humor: number
  /** 0 = concise, 100 = detailed */
  communication: number
}

export interface CoachConfig {
  name: string
  personality: CoachPersonality
  /** Which AI provider backs the coach. `local` needs no credentials. */
  provider: 'local' | 'anthropic'
  /** Optional user-supplied key, stored on-device only. Never bundled. */
  anthropicApiKey?: string
  anthropicModel?: string
}

export type MemoryCategory =
  | 'goal'
  | 'preference'
  | 'equipment'
  | 'availability'
  | 'nutrition'
  | 'habit'
  | 'health'
  | 'history'
  | 'reaction'
  | 'communication'
  | 'note'

export interface MemoryItem {
  id: string
  category: MemoryCategory
  text: string
  source: 'onboarding' | 'conversation' | 'inferred' | 'user'
  createdAt: ISODate
  pinned?: boolean
  /** Last time this memory was confirmed or edited. */
  updatedAt?: ISODate
  /** 0–1. Explicit statements are 1; inferred ones lower. */
  confidence?: number
  /** Temporary memories describe a passing situation; persistent ones describe the person. */
  persistence?: 'persistent' | 'temporary'
  expiresAt?: ISODate
  /** Normalised subject words (“running”, “burpees”) used to detect contradictions. */
  subjects?: string[]
  /** Memory this one replaced after a contradiction. */
  supersedes?: string
}

/* ------------------------------------------------------------------ Actions & audit */

/** What a coach tool changed. Kept explicit so every surface can explain “what changed and why”. */
export type DomainChangeType =
  | 'PROFILE_UPDATED'
  | 'AVAILABILITY_UPDATED'
  | 'READINESS_UPDATED'
  | 'GOAL_CREATED'
  | 'GOAL_UPDATED'
  | 'GOAL_DELETED'
  | 'WORKOUT_CREATED'
  | 'WORKOUT_UPDATED'
  | 'WORKOUT_DELETED'
  | 'WORKOUT_COMPLETED'
  | 'WORKOUT_SKIPPED'
  | 'WORKOUT_RESCHEDULED'
  | 'PROGRAM_CREATED'
  | 'PROGRAM_CANCELLED'
  | 'NUTRITION_TARGET_UPDATED'
  | 'MEAL_ADDED'
  | 'MEAL_UPDATED'
  | 'MEAL_DELETED'
  | 'MEASUREMENT_LOGGED'
  | 'EVENT_CREATED'
  | 'EVENT_UPDATED'
  | 'EVENT_DELETED'
  | 'MEMORY_SAVED'
  | 'MEMORY_REMOVED'
  | 'COACH_UPDATED'
  | 'NOTIFICATION_SENT'

export type EntityType = 'user' | 'goal' | 'workout' | 'program' | 'nutrition_plan' | 'meal' | 'measurement' | 'check_in' | 'event' | 'memory' | 'coach' | 'notification'

export interface EntityRef {
  type: EntityType
  id: string
  label?: string
}

export interface DomainChange {
  type: DomainChangeType
  entity: EntityRef
  summary: string
}

/** One executed (or failed) coach tool call. Stored on the message and in the audit log. */
export interface ActionRecord {
  id: string
  tool: string
  ok: boolean
  summary: string
  changes: DomainChange[]
  error?: string
  /** True when the call was recognised as a repeat and nothing new was changed. */
  idempotent?: boolean
  source: 'coach' | 'user' | 'system'
  at: ISODate
}

export type AttachmentKind = 'image' | 'pdf' | 'document' | 'audio'

export interface Attachment {
  id: string
  kind: AttachmentKind
  name: string
  mimeType: string
  size: number
  /** Data is stored separately in IndexedDB by id; a small preview may be inlined. */
  previewDataUrl?: string
  durationSec?: number
  /** Optional transcript (for audio) or extracted text (for documents). */
  transcript?: string
  createdAt: ISODate
}

export type CardType =
  | 'workout'
  | 'program'
  | 'nutrition'
  | 'progress'
  | 'goal'
  | 'calendar'
  | 'memory'
  | 'checkin'
  | 'attachment'
  | 'insight'
  | 'food'

export interface CoachCard {
  id: string
  type: CardType
  /** Reference to a domain entity when applicable. */
  refId?: string
  title?: string
  subtitle?: string
  /** Free-form structured payload for card types without a domain entity. */
  data?: Record<string, unknown>
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'coach' | 'system'
  text: string
  attachments?: Attachment[]
  cards?: CoachCard[]
  suggestions?: string[]
  createdAt: ISODate
  status?: 'sending' | 'sent' | 'error'
  /** Slot the coach is waiting to fill (e.g. a 1–10 fatigue rating). */
  expects?: ExpectSlot
  /** Tool calls actually executed for this reply, with their real outcome. */
  actions?: ActionRecord[]
  /** Entities this reply talks about (for “it / that / this” resolution). */
  references?: EntityRef[]
}

export type ExpectSlot =
  | 'fatigue_scale'
  | 'sleep_hours'
  | 'energy_scale'
  | 'time_available'
  | 'program_weeks'
  | 'goal_target'
  | 'workout_confirm'
  | 'restaurant_meal'
  | 'coach_name'
  | 'pain_location'
  | 'reschedule_day'
  | 'attachment_kind'
  | 'weight_value'
  | 'goal_choice'
  | 'meal_description'
  | 'bloodwork_flag'
  | 'equipment_list'
  | 'plan_choice'
  | 'meal_slot'
  | 'menu_options'
  | 'finish_confirm'

export interface Conversation {
  id: string
  title: string
  createdAt: ISODate
  updatedAt: ISODate
  /** Contextual pointers so “make it shorter” resolves to the right thing. */
  context: {
    lastWorkoutId?: string
    lastProgramId?: string
    lastNutritionPlanId?: string
    /** Meal currently being discussed (a food scan draft or a logged meal). */
    lastMealId?: string
    /** Last availability instruction, so “actually make it three” resolves. */
    lastAvailabilityScope?: 'week' | 'always'
    lastGoalId?: string
    lastEventId?: string
    topic?: 'workout' | 'program' | 'nutrition' | 'progress' | 'goal' | 'calendar' | 'recovery' | 'general'
  }
}

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'full_body'
  | 'cardio'

export type MovementPattern =
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'core'
  | 'carry'
  | 'isolation'
  | 'conditioning'
  | 'mobility'

export interface ExerciseDefinition {
  id: string
  name: string
  muscles: MuscleGroup[]
  primary: MuscleGroup
  pattern: MovementPattern
  equipment: EquipmentId[]
  level: 1 | 2 | 3
  compound: boolean
  unilateral?: boolean
  /** Bodyweight ratio hint for a sensible starting load at intermediate level. */
  loadRatio?: number
  cue: string
  timed?: boolean
}

export interface WorkoutSet {
  id: string
  targetReps: number
  targetWeightKg?: number
  /** Timed sets (e.g. plank, intervals) use seconds instead of reps. */
  targetSeconds?: number
  actualReps?: number
  actualWeightKg?: number
  actualSeconds?: number
  completed: boolean
  rpe?: number
}

export interface WorkoutExercise {
  id: string
  exerciseId: string
  name: string
  sets: WorkoutSet[]
  restSeconds: number
  note?: string
  /** Superset group letter when paired. */
  group?: string
}

export type WorkoutFocus =
  | 'upper'
  | 'lower'
  | 'push'
  | 'pull'
  | 'legs'
  | 'full_body'
  | 'conditioning'
  | 'core_mobility'
  | 'recovery'

export interface Workout {
  id: string
  title: string
  focus: WorkoutFocus
  estimatedMinutes: number
  exercises: WorkoutExercise[]
  scheduledFor: DayKey
  status: 'planned' | 'in_progress' | 'completed' | 'skipped'
  source: 'coach' | 'program' | 'user'
  programId?: string
  programWeek?: number
  programDay?: number
  constraints?: WorkoutConstraints
  coachNote?: string
  createdAt: ISODate
  startedAt?: ISODate
  completedAt?: ISODate
  /** Populated on completion. */
  summary?: WorkoutSummary
  /** Retained for “revert” style conversational edits. */
  history?: string[]
}

export interface WorkoutConstraints {
  minutes?: number
  equipment?: EquipmentId[]
  noCardio?: boolean
  excludeExerciseIds?: string[]
  intensity?: 'light' | 'moderate' | 'hard'
  focus?: WorkoutFocus
}

export interface WorkoutSummary {
  durationSec: number
  totalVolumeKg: number
  setsCompleted: number
  setsPlanned: number
  exercisesCompleted: number
  prs: Array<{ exerciseId: string; name: string; weightKg: number; reps: number; e1rm: number }>
  feeling?: 'great' | 'good' | 'ok' | 'rough'
  notes?: string
}

export interface ProgramDay {
  dayOfWeek: number
  focus: WorkoutFocus
  title: string
  /** Template exercise ids; concrete workouts are materialised when scheduled. */
  exerciseIds: string[]
  minutes: number
}

export interface ProgramWeek {
  week: number
  phase: 'foundation' | 'build' | 'intensify' | 'peak' | 'deload'
  intensityMultiplier: number
  volumeMultiplier: number
  note: string
  days: ProgramDay[]
}

export interface Program {
  id: string
  name: string
  goalType: GoalType
  weeks: number
  daysPerWeek: number
  split: 'full_body' | 'upper_lower' | 'push_pull_legs' | 'conditioning_hybrid'
  startDate: DayKey
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  weeksPlan: ProgramWeek[]
  description: string
  createdAt: ISODate
  updatedAt: ISODate
}

export interface Meal {
  id: string
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'pre_workout' | 'post_workout'
  name: string
  items: string[]
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  note?: string
  isRestaurant?: boolean
}

export interface NutritionPlan {
  id: string
  date: DayKey
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  meals: Meal[]
  isTrainingDay: boolean
  rationale: string
  adjustments?: string[]
  createdAt: ISODate
}

/* ------------------------------------------------------------------ Food journal */

export type FoodUnit = 'g' | 'ml' | 'piece' | 'serving' | 'cup' | 'tbsp' | 'slice'

export interface FoodItem {
  id: string
  name: string
  /** Quantity in `unit`; `grams` is the resolved weight used for macros. */
  quantity: number
  unit: FoodUnit
  grams: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number
  /** 0–1. Lower when the portion was guessed. */
  confidence: number
  /** Reference into the food database when matched. */
  foodId?: string
}

export interface LoggedMeal {
  id: string
  date: DayKey
  slot: Meal['slot']
  name: string
  items: FoodItem[]
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number
  /** Overall estimate confidence, 0–1. */
  confidence: number
  notes?: string[]
  source: 'scan' | 'text' | 'plan' | 'manual'
  /** How the estimate was produced. Never claims vision when it was not used. */
  analysis: 'local-estimate' | 'vision' | 'manual'
  attachmentId?: string
  previewDataUrl?: string
  /** Draft = analysed but not yet committed to the day. */
  status: 'draft' | 'logged'
  /** Applied portion multiplier (“I only ate half” → 0.5). */
  portionScale: number
  createdAt: ISODate
  updatedAt: ISODate
}

export type MeasurementType = 'body_weight' | 'body_fat' | 'waist' | 'sleep_hours' | 'steps' | 'energy' | 'soreness'

export interface Measurement {
  id: string
  type: MeasurementType
  value: number
  unit: string
  date: DayKey
  createdAt: ISODate
  source: 'user' | 'coach' | 'demo'
}

export interface DailyCheckIn {
  date: DayKey
  sleepHours?: number
  sleepQuality?: 1 | 2 | 3 | 4 | 5
  energy?: number // 1–10
  fatigue?: number // 1–10
  soreness?: number // 1–10
  mood?: 'low' | 'ok' | 'good' | 'great'
  note?: string
  createdAt: ISODate
}

export type CalendarEventType = 'workout' | 'rest' | 'nutrition' | 'program' | 'note'

export interface CalendarEvent {
  id: string
  type: CalendarEventType
  date: DayKey
  time?: string // HH:mm
  title: string
  workoutId?: string
  programId?: string
  status: 'planned' | 'completed' | 'skipped' | 'moved'
  movedFrom?: DayKey
  createdAt: ISODate
}

export interface AppNotification {
  id: string
  kind: 'plan_ready' | 'missed' | 'recovery' | 'reminder' | 'milestone' | 'insight' | 'nutrition'
  title: string
  body: string
  createdAt: ISODate
  read: boolean
  action?: { label: string; to: string }
}

export interface NotificationPreferences {
  enabled: boolean
  morningPlan: boolean
  workoutReminders: boolean
  reminderMinutesBefore: number
  recoveryInsights: boolean
  missedWorkoutNudge: boolean
  nutrition: boolean
  quietHours: { start: string; end: string }
}

export interface Preferences {
  theme: 'dark' | 'light' | 'system'
  units: 'metric' | 'imperial'
  reducedMotion: 'system' | 'on' | 'off'
  hapticFeedback: boolean
  restTimerAutoStart: boolean
  restTimerSound: boolean
  weekStartsOn: 0 | 1
  notifications: NotificationPreferences
  privacy: {
    analytics: boolean
    personalization: boolean
  }
}

export interface Streak {
  current: number
  longest: number
  lastActiveWeek?: string
}

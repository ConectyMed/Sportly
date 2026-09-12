import type {
  Attachment,
  Availability,
  CalendarEvent,
  CoachCard,
  CoachConfig,
  Conversation,
  DailyCheckIn,
  DayKey,
  ExpectSlot,
  Goal,
  LoggedMeal,
  Measurement,
  MemoryItem,
  Message,
  NutritionPlan,
  Program,
  UserProfile,
  Workout,
} from '@/domain/types'
import type { DailyNutrition } from '@/store/selectors'
import type { FoodAnalysis } from './food/foodAnalysis'
import type { Insight } from './insights'
import type { Readiness } from './readiness'

/**
 * Everything the coach can see when it answers. Built by the orchestrator from
 * live app state on every turn, so the coach never reasons from stale assumptions.
 */
export interface CoachContext {
  now: Date
  user: UserProfile
  goals: Goal[]
  coach: CoachConfig
  memory: MemoryItem[]
  readiness: Readiness
  todayCheckIn?: DailyCheckIn
  todayWorkout?: Workout
  tomorrowWorkout?: Workout
  /** Workout currently referenced by the conversation (may equal todayWorkout). */
  contextWorkout?: Workout
  activeProgram?: Program
  todayNutrition?: NutritionPlan
  /** Derived food journal for today: targets, consumed, remaining, meals. */
  nutrition: DailyNutrition
  /** Meal currently being discussed (draft or logged). */
  contextMeal?: LoggedMeal
  /** Whether a real vision model is available for food photos. */
  foodVision: boolean
  workouts: Workout[]
  events: CalendarEvent[]
  measurements: Measurement[]
  checkIns: Record<DayKey, DailyCheckIn>
  conversation: Conversation
  history: Message[]
  insights: Insight[]
  targetPerWeek: number
}

export type CoachAction =
  | { type: 'create_workout'; workout: Workout; replaceWorkoutId?: string }
  | { type: 'update_workout'; workout: Workout }
  | { type: 'skip_workout'; workoutId: string }
  /** Drop a planned (never started) workout and its calendar event, e.g. when a week plan shrinks. */
  | { type: 'remove_workout'; workoutId: string }
  | { type: 'complete_workout'; workoutId: string }
  | { type: 'create_program'; program: Program; workouts: Workout[]; events: CalendarEvent[]; replaceProgramId?: string }
  | { type: 'cancel_program'; programId: string }
  | { type: 'create_nutrition_plan'; plan: NutritionPlan }
  | { type: 'log_meal'; meal: LoggedMeal }
  | { type: 'update_meal'; meal: LoggedMeal }
  | { type: 'delete_meal'; mealId: string }
  | { type: 'remember'; item: Omit<MemoryItem, 'id' | 'createdAt'> }
  | { type: 'forget'; memoryId: string }
  | { type: 'set_goal'; goal: Goal }
  | { type: 'check_in'; patch: Partial<DailyCheckIn> }
  | { type: 'move_event'; eventId: string; toDate: DayKey }
  | { type: 'log_measurement'; measurement: Omit<Measurement, 'id' | 'createdAt'> }
  | { type: 'update_coach'; patch: Partial<CoachConfig> }
  | { type: 'update_user'; patch: Partial<UserProfile> }
  | { type: 'update_availability'; patch: Partial<Availability> }
  | { type: 'notify'; title: string; body: string }

export interface CoachReply {
  text: string
  cards?: CoachCard[]
  actions?: CoachAction[]
  suggestions?: string[]
  expects?: ExpectSlot
  contextPatch?: Partial<Conversation['context']>
  /** Status text shown while the coach "works" (e.g. Building your workout). */
  status?: string
  /** Simulated thinking time hint in ms (local provider). */
  thinkMs?: number
}

export interface CoachRequest {
  text: string
  attachments: Attachment[]
  context: CoachContext
  /** Food analysis already performed by the orchestrator for an attached image (vision or local). */
  foodAnalysis?: FoodAnalysis
}

export interface CoachProvider {
  id: 'local' | 'anthropic'
  respond(request: CoachRequest): Promise<CoachReply>
}

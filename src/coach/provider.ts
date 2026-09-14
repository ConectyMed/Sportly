import type {
  ActionRecord,
  Attachment,
  Availability,
  CalendarEvent,
  CoachCard,
  CoachConfig,
  Conversation,
  DailyCheckIn,
  DayKey,
  EntityRef,
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
import type { Language } from '@/i18n/types'
import type { DailyNutrition } from '@/store/selectors'
import type { CoachContextSnapshot } from './context'
import type { FoodAnalysis } from './food/foodAnalysis'
import type { Insight } from './insights'
import type { Readiness } from './readiness'
import type { TemporalContext } from './time'

/**
 * Everything the coach can see when it answers. Built by the orchestrator from
 * live app state on every turn, so the coach never reasons from stale assumptions.
 */
export interface CoachContext {
  now: Date
  /** The user's selected language: every reply, chip and card is produced in it. */
  language: Language
  /** What today, tomorrow and this week mean for this turn. */
  time: TemporalContext
  /** Serialisable structured view of the same state (what a model receives). */
  snapshot: CoachContextSnapshot
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
  /** The whole food journal (recent days), for questions about yesterday or last week. */
  meals: LoggedMeal[]
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

/**
 * A coach action is a typed tool call. The provider (local engine or a model)
 * only proposes these; the tool layer validates and executes them against the
 * single store. `type` is the tool name.
 */
export type CoachAction =
  | { type: 'create_workout'; workout: Workout; replaceWorkoutId?: string }
  | { type: 'update_workout'; workout: Workout }
  | { type: 'skip_workout'; workoutId: string }
  /** Drop a planned (never started) workout and its calendar event, e.g. when a week plan shrinks. */
  | { type: 'remove_workout'; workoutId: string }
  | { type: 'complete_workout'; workoutId: string }
  | { type: 'reschedule_workout'; workoutId: string; toDate: DayKey }
  | { type: 'create_program'; program: Program; workouts: Workout[]; events: CalendarEvent[]; replaceProgramId?: string }
  | { type: 'cancel_program'; programId: string }
  | { type: 'create_nutrition_plan'; plan: NutritionPlan }
  | { type: 'log_meal'; meal: LoggedMeal }
  | { type: 'update_meal'; meal: LoggedMeal }
  | { type: 'delete_meal'; mealId: string }
  | { type: 'remember'; item: Omit<MemoryItem, 'id' | 'createdAt'> }
  | { type: 'forget'; memoryId: string }
  | { type: 'set_goal'; goal: Goal }
  | { type: 'delete_goal'; goalId: string }
  | { type: 'check_in'; patch: Partial<DailyCheckIn> }
  | { type: 'move_event'; eventId: string; toDate: DayKey }
  | { type: 'create_event'; event: CalendarEvent }
  | { type: 'update_event'; eventId: string; patch: Partial<CalendarEvent> }
  | { type: 'delete_event'; eventId: string }
  | { type: 'log_measurement'; measurement: Omit<Measurement, 'id' | 'createdAt'> }
  | { type: 'update_coach'; patch: Partial<CoachConfig> }
  | { type: 'update_user'; patch: Partial<UserProfile> }
  | { type: 'update_availability'; patch: Partial<Availability> }
  | { type: 'notify'; title: string; body: string }

export type CoachActionType = CoachAction['type']

export interface CoachReply {
  text: string
  cards?: CoachCard[]
  /** Proposed tool calls. The orchestrator executes them and records the real outcome on the message. */
  actions?: CoachAction[]
  suggestions?: string[]
  expects?: ExpectSlot
  contextPatch?: Partial<Conversation['context']>
  /** Entities the reply refers to, for “it / that / this”. */
  references?: EntityRef[]
  /** Status text shown while the coach "works" (e.g. Building your workout). */
  status?: string
  /** Simulated thinking time hint in ms (local provider). */
  thinkMs?: number
}

/**
 * What the orchestrator ultimately commits: the message plus the actions that
 * were REALLY executed. `actions` never lists something that did not happen.
 */
export interface CoachResponse {
  message: string
  actions: ActionRecord[]
  references: EntityRef[]
  suggestedFollowups: string[]
  cards?: CoachCard[]
  expects?: ExpectSlot
}

/* ------------------------------------------------------------------ Model contract */

/**
 * The provider-neutral model contract (CoachModelInput / CoachModelOutput,
 * ToolCall, ToolCallResult, ModelProvider) lives in ./model/contract.ts and is
 * re-exported here for convenience. A model never returns CoachAction objects:
 * it returns tool calls that Sportly resolves, materialises and executes.
 */
export type { CoachModelInput, CoachModelOutput, ModelProvider, ToolCall, ToolCallResult } from './model/contract'

export interface CoachRequest {
  text: string
  attachments: Attachment[]
  context: CoachContext
  /** Food analysis already performed by the orchestrator for an attached image (vision or local). */
  foodAnalysis?: FoodAnalysis
}

/**
 * The built-in engine's interface: it reads a request with its context and
 * proposes a reply with typed actions. Models do not implement this; they
 * implement ModelProvider and go through the tool loop (./model/loop.ts).
 */
export interface CoachProvider {
  id: 'local'
  respond(request: CoachRequest): Promise<CoachReply>
}

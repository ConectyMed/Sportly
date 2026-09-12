import type {
  Attachment,
  CalendarEvent,
  CoachCard,
  CoachConfig,
  Conversation,
  DailyCheckIn,
  DayKey,
  ExpectSlot,
  Goal,
  Measurement,
  MemoryItem,
  Message,
  NutritionPlan,
  Program,
  UserProfile,
  Workout,
} from '@/domain/types'
import type { Insight } from './insights'
import type { Readiness } from './readiness'

/** Everything the coach can see when it answers. Built by the orchestrator from live app state. */
export interface CoachContext {
  now: Date
  user: UserProfile
  goals: Goal[]
  coach: CoachConfig
  memory: MemoryItem[]
  readiness: Readiness
  todayCheckIn?: DailyCheckIn
  todayWorkout?: Workout
  /** Workout currently referenced by the conversation (may equal todayWorkout). */
  contextWorkout?: Workout
  activeProgram?: Program
  todayNutrition?: NutritionPlan
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
  | { type: 'create_program'; program: Program; workouts: Workout[]; events: CalendarEvent[]; replaceProgramId?: string }
  | { type: 'cancel_program'; programId: string }
  | { type: 'create_nutrition_plan'; plan: NutritionPlan }
  | { type: 'remember'; item: Omit<MemoryItem, 'id' | 'createdAt'> }
  | { type: 'forget'; memoryId: string }
  | { type: 'set_goal'; goal: Goal }
  | { type: 'check_in'; patch: Partial<DailyCheckIn> }
  | { type: 'move_event'; eventId: string; toDate: DayKey }
  | { type: 'log_measurement'; measurement: Omit<Measurement, 'id' | 'createdAt'> }
  | { type: 'update_coach'; patch: Partial<CoachConfig> }
  | { type: 'update_user'; patch: Partial<UserProfile> }
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
}

export interface CoachProvider {
  id: 'local' | 'anthropic'
  respond(request: CoachRequest): Promise<CoachReply>
}

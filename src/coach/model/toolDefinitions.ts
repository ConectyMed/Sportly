import type { ToolDefinition } from './contract'
import type { JsonSchema } from './schema'

/**
 * THE source of truth for what a model may ask Sportly to do.
 *
 * Read tools answer from the store. Action tools are model-level requests with
 * small, structured arguments (dates, ids, counts); Sportly resolves references,
 * materialises full entities with its generators, validates and executes them
 * through the registry. The model never builds a Workout or a Program itself.
 *
 * Every provider (OpenAI-style, Anthropic-style, a local endpoint) is given a
 * conversion of this list, never a copy of it.
 */

const DATE_WORDS = 'YYYY-MM-DD, "today", "tomorrow", or a weekday name (next occurrence)'

const date = (description: string): JsonSchema => ({ type: 'string', description: `${description} (${DATE_WORDS}).`, maxLength: 20 })
const id = (description: string): JsonSchema => ({ type: 'string', description, maxLength: 80 })
const text = (description: string, maxLength = 400): JsonSchema => ({ type: 'string', description, maxLength })
const num = (description: string, minimum?: number, maximum?: number): JsonSchema => ({ type: 'number', description, minimum, maximum })
const int = (description: string, minimum?: number, maximum?: number): JsonSchema => ({ type: 'integer', description, minimum, maximum })
const bool = (description: string): JsonSchema => ({ type: 'boolean', description })
const oneOf = (values: string[], description: string): JsonSchema => ({ type: 'string', enum: values, description })
const list = (items: JsonSchema, description: string, maxItems = 20): JsonSchema => ({ type: 'array', items, description, maxItems })
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false })

const GOAL_TYPES = ['build_muscle', 'lose_fat', 'recomposition', 'conditioning', 'strength', 'consistency', 'general_fitness', 'mobility', 'endurance']
const EQUIPMENT = ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bodyweight', 'band', 'pullup_bar', 'bench', 'cardio_machine']
const FOCUS = ['upper', 'lower', 'push', 'pull', 'legs', 'full_body', 'conditioning', 'core_mobility', 'recovery']
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout']
const MEMORY_CATEGORIES = ['goal', 'preference', 'equipment', 'availability', 'nutrition', 'habit', 'health', 'history', 'reaction', 'communication', 'note']
const MEASUREMENTS = ['body_weight', 'body_fat', 'waist', 'sleep_hours', 'steps']
const GOAL_METRICS = ['body_weight', 'bench_press', 'squat', 'deadlift', 'workouts_per_week', 'steps_per_day']
const DIETS = ['omnivore', 'vegetarian', 'vegan', 'pescatarian']

/** How a model points at a workout. An id from context is best; a date is fine; nothing means “the one we are talking about”. */
const WORKOUT_REF = {
  workoutId: id('Workout id from the context or a previous result (preferred).'),
  when: date('Which day, when no id is known'),
}

export const READ_TOOLS: ToolDefinition[] = [
  { name: 'get_user_context', kind: 'read', description: 'The full structured picture of the user: profile, goals, training, readiness, nutrition, progress, calendar, program, memory, conversation.', inputSchema: obj({}) },
  { name: 'get_profile', kind: 'read', description: 'Profile, equipment, availability and dietary preferences.', inputSchema: obj({}) },
  { name: 'get_goals', kind: 'read', description: 'Primary and secondary goals with progress.', inputSchema: obj({}) },
  { name: 'get_goal', kind: 'read', description: 'One goal by id, or the primary goal.', inputSchema: obj({ goalId: id('Goal id; omit for the primary goal.') }) },
  { name: 'get_today', kind: 'read', description: 'What was planned, what happened, what was eaten and readiness today.', inputSchema: obj({}) },
  { name: 'get_tomorrow', kind: 'read', description: 'What is planned tomorrow and the nutrition targets.', inputSchema: obj({}) },
  { name: 'get_day', kind: 'read', description: 'Planned, completed and skipped sessions, meals and check-in for any date.', inputSchema: obj({ date: date('The day') }, ['date']) },
  { name: 'get_workout', kind: 'read', description: 'A workout with its exercises: by id, or today’s / next planned one.', inputSchema: obj({ workoutId: id('Workout id; omit for today’s or the next planned session.') }) },
  { name: 'get_recent_workouts', kind: 'read', description: 'Most recent completed workouts.', inputSchema: obj({ limit: int('How many (1–30).', 1, 30) }) },
  { name: 'get_progress', kind: 'read', description: 'Weight trend, consistency, weekly stats, personal records.', inputSchema: obj({}) },
  { name: 'get_nutrition', kind: 'read', description: 'Targets, consumed, remaining and meals for a date.', inputSchema: obj({ date: date('The day; omit for today') }) },
  { name: 'get_today_meals', kind: 'read', description: 'Meals logged or drafted today.', inputSchema: obj({}) },
  { name: 'get_remaining_nutrition', kind: 'read', description: 'What is left of today’s calories and macros.', inputSchema: obj({}) },
  { name: 'get_calendar', kind: 'read', description: 'Calendar entries in a date range (defaults to the next two weeks).', inputSchema: obj({ from: date('Start'), to: date('End') }) },
  { name: 'get_program', kind: 'read', description: 'The active program, current week and next sessions.', inputSchema: obj({}) },
  { name: 'get_memory', kind: 'read', description: 'What the coach remembers about the user, optionally by category.', inputSchema: obj({ category: oneOf(MEMORY_CATEGORIES, 'Filter by category.') }) },
  { name: 'get_preferences', kind: 'read', description: 'App preferences, coach name and personality.', inputSchema: obj({}) },
  { name: 'get_readiness', kind: 'read', description: 'Today’s readiness score and check-in.', inputSchema: obj({}) },
  { name: 'search_knowledge', kind: 'read', description: 'Search the coaching knowledge base (training, nutrition, recovery principles) with provenance.', inputSchema: obj({ query: text('What to look up.', 200), limit: int('Max hits (1–5).', 1, 5) }, ['query']) },
]

export const ACTION_TOOLS: ToolDefinition[] = [
  {
    name: 'plan_workout',
    kind: 'action',
    description: 'Build (or rebuild) the workout for a day from the user’s goal, readiness and history, with optional constraints. Replaces any planned coach workout on that day.',
    inputSchema: obj({
      date: date('Which day; defaults to today'),
      minutes: int('Time available.', 10, 180),
      focus: oneOf(FOCUS, 'Training focus.'),
      equipment: list(oneOf(EQUIPMENT, 'Equipment id.'), 'Only these equipment types.'),
      intensity: oneOf(['light', 'moderate', 'hard'], 'Overall intensity.'),
      noCardio: bool('Leave conditioning out.'),
    }),
    constraints: ['Sportly generates the exercises, sets and loads; do not invent them.', 'One planned coach workout per day.'],
  },
  {
    name: 'modify_workout',
    kind: 'action',
    description: 'Change an existing planned workout: shorter, longer, lighter, harder, remove cardio, restrict equipment, replace an exercise, change focus, or regenerate.',
    inputSchema: obj(
      {
        ...WORKOUT_REF,
        change: oneOf(['shorter', 'longer', 'lighter', 'harder', 'no_cardio', 'equipment', 'replace_exercise', 'focus', 'regenerate'], 'What to change.'),
        minutes: int('Target length for shorter/longer.', 10, 180),
        exercise: text('Exercise to replace (name or keyword).', 80),
        equipment: list(oneOf(EQUIPMENT, 'Equipment id.'), 'Equipment to restrict to.'),
        focus: oneOf(FOCUS, 'New focus.'),
      },
      ['change'],
    ),
    constraints: ['Only planned workouts can be modified.'],
  },
  {
    name: 'reschedule_workout',
    kind: 'action',
    description: 'Move a planned workout (and its calendar entry) to another day.',
    inputSchema: obj({ ...WORKOUT_REF, toDate: date('The new day') }, ['toDate']),
    constraints: ['Fails if the target day already has a planned workout; ask the user before moving both.'],
  },
  { name: 'skip_workout', kind: 'action', description: 'Mark a planned workout as skipped.', inputSchema: obj(WORKOUT_REF) },
  {
    name: 'complete_workout',
    kind: 'action',
    description: 'Mark a workout as completed; remaining sets count as done. Updates history, calendar, streak and progress.',
    inputSchema: obj({ ...WORKOUT_REF, feeling: oneOf(['great', 'good', 'ok', 'rough'], 'How it felt.'), notes: text('Notes.', 200) }),
  },
  { name: 'delete_workout', kind: 'action', description: 'Remove a planned workout and its calendar entry.', inputSchema: obj(WORKOUT_REF), constraints: ['When several workouts could match, Sportly returns the candidates: ask the user which one instead of guessing.'] },
  {
    name: 'plan_week',
    kind: 'action',
    description: 'Plan the next seven days: one session per chosen weekday (defaults to the user’s preferred days). Existing sessions are kept.',
    inputSchema: obj({ days: list(int('Weekday 0 = Sunday … 6 = Saturday.', 0, 6), 'Weekdays to train on.', 7), count: int('How many sessions if days are not given.', 1, 7) }),
  },
  {
    name: 'create_program',
    kind: 'action',
    description: 'Create a multi-week training program with sessions on the calendar. Replaces the active program.',
    inputSchema: obj({ weeks: int('Length in weeks (4–24).', 4, 24), daysPerWeek: int('Sessions per week (2–6); defaults to availability.', 2, 6), goal: oneOf(GOAL_TYPES, 'Goal to build around; defaults to the primary goal.') }, ['weeks']),
  },
  { name: 'cancel_program', kind: 'action', description: 'Cancel the active program and remove its future sessions.', inputSchema: obj({}) },
  {
    name: 'plan_nutrition',
    kind: 'action',
    description: 'Generate today’s nutrition targets and meal plan, optionally around a restaurant dinner or lower carb.',
    inputSchema: obj({ restaurantDinner: bool('Leave room for eating out tonight.'), lowerCarb: bool('Lower-carb version.') }),
  },
  {
    name: 'log_meal',
    kind: 'action',
    description: 'Log a meal to the food journal from a description (foods and amounts). Sportly estimates calories and macros.',
    inputSchema: obj({ description: text('What was eaten, e.g. "200 g chicken, rice and broccoli".', 300), slot: oneOf(SLOTS, 'Meal slot; defaults to the time of day.'), date: date('Which day; defaults to today') }, ['description']),
  },
  {
    name: 'update_meal',
    kind: 'action',
    description: 'Correct a logged meal: scale the portion, change one food’s amount, add or remove a food, change the slot, or confirm a draft.',
    inputSchema: obj({
      mealId: id('Meal id; omit for the meal being discussed.'),
      corrections: list(
        obj({ type: oneOf(['scale', 'more', 'less', 'remove', 'set_grams', 'set_count', 'add'], 'Correction type.'), food: text('Food the correction applies to.', 80), factor: num('Multiplier for scale/more/less.', 0.05, 5), grams: num('Grams for set_grams.', 1, 3000), count: num('Count for set_count.', 0.25, 50), text: text('Foods to add.', 200) }, ['type']),
        'Corrections, applied in order.',
        10,
      ),
      slot: oneOf(SLOTS, 'Move to this slot.'),
      confirm: bool('Turn a draft into a logged meal.'),
    }),
  },
  { name: 'delete_meal', kind: 'action', description: 'Remove a meal from the food journal.', inputSchema: obj({ mealId: id('Meal id; omit for the meal being discussed.') }) },
  {
    name: 'set_goal',
    kind: 'action',
    description: 'Set or change a goal: type, rank, and an optional measurable target. Changing the primary goal updates it in place.',
    inputSchema: obj({ goal: oneOf(GOAL_TYPES, 'Goal type.'), rank: oneOf(['primary', 'secondary'], 'Defaults to primary.'), metric: oneOf(GOAL_METRICS, 'Measurable metric.'), target: num('Target value for the metric.', 0.1, 100000) }, ['goal']),
  },
  { name: 'delete_goal', kind: 'action', description: 'Remove a goal.', inputSchema: obj({ goalId: id('Goal id; omit when there is only one.') }) },
  {
    name: 'check_in',
    kind: 'action',
    description: 'Record today’s check-in: fatigue, energy, sleep, soreness. Readiness and today’s session adapt from it.',
    inputSchema: obj({ fatigue: int('1 (fresh) – 10 (exhausted).', 1, 10), energy: int('1–10.', 1, 10), sleepHours: num('Hours slept.', 0, 16), soreness: int('1–10.', 1, 10), mood: oneOf(['low', 'ok', 'good', 'great'], 'Mood.') }),
  },
  {
    name: 'log_measurement',
    kind: 'action',
    description: 'Log a body measurement. Body weight also updates the profile.',
    inputSchema: obj({ type: oneOf(MEASUREMENTS, 'Measurement type.'), value: num('Value.', 0.1, 100000), unit: text('Unit; defaults to kg / % / cm / h / steps.', 10), date: date('Which day; defaults to today') }, ['type', 'value']),
  },
  {
    name: 'update_availability',
    kind: 'action',
    description: 'Change the persistent training schedule: days per week, preferred weekdays, session length.',
    inputSchema: obj({ daysPerWeek: int('Sessions per week.', 1, 7), preferredDays: list(int('Weekday 0 = Sunday … 6 = Saturday.', 0, 6), 'Preferred weekdays.', 7), sessionMinutes: int('Usual session length.', 10, 240) }),
    constraints: ['Use plan_week for a one-off week; this changes the standing schedule.'],
  },
  {
    name: 'update_profile',
    kind: 'action',
    description: 'Update profile fields: body weight, equipment, diet, disliked exercises or foods, where the user trains.',
    inputSchema: obj({
      weightKg: num('Body weight in kg.', 20, 400),
      equipment: list(oneOf(EQUIPMENT, 'Equipment id.'), 'Available equipment.'),
      diet: oneOf(DIETS, 'Diet.'),
      dislikedExercises: list(text('Exercise keyword.', 40), 'Exercises to avoid (replaces the list).'),
      dislikedFoods: list(text('Food.', 40), 'Foods to avoid (replaces the list).'),
      trainsAt: oneOf(['gym', 'home', 'both'], 'Where the user trains.'),
    }),
  },
  {
    name: 'save_memory',
    kind: 'action',
    description: 'Ask Sportly to remember a durable fact about the user. Sportly decides the category, persistence, expiry and whether it replaces an older, contradicting memory.',
    inputSchema: obj({ text: text('The fact, in the third person, e.g. "Trains at 7am".', 240), category: oneOf(MEMORY_CATEGORIES, 'Suggested category.') }, ['text']),
    constraints: ['Passing states (“tired today”) belong in check_in, not memory.'],
  },
  { name: 'forget_memory', kind: 'action', description: 'Remove a memory by id or by matching text.', inputSchema: obj({ memoryId: id('Memory id.'), text: text('Text to match when no id is known.', 120) }) },
  { name: 'move_event', kind: 'action', description: 'Move a calendar entry (and its workout, if any) to another day.', inputSchema: obj({ eventId: id('Calendar entry id.'), toDate: date('The new day') }, ['eventId', 'toDate']) },
  { name: 'create_event', kind: 'action', description: 'Add a note or rest day to the calendar.', inputSchema: obj({ title: text('Title.', 80), date: date('The day'), type: oneOf(['rest', 'note', 'nutrition'], 'Entry type; defaults to note.') }, ['title', 'date']) },
  { name: 'delete_event', kind: 'action', description: 'Remove a calendar entry (and its planned workout, if any).', inputSchema: obj({ eventId: id('Calendar entry id.') }, ['eventId']) },
  {
    name: 'update_coach',
    kind: 'action',
    description: 'Change the coach’s name or personality dials (0–100).',
    inputSchema: obj({ name: text('New coach name.', 20), motivation: int('0 calm – 100 intense.', 0, 100), tone: int('0 gentle – 100 direct.', 0, 100), humor: int('0 serious – 100 playful.', 0, 100), communication: int('0 concise – 100 detailed.', 0, 100) }),
  },
  { name: 'notify', kind: 'action', description: 'Leave a note in the user’s notification centre.', inputSchema: obj({ title: text('Title.', 60), body: text('Body.', 200) }, ['title', 'body']) },
]

const ALL: ToolDefinition[] = [...READ_TOOLS, ...ACTION_TOOLS]
const BY_NAME = new Map(ALL.map((t) => [t.name, t]))

/** Every tool a model may be offered, in one list. */
export function toolDefinitions(): ToolDefinition[] {
  return ALL
}

/** The allowlist: a call whose name is not here is refused before anything else happens. */
export function findToolDefinition(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name)
}

export const TOOL_NAMES: string[] = ALL.map((t) => t.name)

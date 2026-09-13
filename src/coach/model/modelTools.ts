import type { ActionRecord, CalendarEvent, CoachCard, Conversation, DomainChange, EntityRef, EquipmentId, Goal, GoalType, MemoryCategory, Workout, WorkoutFocus } from '@/domain/types'
import { GOAL_LABELS } from '@/domain/labels'
import { addDays, dayKey, fromDayKey, weekdayName } from '@/lib/dates'
import { hashString, uid } from '@/lib/utils'
import { selectDailyNutrition } from '@/store/selectors'
import { useStore, type AppState } from '@/store/useStore'
import { buildContextSnapshot, goalSnapshot, workoutSnapshot } from '../context'
import { analyzeDescription, applyCorrection, buildMeal, slotForTime, type MealCorrection } from '../food/foodAnalysis'
import { categorizeMemory } from '../memory'
import { generateNutritionPlan } from '../nutritionGenerator'
import { generateProgram, materializeProgram } from '../programGenerator'
import type { CoachAction } from '../provider'
import { computeReadiness } from '../readiness'
import { executeAction, executeRead } from '../tools/registry'
import type { ReadQuery } from '../tools/readTools'
import { generateWorkout, removeCardio, replaceExercise, restrictEquipment, scaleIntensity, shortenWorkout } from '../workoutGenerator'
import type { ToolCall, ToolCallErrorCode, ToolCallResult } from './contract'
import { resolveDate, resolveGoal, resolveMeal, resolveWorkout } from './resolve'
import { parseArguments } from './schema'
import { findToolDefinition } from './toolDefinitions'

/**
 * Model tools: the bridge between what a model may ask (small structured
 * arguments) and what Sportly executes (typed actions on full entities).
 *
 * Every call goes through, in order:
 *   1. allowlist (the tool exists in toolDefinitions)
 *   2. schema validation (parseArguments: coercion, unknown keys dropped)
 *   3. reference resolution (ids, dates, “the one we are discussing”)
 *   4. materialisation (Sportly's generators build the entity)
 *   5. execution through the registry (domain validation, idempotency, audit)
 *   6. a factual result read back from the store
 *
 * The model has authority over none of these steps.
 */

export interface ToolRunContext {
  conversation?: Conversation
  now?: Date
}

export interface ToolRunOutcome {
  result: ToolCallResult
  records: ActionRecord[]
  contextPatch?: Partial<Conversation['context']>
  cards?: CoachCard[]
}

type Args = Record<string, unknown>

interface Materialised {
  actions: CoachAction[]
  /** Read the real outcome back once the actions ran. */
  after: (state: AppState, records: ActionRecord[]) => unknown
  contextPatch?: Partial<Conversation['context']>
  cards?: CoachCard[]
}

interface Refusal {
  error: { code: ToolCallErrorCode; message: string; candidates?: EntityRef[] }
}

type Handler = (args: Args, state: AppState, ctx: { now: Date; conversation?: Conversation }) => Materialised | Refusal

const refuse = (code: ToolCallErrorCode, message: string, candidates?: EntityRef[]): Refusal => ({ error: { code, message, candidates } })
const isRefusal = (x: Materialised | Refusal): x is Refusal => 'error' in x

const workoutCard = (w: Workout): CoachCard => ({ id: uid('card'), type: 'workout', refId: w.id, title: w.title, subtitle: `${w.estimatedMinutes} min · ${w.exercises.length} exercises` })

function workoutDetail(state: AppState, workoutId: string) {
  const r = executeRead({ tool: 'get_workout', workoutId })
  return r.ok ? r.data : workoutSnapshot(state.workouts[workoutId])
}

function mealSummary(state: AppState, mealId: string) {
  const m = state.meals[mealId]
  if (!m) return { deleted: true, id: mealId }
  const daily = selectDailyNutrition(state, m.date)
  return {
    id: m.id,
    name: m.name,
    date: m.date,
    slot: m.slot,
    status: m.status,
    calories: m.calories,
    proteinG: m.proteinG,
    carbsG: m.carbsG,
    fatG: m.fatG,
    items: m.items.map((i) => ({ name: i.name, grams: i.grams, calories: i.calories, proteinG: i.proteinG })),
    remainingToday: daily.remaining,
  }
}

const str = (a: Args, k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined)
const numv = (a: Args, k: string) => (typeof a[k] === 'number' ? (a[k] as number) : undefined)
const boolv = (a: Args, k: string) => (typeof a[k] === 'boolean' ? (a[k] as boolean) : undefined)
const arr = <T = string>(a: Args, k: string) => (Array.isArray(a[k]) ? (a[k] as T[]) : undefined)

/* ------------------------------------------------------------------ Action handlers */

const HANDLERS: Record<string, Handler> = {
  plan_workout: (a, s, ctx) => {
    const date = resolveDate(str(a, 'date') ?? 'today', ctx.now)
    if (!date) return refuse('invalid_input', `“${str(a, 'date')}” is not a date I can read.`)
    if (date < dayKey(ctx.now)) return refuse('invalid_input', 'Workouts can only be planned for today or later.')
    const workouts = Object.values(s.workouts)
    const constraints = { minutes: numv(a, 'minutes'), equipment: arr<EquipmentId>(a, 'equipment'), noCardio: boolv(a, 'noCardio'), focus: str(a, 'focus') as WorkoutFocus | undefined, intensity: str(a, 'intensity') as 'light' | 'moderate' | 'hard' | undefined }
    const existing = workouts.find((w) => w.scheduledFor === date && w.status === 'planned')
    const today = dayKey(ctx.now)
    const readiness = date === today ? computeReadiness(s.checkIns[today], workouts, today, s.user!.sleepHoursTypical) : undefined
    const gen = generateWorkout({ user: s.user!, goals: s.goals, history: workouts, readiness: readiness?.recommendation === 'rest' ? { ...readiness, recommendation: 'lighter' } : readiness, constraints, date, seed: `${date}-${workouts.length}-${JSON.stringify(constraints)}` })
    return {
      actions: [{ type: 'create_workout', workout: gen, replaceWorkoutId: existing?.id }],
      after: (st) => workoutDetail(st, gen.id),
      contextPatch: { lastWorkoutId: gen.id, topic: 'workout' },
      cards: [workoutCard(gen)],
    }
  },

  modify_workout: (a, s, ctx) => {
    const r = resolveWorkout({ workoutId: str(a, 'workoutId'), when: str(a, 'when') }, s, { statuses: ['planned', 'in_progress'], now: ctx.now, conversation: ctx.conversation, verb: 'changed' })
    if (!r.ok) return { error: r.error }
    const w = r.value
    const workouts = Object.values(s.workouts)
    const change = str(a, 'change')
    const base = { user: s.user!, goals: s.goals, history: workouts, date: w.scheduledFor }
    const keepId = (gen: Workout, note: string): Workout => ({ ...gen, id: w.id, createdAt: w.createdAt, history: [...(w.history ?? []), note] })
    let next: Workout
    switch (change) {
      case 'shorter':
        next = shortenWorkout(w, numv(a, 'minutes') ?? Math.max(20, Math.round((w.estimatedMinutes - 15) / 5) * 5))
        break
      case 'longer': {
        const minutes = numv(a, 'minutes') ?? w.estimatedMinutes + 15
        next = keepId(generateWorkout({ ...base, constraints: { ...(w.constraints ?? {}), focus: w.focus, minutes }, seed: `${w.id}-longer` }), `Extended to ${minutes} min`)
        break
      }
      case 'lighter':
      case 'harder':
        next = scaleIntensity(w, change)
        break
      case 'no_cardio':
        next = removeCardio(w)
        break
      case 'equipment': {
        const eq = arr<EquipmentId>(a, 'equipment')
        if (!eq?.length) return refuse('invalid_input', 'equipment is required for an equipment change.')
        next = restrictEquipment(w, eq, s.user!, workouts)
        break
      }
      case 'replace_exercise': {
        const q = (str(a, 'exercise') ?? '').toLowerCase()
        const target = q ? w.exercises.find((e) => e.name.toLowerCase().includes(q) || q.includes(e.name.toLowerCase().split(' ')[0])) : undefined
        if (!target) return refuse('invalid_input', `Which exercise? ${w.title} has ${w.exercises.map((e) => e.name).join(', ')}.`)
        const rep = replaceExercise(w, target.exerciseId, s.user!, workouts)
        if (!rep.replacedWith) return refuse('conflict', `No good substitute for ${rep.original.name} with the user's equipment.`)
        next = rep.workout
        break
      }
      case 'focus': {
        const focus = str(a, 'focus') as WorkoutFocus | undefined
        if (!focus) return refuse('invalid_input', 'focus is required for a focus change.')
        next = keepId(generateWorkout({ ...base, constraints: { ...(w.constraints ?? {}), focus }, seed: `${w.id}-${focus}` }), `Changed focus to ${focus}`)
        break
      }
      default:
        next = keepId(generateWorkout({ ...base, constraints: w.constraints, seed: `${w.id}-regen-${Date.now()}` }), 'Regenerated')
    }
    return { actions: [{ type: 'update_workout', workout: next }], after: (st) => workoutDetail(st, w.id), contextPatch: { lastWorkoutId: w.id, topic: 'workout' }, cards: [workoutCard(next)] }
  },

  reschedule_workout: (a, s, ctx) => {
    const r = resolveWorkout({ workoutId: str(a, 'workoutId'), when: str(a, 'when') }, s, { statuses: ['planned'], now: ctx.now, conversation: ctx.conversation, verb: 'moved' })
    if (!r.ok) return { error: r.error }
    const toDate = resolveDate(str(a, 'toDate'), ctx.now)
    if (!toDate) return refuse('invalid_input', `“${str(a, 'toDate')}” is not a date I can read.`)
    if (toDate < dayKey(ctx.now)) return refuse('invalid_input', 'A workout can only be moved to today or later.')
    const clash = Object.values(s.workouts).find((w) => w.id !== r.value.id && w.scheduledFor === toDate && w.status === 'planned')
    if (clash) return refuse('conflict', `${weekdayName(fromDayKey(toDate))} already has ${clash.title} planned. Ask whether to move that one too, or pick another day.`, [{ type: 'workout', id: clash.id, label: clash.title }])
    return { actions: [{ type: 'reschedule_workout', workoutId: r.value.id, toDate }], after: (st) => workoutDetail(st, r.value.id), contextPatch: { lastWorkoutId: r.value.id, topic: 'calendar' } }
  },

  skip_workout: (a, s, ctx) => {
    const r = resolveWorkout({ workoutId: str(a, 'workoutId'), when: str(a, 'when') }, s, { statuses: ['planned', 'in_progress'], now: ctx.now, conversation: ctx.conversation, verb: 'skipped' })
    if (!r.ok) return { error: r.error }
    return { actions: [{ type: 'skip_workout', workoutId: r.value.id }], after: (st) => workoutSnapshot(st.workouts[r.value.id]), contextPatch: { topic: 'calendar' } }
  },

  complete_workout: (a, s, ctx) => {
    const r = resolveWorkout({ workoutId: str(a, 'workoutId'), when: str(a, 'when') }, s, { statuses: ['planned', 'in_progress', 'completed'], now: ctx.now, conversation: ctx.conversation, verb: 'completed' })
    if (!r.ok) return { error: r.error }
    return { actions: [{ type: 'complete_workout', workoutId: r.value.id }], after: (st) => ({ ...workoutSnapshot(st.workouts[r.value.id]), summary: st.workouts[r.value.id]?.summary }), contextPatch: { lastWorkoutId: r.value.id, topic: 'workout' } }
  },

  delete_workout: (a, s, ctx) => {
    const r = resolveWorkout({ workoutId: str(a, 'workoutId'), when: str(a, 'when') }, s, { statuses: ['planned'], now: ctx.now, conversation: ctx.conversation, verb: 'deleted' })
    if (!r.ok) return { error: r.error }
    const w = r.value
    return { actions: [{ type: 'remove_workout', workoutId: w.id }], after: () => ({ deleted: true, id: w.id, title: w.title, date: w.scheduledFor }), contextPatch: { lastWorkoutId: undefined, topic: 'calendar' } }
  },

  plan_week: (a, s, ctx) => {
    const user = s.user!
    const count = numv(a, 'count')
    let days = arr<number>(a, 'days')
    if (!days?.length) {
      const wanted = count ?? user.availability.daysPerWeek
      days = [...user.availability.preferredDays]
      for (const d of [1, 3, 5, 2, 4, 6, 0]) if (days.length < wanted && !days.includes(d)) days.push(d)
      days = days.slice(0, wanted)
    }
    const workouts = Object.values(s.workouts)
    const created: Workout[] = []
    const week: Array<{ date: string; id: string; title: string; existing: boolean }> = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(ctx.now, i)
      const key = dayKey(d)
      if (!days.includes(d.getDay())) continue
      if (count !== undefined && week.length >= count) break
      const existing = workouts.find((w) => w.scheduledFor === key && w.status !== 'skipped')
      if (existing) {
        week.push({ date: key, id: existing.id, title: existing.title, existing: true })
        continue
      }
      const gen = generateWorkout({ user, goals: s.goals, history: [...workouts, ...created.map((c) => ({ ...c, status: 'completed' as const, completedAt: c.scheduledFor }))], date: key, seed: `${key}-week`, constraints: {} })
      created.push(gen)
      week.push({ date: key, id: gen.id, title: gen.title, existing: false })
    }
    return { actions: created.map((w) => ({ type: 'create_workout', workout: w }) as CoachAction), after: () => ({ sessions: week }), contextPatch: { topic: 'calendar' } }
  },

  create_program: (a, s) => {
    const weeks = numv(a, 'weeks')
    if (!weeks) return refuse('invalid_input', 'weeks is required.')
    const program = generateProgram({ user: s.user!, goals: s.goals, history: Object.values(s.workouts), weeks, daysPerWeek: numv(a, 'daysPerWeek'), goalType: str(a, 'goal') as GoalType | undefined })
    const { workouts, events } = materializeProgram(program, s.user!, s.goals, Object.values(s.workouts))
    const active = Object.values(s.programs).find((p) => p.status === 'active')
    return {
      actions: [{ type: 'create_program', program, workouts, events, replaceProgramId: active?.id }],
      after: () => {
        const r = executeRead({ tool: 'get_program' })
        return r.ok ? r.data : { id: program.id, name: program.name }
      },
      contextPatch: { lastProgramId: program.id, topic: 'program' },
      cards: [{ id: uid('card'), type: 'program', refId: program.id, title: program.name, subtitle: `${program.weeks} weeks · ${program.daysPerWeek} days/week` }],
    }
  },

  cancel_program: (_a, s) => {
    const active = Object.values(s.programs).find((p) => p.status === 'active')
    if (!active) return refuse('not_found', 'There is no active program.')
    return { actions: [{ type: 'cancel_program', programId: active.id }], after: () => ({ cancelled: true, id: active.id, name: active.name }), contextPatch: { topic: 'program' } }
  },

  plan_nutrition: (a, s, ctx) => {
    const today = dayKey(ctx.now)
    const tw = Object.values(s.workouts).find((w) => w.scheduledFor === today && w.status !== 'skipped')
    const restaurantDinner = boolv(a, 'restaurantDinner')
    const lowerCarb = boolv(a, 'lowerCarb')
    const plan = generateNutritionPlan({ user: s.user!, goals: s.goals, isTrainingDay: Boolean(tw), restaurantDinner, lowerCarb, seed: `${today}-${s.user!.id}-${restaurantDinner ? 'rest' : ''}${lowerCarb ? 'lc' : ''}` })
    return {
      actions: [{ type: 'create_nutrition_plan', plan }],
      after: () => ({ id: plan.id, date: plan.date, calories: plan.calories, proteinG: plan.proteinG, carbsG: plan.carbsG, fatG: plan.fatG, isTrainingDay: plan.isTrainingDay, meals: plan.meals.map((m) => ({ slot: m.slot, name: m.name, calories: m.calories, proteinG: m.proteinG })), rationale: plan.rationale }),
      contextPatch: { lastNutritionPlanId: plan.id, topic: 'nutrition' },
      cards: [{ id: uid('card'), type: 'nutrition', refId: plan.id, title: 'Today’s nutrition', subtitle: `${plan.calories.toLocaleString()} kcal · ${plan.proteinG} g protein` }],
    }
  },

  log_meal: (a, _s, ctx) => {
    const description = str(a, 'description') ?? ''
    const analysis = analyzeDescription(description)
    if (!analysis.items.length) return refuse('invalid_input', analysis.notes[0] ?? 'I could not recognise any food in that description.')
    const date = resolveDate(str(a, 'date') ?? 'today', ctx.now)
    if (!date) return refuse('invalid_input', `“${str(a, 'date')}” is not a date I can read.`)
    if (date > dayKey(ctx.now)) return refuse('invalid_input', 'A meal cannot be logged for a future day.')
    const meal = buildMeal(analysis, { date, slot: (str(a, 'slot') as ReturnType<typeof slotForTime> | undefined) ?? slotForTime(ctx.now), source: 'text', status: 'logged' })
    return { actions: [{ type: 'log_meal', meal }], after: (st) => mealSummary(st, meal.id), contextPatch: { lastMealId: meal.id, topic: 'nutrition' }, cards: [{ id: uid('card'), type: 'food', refId: meal.id, title: meal.name, subtitle: `${meal.calories} kcal · ${meal.proteinG} g protein` }] }
  },

  update_meal: (a, s, ctx) => {
    const r = resolveMeal({ mealId: str(a, 'mealId') }, s, ctx.conversation, ctx.now)
    if (!r.ok) return { error: r.error }
    let meal = r.value
    const failures: string[] = []
    let applied = 0
    for (const c of arr<Args>(a, 'corrections') ?? []) {
      const correction = toCorrection(c)
      if (!correction) {
        failures.push(`Correction ${JSON.stringify(c)} is incomplete.`)
        continue
      }
      const res = applyCorrection(meal, correction)
      if (res.applied) {
        meal = res.meal
        applied++
      } else failures.push(res.summary)
    }
    const slot = str(a, 'slot') as typeof meal.slot | undefined
    if (slot && slot !== meal.slot) {
      meal = { ...meal, slot, updatedAt: new Date().toISOString() }
      applied++
    }
    if (boolv(a, 'confirm') && meal.status !== 'logged') {
      meal = { ...meal, status: 'logged', updatedAt: new Date().toISOString() }
      applied++
    }
    if (!applied) return refuse('invalid_input', failures[0] ?? 'Nothing to change: give corrections, a slot or confirm.')
    return { actions: [{ type: 'update_meal', meal }], after: (st) => ({ ...(mealSummary(st, meal.id) as object), notApplied: failures }), contextPatch: { lastMealId: meal.id, topic: 'nutrition' } }
  },

  delete_meal: (a, s, ctx) => {
    const r = resolveMeal({ mealId: str(a, 'mealId') }, s, ctx.conversation, ctx.now)
    if (!r.ok) return { error: r.error }
    return { actions: [{ type: 'delete_meal', mealId: r.value.id }], after: (st) => ({ deleted: true, id: r.value.id, name: r.value.name, remainingToday: selectDailyNutrition(st, dayKey(ctx.now)).remaining }), contextPatch: { lastMealId: undefined, topic: 'nutrition' } }
  },

  set_goal: (a, s, ctx) => {
    const type = str(a, 'goal') as GoalType | undefined
    if (!type || !(type in GOAL_LABELS)) return refuse('invalid_input', 'goal must be a known goal type.')
    const rank = (str(a, 'rank') as Goal['rank'] | undefined) ?? 'primary'
    const metric = str(a, 'metric') as Goal['metric'] | undefined
    const target = numv(a, 'target')
    if (metric && target === undefined) return refuse('invalid_input', 'A metric needs a target value.')
    const existing = rank === 'primary' ? s.goals.find((g) => g.rank === 'primary') : s.goals.find((g) => g.rank === 'secondary' && g.type === type)
    const goal: Goal = {
      id: existing?.id ?? uid('goal'),
      type,
      rank,
      label: GOAL_LABELS[type],
      metric: metric ?? (existing?.type === type ? existing.metric : undefined),
      targetValue: target ?? (existing?.type === type ? existing.targetValue : undefined),
      targetUnit: metric === 'workouts_per_week' ? '/week' : metric === 'steps_per_day' ? 'steps' : metric ? 'kg' : existing?.type === type ? existing.targetUnit : undefined,
      startValue: metric === 'body_weight' ? s.user!.weightKg : existing?.startValue,
      createdAt: existing?.createdAt ?? ctx.now.toISOString(),
    }
    const summary = `${GOAL_LABELS[type]}${goal.targetValue ? ` (target ${goal.targetValue} ${goal.targetUnit ?? ''})`.replace(/\s+\)/, ')') : ''}`
    return {
      actions: [
        { type: 'set_goal', goal },
        { type: 'remember', item: { category: 'goal', text: `${rank === 'primary' ? 'Primary' : 'Secondary'} goal: ${summary}`, source: 'conversation' } },
      ],
      after: (st) => {
        const g = st.goals.find((x) => x.id === goal.id)
        return g ? goalSnapshot(g, st) : { id: goal.id }
      },
      contextPatch: { lastGoalId: goal.id, topic: 'goal' },
      cards: [{ id: uid('card'), type: 'goal', refId: goal.id, title: goal.label, subtitle: goal.targetValue ? `Target ${goal.targetValue} ${goal.targetUnit ?? ''}`.trim() : `${rank} goal` }],
    }
  },

  delete_goal: (a, s) => {
    const r = resolveGoal({ goalId: str(a, 'goalId') }, s)
    if (!r.ok) return { error: r.error }
    return { actions: [{ type: 'delete_goal', goalId: r.value.id }], after: (st) => ({ deleted: true, id: r.value.id, label: r.value.label, remainingGoals: st.goals.map((g) => ({ id: g.id, type: g.type, rank: g.rank })) }), contextPatch: { topic: 'goal' } }
  },

  check_in: (a) => {
    const patch = { fatigue: numv(a, 'fatigue'), energy: numv(a, 'energy'), sleepHours: numv(a, 'sleepHours'), soreness: numv(a, 'soreness'), mood: str(a, 'mood') as 'low' | 'ok' | 'good' | 'great' | undefined }
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    if (!Object.keys(clean).length) return refuse('invalid_input', 'Give at least one of fatigue, energy, sleepHours, soreness or mood.')
    if (clean.fatigue !== undefined && clean.energy === undefined) clean.energy = Math.min(10, Math.max(1, 11 - (clean.fatigue as number)))
    return {
      actions: [{ type: 'check_in', patch: clean }],
      after: () => {
        const r = executeRead({ tool: 'get_readiness' })
        return r.ok ? r.data : clean
      },
      contextPatch: { topic: 'recovery' },
    }
  },

  log_measurement: (a, _s, ctx) => {
    const type = str(a, 'type') as 'body_weight' | 'body_fat' | 'waist' | 'sleep_hours' | 'steps' | undefined
    const value = numv(a, 'value')
    if (!type || value === undefined) return refuse('invalid_input', 'type and value are required.')
    const date = resolveDate(str(a, 'date') ?? 'today', ctx.now)
    if (!date) return refuse('invalid_input', `“${str(a, 'date')}” is not a date I can read.`)
    const unit = str(a, 'unit') ?? { body_weight: 'kg', body_fat: '%', waist: 'cm', sleep_hours: 'h', steps: 'steps' }[type]
    return {
      actions: [{ type: 'log_measurement', measurement: { type, value, unit, date, source: 'coach' } }],
      after: (st) => ({ type, value, unit, date, profileWeightKg: st.user?.weightKg, trend: buildContextSnapshot(st, undefined, ctx.now).progress.weight }),
      contextPatch: { topic: 'progress' },
    }
  },

  update_availability: (a, s) => {
    const user = s.user!
    let days = arr<number>(a, 'preferredDays')
    if (days) days = [...new Set(days)]
    const wanted = numv(a, 'daysPerWeek') ?? days?.length
    if (days?.length && wanted !== undefined && days.length !== wanted) return refuse('invalid_input', `preferredDays lists ${days.length} days but daysPerWeek is ${wanted}; make them agree.`)
    if (!days?.length && wanted !== undefined) {
      days = [...user.availability.preferredDays]
      for (const d of [1, 3, 5, 2, 4, 6, 0]) if (days.length < wanted && !days.includes(d)) days.push(d)
      days = days.slice(0, wanted).sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7))
    }
    const patch = { daysPerWeek: wanted, preferredDays: days ? [...new Set(days)] : undefined, sessionMinutes: numv(a, 'sessionMinutes') }
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    if (!Object.keys(clean).length) return refuse('invalid_input', 'Give daysPerWeek, preferredDays or sessionMinutes.')
    const actions: CoachAction[] = [{ type: 'update_availability', patch: clean }]
    if (days) actions.push({ type: 'remember', item: { category: 'availability', text: `Trains ${days.length} day${days.length === 1 ? '' : 's'} a week: ${days.map((d) => weekdayName(new Date(2024, 0, 7 + d), true)).join(', ')}`, source: 'conversation' } })
    return { actions, after: (st) => ({ ...st.user!.availability }), contextPatch: { lastAvailabilityScope: 'always', topic: 'calendar' } }
  },

  update_profile: (a) => {
    const patch = {
      weightKg: numv(a, 'weightKg'),
      equipment: arr<EquipmentId>(a, 'equipment'),
      diet: str(a, 'diet') as 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian' | undefined,
      dislikedExercises: arr<string>(a, 'dislikedExercises'),
      dislikedFoods: arr<string>(a, 'dislikedFoods'),
      trainsAt: str(a, 'trainsAt') as 'gym' | 'home' | 'both' | undefined,
    }
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    if (!Object.keys(clean).length) return refuse('invalid_input', 'Nothing to update.')
    return { actions: [{ type: 'update_user', patch: clean }], after: (st) => Object.fromEntries(Object.keys(clean).map((k) => [k, (st.user as unknown as Args)[k]])) }
  },

  save_memory: (a) => {
    const text = (str(a, 'text') ?? '').trim()
    if (!text) return refuse('invalid_input', 'text is required.')
    const category = (str(a, 'category') as MemoryCategory | undefined) ?? categorizeMemory(text)
    return {
      actions: [{ type: 'remember', item: { category, text: text.charAt(0).toUpperCase() + text.slice(1), source: 'conversation' } }],
      after: (st, records) => {
        const saved = records.flatMap((r) => r.changes).find((c) => c.type === 'MEMORY_SAVED')
        const m = saved ? st.memory.find((x) => x.id === saved.entity.id) : undefined
        const replaced = records.flatMap((r) => r.changes).filter((c) => c.type === 'MEMORY_REMOVED').map((c) => c.entity.label)
        return m ? { id: m.id, text: m.text, category: m.category, persistence: m.persistence, expiresAt: m.expiresAt, replaced } : { alreadyKnown: true, replaced }
      },
    }
  },

  forget_memory: (a, s) => {
    const idv = str(a, 'memoryId')
    const q = (str(a, 'text') ?? '').toLowerCase()
    const m = idv ? s.memory.find((x) => x.id === idv) : q ? s.memory.find((x) => x.text.toLowerCase().includes(q) || q.includes(x.text.toLowerCase())) : undefined
    if (!m) return refuse('not_found', idv ? `No memory with id ${idv}.` : 'No memory matches that text.')
    return { actions: [{ type: 'forget', memoryId: m.id }], after: () => ({ deleted: true, id: m.id, text: m.text }) }
  },

  move_event: (a, s, ctx) => {
    const eventId = str(a, 'eventId') ?? ''
    const ev = s.events.find((e) => e.id === eventId)
    if (!ev) return refuse('not_found', `No calendar entry with id ${eventId}.`)
    const toDate = resolveDate(str(a, 'toDate'), ctx.now)
    if (!toDate) return refuse('invalid_input', `“${str(a, 'toDate')}” is not a date I can read.`)
    if (ev.workoutId) {
      const clash = Object.values(s.workouts).find((w) => w.id !== ev.workoutId && w.scheduledFor === toDate && w.status === 'planned')
      if (clash) return refuse('conflict', `${weekdayName(fromDayKey(toDate))} already has ${clash.title} planned.`, [{ type: 'workout', id: clash.id, label: clash.title }])
    }
    return { actions: [{ type: 'move_event', eventId: ev.id, toDate }], after: (st) => eventLite(st.events.find((e) => e.id === ev.id)), contextPatch: { lastEventId: ev.id, topic: 'calendar' } }
  },

  create_event: (a, _s, ctx) => {
    const date = resolveDate(str(a, 'date'), ctx.now)
    if (!date) return refuse('invalid_input', `“${str(a, 'date')}” is not a date I can read.`)
    const event: CalendarEvent = { id: uid('evt'), type: (str(a, 'type') as CalendarEvent['type'] | undefined) ?? 'note', date, title: str(a, 'title') ?? 'Note', status: 'planned', createdAt: ctx.now.toISOString() }
    return { actions: [{ type: 'create_event', event }], after: (st) => eventLite(st.events.find((e) => e.id === event.id)), contextPatch: { lastEventId: event.id, topic: 'calendar' } }
  },

  delete_event: (a, s) => {
    const eventId = str(a, 'eventId') ?? ''
    const ev = s.events.find((e) => e.id === eventId)
    if (!ev) return refuse('not_found', `No calendar entry with id ${eventId}.`)
    return { actions: [{ type: 'delete_event', eventId: ev.id }], after: () => ({ deleted: true, id: ev.id, title: ev.title, date: ev.date }), contextPatch: { topic: 'calendar' } }
  },

  update_coach: (a, s) => {
    const dials = { motivation: numv(a, 'motivation'), tone: numv(a, 'tone'), humor: numv(a, 'humor'), communication: numv(a, 'communication') }
    const dialPatch = Object.fromEntries(Object.entries(dials).filter(([, v]) => v !== undefined))
    const patch: Partial<AppState['coach']> = {}
    const name = str(a, 'name')?.trim()
    if (name) patch.name = name
    if (Object.keys(dialPatch).length) patch.personality = { ...s.coach.personality, ...dialPatch }
    if (!Object.keys(patch).length) return refuse('invalid_input', 'Give a name or at least one personality dial.')
    return { actions: [{ type: 'update_coach', patch }], after: (st) => ({ name: st.coach.name, personality: st.coach.personality }) }
  },

  notify: (a) => {
    const title = str(a, 'title') ?? ''
    const body = str(a, 'body') ?? ''
    if (!title) return refuse('invalid_input', 'title is required.')
    return { actions: [{ type: 'notify', title, body }], after: () => ({ sent: true, title }) }
  },
}

function eventLite(e: CalendarEvent | undefined) {
  return e ? { id: e.id, date: e.date, title: e.title, type: e.type, status: e.status, workoutId: e.workoutId, movedFrom: e.movedFrom } : { deleted: true }
}

function toCorrection(c: Args): MealCorrection | undefined {
  const type = str(c, 'type')
  const food = str(c, 'food')
  switch (type) {
    case 'scale':
      return numv(c, 'factor') !== undefined ? { type: 'scale', factor: numv(c, 'factor')! } : undefined
    case 'more':
    case 'less':
      return food ? { type, food, factor: numv(c, 'factor') } : undefined
    case 'remove':
      return food ? { type: 'remove', food } : undefined
    case 'set_grams':
      return food && numv(c, 'grams') !== undefined ? { type: 'set_grams', food, grams: numv(c, 'grams')! } : undefined
    case 'set_count':
      return food && numv(c, 'count') !== undefined ? { type: 'set_count', food, count: numv(c, 'count')! } : undefined
    case 'add':
      return str(c, 'text') ? { type: 'add', text: str(c, 'text')! } : undefined
    default:
      return undefined
  }
}

/* ------------------------------------------------------------------ Read dispatch */

function toReadQuery(name: string, a: Args, now: Date): ReadQuery | Refusal {
  const d = (k: string) => {
    const v = str(a, k)
    if (v === undefined) return undefined
    const r = resolveDate(v, now)
    return r ?? null
  }
  switch (name) {
    case 'get_day': {
      const date = d('date')
      if (!date) return refuse('invalid_input', 'date must be YYYY-MM-DD, today, tomorrow or a weekday.')
      return { tool: 'get_day', date }
    }
    case 'get_nutrition': {
      const date = d('date')
      if (date === null) return refuse('invalid_input', 'date is not readable.')
      return { tool: 'get_nutrition', date: date ?? undefined }
    }
    case 'get_calendar': {
      const from = d('from')
      const to = d('to')
      if (from === null || to === null) return refuse('invalid_input', 'from/to are not readable dates.')
      return { tool: 'get_calendar', from: from ?? undefined, to: to ?? undefined }
    }
    case 'get_goal':
      return { tool: 'get_goal', goalId: str(a, 'goalId') }
    case 'get_workout':
      return { tool: 'get_workout', workoutId: str(a, 'workoutId') }
    case 'get_recent_workouts':
      return { tool: 'get_recent_workouts', limit: numv(a, 'limit') }
    case 'get_memory':
      return { tool: 'get_memory', category: str(a, 'category') as MemoryCategory | undefined }
    case 'search_knowledge':
      return { tool: 'search_knowledge', query: str(a, 'query') ?? '', limit: numv(a, 'limit') }
    default:
      return { tool: name } as ReadQuery
  }
}

/* ------------------------------------------------------------------ Entry point */

/** Identical model calls inside this window are answered from the first result, not re-run. */
const REPEAT_WINDOW_MS = 8_000
const recent = new Map<string, { at: number; outcome: ToolRunOutcome }>()

export function resetModelToolLedger(): void {
  recent.clear()
}

/** Turn whatever a provider handed us into a well-formed call (or null). */
export function normalizeToolCall(raw: unknown, index = 0): ToolCall | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name : typeof r.toolName === 'string' ? r.toolName : typeof r.tool === 'string' ? r.tool : undefined
  if (!name) return null
  let args: unknown = r.arguments ?? r.input ?? r.args ?? {}
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      args = {}
    }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {}
  const id = typeof r.id === 'string' && r.id ? r.id : `call_${index}_${uid('')}`
  return { id, name, arguments: args as Args }
}

/** Run one model tool call end to end. Never throws; the outcome says exactly what happened. */
export function runToolCall(call: ToolCall, ctx: ToolRunContext = {}): ToolRunOutcome {
  const now = ctx.now ?? new Date()
  const failure = (code: ToolCallErrorCode, message: string, candidates?: EntityRef[]): ToolRunOutcome => ({
    result: { toolCallId: call.id, name: call.name, ok: false, error: { code, message, candidates }, affectedEntities: [], changes: [] },
    records: [],
  })

  // 1. allowlist
  const def = findToolDefinition(call.name)
  if (!def) return failure('unknown_tool', `“${call.name}” is not a Sportly tool.`)

  // 2. schema
  const parsed = parseArguments(def.inputSchema, call.arguments)
  if (!parsed.ok) return failure('invalid_arguments', `Invalid arguments for ${call.name}: ${parsed.errors.join('; ')}.`)
  const args = parsed.value

  // Reads: straight to the registry, no side effects, no ledger.
  if (def.kind === 'read') {
    const q = toReadQuery(call.name, args, now)
    if ('error' in q) return failure(q.error.code, q.error.message)
    const r = executeRead(q)
    return r.ok
      ? { result: { toolCallId: call.id, name: call.name, ok: true, data: r.data, affectedEntities: [], changes: [] }, records: [] }
      : failure(r.error.code, r.error.message, r.error.candidates)
  }

  // Repeated identical request: same answer, no second execution.
  const key = `${call.name}:${hashString(JSON.stringify(args))}`
  const seen = recent.get(key)
  if (seen && now.getTime() - seen.at < REPEAT_WINDOW_MS && seen.outcome.result.ok) {
    return { ...seen.outcome, result: { ...seen.outcome.result, toolCallId: call.id }, records: [] }
  }

  // 3–4. resolve and materialise
  const handler = HANDLERS[call.name]
  if (!handler) return failure('unknown_tool', `“${call.name}” has no executor.`)
  const state = useStore.getState()
  if (!state.user) return failure('not_allowed', 'No profile yet: onboarding has not completed.')
  let plan: Materialised | Refusal
  try {
    plan = handler(args, state, { now, conversation: ctx.conversation })
  } catch (err) {
    return failure('failed', err instanceof Error ? err.message : 'Could not prepare that action.')
  }
  if (isRefusal(plan)) return failure(plan.error.code, plan.error.message, plan.error.candidates)

  // 5. execute through the registry, stopping at the first failure
  const records: ActionRecord[] = []
  let failed: ActionRecord | undefined
  for (const action of plan.actions) {
    const record = executeAction(action, { source: 'coach', toolCallId: call.id, via: call.name, arguments: args })
    records.push(record)
    if (!record.ok) {
      failed = record
      break
    }
  }
  const changes: DomainChange[] = records.flatMap((r) => r.changes)
  const affected: EntityRef[] = []
  for (const c of changes) if (!affected.some((e) => e.type === c.entity.type && e.id === c.entity.id)) affected.push(c.entity)
  if (failed) {
    return {
      result: { toolCallId: call.id, name: call.name, ok: false, error: { code: (failed.error as ToolCallErrorCode) ?? 'failed', message: failed.summary }, affectedEntities: affected, changes },
      records,
    }
  }

  // 6. factual result from the store after execution
  const after = useStore.getState()
  let data: unknown
  try {
    data = plan.after(after, records)
  } catch {
    data = { ok: true }
  }
  const outcome: ToolRunOutcome = {
    result: { toolCallId: call.id, name: call.name, ok: true, data, affectedEntities: affected, changes },
    records,
    contextPatch: plan.contextPatch,
    cards: plan.cards,
  }
  recent.set(key, { at: now.getTime(), outcome })
  if (recent.size > 100) for (const [k, v] of recent) if (now.getTime() - v.at > REPEAT_WINDOW_MS) recent.delete(k)
  return outcome
}

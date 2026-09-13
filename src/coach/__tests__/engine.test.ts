import { describe, expect, it } from 'vitest'
import { buildDemoSeed } from '@/domain/demo'
import { parseIntent } from '@/coach/intents'
import { LocalCoachProvider } from '@/coach/localProvider'
import type { CoachContext } from '@/coach/provider'
import { computeReadiness } from '@/coach/readiness'
import { generateWorkout, shortenWorkout, restrictEquipment } from '@/coach/workoutGenerator'
import { generateProgram, materializeProgram } from '@/coach/programGenerator'
import { generateNutritionPlan } from '@/coach/nutritionGenerator'
import { generateInsights, consistencyStreak } from '@/coach/insights'
import { buildVoice } from '@/coach/personality'
import { buildContext } from '@/coach/coachService'
import { todayKey } from '@/lib/dates'
import { useStore } from '@/store/useStore'

const seed = buildDemoSeed()

const todayWorkout = (() => {
  const w = generateWorkout({ user: seed.user, goals: seed.goals, history: Object.values(seed.workouts), date: todayKey(), seed: 'test-today' })
  return w
})()

function ctx(overrides: Partial<CoachContext> = {}): CoachContext {
  // The real context builder over the real store, with the deterministic test workout as today's session.
  const workouts = [...Object.values(seed.workouts).filter((w) => w.scheduledFor !== todayKey()), todayWorkout]
  useStore.getState().seed({ ...seed, workouts: Object.fromEntries(workouts.map((w) => [w.id, w])), nutritionPlans: {} })
  const state = useStore.getState()
  const conversation = state.conversations[0]
  return {
    ...buildContext(state, conversation),
    readiness: computeReadiness(seed.checkIns[todayKey()], workouts),
    todayWorkout,
    contextWorkout: todayWorkout,
    activeProgram: undefined,
    todayNutrition: undefined,
    insights: [],
    targetPerWeek: 4,
    ...overrides,
  }
}

describe('demo seed', () => {
  it('builds a rich history', () => {
    const done = Object.values(seed.workouts).filter((w) => w.status === 'completed')
    expect(done.length).toBeGreaterThan(25)
    expect(seed.measurements.filter((m) => m.type === 'body_weight').length).toBeGreaterThan(30)
    expect(seed.conversations.length).toBe(4)
    expect(Object.values(seed.meals ?? {}).filter((m) => m.status === 'logged').length).toBeGreaterThanOrEqual(5)
    expect(seed.memory.length).toBeGreaterThan(8)
  })
  it('produces insights', () => {
    const insights = generateInsights({ workouts: Object.values(seed.workouts), measurements: seed.measurements, checkIns: seed.checkIns, goals: seed.goals, targetPerWeek: 4 })
    expect(insights.length).toBeGreaterThan(1)
    const streak = consistencyStreak(Object.values(seed.workouts), 4)
    expect(streak.current).toBeGreaterThanOrEqual(1)
  })
})

describe('intents', () => {
  it('parses core requests', () => {
    expect(parseIntent('What should I do today?', {}).kind).toBe('today_plan')
    expect(parseIntent("I'm tired", {}).kind).toBe('tired')
    expect(parseIntent('6', { expects: 'fatigue_scale' })).toEqual({ kind: 'scale_answer', value: 6 })
    expect(parseIntent('Make my workout', {}).kind).toBe('make_workout')
    expect(parseIntent('I only have 30 minutes', {})).toMatchObject({ kind: 'make_workout', constraints: { minutes: 30 } })
    expect(parseIntent('Make it shorter', { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'shorter' } })
    expect(parseIntent('I only have dumbbells', { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'equipment', equipment: ['dumbbell'] } })
    expect(parseIntent('Replace squats', { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'replace' } })
    expect(parseIntent("I don't want cardio today", { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'no_cardio' } })
    expect(parseIntent('Create me a 12-week muscle-building program', {})).toMatchObject({ kind: 'create_program', weeks: 12, goalType: 'build_muscle' })
    expect(parseIntent('What should I eat tonight?', {})).toMatchObject({ kind: 'nutrition', slot: 'dinner' })
    expect(parseIntent("I'm eating at a restaurant tonight", {}).kind).toBe('restaurant')
    expect(parseIntent('Analyze my progress', {}).kind).toBe('analyze_progress')
    expect(parseIntent('Why has my weight stopped moving?', {}).kind).toBe('weight_stalled')
    expect(parseIntent('Remember that I train at 7am', {})).toMatchObject({ kind: 'remember', text: 'I train at 7am' })
    expect(parseIntent('Move Monday to Wednesday', {})).toMatchObject({ kind: 'reschedule', from: 1, to: 3 })
    expect(parseIntent('Plan my week', {}).kind).toBe('plan_week')
    expect(parseIntent('My knee hurts a bit', {})).toMatchObject({ kind: 'pain', area: 'knee', severe: false })
    expect(parseIntent('Be more direct with me', {})).toMatchObject({ kind: 'personality', patch: { tone: 85 } })
    expect(parseIntent('I weighed 74.5 kg this morning', {})).toMatchObject({ kind: 'log_weight', kg: 74.5 })
    expect(parseIntent('My goal is to bench 100 kg', {})).toMatchObject({ kind: 'set_goal', metric: 'bench_press', target: 100 })
    expect(parseIntent('Start workout', {}).kind).toBe('start_workout')
    expect(parseIntent('Plan tomorrow', {})).toMatchObject({ kind: 'make_workout', constraints: { forDate: 'tomorrow' } })
    expect(parseIntent('Show my calendar', {}).kind).toBe('show_calendar')
    expect(parseIntent('Show me week 1', {}).kind).toBe('show_program')
    expect(parseIntent('Log my weight', {}).kind).toBe('log_weight_prompt')
    expect(parseIntent('74.4', { expects: 'weight_value' })).toMatchObject({ kind: 'log_weight', kg: 74.4 })
    expect(parseIntent('How did I do this week?', {}).kind).toBe('analyze_progress')
    expect(parseIntent('What should I order?', {}).kind).toBe('order_advice')
    expect(parseIntent('Rebuild my program around fat loss', {})).toMatchObject({ kind: 'create_program', goalType: 'lose_fat' })
    expect(parseIntent('Change my program to 3 days a week', {})).toMatchObject({ kind: 'create_program', daysPerWeek: 3 })
    expect(parseIntent('Bench 100 kg', { expects: 'goal_choice' })).toMatchObject({ kind: 'set_goal', metric: 'bench_press', target: 100 })
    expect(parseIntent('Build muscle', { expects: 'goal_choice' })).toMatchObject({ kind: 'set_goal', goalType: 'build_muscle' })
    expect(parseIntent('Chicken, rice and veg', { expects: 'meal_description' }).kind).toBe('meal_description')
    expect(parseIntent('Dumbbells and a bench', { expects: 'equipment_list' })).toMatchObject({ kind: 'equipment_list', equipment: ['dumbbell', 'bench'] })
    expect(parseIntent('Skip today', {}).kind).toBe('skip_workout')
    expect(parseIntent('Set a new goal', {}).kind).toBe('set_goal')
  })

  it('every suggestion chip the coach offers resolves to a real intent', async () => {
    const provider = new LocalCoachProvider()
    const c = ctx()
    const prompts = ['Make my workout', "I'm tired", 'Create me a 12-week muscle-building program', "I'm eating at a restaurant tonight", 'Analyze my progress', 'Plan my week', 'What should I eat today?']
    for (const p of prompts) {
      const r = await provider.respond({ text: p, attachments: [], context: c })
      for (const s of r.suggestions ?? []) {
        const next = parseIntent(s, { expects: r.expects, topic: r.contextPatch?.topic, hasWorkout: true })
        expect(next.kind, `"${s}" after "${p}"`).not.toBe('unknown')
      }
    }
  })
})

describe('generators', () => {
  it('generates a workout within time budget and equipment', () => {
    const w = generateWorkout({ user: seed.user, goals: seed.goals, history: Object.values(seed.workouts), constraints: { minutes: 30, equipment: ['dumbbell'] } })
    expect(w.exercises.length).toBeGreaterThanOrEqual(3)
    expect(w.estimatedMinutes).toBeLessThanOrEqual(36)
    // Strength work always has ≥2 sets; a steady conditioning finisher may be a single timed block.
    expect(w.exercises.every((e) => e.sets.length >= 2 || Boolean(e.sets[0]?.targetSeconds))).toBe(true)
  })
  it('shortens and restricts', () => {
    const w = generateWorkout({ user: seed.user, goals: seed.goals, history: Object.values(seed.workouts), constraints: { minutes: 60 } })
    const s = shortenWorkout(w, 30)
    expect(s.estimatedMinutes).toBeLessThanOrEqual(35)
    const r = restrictEquipment(w, ['bodyweight'], seed.user, Object.values(seed.workouts))
    expect(r.constraints?.equipment).toEqual(['bodyweight'])
  })
  it('generates a program and materialises it', () => {
    const p = generateProgram({ user: seed.user, goals: seed.goals, history: [], weeks: 12 })
    expect(p.weeksPlan.length).toBe(12)
    expect(p.weeksPlan[3].phase).toBe('deload')
    const m = materializeProgram(p, seed.user, seed.goals, [])
    expect(m.workouts.length).toBe(48)
    expect(m.events.length).toBe(48)
  })
  it('generates nutrition with sensible macros', () => {
    const n = generateNutritionPlan({ user: seed.user, goals: seed.goals, isTrainingDay: true })
    expect(n.calories).toBeGreaterThan(2000)
    expect(n.proteinG).toBeGreaterThan(130)
    expect(n.meals.length).toBe(5)
    const r = generateNutritionPlan({ user: seed.user, goals: seed.goals, isTrainingDay: false, restaurantDinner: true })
    expect(r.meals.some((m) => m.isRestaurant)).toBe(true)
  })
})

describe('local coach', () => {
  const provider = new LocalCoachProvider()
  it('answers today and builds workouts with actions', async () => {
    const c = ctx({ todayWorkout: undefined, contextWorkout: undefined })
    const r = await provider.respond({ text: 'Make my workout', attachments: [], context: c })
    expect(r.actions?.[0].type).toBe('create_workout')
    expect(r.cards?.[0].type).toBe('workout')
  })
  it('keeps fatigue context', async () => {
    const c = ctx()
    const r1 = await provider.respond({ text: "I'm tired", attachments: [], context: c })
    expect(r1.expects).toBe('fatigue_scale')
    const c2 = ctx({ history: [...c.history, { id: 'x', conversationId: c.conversation.id, role: 'coach', text: r1.text, expects: r1.expects, createdAt: new Date().toISOString() }] })
    const r2 = await provider.respond({ text: '6', attachments: [], context: c2 })
    expect(r2.actions?.some((a) => a.type === 'check_in')).toBe(true)
    expect(r2.actions?.some((a) => a.type === 'update_workout')).toBe(true)
  })
  it('modifies the workout in context', async () => {
    const c = ctx()
    const r = await provider.respond({ text: 'Make it shorter', attachments: [], context: c })
    expect(r.actions?.[0].type).toBe('update_workout')
  })
  it('creates a program', async () => {
    const r = await provider.respond({ text: 'Create me a 12-week muscle-building program', attachments: [], context: ctx() })
    expect(r.actions?.[0].type).toBe('create_program')
  })
  it('handles restaurant', async () => {
    const r = await provider.respond({ text: "I'm eating at a restaurant tonight", attachments: [], context: ctx() })
    expect(r.actions?.some((a) => a.type === 'create_nutrition_plan')).toBe(true)
  })
  it('personality changes the voice', () => {
    const intense = buildVoice({ motivation: 95, tone: 90, humor: 10, communication: 10 })
    const calm = buildVoice({ motivation: 5, tone: 10, humor: 90, communication: 90 })
    const parts = { core: 'Today is upper body.', reason: 'Because it is next in rotation.', soft: 'If you are up for it,', push: 'Go.', calm: 'Steady.', quip: 'Ha.' }
    const a = intense.compose(parts)
    const b = calm.compose(parts)
    expect(a).toContain('Go.')
    expect(a).not.toContain('Because')
    expect(b).toContain('Because')
    expect(b).toContain('Ha.')
    expect(b.startsWith('If you are up for it')).toBe(true)
  })
})

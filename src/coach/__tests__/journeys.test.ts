import { beforeEach, describe, expect, it } from 'vitest'
import { sendMessage, serviceOptions } from '@/coach/coachService'
import { buildContextSnapshot } from '@/coach/context'
import { parseIntent } from '@/coach/intents'
import { resetModelToolLedger } from '@/coach/model'
import type { CoachResponse } from '@/coach/provider'
import { resetActionLedger } from '@/coach/tools/registry'
import { buildDemoSeed } from '@/domain/demo'
import { addDays, dayKey, todayKey } from '@/lib/dates'
import { selectDailyNutrition } from '@/store/selectors'
import { useStore } from '@/store/useStore'

/**
 * The V6 brief's journeys A–F through the built-in engine, with the standing
 * NO-LIE and NO-DEAD-END rules at every step. The same journeys run through a
 * fake model in model.test.ts; both brains must land in the same state.
 */

serviceOptions.simulateThinking = false
const state = () => useStore.getState()
const today = todayKey()
const tomorrow = dayKey(addDays(new Date(), 1))

function reset() {
  state().resetAll()
  state().seed(buildDemoSeed())
  useStore.setState({ meals: {} })
  resetActionLedger()
  resetModelToolLedger()
  const conv = state().createConversation('Journeys')
  state().setActiveConversation(conv.id)
}

const CLAIMS = /(?<!\b(?:no|not|nothing|never|already|still|was|were|been|is|are|have|has|had|you've|i've)\s)\b(added|logged|removed|deleted|updated|moved|completed|saved|remembered|planned|created|set to|noted:|rebuilt|adjusted|scaled|halved)\b/i
const FALLBACK = /I want to get this right|Tell me a little more and I will act on it|Not sure I caught that/i

async function say(text: string): Promise<CoachResponse> {
  const r = await sendMessage(text)
  expect(r, `no response to "${text}"`).toBeDefined()
  const res = r!
  expect(res.message, `fallback reply to "${text}": ${res.message}`).not.toMatch(FALLBACK)
  const positive = res.message
    .split(/(?<=[.!?])\s+|\n/)
    .filter((sentence) => !/^(no|nothing|not|never|still|already)\b/i.test(sentence.trim()))
    .join(' ')
  if (CLAIMS.test(positive) && !/already|no longer/i.test(res.message)) {
    expect(res.actions.some((a) => a.ok), `"${text}" → claims a change but nothing was executed: ${res.message}`).toBe(true)
  }
  const conv = state().conversations.find((c) => c.id === state().activeConversationId)!
  for (const chip of res.suggestedFollowups) {
    const next = parseIntent(chip, { expects: res.expects, topic: conv.context.topic, hasWorkout: true, hasMeal: Boolean(conv.context.lastMealId), lastAvailabilityScope: conv.context.lastAvailabilityScope })
    expect(next.kind, `chip "${chip}" after "${text}" is a dead end`).not.toBe('unknown')
  }
  return res
}

const primary = () => state().goals.find((g) => g.rank === 'primary')
const todayWorkout = () => Object.values(state().workouts).find((w) => w.scheduledFor === today && w.status === 'planned')

describe('journeys A–F (built-in engine)', () => {
  beforeEach(reset)

  it('A. goal → change of mind → availability → readiness → workout → shorter', async () => {
    await say('I want to build muscle.')
    expect(primary()?.type).toBe('build_muscle')
    const id = primary()!.id
    await say('Actually, make that strength.')
    expect(primary()?.type).toBe('strength')
    expect(primary()!.id).toBe(id)
    expect(state().goals.filter((g) => g.rank === 'primary').length).toBe(1)
    await say('Four days a week.')
    expect(state().user!.availability.daysPerWeek).toBe(4)
    await say("I'm tired today, 6 out of 10.")
    expect(state().checkIns[today]?.fatigue).toBe(6)
    await say("Make today's workout.")
    const w = todayWorkout()!
    expect(w).toBeDefined()
    await say('Make it shorter.')
    expect(state().workouts[w.id].estimatedMinutes).toBeLessThanOrEqual(w.estimatedMinutes)
    expect(Object.values(state().workouts).filter((x) => x.scheduledFor === today && x.status === 'planned').length).toBe(1)
    const snap = buildContextSnapshot(state())
    expect(snap.goals.primary?.type).toBe('strength')
    expect(snap.profile.availability.daysPerWeek).toBe(4)
    expect(snap.readiness.checkIn?.fatigue).toBe(6)
    expect(snap.training.today?.id).toBe(w.id)
  })

  it('B. meal → more rice → half → what is left', async () => {
    await say('I ate chicken, rice and vegetables.')
    const meal = () => selectDailyNutrition(state(), today).meals[0]
    expect(meal()).toBeDefined()
    const rice = meal().items.find((i) => i.foodId === 'rice')!.grams
    await say('There was more rice.')
    expect(meal().items.find((i) => i.foodId === 'rice')!.grams).toBeGreaterThan(rice)
    const full = meal().calories
    await say('Actually I only ate half.')
    expect(meal().calories).toBeLessThan(full * 0.6)
    expect(selectDailyNutrition(state(), today).meals.length).toBe(1)
    const r = await say('What do I have left today?')
    const d = selectDailyNutrition(state(), today)
    expect(r.message).toContain(`${Math.max(0, d.remaining.calories).toLocaleString()} kcal`)
  })

  it("C. what's on tomorrow → move that to a free day: calendar, workout and context agree", async () => {
    const r = await say("What's on tomorrow?")
    const tw = Object.values(state().workouts).find((w) => w.scheduledFor === tomorrow && w.status === 'planned')
    if (!tw) {
      expect(r.message).toMatch(/rest day|Tomorrow is|nothing planned/i)
      return
    }
    expect(r.message).toContain(tw.title)
    let free = new Date(addDays(new Date(), 2))
    while (Object.values(state().workouts).some((w) => w.scheduledFor === dayKey(free) && w.status === 'planned')) free = addDays(free, 1)
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][free.getDay()]
    const moved = await say(`Move that to ${dayName}.`)
    expect(moved.actions.some((a) => (a.tool === 'reschedule_workout' || a.tool === 'move_event') && a.ok)).toBe(true)
    expect(state().workouts[tw.id].scheduledFor).toBe(dayKey(free))
    const ev = state().events.find((e) => e.workoutId === tw.id)!
    expect(ev.date).toBe(dayKey(free))
    expect(buildContextSnapshot(state()).training.tomorrow?.id).not.toBe(tw.id)
  })

  it('D. delete my workout → ambiguity → user picks → the right one goes', async () => {
    await say('Plan my week')
    for (const w of Object.values(state().workouts).filter((x) => x.scheduledFor === today && x.status === 'planned')) state().deleteWorkout(w.id)
    state().updateConversationContext(state().activeConversationId!, { lastWorkoutId: undefined })
    const planned = () => Object.values(state().workouts).filter((w) => w.status === 'planned' && w.scheduledFor >= today)
    const count = planned().length
    expect(count).toBeGreaterThan(1)
    const ask = await say('Delete my workout.')
    expect(ask.message).toMatch(/which one/i)
    expect(ask.actions.length).toBe(0)
    expect(ask.references?.length).toBeGreaterThan(1)
    const chosen = state().workouts[ask.references[0].id]
    const done = await say(ask.suggestedFollowups[0])
    expect(done.actions.some((a) => a.tool === 'remove_workout' && a.ok)).toBe(true)
    expect(state().workouts[chosen.id]).toBeUndefined()
    expect(planned().length).toBe(count - 1)
  })

  it('E. “Change my goal, make it muscle gain” is one coherent action', async () => {
    await say('Actually, make that strength.')
    const r = await say('Change my goal, make it muscle gain.')
    expect(primary()?.type).toBe('build_muscle')
    expect(r.actions.filter((a) => a.tool === 'set_goal' && a.ok).length).toBe(1)
    expect(state().goals.filter((g) => g.rank === 'primary').length).toBe(1)
  })

  it('F. three requests in one message run in dependency order', async () => {
    const r = await say('I want muscle gain, four days a week and a 12-week program.')
    const tools = r.actions.filter((a) => a.ok).map((a) => a.tool)
    expect(tools.indexOf('set_goal')).toBeGreaterThanOrEqual(0)
    expect(tools.indexOf('update_availability')).toBeGreaterThan(tools.indexOf('set_goal'))
    expect(tools.indexOf('create_program')).toBeGreaterThan(tools.indexOf('update_availability'))
    const program = Object.values(state().programs).find((p) => p.status === 'active')!
    expect(program).toMatchObject({ weeks: 12, daysPerWeek: 4, goalType: 'build_muscle' })
  })
})

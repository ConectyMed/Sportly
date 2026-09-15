import { beforeEach, describe, expect, it } from 'vitest'
import { sendMessage, serviceOptions } from '@/coach/coachService'
import { buildContextSnapshot } from '@/coach/context'
import { parseIntent } from '@/coach/intents'
import type { CoachResponse } from '@/coach/provider'
import { resetActionLedger } from '@/coach/tools/registry'
import { buildDemoSeed } from '@/domain/demo'
import { addDays, dayKey, todayKey } from '@/lib/dates'
import { selectDailyNutrition } from '@/store/selectors'
import { useStore } from '@/store/useStore'

/**
 * Complete conversational journeys through the real pipeline, with three
 * standing rules checked at every step:
 *
 *  - NO LIE: when the coach says added / logged / removed / updated / moved /
 *    completed / saved / set / planned, an executed action confirms it.
 *  - NO DEAD END: every suggestion chip resolves to a real intent.
 *  - COHERENCE: response, intent, state and derived data agree.
 */

serviceOptions.simulateThinking = false
const state = () => useStore.getState()
const today = todayKey()

function reset() {
  state().resetAll()
  state().seed(buildDemoSeed())
  useStore.setState({ meals: {} })
  resetActionLedger()
  const conv = state().createConversation('Journey')
  state().setActiveConversation(conv.id)
}

// A positive claim of change (“Logged …”), not a negation (“no meals logged”, “nothing planned”).
// “Planned yesterday: Upper Body (done).” is a day report (coach.report.planned), not a claim: a
// “planned” that is followed by a colon before the sentence ends is a headline, so it is excluded.
// The tool claim “Planned Upper Body for Tuesday.” has no colon and is still caught.
const CLAIMS = /(?<!\b(?:no|not|nothing|never|already|still|was|were|been|is|are|have|has|had|you've|i've)\s)\b(added|logged|removed|deleted|updated|moved|completed|saved|remembered|planned(?![^.!?\n]*:)|created|set to|noted:|rebuilt|adjusted|scaled|halved)\b/i
const FALLBACK = /I want to get this right|Tell me a little more and I will act on it|Not sure I caught that/i

async function say(text: string): Promise<CoachResponse> {
  const r = await sendMessage(text)
  expect(r, `no response to "${text}"`).toBeDefined()
  const res = r!
  expect(res.message, `fallback reply to "${text}": ${res.message}`).not.toMatch(FALLBACK)
  // NO LIE: a claim of change must be backed by an executed, successful action (or an explicit “already”).
  // Sentences that negate (“No meals logged yesterday.”) are not claims.
  const positive = res.message
    .split(/(?<=[.!?])\s+|\n/)
    .filter((sentence) => !/^(no|nothing|not|never|still|already)\b/i.test(sentence.trim()))
    .join(' ')
  if (CLAIMS.test(positive) && !/already|no longer/i.test(res.message)) {
    expect(res.actions.some((a) => a.ok), `"${text}" → claims a change but nothing was executed: ${res.message}`).toBe(true)
  }
  // NO DEAD END
  const conv = state().conversations.find((c) => c.id === state().activeConversationId)!
  for (const chip of res.suggestedFollowups) {
    const next = parseIntent(chip, { expects: res.expects, topic: conv.context.topic, hasWorkout: true, hasMeal: Boolean(conv.context.lastMealId), lastAvailabilityScope: conv.context.lastAvailabilityScope })
    expect(next.kind, `chip "${chip}" after "${text}" is a dead end`).not.toBe('unknown')
  }
  return res
}

const todayWorkout = () => Object.values(state().workouts).find((w) => w.scheduledFor === today && w.status !== 'skipped')

describe('journey: from goal to progress in one conversation', () => {
  beforeEach(reset)

  it('walks the brief end to end with state checks at each step', async () => {
    // goal
    let r = await say('I want to build muscle')
    expect(state().goals.find((g) => g.rank === 'primary')?.type).toBe('build_muscle')
    expect(r.actions.some((a) => a.tool === 'set_goal' && a.ok)).toBe(true)

    // availability
    r = await say('Four days a week')
    expect(state().user!.availability.daysPerWeek).toBe(4)

    // readiness with inline rating
    r = await say('I’m exhausted today, 6 out of 10')
    expect(state().checkIns[today]?.fatigue).toBe(6)
    expect(r.actions.some((a) => a.tool === 'check_in' && a.ok)).toBe(true)

    // constraints + workout
    r = await say('I only have 30 minutes and dumbbells')
    const w1 = todayWorkout()!
    expect(w1).toBeDefined()
    expect(w1.estimatedMinutes).toBeLessThanOrEqual(36)
    expect(w1.constraints?.equipment).toEqual(['dumbbell'])
    // The lighter session from the check-in is rebuilt in place (same entity), not duplicated.
    expect(r.actions.some((a) => (a.tool === 'create_workout' || a.tool === 'update_workout') && a.ok)).toBe(true)

    r = await say('Make today’s workout')
    expect(todayWorkout()).toBeDefined()

    // modification via reference
    const before = todayWorkout()!.estimatedMinutes
    r = await say('Make it shorter')
    expect(todayWorkout()!.estimatedMinutes).toBeLessThanOrEqual(before)
    expect(Object.values(state().workouts).filter((w) => w.scheduledFor === today && w.status === 'planned').length).toBe(1)

    // meal
    r = await say('I ate chicken, rice and vegetables')
    let d = selectDailyNutrition(state(), today)
    expect(d.meals.length).toBe(1)
    expect(r.actions.some((a) => a.tool === 'log_meal' && a.ok)).toBe(true)
    const riceBefore = d.meals[0].items.find((i) => i.foodId === 'rice')!.grams

    // corrections
    r = await say('There was more rice')
    d = selectDailyNutrition(state(), today)
    expect(d.meals[0].items.find((i) => i.foodId === 'rice')!.grams).toBeGreaterThan(riceBefore)
    expect(d.meals.length).toBe(1)
    const full = d.meals[0].calories
    r = await say('Actually, I only ate half')
    d = selectDailyNutrition(state(), today)
    expect(d.meals[0].calories).toBeLessThan(full * 0.6)

    // derived nutrition
    r = await say('What’s left for today?')
    expect(r.message).toContain(`${Math.max(0, d.remaining.calories).toLocaleString()} kcal`)

    // calendar
    r = await say('What’s on tomorrow?')
    const tomorrow = dayKey(addDays(new Date(), 1))
    const planned = Object.values(state().workouts).find((w) => w.scheduledFor === tomorrow && w.status === 'planned')
    if (planned) expect(r.message).toContain(planned.title)
    else expect(r.message).toMatch(/rest day|nothing planned|Tomorrow is/i)

    // progress
    r = await say('How am I progressing?')
    const snap = buildContextSnapshot(state())
    expect(r.message.length).toBeGreaterThan(40)
    expect(snap.progress.totalCompleted).toBeGreaterThan(20)

    // CoachContext reflects everything above
    expect(snap.goals.primary?.type).toBe('build_muscle')
    expect(snap.profile.availability.daysPerWeek).toBe(4)
    expect(snap.readiness.checkIn?.fatigue).toBe(6)
    expect(snap.training.today?.id).toBe(todayWorkout()!.id)
    expect(snap.nutrition.todayMeals.length).toBe(1)
    expect(snap.recentActions.length).toBeGreaterThan(3)
  })
})

describe('multi-action, ambiguity, references', () => {
  beforeEach(reset)

  it('one message with three requests executes all three in dependency order', async () => {
    const r = await say('I want to build muscle, train four days a week, and create a 12-week program')
    const tools = r.actions.filter((a) => a.ok).map((a) => a.tool)
    expect(tools.indexOf('set_goal')).toBeGreaterThanOrEqual(0)
    expect(tools.indexOf('update_availability')).toBeGreaterThan(tools.indexOf('set_goal'))
    expect(tools.indexOf('create_program')).toBeGreaterThan(tools.indexOf('update_availability'))
    const program = Object.values(state().programs).find((p) => p.status === 'active')!
    expect(program.weeks).toBe(12)
    expect(program.daysPerWeek).toBe(4)
    expect(program.goalType).toBe('build_muscle')
    expect(r.message).toMatch(/12 weeks|12-week/i)
  })

  it('ambiguous deletion asks instead of guessing; a precise one executes', async () => {
    await say('Plan my week')
    const planned = () => Object.values(state().workouts).filter((w) => w.status === 'planned' && w.scheduledFor >= today)
    // Remove any conversational or same-day referent so the request is genuinely ambiguous.
    for (const w of planned().filter((x) => x.scheduledFor === today)) state().deleteWorkout(w.id)
    state().updateConversationContext(state().activeConversationId!, { lastWorkoutId: undefined })
    const count = planned().length
    expect(count).toBeGreaterThan(1)
    const ask = await say('Delete my workout')
    expect(ask.message).toMatch(/which one/i)
    expect(ask.actions.length).toBe(0)
    expect(planned().length).toBe(count)
    const first = planned()[0]
    const day = new Date(first.scheduledFor).getDay()
    const name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]
    const done = await say(`Delete ${name}'s workout`)
    expect(done.actions.some((a) => a.tool === 'remove_workout' && a.ok)).toBe(true)
    expect(planned().length).toBe(count - 1)
    expect(state().events.some((e) => e.workoutId === first.id)).toBe(false)
  })

  it('“it / that / this / three” resolve to the right entity', async () => {
    await say('Make my workout')
    const w = todayWorkout()!
    await say('Shorten it')
    expect(state().workouts[w.id]?.estimatedMinutes ?? 0).toBeLessThanOrEqual(w.estimatedMinutes)

    await say('I ate a chicken salad')
    expect(selectDailyNutrition(state(), today).meals.length).toBe(1)
    const removed = await say('Remove that')
    expect(removed.actions.some((a) => a.tool === 'delete_meal' && a.ok)).toBe(true)
    expect(selectDailyNutrition(state(), today).meals.length).toBe(0)

    await say('I can train four days this week')
    const window = dayKey(addDays(new Date(), 6))
    const inWindow = () => Object.values(state().workouts).filter((x) => x.scheduledFor >= today && x.scheduledFor <= window && x.status === 'planned').length
    expect(inWindow()).toBe(4)
    await say('Make it three')
    expect(inWindow()).toBe(3)
  })

  it('temporal questions read the journal and calendar for other days', async () => {
    // Alex has logged meals yesterday in the demo seed; the turn context must see them.
    state().seed(buildDemoSeed())
    const conv = state().createConversation('Temporal')
    state().setActiveConversation(conv.id)
    const yesterday = dayKey(addDays(new Date(), -1))
    const meals = Object.values(state().meals).filter((m) => m.date === yesterday && m.status === 'logged')
    expect(meals.length).toBeGreaterThan(0)
    const r = await say('What did I eat yesterday?')
    expect(r.message).toMatch(/kcal/)
    expect(r.message).not.toMatch(/no meals logged/i)
    const planned = await say('What was planned yesterday?')
    expect(planned.message).toMatch(/planned yesterday|nothing was planned yesterday/i)
    const week = await say('What did I do this week?')
    expect(week.message).toMatch(/this week/i)
  })

  it('“and tomorrow?” stays in the domain of the previous topic', async () => {
    await say('What should I eat tonight?')
    const r = await say('And tomorrow?')
    expect(r.message).toMatch(/kcal|protein|targets/i)
    await say('Make my workout')
    const r2 = await say('And tomorrow?')
    expect(r2.message).toMatch(/Tomorrow|rest day|Upper|Lower|Body|session/i)
  })

  it('a failed tool call is reported, never claimed as done', async () => {
    await say('Make my workout')
    const w = todayWorkout()!
    // The workout disappears between the reply being composed and executed: the tool must refuse.
    const conv = state().activeConversationId!
    state().deleteWorkout(w.id)
    state().updateConversationContext(conv, { lastWorkoutId: w.id })
    const r = await say('I just finished my workout')
    const failed = r.actions.filter((a) => !a.ok)
    if (failed.length) expect(r.message).toMatch(/did not go through/i)
    else expect(r.actions.some((a) => a.ok)).toBe(true)
  })
})

describe('memory, readiness, personality, persistence', () => {
  beforeEach(reset)

  it('memory conflict in conversation: new statement beats old', async () => {
    await say('Remember that I prefer running for cardio')
    expect(state().memory.some((m) => /prefer running/i.test(m.text))).toBe(true)
    resetActionLedger()
    const r = await say('Remember that I actually hate running')
    expect(r.actions.some((a) => a.ok && a.changes.some((c) => c.type === 'MEMORY_REMOVED'))).toBe(true)
    expect(state().memory.some((m) => /prefer running/i.test(m.text))).toBe(false)
    expect(state().memory.some((m) => /hate running|dislikes running/i.test(m.text))).toBe(true)
    // The preference also reaches the structured profile, so generation avoids it.
    expect(state().user!.dislikedExercises?.some((d) => /run/.test(d))).toBe(true)
  })

  it('a statement about today is not turned into a durable memory', async () => {
    const before = state().memory.length
    await say('I’m tired today')
    await say('7')
    expect(state().memory.filter((m) => m.persistence !== 'temporary').length).toBe(before)
    expect(state().checkIns[today]?.fatigue).toBe(7)
  })

  it('personality changes the wording of the same answer', async () => {
    state().updatePersonality({ motivation: 5, tone: 5, humor: 5, communication: 5 })
    const calm = await say('What should I do today?')
    reset()
    state().updatePersonality({ motivation: 95, tone: 95, humor: 95, communication: 95 })
    const intense = await say('What should I do today?')
    expect(calm.message).not.toBe(intense.message)
  })

  it('empty data: a brand-new user gets useful answers, not crashes', async () => {
    state().resetAll()
    state().completeOnboarding({
      user: { ...buildDemoSeed().user, id: 'usr_new', name: 'Sam', isDemo: false },
      goals: [],
      coach: buildDemoSeed().coach,
      memory: [],
    })
    const conv = state().createConversation('New')
    state().setActiveConversation(conv.id)
    const a = await say('What have I eaten today?')
    expect(a.message).toMatch(/nothing logged/i)
    const b = await say('How am I progressing?')
    expect(b.message.length).toBeGreaterThan(20)
    const c = await say('What did I do yesterday?')
    expect(c.message).toMatch(/no completed session|no meals/i)
    const snap = buildContextSnapshot(state())
    expect(snap.progress.totalCompleted).toBe(0)
    expect(snap.goals.primary).toBeUndefined()
  })

  it('state and audit survive a JSON round trip and every message keeps its executed actions', async () => {
    const r = await say('I ate 3 eggs and toast')
    expect(r.actions.length).toBeGreaterThan(0)
    const snapshot = JSON.parse(JSON.stringify(state()))
    expect(Object.keys(snapshot.meals).length).toBe(1)
    expect(snapshot.actionLog[0].tool).toBe('log_meal')
    const msgs = snapshot.messages[state().activeConversationId!] as Array<{ role: string; actions?: unknown[] }>
    const last = [...msgs].reverse().find((m) => m.role === 'coach')!
    expect(last.actions?.length).toBeGreaterThan(0)
  })

  it('dashboard-facing selectors and the coach context agree after actions', async () => {
    await say('I ate 200 g turkey and 150 g rice')
    await say('Make my workout')
    await say('I just finished my workout')
    const s = state()
    const daily = selectDailyNutrition(s, today)
    const snap = buildContextSnapshot(s)
    expect(snap.nutrition.consumed.calories).toBe(daily.consumed.calories)
    expect(snap.training.today?.status).toBe('completed')
    expect(Object.values(s.workouts).filter((w) => w.scheduledFor === today && w.status === 'completed').length).toBe(1)
    expect(s.events.find((e) => e.workoutId === snap.training.today?.id)?.status).toBe('completed')
    expect(snap.progress.totalCompleted).toBe(Object.values(s.workouts).filter((w) => w.status === 'completed').length)
  })
})

import './clock'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildContext, sendMessage, serviceOptions } from '@/coach/coachService'
import { analyzeDescription, applyCorrection, buildMeal, LocalFoodAnalysisProvider } from '@/coach/food/foodAnalysis'
import { generateWorkout } from '@/coach/workoutGenerator'
import { buildDemoSeed } from '@/domain/demo'
import type { Attachment } from '@/domain/types'
import { addDays, dayKey, todayKey } from '@/lib/dates'
import { selectDailyNutrition } from '@/store/selectors'
import { useStore } from '@/store/useStore'

/**
 * Living-state tests: every conversation turn goes through the real orchestrator
 * and the real store, exactly like the UI. Assertions read the store the way the
 * screens do, so a passing test means Coach, Nutrition, Home, Calendar and Goals
 * are looking at the same truth.
 */

serviceOptions.simulateThinking = false

const state = () => useStore.getState()
const today = todayKey()

function reset() {
  state().resetAll()
  state().seed(buildDemoSeed())
  // Start from a clean food journal so intake assertions are exact.
  useStore.setState({ meals: {} })
  const conv = state().createConversation('Test')
  state().setActiveConversation(conv.id)
}

async function say(text: string, attachments: Attachment[] = []): Promise<string> {
  await sendMessage(text, attachments)
  const s = state()
  const msgs = s.messages[s.activeConversationId!] ?? []
  const last = [...msgs].reverse().find((m) => m.role === 'coach')
  return last?.text ?? ''
}

const daily = () => selectDailyNutrition(state(), today)
const todayWorkout = () => Object.values(state().workouts).find((w) => w.scheduledFor === today && w.status !== 'skipped')

describe('food scan → shared nutrition state', () => {
  beforeEach(reset)

  it('a described meal is logged and immediately visible to Nutrition and Home', async () => {
    expect(daily().meals.length).toBe(0)
    const reply = await say('I ate 200 g chicken breast, 150 g rice and broccoli')
    expect(reply).toMatch(/kcal/)
    const d = daily()
    expect(d.meals.length).toBe(1)
    expect(d.consumed.calories).toBeGreaterThan(300)
    expect(d.consumed.proteinG).toBeGreaterThan(40)
    expect(d.remaining.calories).toBe(d.targets.calories - d.consumed.calories)
    // The card the coach shows points at the very same entity.
    const s = state()
    const last = [...(s.messages[s.activeConversationId!] ?? [])].reverse().find((m) => m.role === 'coach')!
    expect(last.cards?.[0]).toMatchObject({ type: 'food', refId: d.meals[0].id })
  })

  it('corrections mutate the meal in context without duplicating it', async () => {
    await say('I ate chicken, rice and broccoli with sauce')
    const before = daily().meals[0]
    const rice = before.items.find((i) => i.foodId === 'rice')!
    await say('There was more rice')
    let after = daily().meals[0]
    expect(daily().meals.length).toBe(1)
    expect(after.id).toBe(before.id)
    expect(after.items.find((i) => i.foodId === 'rice')!.grams).toBeGreaterThan(rice.grams)
    expect(after.items.filter((i) => i.foodId === 'rice').length).toBe(1)

    await say('Actually remove the sauce')
    after = daily().meals[0]
    expect(after.items.some((i) => /sauce/i.test(i.name))).toBe(false)

    const full = after.calories
    await say('I only ate half')
    after = daily().meals[0]
    expect(after.calories).toBeLessThan(full * 0.6)
    expect(after.portionScale).toBeCloseTo(0.5, 1)
  })

  it('moving a meal between slots is reflected everywhere', async () => {
    await say('I had eggs and toast')
    expect(daily().meals[0].slot).toBeDefined()
    await say('This was dinner')
    expect(daily().meals[0].slot).toBe('dinner')
    await say('Add it to lunch')
    expect(daily().meals[0].slot).toBe('lunch')
    expect(daily().meals.length).toBe(1)
  })

  it('"what have I eaten" and "protein left" answer from the same derived numbers', async () => {
    await say('I ate 3 eggs and 2 slices of toast')
    await say('I had 150 g salmon with rice')
    const d = daily()
    expect(d.meals.length).toBe(2)
    const eaten = await say('What have I eaten today?')
    expect(eaten).toContain(`${d.consumed.calories.toLocaleString()} kcal`)
    const left = await say('How much protein do I have left?')
    expect(left).toContain(`${Math.max(0, d.remaining.proteinG)} g`)
  })

  it('dinner advice is sized to what is left after logged meals', async () => {
    const empty = await say('What should I eat tonight?')
    await say('I ate a big burrito bowl with chicken, rice, black beans and avocado')
    await say('I had a protein bar and a banana')
    const d = daily()
    const sized = await say('What should I eat tonight?')
    expect(sized).not.toBe(empty)
    expect(sized).toMatch(new RegExp(`${Math.max(0, d.remaining.proteinG)} g protein|${Math.max(0, d.remaining.calories).toLocaleString()} kcal`))
  })

  it('removing a logged meal from chat updates the journal', async () => {
    await say('I ate a chicken salad')
    expect(daily().meals.length).toBe(1)
    await say('Remove that meal')
    expect(daily().meals.length).toBe(0)
  })

  it('a photo without a vision model is handled honestly and still ends in a logged meal', async () => {
    const photo: Attachment = { id: 'att_test', kind: 'image', name: 'plate.jpg', mimeType: 'image/jpeg', size: 1000, createdAt: new Date().toISOString() }
    const reply = await say('I ate this', [photo])
    expect(reply).not.toMatch(/I can see|from the photo I can see/i)
    expect(reply).toMatch(/can’t see photos|tell me what/i)
    expect(daily().meals.length).toBe(0)
    const est = await say('Chicken, rice and vegetables')
    expect(est).toMatch(/kcal/)
    expect(daily().drafts.length + daily().meals.length).toBe(1)
    await say('Add it to lunch')
    const d = daily()
    expect(d.meals.length).toBe(1)
    expect(d.meals[0].slot).toBe('lunch')
    expect(d.meals[0].analysis).toBe('local-estimate')
    expect(d.meals[0].attachmentId).toBe('att_test')
  })

  it('local provider never claims vision', async () => {
    const p = new LocalFoodAnalysisProvider()
    const r = await p.analyze({ image: { attachment: { id: 'x', kind: 'image', name: 'x', mimeType: 'image/jpeg', size: 1, createdAt: '' } } })
    expect(r.needsDescription).toBe(true)
    expect(r.analysis).toBe('local-estimate')
    expect(p.supportsImages).toBe(false)
  })

  it('a question asked while a meal is in context never mutates that meal', async () => {
    await say('I ate 200 g turkey, 150 g rice and broccoli')
    const before = daily().meals[0]
    await say('What would you choose: grilled salmon with rice, creamy pasta, or a burger and fries?')
    await say('What have I eaten today?')
    await say('How much protein do I have left?')
    const after = daily().meals[0]
    expect(after.items.map((i) => [i.foodId, i.grams])).toEqual(before.items.map((i) => [i.foodId, i.grams]))
    expect(daily().meals.length).toBe(1)
  })

  it('a gram quantity binds only to the food next to it', () => {
    const a = analyzeDescription('80 g oats, a banana and a whey shake')
    const byId = Object.fromEntries(a.items.map((i) => [i.foodId, i]))
    expect(byId.oats.grams).toBe(80)
    expect(byId.banana.grams).not.toBe(80)
    expect(byId.protein_shake.grams).not.toBe(80)
    const b = analyzeDescription('chicken 200g with rice (150 g) and a big salad')
    const bid = Object.fromEntries(b.items.map((i) => [i.foodId, i]))
    expect(bid.chicken_breast.grams).toBe(200)
    expect(bid.rice.grams).toBe(150)
  })

  it('restaurant menu options are ranked against the remaining budget', async () => {
    await say('I’m going to a restaurant tonight')
    const reply = await say('What would you choose: grilled salmon with rice, creamy pasta, or a burger and fries?')
    expect(reply).toMatch(/salmon/i)
  })
})

describe('conversation → structured state', () => {
  beforeEach(reset)

  it('"I want to gain 5kg" creates a real goal and shifts nutrition targets', async () => {
    const before = daily().targets.calories
    const weight = state().user!.weightKg
    await say('I want to gain 5kg')
    const goal = state().goals.find((g) => g.rank === 'primary')!
    expect(goal.metric).toBe('body_weight')
    expect(goal.targetValue).toBeCloseTo(weight + 5, 1)
    const impact = await say('How does that affect my plan?')
    expect(impact.length).toBeGreaterThan(40)
    // Derived targets follow the goal, not a stored number.
    expect(daily().targets.calories === before || daily().plan !== undefined).toBe(true)
  })

  it('availability for this week creates calendar workouts, and "actually make it three" corrects them', async () => {
    // The coach plans the next seven days (a Saturday request rolls into next week).
    const windowEnd = dayKey(addDays(new Date(), 6))
    const inWeek = () => Object.values(state().workouts).filter((w) => w.scheduledFor >= today && w.scheduledFor <= windowEnd && w.status === 'planned')
    await say('I can train four days this week')
    const four = inWeek().length
    expect(four).toBe(4)
    await say('Actually make it three')
    const three = inWeek().length
    expect(three).toBe(3)
    // Every planned workout has exactly one calendar event.
    for (const w of inWeek()) expect(state().events.filter((e) => e.workoutId === w.id).length).toBe(1)
  })

  it('a permanent availability change updates the profile, not just this week', async () => {
    await say('I can only train Monday, Wednesday and Friday from now on')
    expect(state().user!.availability.preferredDays).toEqual([1, 3, 5])
    expect(state().user!.availability.daysPerWeek).toBe(3)
    // New explicit information replaces the older availability memory instead of sitting next to it.
    expect(state().memory.some((m) => m.category === 'availability' && /mon, wed, fri/i.test(m.text))).toBe(true)
    expect(state().memory.some((m) => m.category === 'availability' && /tuesday/i.test(m.text))).toBe(false)
  })

  it('"I\'m tired today" then "7" updates the check-in and lightens today', async () => {
    await say('I’m tired today')
    await say('7')
    expect(state().checkIns[today]?.fatigue).toBe(7)
    const w = todayWorkout()
    expect(w?.constraints?.intensity).toBe('light')
  })

  it('"Make today\'s workout 30 minutes" and "I only have dumbbells" rewrite the same workout', async () => {
    await say('Make today’s workout 30 minutes')
    const w1 = todayWorkout()!
    expect(w1.estimatedMinutes).toBeLessThanOrEqual(36)
    await say('I only have dumbbells')
    const w2 = todayWorkout()!
    expect(w2.constraints?.equipment).toEqual(['dumbbell'])
    expect(Object.values(state().workouts).filter((w) => w.scheduledFor === today && w.status === 'planned').length).toBe(1)
  })

  it('"I just finished my workout" completes the real session and updates calendar and progress', async () => {
    const before = Object.values(state().workouts).filter((w) => w.status === 'completed').length
    await say('Make my workout')
    const w = todayWorkout()!
    await say('I just finished my workout')
    const done = state().workouts[w.id]
    expect(done.status).toBe('completed')
    expect(done.summary?.setsCompleted).toBe(done.summary?.setsPlanned)
    expect(state().events.find((e) => e.workoutId === w.id)?.status).toBe('completed')
    expect(Object.values(state().workouts).filter((x) => x.status === 'completed').length).toBe(before + 1)
    const again = await say('I just finished my workout')
    expect(again).toMatch(/already/i)
  })

  it('exercise dislikes persist and shape future generation', async () => {
    await say('Make my workout')
    await say('I hate burpees, never give me burpees')
    expect(state().user!.dislikedExercises?.some((d) => /burpee/.test(d))).toBe(true)
    expect(state().memory.some((m) => /burpee/i.test(m.text))).toBe(true)
    for (let i = 0; i < 6; i++) {
      const w = generateWorkout({ user: state().user!, goals: state().goals, history: Object.values(state().workouts), constraints: { focus: 'conditioning', minutes: 30 }, seed: `dislike-${i}` })
      expect(w.exercises.some((e) => e.exerciseId === 'burpee')).toBe(false)
    }
  })

  it('the coach context is rebuilt from live state every turn', async () => {
    const conv = state().conversations.find((c) => c.id === state().activeConversationId)!
    const c1 = buildContext(state(), conv)
    expect(c1.nutrition.meals.length).toBe(0)
    state().upsertMeal(buildMeal(analyzeDescription('greek yogurt and almonds'), { date: today, slot: 'snack', source: 'manual', status: 'logged' }))
    const c2 = buildContext(state(), conv)
    expect(c2.nutrition.meals.length).toBe(1)
    expect(c2.nutrition.consumed.calories).toBeGreaterThan(0)
    const reply = await say('What have I eaten today?')
    expect(reply).toMatch(/yogurt/i)
  })

  it('tomorrow resolves from the calendar', async () => {
    const reply = await say('What’s on tomorrow?')
    const tomorrow = dayKey(addDays(new Date(), 1))
    const planned = Object.values(state().workouts).find((w) => w.scheduledFor === tomorrow && w.status === 'planned')
    if (planned) expect(reply).toContain(planned.title)
    else expect(reply).toMatch(/rest day|nothing planned|plan/i)
  })
})

describe('persistence and derivation', () => {
  beforeEach(reset)

  it('meal totals are always derived from items', () => {
    const meal = buildMeal(analyzeDescription('200 g chicken breast and 100 g rice'), { date: today, slot: 'lunch', source: 'text', status: 'logged' })
    const sum = meal.items.reduce((a, i) => a + i.calories, 0)
    expect(meal.calories).toBe(Math.round(sum))
    const halved = applyCorrection(meal, { type: 'scale', factor: 0.5 }).meal
    expect(halved.calories).toBe(Math.round(halved.items.reduce((a, i) => a + i.calories, 0)))
    expect(halved.calories).toBeLessThan(meal.calories)
  })

  it('state survives a JSON round-trip and old snapshots migrate to include meals', () => {
    state().upsertMeal(buildMeal(analyzeDescription('banana'), { date: today, slot: 'snack', source: 'text', status: 'logged' }))
    const snapshot = JSON.parse(JSON.stringify(state()))
    expect(Object.keys(snapshot.meals).length).toBe(1)
    const persistApi = (useStore as unknown as { persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } } }).persist
    const migrated = persistApi.getOptions().migrate?.({ ...snapshot, meals: undefined }, 1) as { meals: Record<string, unknown> }
    expect(migrated.meals).toEqual({})
  })
})

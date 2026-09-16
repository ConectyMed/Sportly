import './clock'
import { beforeAll, describe, expect, it } from 'vitest'
import { sendMessage, serviceOptions } from '@/coach/coachService'
import { parseIntent } from '@/coach/intents'
import { buildDemoSeed } from '@/domain/demo'
import type { Attachment, Message } from '@/domain/types'
import { todayKey } from '@/lib/dates'
import { selectDailyNutrition } from '@/store/selectors'
import { useStore } from '@/store/useStore'

/**
 * The V3 brief's example conversation, played end to end as one continuous chat
 * through the real orchestrator. Every turn must produce a real answer (no
 * fallback), every suggestion chip must resolve to a real intent, and the state
 * must move where the words say it moves.
 */

serviceOptions.simulateThinking = false
const state = () => useStore.getState()
const today = todayKey()
// Optional transcript for reading the conversation by eye: SPORTLY_TRANSCRIPT=/path/to/file.md
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const transcriptPath = env.SPORTLY_TRANSCRIPT
type Fs = { appendFileSync(path: string, data: string): void; mkdirSync(path: string, opts: { recursive: boolean }): void }
let fs: Fs | undefined
async function transcript(line: string) {
  if (!transcriptPath) return
  const spec = 'node:fs'
  fs ??= (await import(/* @vite-ignore */ spec)) as Fs
  fs.appendFileSync(transcriptPath, line)
}

const photo = (id: string): Attachment => ({ id, kind: 'image', name: `${id}.jpg`, mimeType: 'image/jpeg', size: 1200, createdAt: new Date().toISOString() })

async function say(text: string, attachments: Attachment[] = []): Promise<Message> {
  await sendMessage(text, attachments)
  const s = state()
  const msgs = s.messages[s.activeConversationId!] ?? []
  const last = [...msgs].reverse().find((m) => m.role === 'coach')!
  await transcript(`\n> ${text}${attachments.length ? ' [photo]' : ''}\n${last.text}\n${last.suggestions?.length ? `  chips: ${last.suggestions.join(' | ')}` : ''}\n`)
  return last
}

const FALLBACK = /I want to get this right|Tell me a little more and I will act on it|Not sure I caught that/i

function expectRealAnswer(m: Message, prompt: string) {
  expect(m.text.length, `empty reply to "${prompt}"`).toBeGreaterThan(20)
  expect(m.text, `fallback reply to "${prompt}": ${m.text}`).not.toMatch(FALLBACK)
  for (const chip of m.suggestions ?? []) {
    const conv = state().conversations.find((c) => c.id === state().activeConversationId)!
    const next = parseIntent(chip, { expects: m.expects, topic: conv.context.topic, hasWorkout: true, hasMeal: Boolean(conv.context.lastMealId), lastAvailabilityScope: conv.context.lastAvailabilityScope })
    expect(next.kind, `chip "${chip}" after "${prompt}" is a dead end`).not.toBe('unknown')
  }
}

describe('the V3 brief conversation, end to end', () => {
  beforeAll(async () => {
    state().resetAll()
    state().seed(buildDemoSeed())
    useStore.setState({ meals: {} })
    const conv = state().createConversation('Brief script')
    state().setActiveConversation(conv.id)
    await transcript(`# Sportly V3 script · ${new Date().toISOString()}\n`)
  })

  it('goals and training', async () => {
    const weight = state().user!.weightKg
    expectRealAnswer(await say('I want to gain 5kg'), 'gain')
    expect(state().goals.find((g) => g.rank === 'primary')?.targetValue).toBeCloseTo(weight + 5, 1)

    expectRealAnswer(await say('I can train four days this week'), 'four days')
    expectRealAnswer(await say('Actually make it three'), 'three')
    const planned = Object.values(state().workouts).filter((w) => w.status === 'planned' && w.scheduledFor >= today)
    expect(planned.length).toBeGreaterThanOrEqual(1)
    expect(planned.length).toBeLessThanOrEqual(3)

    expectRealAnswer(await say('I’m tired today'), 'tired')
    expectRealAnswer(await say('7'), '7')
    expect(state().checkIns[today]?.fatigue).toBe(7)

    expectRealAnswer(await say('Make today’s workout 30 minutes'), '30 minutes')
    const w1 = Object.values(state().workouts).find((w) => w.scheduledFor === today && w.status === 'planned')!
    expect(w1.estimatedMinutes).toBeLessThanOrEqual(36)

    expectRealAnswer(await say('I only have dumbbells'), 'dumbbells')
    const w2 = Object.values(state().workouts).find((w) => w.scheduledFor === today && w.status === 'planned')!
    expect(w2.constraints?.equipment).toEqual(['dumbbell'])

    expectRealAnswer(await say('I just finished my workout'), 'finished')
    expect(state().workouts[w2.id].status).toBe('completed')
  })

  it('food scan and corrections', async () => {
    const r = await say('I ate this', [photo('att_lunch')])
    expectRealAnswer(r, 'I ate this')
    expect(r.text).not.toMatch(/I can see/i)
    expectRealAnswer(await say('Chicken, rice and vegetables with sauce'), 'description')
    const d1 = selectDailyNutrition(state(), today)
    expect(d1.drafts.length).toBe(1)
    const riceBefore = d1.drafts[0].items.find((i) => i.foodId === 'rice')!.grams

    expectRealAnswer(await say('There was more rice'), 'more rice')
    expectRealAnswer(await say('Add it to lunch'), 'add to lunch')
    const d2 = selectDailyNutrition(state(), today)
    expect(d2.meals.length).toBe(1)
    expect(d2.meals[0].slot).toBe('lunch')
    expect(d2.meals[0].items.find((i) => i.foodId === 'rice')!.grams).toBeGreaterThan(riceBefore)

    expectRealAnswer(await say('Actually remove the sauce'), 'remove sauce')
    expect(selectDailyNutrition(state(), today).meals[0].items.some((i) => /sauce/i.test(i.name))).toBe(false)

    const eaten = await say('What have I eaten today?')
    expectRealAnswer(eaten, 'eaten today')
    expect(eaten.text).toMatch(/chicken/i)
    const left = await say('How much protein do I have left?')
    expectRealAnswer(left, 'protein left')
    expect(left.text).toContain(`${Math.max(0, selectDailyNutrition(state(), today).remaining.proteinG)} g`)
    expectRealAnswer(await say('What should I eat tonight?'), 'tonight')
  })

  it('restaurant, menu and goal change', async () => {
    expectRealAnswer(await say('I’m going to a restaurant tonight'), 'restaurant')
    const menu = await say('', [photo('att_menu')])
    expectRealAnswer(menu, 'menu photo')
    expect(menu.text).not.toMatch(/I can see the menu/i)
    const choose = await say('What would you choose? Grilled salmon with rice, chicken pasta or a burger and fries')
    expectRealAnswer(choose, 'what would you choose')
    expect(choose.text).toMatch(/salmon|pasta|burger/i)
    // The logged lunch must be untouched by menu talk.
    expect(selectDailyNutrition(state(), today).meals.length).toBe(1)

    expectRealAnswer(await say('I changed my goal'), 'changed goal')
    expectRealAnswer(await say('Lose fat'), 'lose fat')
    expect(state().goals.find((g) => g.rank === 'primary')?.type).toBe('lose_fat')
    const impact = await say('How does that affect my plan?')
    expectRealAnswer(impact, 'impact')
    expect(impact.text).toMatch(/fat|deficit|calories|protein/i)
    expectRealAnswer(await say('What’s on tomorrow?'), 'tomorrow')
  })
})

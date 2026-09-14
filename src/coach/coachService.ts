import type { ActionRecord, Attachment, Conversation, EntityRef, Message, Workout, WorkoutSummary } from '@/domain/types'
import { exerciseName, goalLabel, workoutTitle } from '@/domain/labels'
import { t, translator } from '@/i18n'
import { addDays, dayKey, diffDays, timeOfDay, todayKey } from '@/lib/dates'
import { formatMinutes, sleep, uid } from '@/lib/utils'
import { fileToDataUrl, loadAttachmentBlob } from '@/store/attachments'
import { selectDailyNutrition } from '@/store/selectors'
import { useStore, type AppState } from '@/store/useStore'
import { buildContextSnapshot } from './context'
import { AnthropicVisionFoodProvider, LocalFoodAnalysisProvider, type FoodAnalysis, type FoodAnalysisProvider } from './food/foodAnalysis'
import { generateInsights } from './insights'
import { splitCompound, type ParseOptions } from './intents'
import { LocalCoachProvider } from './localProvider'
import { ProviderError } from './model/contract'
import { runModelTurn } from './model/loop'
import { providerStatus, resolveModelProvider, type ProviderStatus } from './model/providers'
import { generateNutritionPlan } from './nutritionGenerator'
import { buildVoice } from './personality'
import type { CoachAction, CoachContext, CoachProvider, CoachReply, CoachResponse } from './provider'
import { computeReadiness } from './readiness'
import { buildTemporalContext } from './time'
import { describeTools, executeActions } from './tools/registry'
import { completeWorkoutRecord, ensureEventForWorkout } from './workoutCompletion'
import { generateWorkout } from './workoutGenerator'

/**
 * Coach orchestration. One pipeline, whatever the brain:
 *
 *   message → normalisation → context from live state
 *   → brain (built-in engine: intent → proposed actions | model: tool loop)
 *   → tool execution (validation, idempotency, audit) → derived state
 *   → context refresh → response that only claims what really happened.
 *
 * No brain touches the store. The built-in engine proposes typed actions that
 * are executed here; a model proposes tool calls that the model loop
 * (./model/loop.ts) validates, executes and feeds back until it is done.
 */

const local = new LocalCoachProvider()
const localFood = new LocalFoodAnalysisProvider()

/** Tests flip this off so conversations run without the simulated thinking pause. */
export const serviceOptions = { simulateThinking: true }

export { ensureEventForWorkout, describeTools }

function hasVisionKey(state: Pick<AppState, 'coach'>): boolean {
  return state.coach.provider === 'anthropic' && Boolean(state.coach.anthropicApiKey)
}

function providerFor(): CoachProvider {
  return local
}

/** Which engine answers right now, and why (for the settings screen). */
export function coachEngineStatus(state: Pick<AppState, 'coach'> = useStore.getState()): ProviderStatus {
  return providerStatus(state.coach)
}

function foodProviderFor(state: AppState): FoodAnalysisProvider {
  if (hasVisionKey(state)) return new AnthropicVisionFoodProvider(state.coach.anthropicApiKey!, state.coach.anthropicModel, localFood)
  return localFood
}

/**
 * Analyse an attached food photo before the coach answers. With a vision-capable
 * provider the image is genuinely interpreted; otherwise only the text is used and
 * the result says so, so the coach never claims to have seen the plate.
 */
async function analyzeAttachedFood(state: AppState, text: string, attachments: Attachment[]): Promise<FoodAnalysis | undefined> {
  const image = attachments.find((a) => a.kind === 'image')
  if (!image) return undefined
  const provider = foodProviderFor(state)
  const language = state.preferences.language
  if (!provider.supportsImages) return provider.analyze({ text, language })
  let base64: string | undefined
  try {
    const blob = await loadAttachmentBlob(image.id)
    if (blob) {
      const dataUrl = await fileToDataUrl(blob)
      base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    }
  } catch (err) {
    console.warn('[food] could not load attachment for analysis', err)
  }
  return provider.analyze({ text, language, image: { attachment: image, base64, mediaType: image.mimeType } })
}

/* ------------------------------------------------------------------ Selectors */

export function selectTodayWorkout(state: Pick<AppState, 'workouts'>, date = todayKey()): Workout | undefined {
  const list = Object.values(state.workouts).filter((w) => w.scheduledFor === date)
  return (
    list.find((w) => w.status === 'in_progress') ??
    list.find((w) => w.status === 'planned') ??
    list.filter((w) => w.status === 'completed').sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1))[0] ??
    list[0]
  )
}

export function selectActiveProgram(state: Pick<AppState, 'programs'>) {
  return Object.values(state.programs).find((p) => p.status === 'active')
}

export function selectTodayNutrition(state: Pick<AppState, 'nutritionPlans'>, date = todayKey()) {
  return Object.values(state.nutritionPlans)
    .filter((p) => p.date === date)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
}

/* ------------------------------------------------------------------ Context */

/** Everything the coach sees this turn, rebuilt from live state (never cached). */
export function buildContext(state: AppState, conversation: Conversation, now = new Date()): CoachContext {
  const user = state.user!
  const workouts = Object.values(state.workouts)
  const time = buildTemporalContext(now)
  const today = time.today
  const todayCheckIn = state.checkIns[today]
  const readiness = computeReadiness(todayCheckIn, workouts, today, user.sleepHoursTypical)
  const todayWorkout = selectTodayWorkout(state, today)
  const tomorrowWorkout = workouts.find((w) => w.scheduledFor === time.tomorrow && w.status === 'planned')
  // Conversational references: only honoured while the entity still exists (stale references are dropped).
  const contextWorkout = conversation.context.lastWorkoutId ? state.workouts[conversation.context.lastWorkoutId] : undefined
  const contextMeal = conversation.context.lastMealId ? state.meals[conversation.context.lastMealId] : undefined
  const targetPerWeek = user.availability.daysPerWeek
  const language = state.preferences.language
  return {
    now,
    language,
    time,
    snapshot: buildContextSnapshot(state, conversation, now),
    user,
    goals: state.goals,
    coach: state.coach,
    memory: state.memory,
    readiness,
    todayCheckIn,
    todayWorkout,
    tomorrowWorkout,
    contextWorkout: contextWorkout ?? todayWorkout,
    activeProgram: selectActiveProgram(state),
    todayNutrition: selectTodayNutrition(state, today),
    nutrition: selectDailyNutrition(state, today),
    contextMeal,
    meals: Object.values(state.meals),
    foodVision: hasVisionKey(state),
    workouts,
    events: state.events,
    measurements: state.measurements,
    checkIns: state.checkIns,
    conversation,
    history: (state.messages[conversation.id] ?? []).slice(-12),
    insights: generateInsights({ workouts, measurements: state.measurements, checkIns: state.checkIns, goals: state.goals, targetPerWeek }, language),
    targetPerWeek,
  }
}

/* ------------------------------------------------------------------ Actions */

/**
 * Apply proposed actions through the tool registry. Returns the real outcome of
 * each call; callers must speak from these records, never from the proposal.
 */
export function applyActions(actions: CoachAction[] | undefined, source: ActionRecord['source'] = 'coach'): ActionRecord[] {
  return executeActions(actions, { source })
}

/** Make the reply honest: it may only claim what the records confirm. */
function reconcile(reply: CoachReply, records: ActionRecord[]): CoachReply {
  const failed = records.filter((r) => !r.ok)
  if (!failed.length) return reply
  const lines = failed.map((f) => f.summary.replace(/\.$/, ''))
  const note = failed.length === 1 ? t('service.reconcile.one', { line: lines[0] }) : t('service.reconcile.some', { lines: lines.join('; ') })
  return { ...reply, text: `${reply.text.trim()}\n\n${note}` }
}

function referencesFrom(reply: CoachReply, records: ActionRecord[]): EntityRef[] {
  const out: EntityRef[] = [...(reply.references ?? [])]
  for (const r of records) for (const c of r.changes) if (!out.some((x) => x.type === c.entity.type && x.id === c.entity.id)) out.push(c.entity)
  return out
}

/* ------------------------------------------------------------------ Conversation */

function activeConversation(): Conversation {
  const s = useStore.getState()
  const existing = s.conversations.find((c) => c.id === s.activeConversationId) ?? s.conversations[0]
  if (existing) {
    if (s.activeConversationId !== existing.id) s.setActiveConversation(existing.id)
    return existing
  }
  return s.createConversation()
}

function conversationById(id: string): Conversation {
  return useStore.getState().conversations.find((c) => c.id === id)!
}

/**
 * Normalise what the user typed: trim and collapse whitespace. Typographic
 * apostrophes and quotes are kept (they are correct French); every parser folds
 * them for matching, so “j’ai”, "j'ai" and j´ai are understood alike.
 */
export function normalizeMessage(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

let inflight = false

/** One conversational turn. Resolves when the coach's reply is committed. */
export async function sendMessage(text: string, attachments: Attachment[] = []): Promise<CoachResponse | undefined> {
  const trimmed = normalizeMessage(text)
  if (!trimmed && !attachments.length) return undefined
  if (inflight) return undefined
  inflight = true
  const store = useStore.getState()
  const conversation = activeConversation()
  const userMsg: Message = {
    id: uid('msg'),
    conversationId: conversation.id,
    role: 'user',
    text: trimmed,
    attachments: attachments.length ? attachments : undefined,
    createdAt: new Date().toISOString(),
    status: 'sent',
  }
  store.addMessage(userMsg)
  store.setCoachTyping(true)

  try {
    const state = useStore.getState()
    const started = Date.now()
    if (attachments.some((a) => a.kind === 'image')) useStore.getState().setCoachTyping(true, hasVisionKey(state) ? t('service.status.lookingPhoto') : t('service.status.reading'))
    const foodAnalysis = await analyzeAttachedFood(state, trimmed, attachments)

    // A configured model runs the tool loop; otherwise (or if it fails before doing anything) the built-in engine answers.
    const model = await resolveModelProvider(state.coach)
    if (model) {
      try {
        const turn = await runModelTurn(model, conversation.id, { text: trimmed, attachments, foodAnalysis }, { onStatus: (status) => useStore.getState().setCoachTyping(true, status) })
        return commitReply(conversation.id, reconcile(turn.reply, turn.limitReached ? turn.records : []), turn.records)
      } catch (err) {
        const executed = useStore.getState().actionLog.filter((a) => a.source === 'coach' && Date.parse(a.at) >= started)
        console.warn(`[coach] ${model.label} failed (${err instanceof ProviderError ? err.kind : 'error'}); ${executed.length ? 'reporting what was done' : 'using the built-in coach'}`, err)
        if (executed.length) {
          const voice = buildVoice(useStore.getState().coach.personality)
          const done = executed.filter((a) => a.ok).map((a) => a.summary.replace(/\.$/, ''))
          return commitReply(
            conversation.id,
            { text: voice.compose({ core: t('service.model.lost', { lead: done.length ? t('service.model.did', { done: done.join('; ') }) : t('service.model.couldNotFinish'), label: model.label }), soft: t('service.model.headsUp') }), suggestions: [t('service.sug.tryAgain'), t('service.sug.whatDidToday')] },
            executed.reverse(),
          )
        }
        // Fall through to the built-in engine.
      }
    }

    const provider = providerFor()
    // A message can carry several requests. Each one gets a fresh context so the
    // second request already sees what the first changed (goal → availability → program).
    const lastCoach = [...(state.messages[conversation.id] ?? [])].reverse().find((m) => m.role === 'coach')
    const parseOpts: ParseOptions = { expects: lastCoach?.expects, topic: conversation.context.topic, hasAttachments: attachments.length > 0, language: state.preferences.language }
    const parts = !attachments.length ? splitCompound(trimmed, parseOpts) : undefined
    const turns = parts?.map((p) => p.text) ?? [trimmed]

    const replies: CoachReply[] = []
    const records: ActionRecord[] = []
    let thinkMs = 0
    for (let i = 0; i < turns.length; i++) {
      const ctx = buildContext(useStore.getState(), conversationById(conversation.id))
      const reply = await provider.respond({ text: turns[i], attachments: i === 0 ? attachments : [], context: ctx, foodAnalysis: i === 0 ? foodAnalysis : undefined })
      if (reply.status) useStore.getState().setCoachTyping(true, reply.status)
      const executed = applyActions(reply.actions)
      records.push(...executed)
      replies.push(reconcile(reply, executed))
      if (reply.contextPatch) useStore.getState().updateConversationContext(conversation.id, reply.contextPatch)
      thinkMs = Math.max(thinkMs, reply.thinkMs ?? 800)
    }

    // Make the coach feel like it thinks — briefly, and only for the built-in engine.
    const think = serviceOptions.simulateThinking ? thinkMs : 0
    const elapsed = Date.now() - started
    if (think > elapsed) await sleep(think - elapsed)

    const last = replies[replies.length - 1]
    const merged: CoachReply = {
      ...last,
      text: replies.map((r) => r.text.trim()).join('\n\n'),
      cards: replies.flatMap((r) => r.cards ?? []),
      references: replies.flatMap((r) => r.references ?? []),
      contextPatch: undefined,
    }
    return commitReply(conversation.id, merged, records)
  } catch (err) {
    console.error('[coach] respond failed', err)
    const coach = useStore.getState().coach
    const voice = buildVoice(coach.personality)
    return commitReply(conversation.id, {
      text: voice.compose({ core: t('service.error.core'), soft: t('service.error.soft') }),
      suggestions: [t('service.sug.tryAgain'), t('coach.sug.buildToday')],
    })
  } finally {
    useStore.getState().setCoachTyping(false)
    inflight = false
  }
}

function commitReply(conversationId: string, reply: CoachReply, records: ActionRecord[] = []): CoachResponse {
  const s = useStore.getState()
  const references = referencesFrom(reply, records)
  const msg: Message = {
    id: uid('msg'),
    conversationId,
    role: 'coach',
    text: reply.text,
    cards: reply.cards?.length ? reply.cards : undefined,
    suggestions: reply.suggestions,
    expects: reply.expects,
    actions: records.length ? records : undefined,
    references: references.length ? references : undefined,
    createdAt: new Date().toISOString(),
    status: 'sent',
  }
  s.addMessage(msg)
  if (reply.contextPatch) s.updateConversationContext(conversationId, reply.contextPatch)
  return { message: reply.text, actions: records, references, suggestedFollowups: reply.suggestions ?? [], cards: reply.cards, expects: reply.expects }
}

/** Post a coach message directly (no user turn), e.g. after finishing a workout. */
export function coachSays(text: string, extra: Partial<CoachReply> = {}, conversationId?: string): void {
  const conversation = conversationId ? useStore.getState().conversations.find((c) => c.id === conversationId) : activeConversation()
  if (!conversation) return
  commitReply(conversation.id, { text, ...extra })
}

// ---------------------------------------------------------------------------
// First conversation after onboarding
// ---------------------------------------------------------------------------

export function startFirstConversation(): void {
  const s = useStore.getState()
  if (!s.user) return
  const conv = s.createConversation(t('service.first.title'))
  const voice = buildVoice(s.coach.personality)
  const name = s.user.name.split(' ')[0]
  const goal = s.goals.find((g) => g.rank === 'primary')
  const secondary = s.goals.find((g) => g.rank === 'secondary')
  const days = s.user.availability.daysPerWeek
  const intro = voice.compose({
    core: t('service.first.core', { name, coach: s.coach.name, goal: goalLabel(goal?.type ?? 'general_fitness').toLowerCase(), secondary: secondary ? t('service.first.secondary', { goal: goalLabel(secondary.type).toLowerCase() }) : '', days, minutes: formatMinutes(s.user.availability.sessionMinutes) }),
    reason: t('service.first.reason'),
    calm: t('service.first.calm'),
    push: t('service.first.push'),
    quip: t('service.first.quip'),
  })
  commitReply(conv.id, {
    text: intro,
    suggestions: [t('coach.sug.buildToday'), t('coach.sug.create12'), t('coach.sug.whatEatToday'), t('coach.sug.only30')],
  })
  commitReply(conv.id, {
    text: voice.compose({ core: t('service.first.question'), soft: t('service.first.questionSoft') }),
    suggestions: [t('coach.sug.feelingGreat'), t('coach.sug.bitTired'), t('coach.sug.sleptBadly')],
    expects: 'energy_scale',
  })
}

// ---------------------------------------------------------------------------
// Quick actions used by screens (no conversation turn). They go through the same tools.
// ---------------------------------------------------------------------------

export function generateTodayWorkoutQuick(): Workout {
  const s = useStore.getState()
  const workouts = Object.values(s.workouts)
  const readiness = computeReadiness(s.checkIns[todayKey()], workouts, todayKey(), s.user!.sleepHoursTypical)
  const w = generateWorkout({ user: s.user!, goals: s.goals, history: workouts, readiness, seed: `${todayKey()}-${workouts.length}-quick` })
  applyActions([{ type: 'create_workout', workout: w }], 'user')
  return w
}

export function ensureTodayNutrition() {
  const s = useStore.getState()
  const existing = selectTodayNutrition(s)
  if (existing) return existing
  const tw = selectTodayWorkout(s)
  const plan = generateNutritionPlan({ user: s.user!, goals: s.goals, isTrainingDay: Boolean(tw && tw.status !== 'skipped'), seed: `${todayKey()}-${s.user!.id}` })
  applyActions([{ type: 'create_nutrition_plan', plan }], 'system')
  return plan
}

/** Finish a workout from the session screen: same completion path as the coach's tool, plus the coach's reaction. */
export function finishWorkout(workoutId: string, feeling?: WorkoutSummary['feeling'], notes?: string, opts: { announce?: boolean } = {}): WorkoutSummary | undefined {
  const s = useStore.getState()
  const w = s.workouts[workoutId]
  if (!w) return undefined
  const summary = completeWorkoutRecord(workoutId, feeling, notes)
  if (!summary) return undefined
  const tr = translator()
  const title = workoutTitle(w)
  s.appendActionLog({ id: uid('act'), tool: 'complete_workout', ok: true, source: 'user', at: new Date().toISOString(), summary: tr.t('service.finish.log', { title, done: summary.setsCompleted, total: summary.setsPlanned }), changes: [{ type: 'WORKOUT_COMPLETED', entity: { type: 'workout', id: w.id, label: title }, summary: tr.t('service.finish.change', { title }) }] })
  if (opts.announce === false) return summary
  const voice = buildVoice(s.coach.personality)
  const ratio = summary.setsPlanned ? summary.setsCompleted / summary.setsPlanned : 1
  const core =
    ratio >= 0.9
      ? tr.t('service.finish.done', { cheer: voice.cheer(workoutId), title, done: summary.setsCompleted, total: summary.setsPlanned, volume: tr.int(Math.round(summary.totalVolumeKg)), duration: formatMinutes(Math.round(summary.durationSec / 60)) })
      : tr.t('service.finish.partial', { title, done: summary.setsCompleted, total: summary.setsPlanned })
  const prLine = summary.prs.length ? tr.t('service.finish.pr', { lifts: summary.prs.map((p) => tr.t('service.finish.lift', { name: exerciseName(p.exerciseId, p.name), kg: tr.num(p.weightKg), reps: p.reps })).join(', ') }) : undefined
  coachSays(
    voice.compose({ core, reason: prLine, extra: tr.t('service.finish.extra'), calm: tr.t('service.finish.calm'), push: tr.t('service.finish.push'), quip: tr.t('service.finish.quip') }),
    { suggestions: [tr.t('coach.sug.whatEatNow'), tr.t('coach.sug.howDidWeek'), tr.t('coach.sug.planTomorrow')], references: [{ type: 'workout', id: w.id, label: title }] },
  )
  return summary
}

// ---------------------------------------------------------------------------
// Contextual notifications (in-app, generated from state)
// ---------------------------------------------------------------------------

export function runNotificationSweep(): void {
  const s = useStore.getState()
  if (!s.onboarded || !s.user) return
  const prefs = s.preferences.notifications
  if (!prefs.enabled) return
  const now = new Date()
  const key = `${todayKey()}-${now.getHours() < 12 ? 'am' : now.getHours() < 18 ? 'pm' : 'eve'}`
  if (s.lastNotificationSweep === key) return
  s.setNotificationSweep(key)
  // Food scan drafts from earlier days were never confirmed: drop them.
  s.pruneMealDrafts(todayKey())

  const voice = buildVoice(s.coach.personality)
  const tw = selectTodayWorkout(s)
  const hour = now.getHours()
  const has = (kind: string, title?: string) => s.notifications.some((n) => n.kind === kind && diffDays(now, n.createdAt) === 0 && (!title || n.title === title))
  // Mirror new in-app notifications to the device when the user allowed it.
  const before = s.notifications.length
  const mirror = () => {
    const after = useStore.getState().notifications
    const fresh = after.slice(0, Math.max(0, after.length - before))
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    for (const n of fresh) {
      try {
        new Notification(n.title, { body: n.body, icon: `${import.meta.env.BASE_URL}icons/icon-192.png`, tag: n.id })
      } catch {
        /* not supported in this context */
      }
    }
  }
  queueMicrotask(mirror)
  const workouts = Object.values(s.workouts)
  const readiness = computeReadiness(s.checkIns[todayKey()], workouts, todayKey(), s.user.sleepHoursTypical)

  if (prefs.morningPlan && hour >= 6 && hour < 12 && tw && tw.status === 'planned' && !has('plan_ready')) {
    s.addNotification({ kind: 'plan_ready', title: voice.isIntense ? t('service.notify.planReadyIntense') : t('service.notify.planReady'), body: t('service.notify.planReadyBody', { title: workoutTitle(tw), minutes: formatMinutes(tw.estimatedMinutes) }), action: { label: t('service.notify.seeToday'), to: '/' } })
  }
  if (prefs.recoveryInsights && readiness.hasCheckIn && readiness.recommendation === 'push' && !has('recovery')) {
    s.addNotification({ kind: 'recovery', title: t('service.notify.recoveryTitle'), body: voice.isIntense ? t('service.notify.recoveryIntense') : t('service.notify.recoveryBody'), action: { label: t('service.notify.talkToCoach'), to: '/coach' } })
  }
  if (prefs.missedWorkoutNudge && hour >= 17 && tw && tw.status === 'planned' && !has('missed')) {
    s.addNotification({ kind: 'missed', title: t('service.notify.missedTitle'), body: voice.isGentle ? t('service.notify.missedGentle') : t('service.notify.missedBody'), action: { label: t('service.notify.adaptIt'), to: `/coach?prompt=${encodeURIComponent(t('service.notify.adaptPrompt'))}` } })
  }
  if (prefs.nutrition && hour >= 11 && hour < 14 && !selectTodayNutrition(s) && !has('nutrition')) {
    s.addNotification({ kind: 'nutrition', title: t('service.notify.lunchTitle'), body: t('service.notify.lunchBody'), action: { label: t('service.notify.planMeals'), to: `/coach?prompt=${encodeURIComponent(t('service.notify.planMealsPrompt'))}` } })
  }
  // Milestone: streaks.
  const done = workouts.filter((w) => w.status === 'completed').length
  if ([10, 25, 50, 100].includes(done) && !s.notifications.some((n) => n.kind === 'milestone' && n.title.includes(String(done)))) {
    s.addNotification({ kind: 'milestone', title: t('service.notify.milestoneTitle', { n: done, coach: s.coach.name }), body: t('service.notify.milestoneBody'), action: { label: t('service.notify.seeProgress'), to: '/progress' } })
  }
  // Tomorrow preview in the evening.
  if (prefs.morningPlan && hour >= 19) {
    const tomorrow = dayKey(addDays(now, 1))
    const next = Object.values(s.workouts).find((w) => w.scheduledFor === tomorrow && w.status === 'planned')
    if (next && !has('reminder', t('service.notify.tomorrowTitle'))) s.addNotification({ kind: 'reminder', title: t('service.notify.tomorrowTitle'), body: `${t('service.notify.tomorrowBody', { title: workoutTitle(next) })} ${timeOfDay(now) === 'evening' ? t('service.notify.sleepWell') : ''}`.trim(), action: { label: t('service.notify.preview'), to: `/workout/${next.id}` } })
  }
}

/** Ask for browser notification permission and mirror the latest in-app notification when granted. */
export async function requestPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

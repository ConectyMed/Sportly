import type { Attachment, CalendarEvent, Conversation, Message, Workout, WorkoutSummary } from '@/domain/types'
import { GOAL_LABELS } from '@/domain/labels'
import { addDays, dayKey, diffDays, formatShortDate, timeOfDayGreeting, todayKey } from '@/lib/dates'
import { formatMinutes, sleep, uid } from '@/lib/utils'
import { useStore, type AppState } from '@/store/useStore'
import { AnthropicCoachProvider } from './anthropicProvider'
import { detectPRs, generateInsights } from './insights'
import { LocalCoachProvider } from './localProvider'
import { generateNutritionPlan } from './nutritionGenerator'
import { buildVoice } from './personality'
import type { CoachAction, CoachContext, CoachProvider, CoachReply } from './provider'
import { computeReadiness } from './readiness'
import { generateWorkout, workoutVolume } from './workoutGenerator'

/**
 * Coach orchestration: UI → this service → provider → actions applied to the store.
 * The provider never touches the store; it returns actions and this layer applies them.
 */

const local = new LocalCoachProvider()

function providerFor(state: AppState): CoachProvider {
  if (state.coach.provider === 'anthropic' && state.coach.anthropicApiKey) return new AnthropicCoachProvider(state.coach.anthropicApiKey, state.coach.anthropicModel, local)
  return local
}

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

export function buildContext(state: AppState, conversation: Conversation): CoachContext {
  const user = state.user!
  const workouts = Object.values(state.workouts)
  const today = todayKey()
  const todayCheckIn = state.checkIns[today]
  const readiness = computeReadiness(todayCheckIn, workouts, today, user.sleepHoursTypical)
  const todayWorkout = selectTodayWorkout(state)
  const contextWorkout = conversation.context.lastWorkoutId ? state.workouts[conversation.context.lastWorkoutId] : undefined
  const targetPerWeek = user.availability.daysPerWeek
  return {
    now: new Date(),
    user,
    goals: state.goals,
    coach: state.coach,
    memory: state.memory,
    readiness,
    todayCheckIn,
    todayWorkout,
    contextWorkout: contextWorkout ?? todayWorkout,
    activeProgram: selectActiveProgram(state),
    todayNutrition: selectTodayNutrition(state),
    workouts,
    events: state.events,
    measurements: state.measurements,
    checkIns: state.checkIns,
    conversation,
    history: (state.messages[conversation.id] ?? []).slice(-12),
    insights: generateInsights({ workouts, measurements: state.measurements, checkIns: state.checkIns, goals: state.goals, targetPerWeek }),
    targetPerWeek,
  }
}

export function applyActions(actions: CoachAction[] | undefined): void {
  if (!actions?.length) return
  const s = useStore.getState()
  for (const a of actions) {
    switch (a.type) {
      case 'create_workout': {
        if (a.replaceWorkoutId && a.replaceWorkoutId !== a.workout.id) {
          const old = s.workouts[a.replaceWorkoutId]
          if (old && old.status === 'planned') s.deleteWorkout(a.replaceWorkoutId)
        }
        // Keep one planned workout per day: retire other planned ones for that date.
        for (const w of Object.values(useStore.getState().workouts)) {
          if (w.id !== a.workout.id && w.scheduledFor === a.workout.scheduledFor && w.status === 'planned' && !w.programId) s.deleteWorkout(w.id)
        }
        s.upsertWorkout(a.workout)
        ensureEventForWorkout(a.workout)
        break
      }
      case 'update_workout':
        s.upsertWorkout(a.workout)
        ensureEventForWorkout(a.workout)
        break
      case 'skip_workout':
        s.skipWorkout(a.workoutId)
        break
      case 'create_program': {
        if (a.replaceProgramId) {
          s.updateProgram(a.replaceProgramId, { status: 'cancelled' })
          s.removeEventsForProgram(a.replaceProgramId, todayKey())
        }
        s.upsertProgram(a.program)
        for (const w of a.workouts) s.upsertWorkout(w)
        s.upsertEvents(a.events)
        s.addNotification({ kind: 'plan_ready', title: `${a.program.name} is ready`, body: `${a.program.weeks} weeks, ${a.program.daysPerWeek} days a week. First session ${formatShortDate(a.program.startDate)}.`, action: { label: 'View program', to: `/program/${a.program.id}` } })
        break
      }
      case 'cancel_program':
        s.updateProgram(a.programId, { status: 'cancelled' })
        s.removeEventsForProgram(a.programId, todayKey())
        break
      case 'create_nutrition_plan':
        s.upsertNutritionPlan(a.plan)
        break
      case 'remember':
        s.addMemory(a.item)
        break
      case 'forget':
        s.removeMemory(a.memoryId)
        break
      case 'set_goal':
        s.upsertGoal(a.goal)
        break
      case 'check_in':
        s.setCheckIn(todayKey(), a.patch)
        break
      case 'move_event':
        s.moveEvent(a.eventId, a.toDate)
        break
      case 'log_measurement':
        s.addMeasurement(a.measurement)
        break
      case 'update_coach':
        s.updateCoach(a.patch)
        break
      case 'update_user':
        s.updateUser(a.patch)
        break
      case 'notify':
        s.addNotification({ kind: 'insight', title: a.title, body: a.body })
        break
    }
  }
}

export function ensureEventForWorkout(workout: Workout): void {
  const s = useStore.getState()
  const existing = s.events.find((e) => e.workoutId === workout.id)
  if (existing) {
    if (existing.title !== workout.title || existing.date !== workout.scheduledFor) s.upsertEvent({ ...existing, title: workout.title, date: workout.scheduledFor })
    return
  }
  const ev: CalendarEvent = {
    id: uid('evt'),
    type: 'workout',
    date: workout.scheduledFor,
    title: workout.title,
    workoutId: workout.id,
    programId: workout.programId,
    status: workout.status === 'completed' ? 'completed' : workout.status === 'skipped' ? 'skipped' : 'planned',
    createdAt: new Date().toISOString(),
  }
  s.upsertEvent(ev)
}

function activeConversation(): Conversation {
  const s = useStore.getState()
  const existing = s.conversations.find((c) => c.id === s.activeConversationId) ?? s.conversations[0]
  if (existing) {
    if (s.activeConversationId !== existing.id) s.setActiveConversation(existing.id)
    return existing
  }
  return s.createConversation()
}

let inflight = false

export async function sendMessage(text: string, attachments: Attachment[] = []): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed && !attachments.length) return
  if (inflight) return
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
    const conv = state.conversations.find((c) => c.id === conversation.id)!
    const ctx = buildContext(state, conv)
    const provider = providerFor(state)
    const started = Date.now()
    const reply = await provider.respond({ text: trimmed, attachments, context: ctx })
    if (reply.status) useStore.getState().setCoachTyping(true, reply.status)
    // Make the coach feel like it thinks — briefly, and only for the local engine.
    const think = provider.id === 'local' ? (reply.thinkMs ?? 800) : 0
    const elapsed = Date.now() - started
    if (think > elapsed) await sleep(think - elapsed)
    applyActions(reply.actions)
    commitReply(conversation.id, reply)
  } catch (err) {
    console.error('[coach] respond failed', err)
    const coach = useStore.getState().coach
    const voice = buildVoice(coach.personality)
    commitReply(conversation.id, {
      text: voice.compose({ core: 'Something went wrong on my side. Let’s try that again.', soft: 'Sorry,' }),
      suggestions: ['Try again', 'Build today’s workout'],
    })
  } finally {
    useStore.getState().setCoachTyping(false)
    inflight = false
  }
}

function commitReply(conversationId: string, reply: CoachReply): void {
  const s = useStore.getState()
  const msg: Message = {
    id: uid('msg'),
    conversationId,
    role: 'coach',
    text: reply.text,
    cards: reply.cards,
    suggestions: reply.suggestions,
    expects: reply.expects,
    createdAt: new Date().toISOString(),
    status: 'sent',
  }
  s.addMessage(msg)
  if (reply.contextPatch) s.updateConversationContext(conversationId, reply.contextPatch)
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
  const conv = s.createConversation('Getting started')
  const voice = buildVoice(s.coach.personality)
  const name = s.user.name.split(' ')[0]
  const goal = s.goals.find((g) => g.rank === 'primary')
  const secondary = s.goals.find((g) => g.rank === 'secondary')
  const days = s.user.availability.daysPerWeek
  const intro = voice.compose({
    core: `Hey ${name}. I’m ${s.coach.name}, your coach.\n\nI already know the basics: ${goal ? GOAL_LABELS[goal.type].toLowerCase() : 'general fitness'}${secondary ? ` with ${GOAL_LABELS[secondary.type].toLowerCase()} on the side` : ''}, ${days} days a week, about ${formatMinutes(s.user.availability.sessionMinutes)} a session. Let’s figure out what will actually work for you.`,
    reason: 'I will plan each session around how you are recovering, and I will remember what you tell me, so the more you talk to me the better the coaching gets.',
    calm: 'No pressure, we build this at your pace.',
    push: 'Let’s get moving.',
    quip: 'I do not have a face, but I do have opinions about rest periods.',
  })
  commitReply(conv.id, {
    text: intro,
    suggestions: ['Build today’s workout', 'Create a 12-week program', 'What should I eat today?', 'I only have 30 minutes'],
  })
  commitReply(conv.id, {
    text: voice.compose({ core: 'One useful question to start: how are you feeling today, honestly?', soft: 'If you feel like sharing,' }),
    suggestions: ['Feeling great', 'A bit tired', 'I slept badly'],
    expects: 'energy_scale',
  })
}

// ---------------------------------------------------------------------------
// Quick actions used by screens (no conversation turn)
// ---------------------------------------------------------------------------

export function generateTodayWorkoutQuick(): Workout {
  const s = useStore.getState()
  const workouts = Object.values(s.workouts)
  const readiness = computeReadiness(s.checkIns[todayKey()], workouts, todayKey(), s.user!.sleepHoursTypical)
  const w = generateWorkout({ user: s.user!, goals: s.goals, history: workouts, readiness, seed: `${todayKey()}-${workouts.length}-quick` })
  applyActions([{ type: 'create_workout', workout: w }])
  return w
}

export function ensureTodayNutrition() {
  const s = useStore.getState()
  const existing = selectTodayNutrition(s)
  if (existing) return existing
  const tw = selectTodayWorkout(s)
  const plan = generateNutritionPlan({ user: s.user!, goals: s.goals, isTrainingDay: Boolean(tw && tw.status !== 'skipped'), seed: `${todayKey()}-${s.user!.id}` })
  s.upsertNutritionPlan(plan)
  return plan
}

export function finishWorkout(workoutId: string, feeling?: WorkoutSummary['feeling'], notes?: string): WorkoutSummary | undefined {
  const s = useStore.getState()
  const w = s.workouts[workoutId]
  if (!w) return undefined
  const history = Object.values(s.workouts)
  const startedAt = w.startedAt ? new Date(w.startedAt).getTime() : Date.now() - w.estimatedMinutes * 60_000
  const durationSec = Math.max(60, Math.round((Date.now() - startedAt) / 1000))
  const setsPlanned = w.exercises.reduce((a, e) => a + e.sets.length, 0)
  const setsCompleted = w.exercises.reduce((a, e) => a + e.sets.filter((x) => x.completed).length, 0)
  const exercisesCompleted = w.exercises.filter((e) => e.sets.some((x) => x.completed)).length
  const prs = detectPRs(w, history)
  const summary: WorkoutSummary = {
    durationSec,
    totalVolumeKg: workoutVolume(w),
    setsCompleted,
    setsPlanned,
    exercisesCompleted,
    prs: prs.map((p) => ({ exerciseId: p.exerciseId, name: p.name, weightKg: p.weightKg, reps: p.reps, e1rm: p.e1rm })),
    feeling,
    notes,
  }
  s.completeWorkout(workoutId, summary)
  if (feeling) s.addMemory({ category: 'reaction', text: `${w.title} on ${formatShortDate(new Date())} felt ${feeling}${notes ? `: ${notes}` : ''}`, source: 'inferred' })
  // The coach acknowledges in the conversation.
  const voice = buildVoice(s.coach.personality)
  const ratio = setsPlanned ? setsCompleted / setsPlanned : 1
  const core =
    ratio >= 0.9
      ? `${voice.cheer(workoutId)} ${w.title} done: ${setsCompleted} of ${setsPlanned} sets, ${Math.round(summary.totalVolumeKg).toLocaleString()} kg moved in ${formatMinutes(Math.round(durationSec / 60))}.`
      : `${w.title} logged: ${setsCompleted} of ${setsPlanned} sets. A shorter session still counts.`
  const prLine = prs.length ? `New best on ${prs.map((p) => `${p.name} (${p.weightKg} kg × ${p.reps})`).join(', ')}.` : undefined
  coachSays(
    voice.compose({ core, reason: prLine, extra: 'Eat within a couple of hours and prioritise protein tonight.', calm: 'Rest well.', push: 'Recover like it matters, because it does.', quip: 'Your muscles are filing a formal complaint. Approved.' }),
    { suggestions: ['What should I eat now?', 'How did I do this week?', 'Plan tomorrow'] },
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
        new Notification(n.title, { body: n.body, icon: '/icons/icon-192.png', tag: n.id })
      } catch {
        /* not supported in this context */
      }
    }
  }
  queueMicrotask(mirror)
  const workouts = Object.values(s.workouts)
  const readiness = computeReadiness(s.checkIns[todayKey()], workouts, todayKey(), s.user.sleepHoursTypical)

  if (prefs.morningPlan && hour >= 6 && hour < 12 && tw && tw.status === 'planned' && !has('plan_ready')) {
    s.addNotification({ kind: 'plan_ready', title: voice.isIntense ? 'Your plan is ready. Let’s go.' : 'Good morning. Your plan is ready.', body: `${tw.title}, about ${formatMinutes(tw.estimatedMinutes)}.`, action: { label: 'See today', to: '/' } })
  }
  if (prefs.recoveryInsights && readiness.hasCheckIn && readiness.recommendation === 'push' && !has('recovery')) {
    s.addNotification({ kind: 'recovery', title: 'You’re recovering well today', body: voice.isIntense ? 'We push harder today.' : 'We can push a little harder if you feel like it.', action: { label: 'Talk to coach', to: '/coach' } })
  }
  if (prefs.missedWorkoutNudge && hour >= 17 && tw && tw.status === 'planned' && !has('missed')) {
    s.addNotification({ kind: 'missed', title: 'You haven’t trained today', body: voice.isGentle ? 'Want me to adapt your workout to the time you have?' : 'Want me to adapt your workout? Even 20 minutes counts.', action: { label: 'Adapt it', to: '/coach?prompt=I%20only%20have%2020%20minutes' } })
  }
  if (prefs.nutrition && hour >= 11 && hour < 14 && !selectTodayNutrition(s) && !has('nutrition')) {
    s.addNotification({ kind: 'nutrition', title: 'Lunch plan?', body: 'I can put together today’s meals around your training.', action: { label: 'Plan meals', to: '/coach?prompt=What%20should%20I%20eat%20today%3F' } })
  }
  // Milestone: streaks.
  const done = workouts.filter((w) => w.status === 'completed').length
  if ([10, 25, 50, 100].includes(done) && !s.notifications.some((n) => n.kind === 'milestone' && n.title.includes(String(done)))) {
    s.addNotification({ kind: 'milestone', title: `${done} workouts with ${s.coach.name}`, body: 'Consistency is the whole game. This is what it looks like.', action: { label: 'See progress', to: '/progress' } })
  }
  // Tomorrow preview in the evening.
  if (prefs.morningPlan && hour >= 19) {
    const tomorrow = dayKey(addDays(now, 1))
    const next = Object.values(s.workouts).find((w) => w.scheduledFor === tomorrow && w.status === 'planned')
    if (next && !has('reminder', 'Tomorrow')) s.addNotification({ kind: 'reminder', title: 'Tomorrow', body: `${next.title} is on the plan. ${timeOfDayGreeting(now) === 'Good evening' ? 'Sleep well tonight.' : ''}`.trim(), action: { label: 'Preview', to: `/workout/${next.id}` } })
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

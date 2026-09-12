import { generateWorkout, workoutVolume } from '@/coach/workoutGenerator'
import { generateNutritionPlan } from '@/coach/nutritionGenerator'
import type { SeedPayload } from '@/store/useStore'
import { addDays, dayKey, startOfWeek, todayKey } from '@/lib/dates'
import { hashString, round, uid } from '@/lib/utils'
import type { AppNotification, CalendarEvent, Conversation, DailyCheckIn, Goal, Measurement, MemoryItem, Message, UserProfile, Workout } from './types'

/**
 * Fictional demo user. Everything here is invented and generated deterministically
 * relative to "today" so the app always launches with a living history.
 */
export function buildDemoSeed(): SeedPayload {
  const now = new Date()
  const today = todayKey()
  const createdAt = addDays(now, -77).toISOString()
  const userId = 'usr_demo_alex'

  const user: UserProfile = {
    id: userId,
    name: 'Alex',
    age: 27,
    sex: 'unspecified',
    heightCm: 178,
    weightKg: 74.2,
    level: 'intermediate',
    yearsTraining: 2,
    sports: ['Running (casual)', 'Climbing'],
    equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bench', 'pullup_bar', 'cardio_machine', 'bodyweight'],
    trainsAt: 'gym',
    availability: { daysPerWeek: 4, preferredDays: [1, 2, 4, 5], sessionMinutes: 50, preferredTime: 'morning' },
    diet: 'omnivore',
    dietaryFlags: [],
    dislikedFoods: ['Mushrooms'],
    lifestyle: 'moderate',
    sleepHoursTypical: 7,
    createdAt,
    onboardedAt: createdAt,
    isDemo: true,
  }

  const goals: Goal[] = [
    { id: 'goal_primary', type: 'build_muscle', rank: 'primary', label: 'Build muscle', metric: 'body_weight', targetValue: 77, targetUnit: 'kg', startValue: 72.4, createdAt },
    { id: 'goal_secondary', type: 'conditioning', rank: 'secondary', label: 'Improve conditioning', metric: 'workouts_per_week', targetValue: 4, targetUnit: '/week', createdAt },
  ]

  const coach = {
    name: 'Nova',
    personality: { motivation: 55, tone: 58, humor: 40, communication: 42 },
    provider: 'local' as const,
    anthropicModel: 'claude-sonnet-5',
  }

  const mem = (category: MemoryItem['category'], text: string, daysAgo: number, source: MemoryItem['source'] = 'conversation'): MemoryItem => ({
    id: uid('mem'),
    category,
    text,
    source,
    createdAt: addDays(now, -daysAgo).toISOString(),
  })
  const memory: MemoryItem[] = [
    mem('goal', 'Primary goal is building muscle; wants to reach 77 kg lean', 77, 'onboarding'),
    mem('goal', 'Secondary goal: better conditioning for climbing', 77, 'onboarding'),
    mem('availability', 'Trains Monday, Tuesday, Thursday and Friday, usually around 7am before work', 77, 'onboarding'),
    mem('equipment', 'Full commercial gym; prefers free weights over machines', 70),
    mem('preference', 'Dislikes long steady-state cardio; likes bike intervals', 61),
    mem('nutrition', 'Eats everything, but no mushrooms', 77, 'onboarding'),
    mem('nutrition', 'Struggles to hit protein on busy days; shakes help', 40),
    mem('health', 'Mild left shoulder tightness on overhead pressing in spring; fine since switching to dumbbells', 48),
    mem('habit', 'Sleeps ~7h on weeknights, less before early flights', 33),
    mem('reaction', 'Enjoys Bulgarian split squats far more than lunges', 26),
    mem('history', 'Ran an 8-week upper/lower block in spring; bench went from 70 to 80 kg', 55),
    mem('communication', 'Prefers short answers with one clear next step', 60),
    mem('habit', 'Climbs on Saturday afternoons; keep Saturday legs light', 20),
  ]

  // ---- Training history: ~10 weeks, upper/lower, 4x/week with a few realistic misses.
  const workouts: Record<string, Workout> = {}
  const events: CalendarEvent[] = []
  const checkIns: Record<string, DailyCheckIn> = {}
  const measurements: Measurement[] = []
  const history: Workout[] = []

  const weekStart = startOfWeek(now)
  const firstWeek = addDays(weekStart, -7 * 10)
  const rotation = ['upper', 'lower', 'upper', 'lower'] as const
  const preferred = user.availability.preferredDays

  let sessionIndex = 0
  for (let w = 0; w < 11; w++) {
    preferred.forEach((dow, di) => {
      const offset = (dow + 6) % 7
      const date = addDays(firstWeek, w * 7 + offset)
      const key = dayKey(date)
      if (key > today) return
      const seed = hashString(`demo-${w}-${di}`)
      const isToday = key === today
      // Realistic misses: a travel week and a couple of odd days.
      const missed = (w === 4 && di >= 2) || seed % 19 === 0
      // Weight progression: loads climb over time; feed prior sessions as history.
      const readinessScore = 60 + (seed % 35)
      const workout = generateWorkout({
        user: { ...user, weightKg: 72.4 + (w / 10) * 1.8 },
        goals,
        history,
        constraints: { focus: rotation[di % 4], minutes: 50 },
        date: key,
        seed: `demo-${w}-${di}`,
        readiness: undefined,
      })
      workout.id = `wk_demo_${w}_${di}`
      workout.createdAt = addDays(date, -1).toISOString()
      const sleepHours = round(5.6 + ((seed >> 3) % 23) / 10, 1)
      checkIns[key] = {
        date: key,
        sleepHours,
        sleepQuality: (sleepHours >= 7.5 ? 4 : sleepHours >= 6.5 ? 3 : 2) as 2 | 3 | 4,
        energy: Math.min(10, Math.max(3, Math.round(readinessScore / 10))),
        createdAt: date.toISOString(),
      }
      if (isToday) {
        // Today's session is planned, not done.
        workout.status = 'planned'
        workouts[workout.id] = workout
        events.push({ id: uid('evt'), type: 'workout', date: key, title: workout.title, workoutId: workout.id, status: 'planned', createdAt: workout.createdAt })
        return
      }
      if (missed) {
        // Skips correlate with short sleep, which the insights engine will notice.
        checkIns[key].sleepHours = round(4.8 + (seed % 12) / 10, 1)
        checkIns[key].sleepQuality = 1
        workout.status = 'skipped'
        workouts[workout.id] = workout
        events.push({ id: uid('evt'), type: 'workout', date: key, title: workout.title, workoutId: workout.id, status: 'skipped', createdAt: workout.createdAt })
        return
      }
      // Complete the session with realistic actuals.
      const startHour = seed % 5 === 0 ? 18 : 7
      const started = new Date(date)
      started.setHours(startHour, 5 + (seed % 20), 0, 0)
      const durationSec = (44 + (seed % 14)) * 60
      workout.exercises = workout.exercises.map((e, ei) => ({
        ...e,
        sets: e.sets.map((s, si) => {
          const lastSetFail = (seed + ei + si) % 9 === 0 && si === e.sets.length - 1
          return {
            ...s,
            completed: !((seed + ei) % 17 === 0 && si === e.sets.length - 1 && ei > 3),
            actualReps: lastSetFail ? Math.max(1, s.targetReps - 2) : s.targetReps,
            actualWeightKg: s.targetWeightKg,
            actualSeconds: s.targetSeconds,
          }
        }),
      }))
      workout.status = 'completed'
      workout.startedAt = started.toISOString()
      workout.completedAt = new Date(started.getTime() + durationSec * 1000).toISOString()
      const setsPlanned = workout.exercises.reduce((a, e) => a + e.sets.length, 0)
      const setsCompleted = workout.exercises.reduce((a, e) => a + e.sets.filter((x) => x.completed).length, 0)
      workout.summary = {
        durationSec,
        totalVolumeKg: workoutVolume(workout),
        setsCompleted,
        setsPlanned,
        exercisesCompleted: workout.exercises.length,
        prs: [],
        feeling: (['good', 'great', 'ok', 'good'] as const)[seed % 4],
      }
      workouts[workout.id] = workout
      history.push(workout)
      events.push({ id: uid('evt'), type: 'workout', date: key, title: workout.title, workoutId: workout.id, status: 'completed', createdAt: workout.createdAt })
      sessionIndex++
    })
  }

  // Upcoming sessions this week (planned) so the calendar and home feel alive.
  for (let i = 1; i <= 6; i++) {
    const d = addDays(now, i)
    if (!preferred.includes(d.getDay())) continue
    const key = dayKey(d)
    if (d > addDays(weekStart, 13)) break
    const focusIdx = preferred.indexOf(d.getDay())
    const w = generateWorkout({ user, goals, history, constraints: { focus: rotation[focusIdx % 4], minutes: 50 }, date: key, seed: `demo-up-${key}` })
    w.id = `wk_demo_up_${i}`
    workouts[w.id] = w
    events.push({ id: uid('evt'), type: 'workout', date: key, title: w.title, workoutId: w.id, status: 'planned', createdAt: now.toISOString() })
  }

  // ---- Body weight: slow, noisy gain from 72.4 → ~74.2 with a recent 3-week plateau.
  for (let d = 76; d >= 0; d -= 2) {
    const date = addDays(now, -d)
    const key = dayKey(date)
    const progress = (76 - d) / 76
    const base = 72.4 + progress * 1.8
    const plateau = d <= 21 ? 74.2 - base : 0
    const noise = ((hashString(`w-${key}`) % 60) - 30) / 100
    measurements.push({ id: uid('meas'), type: 'body_weight', value: round(base + plateau + noise, 1), unit: 'kg', date: key, createdAt: date.toISOString(), source: 'demo' })
  }
  measurements.push({ id: uid('meas'), type: 'body_weight', value: 74.2, unit: 'kg', date: today, createdAt: now.toISOString(), source: 'demo' })
  for (let d = 13; d >= 0; d--) {
    const date = addDays(now, -d)
    const key = dayKey(date)
    measurements.push({ id: uid('meas'), type: 'steps', value: 6500 + (hashString(`s-${key}`) % 5000), unit: 'steps', date: key, createdAt: date.toISOString(), source: 'demo' })
    const ci = checkIns[key]
    if (ci?.sleepHours) measurements.push({ id: uid('meas'), type: 'sleep_hours', value: ci.sleepHours, unit: 'h', date: key, createdAt: date.toISOString(), source: 'demo' })
  }
  // Today's check-in: a good night.
  checkIns[today] = { date: today, sleepHours: 7.6, sleepQuality: 4, energy: 8, fatigue: 3, soreness: 3, mood: 'good', createdAt: now.toISOString() }

  // ---- Conversations
  const conversations: Conversation[] = []
  const messages: Record<string, Message[]> = {}
  const todayWorkout = Object.values(workouts).find((w) => w.scheduledFor === today && w.status === 'planned')

  const conv = (title: string, daysAgo: number, ctx: Conversation['context'], msgs: Array<[Message['role'], string, Partial<Message>?]>) => {
    const id = uid('conv')
    const base = addDays(now, -daysAgo)
    const c: Conversation = { id, title, createdAt: base.toISOString(), updatedAt: base.toISOString(), context: ctx }
    conversations.push(c)
    messages[id] = msgs.map(([role, text, extra], i) => ({
      id: uid('msg'),
      conversationId: id,
      role,
      text,
      createdAt: new Date(base.getTime() + i * 45_000).toISOString(),
      status: 'sent',
      ...(extra ?? {}),
    }))
    return c
  }

  conv('Today', 0, { topic: 'workout', lastWorkoutId: todayWorkout?.id }, [
    ['coach', 'Morning, Alex. 7.6 hours of sleep and low soreness: readiness is looking good today.'],
    ['user', 'What should I do today?'],
    [
      'coach',
      todayWorkout
        ? `Today is ${todayWorkout.title}: about ${todayWorkout.estimatedMinutes} min, ${todayWorkout.exercises.length} exercises. You are recovering well, so there is room to push the first two compounds.`
        : 'Nothing is scheduled today. Want me to build something?',
      {
        cards: todayWorkout ? [{ id: uid('card'), type: 'workout', refId: todayWorkout.id, title: todayWorkout.title, subtitle: `${todayWorkout.estimatedMinutes} min · ${todayWorkout.exercises.length} exercises` }] : undefined,
        suggestions: ['Start it', 'Make it shorter', 'What should I eat?'],
      },
    ],
  ])

  conv('Restaurant tonight', 6, { topic: 'nutrition' }, [
    ['user', 'I’m eating at a restaurant tonight'],
    ['coach', 'No problem. I adjusted the rest of your day around it: lighter, protein-forward meals earlier so dinner has room. Order a protein main, add vegetables, and pick one indulgence you actually want.', { suggestions: ['What should I order?'] }],
    ['user', 'Thanks'],
    ['coach', 'Anytime. Enjoy it properly.'],
  ])

  conv('Shoulder check', 48, { topic: 'recovery' }, [
    ['user', 'My left shoulder feels tight on overhead press'],
    ['coach', 'Got it. Mild shoulder discomfort: we work around it, not through it. I swapped Overhead Press for Dumbbell Shoulder Press and kept today lighter. If it sharpens, swells, or lasts more than a few days, see a physio.'],
    ['user', 'Remember that dumbbells feel better for my shoulder'],
    ['coach', 'Noted: “Dumbbells feel better for my shoulder.” I will factor that in from now on.'],
  ])

  // Sort: newest first.
  conversations.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))

  const notifications: AppNotification[] = [
    { id: uid('ntf'), kind: 'recovery', title: 'You’re recovering well today', body: 'We can push a little harder on the first two lifts.', createdAt: new Date(now.getTime() - 40 * 60_000).toISOString(), read: false, action: { label: 'Talk to Nova', to: '/coach' } },
    { id: uid('ntf'), kind: 'insight', title: 'Four weeks consistent', body: 'You have hit your sessions four weeks in a row. This is where it compounds.', createdAt: addDays(now, -1).toISOString(), read: true, action: { label: 'See progress', to: '/progress' } },
    { id: uid('ntf'), kind: 'plan_ready', title: 'Good morning. Your plan is ready.', body: todayWorkout ? `${todayWorkout.title}, about ${todayWorkout.estimatedMinutes} min.` : 'Tap to see today.', createdAt: new Date(now.getTime() - 3 * 3600_000).toISOString(), read: true, action: { label: 'See today', to: '/' } },
  ]

  const nutrition = generateNutritionPlan({ user, goals, isTrainingDay: true, seed: `${today}-${userId}` })

  void sessionIndex
  return {
    user,
    goals,
    coach,
    memory,
    conversations,
    messages,
    workouts,
    programs: {},
    nutritionPlans: { [nutrition.id]: nutrition },
    measurements,
    checkIns,
    events,
    notifications,
  }
}

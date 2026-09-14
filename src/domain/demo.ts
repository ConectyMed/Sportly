import { generateWorkout, workoutVolume } from '@/coach/workoutGenerator'
import { analyzeDescription, buildMeal } from '@/coach/food/foodAnalysis'
import { generateNutritionPlan } from '@/coach/nutritionGenerator'
import { workoutTitle } from '@/domain/labels'
import { t, tn } from '@/i18n'
import { foodItemName, mealDisplayName } from '@/coach/food/foodAnalysis'
import { formatMinutes } from '@/lib/utils'
import type { SeedPayload } from '@/store/useStore'
import { addDays, dayKey, startOfWeek, todayKey } from '@/lib/dates'
import { hashString, round, uid } from '@/lib/utils'
import type { AppNotification, CalendarEvent, Conversation, DailyCheckIn, Goal, LoggedMeal, Measurement, MemoryItem, Message, UserProfile, Workout } from './types'

/**
 * Fictional demo user. Everything here is invented and generated deterministically
 * relative to "today" so the app always launches with a living history.
 * Domain data (workouts, foods, goals) is language-independent; the memories,
 * conversations and notifications are written in the user's language at seed time.
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
    dislikedExercises: ['burpee'],
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
    mem('goal', t('demo.mem.goalPrimary'), 77, 'onboarding'),
    mem('goal', t('demo.mem.goalSecondary'), 77, 'onboarding'),
    mem('availability', t('demo.mem.availability'), 77, 'onboarding'),
    mem('equipment', t('demo.mem.equipment'), 70),
    mem('preference', t('demo.mem.cardio'), 61),
    mem('nutrition', t('demo.mem.mushrooms'), 77, 'onboarding'),
    mem('nutrition', t('demo.mem.protein'), 40),
    mem('health', t('demo.mem.shoulder'), 48),
    mem('habit', t('demo.mem.sleep'), 33),
    mem('reaction', t('demo.mem.splitSquats'), 26),
    mem('history', t('demo.mem.block'), 55),
    mem('communication', t('demo.mem.communication'), 60),
    mem('habit', t('demo.mem.climbing'), 20),
    mem('preference', t('demo.mem.burpees'), 15),
    mem('nutrition', t('demo.mem.breakfast'), 12, 'inferred'),
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

  // ---- Food journal: meals are analysed from text like a real log, so totals are derived, never typed in.
  const meals: Record<string, LoggedMeal> = {}
  const logMeal = (daysAgo: number, hour: number, slot: LoggedMeal['slot'], description: string, opts: { source?: LoggedMeal['source']; id?: string } = {}) => {
    const at = new Date(addDays(now, -daysAgo))
    at.setHours(hour, 5 + (hashString(description) % 40), 0, 0)
    if (at.getTime() > now.getTime()) return undefined
    const meal = buildMeal(analyzeDescription(description), { date: dayKey(at), slot, source: opts.source ?? 'text', status: 'logged' })
    meal.id = opts.id ?? `meal_demo_${daysAgo}_${slot}`
    meal.createdAt = at.toISOString()
    meal.updatedAt = at.toISOString()
    meals[meal.id] = meal
    return meal
  }
  logMeal(0, 7, 'breakfast', '80 g oats, a banana and a whey shake')
  logMeal(0, 12, 'lunch', '200 g chicken breast, 180 g rice and broccoli')
  logMeal(1, 7, 'breakfast', '3 eggs, 2 slices of toast and an apple')
  logMeal(1, 13, 'lunch', 'salmon with 150 g rice and a salad')
  logMeal(1, 16, 'snack', 'greek yogurt with a handful of almonds')
  logMeal(1, 19, 'dinner', 'beef mince with pasta and tomato sauce')
  const scannedMeal = logMeal(2, 13, 'lunch', 'chicken burrito bowl with rice, black beans and avocado', { source: 'scan', id: 'meal_demo_scan' })

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

  const wTitle = todayWorkout ? workoutTitle(todayWorkout) : ''
  conv(t('demo.conv.today'), 0, { topic: 'workout', lastWorkoutId: todayWorkout?.id }, [
    ['coach', t('demo.conv.todayHello')],
    ['user', t('demo.conv.todayAsk')],
    [
      'coach',
      todayWorkout ? t('demo.conv.todayWorkout', { title: wTitle, minutes: formatMinutes(todayWorkout.estimatedMinutes), exercises: tn('common.exercises', todayWorkout.exercises.length) }) : t('demo.conv.todayRest'),
      {
        cards: todayWorkout ? [{ id: uid('card'), type: 'workout', refId: todayWorkout.id, title: wTitle, subtitle: t('coach.card.workoutSubtitle', { minutes: formatMinutes(todayWorkout.estimatedMinutes), exercises: tn('common.exercises', todayWorkout.exercises.length) }) }] : undefined,
        suggestions: todayWorkout ? [t('coach.sug.startIt'), t('coach.sug.makeShorter'), t('coach.sug.whatEat')] : [t('coach.sug.buildToday'), t('demo.conv.lightSession'), t('coach.sug.whatEat')],
      },
    ],
  ])

  if (scannedMeal) {
    const mealName = mealDisplayName(scannedMeal)
    conv(t('demo.conv.lunchScan'), 2, { topic: 'nutrition', lastMealId: scannedMeal.id }, [
      ['user', t('demo.conv.lunchAte')],
      [
        'coach',
        t('demo.conv.lunchCount', { items: scannedMeal.items.map((i) => foodItemName(i).toLowerCase()).join(', '), kcal: scannedMeal.calories, protein: scannedMeal.proteinG }),
        { cards: [{ id: uid('card'), type: 'food', refId: scannedMeal.id, title: mealName, subtitle: t('coach.card.foodSubtitle', { kcal: scannedMeal.calories, protein: scannedMeal.proteinG }) }], suggestions: [t('coach.sug.moreRice'), t('coach.sug.addItTo', { slot: t('coach.slotTo.lunch') })] },
      ],
      ['user', t('coach.sug.addItTo', { slot: t('coach.slotTo.lunch') })],
      ['coach', t('demo.conv.lunchAdded', { meal: mealName }), { suggestions: [t('coach.sug.whatEatTonight'), t('coach.sug.proteinLeft')] }],
    ])
  }

  conv(t('demo.conv.restaurant'), 6, { topic: 'nutrition' }, [
    ['user', t('coach.sug.restaurantTonight')],
    ['coach', t('demo.conv.restaurantReply'), { suggestions: [t('coach.sug.whatOrder')] }],
    ['user', t('demo.conv.thanks')],
    ['coach', t('demo.conv.anytime')],
  ])

  conv(t('demo.conv.shoulder'), 48, { topic: 'recovery' }, [
    ['user', t('demo.conv.shoulderUser')],
    ['coach', t('demo.conv.shoulderReply')],
    ['user', t('demo.conv.shoulderRemember')],
    ['coach', t('demo.conv.shoulderNoted')],
  ])

  // Sort: newest first.
  conversations.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))

  const notifications: AppNotification[] = [
    { id: uid('ntf'), kind: 'recovery', title: t('demo.ntf.recoveryTitle'), body: t('demo.ntf.recoveryBody'), createdAt: new Date(now.getTime() - 40 * 60_000).toISOString(), read: false, action: { label: t('demo.ntf.talkTo', { name: coach.name }), to: '/coach' } },
    { id: uid('ntf'), kind: 'insight', title: t('demo.ntf.consistentTitle'), body: t('demo.ntf.consistentBody'), createdAt: addDays(now, -1).toISOString(), read: true, action: { label: t('demo.ntf.seeProgress'), to: '/progress' } },
    { id: uid('ntf'), kind: 'plan_ready', title: t('demo.ntf.planTitle'), body: todayWorkout ? t('demo.ntf.planBody', { title: wTitle, minutes: formatMinutes(todayWorkout.estimatedMinutes) }) : t('demo.ntf.planBodyRest'), createdAt: new Date(now.getTime() - 3 * 3600_000).toISOString(), read: true, action: { label: t('demo.ntf.seeToday'), to: '/' } },
  ]

  const nutrition = generateNutritionPlan({ user, goals, isTrainingDay: Boolean(todayWorkout), seed: `${today}-${userId}` })

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
    meals,
    measurements,
    checkIns,
    events,
    notifications,
  }
}

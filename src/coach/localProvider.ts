import { EQUIPMENT_LABELS, getExercise } from '@/domain/exercises'
import { FOCUS_LABELS, GOAL_LABELS } from '@/domain/labels'
import type { CoachCard, Goal, LoggedMeal, Meal, MemoryItem, Workout } from '@/domain/types'
import { analyzeDescription, applyCorrection, buildMeal, confidenceLabel, slotForTime, totalsOf, type FoodAnalysis } from './food/foodAnalysis'
import { computeTargets } from './nutritionGenerator'
import { addDays, dayKey, formatShortDate, fromDayKey, nextWeekday, timeOfDayGreeting, todayKey, weekdayName } from '@/lib/dates'
import { clamp, formatMinutes, plural, round, uid } from '@/lib/utils'
import { consistencyStreak, personalRecords, weeklyStats, weightTrend } from './insights'
import { parseIntent, parseSlot, type Intent, type WorkoutChange } from './intents'
import { generateNutritionPlan } from './nutritionGenerator'
import { buildVoice, type Voice } from './personality'
import { generateProgram, materializeProgram, programWeekFor } from './programGenerator'
import type { CoachAction, CoachContext, CoachProvider, CoachReply, CoachRequest } from './provider'
import { computeReadiness } from './readiness'
import { generateWorkout, primaryGoal, removeCardio, replaceExercise, restrictEquipment, scaleIntensity, shortenWorkout } from './workoutGenerator'

/**
 * The local coach. No network, no credentials: a structured, context-aware engine
 * that reads real app state, generates real entities and triggers real actions.
 * It is the default provider and the fallback when a remote model is unavailable.
 */
export class LocalCoachProvider implements CoachProvider {
  id = 'local' as const

  async respond(req: CoachRequest): Promise<CoachReply> {
    const { context: ctx } = req
    const last = [...ctx.history].reverse().find((m) => m.role === 'coach')
    const intent = parseIntent(req.text, {
      expects: last?.expects,
      topic: ctx.conversation.context.topic,
      hasAttachments: req.attachments.length > 0,
      hasWorkout: Boolean(ctx.contextWorkout && ctx.contextWorkout.status !== 'completed'),
      hasMeal: Boolean(ctx.contextMeal),
      lastAvailabilityScope: ctx.conversation.context.lastAvailabilityScope,
    })
    const voice = buildVoice(ctx.coach.personality)
    return respond(intent, req, ctx, voice)
  }
}

/** Run the local engine for a pre-parsed intent (used by remote providers to materialise actions). */
export function respondToIntent(intent: Intent, req: CoachRequest, ctx: CoachContext): CoachReply {
  return respond(intent, req, ctx, buildVoice(ctx.coach.personality))
}

// ---------------------------------------------------------------------------

function firstName(ctx: CoachContext): string {
  return ctx.user.name.split(' ')[0]
}

function workoutCard(w: Workout): CoachCard {
  return { id: uid('card'), type: 'workout', refId: w.id, title: w.title, subtitle: `${formatMinutes(w.estimatedMinutes)} · ${w.exercises.length} exercises` }
}

function readinessLine(ctx: CoachContext): string {
  const r = ctx.readiness
  if (!r.hasCheckIn) return ''
  if (r.recommendation === 'push') return 'You are recovering well, so there is room to push a little.'
  if (r.recommendation === 'lighter') return 'Your readiness is a bit low, so I kept the load honest.'
  if (r.recommendation === 'rest') return 'Your body is asking for recovery today, so this is deliberately light.'
  return ''
}

function suggestionsForWorkout(): string[] {
  return ['Make it shorter', 'I only have dumbbells', 'Swap an exercise', 'Start it']
}

function respond(intent: Intent, req: CoachRequest, ctx: CoachContext, voice: Voice): CoachReply {
  const name = firstName(ctx)
  const coachName = ctx.coach.name
  const goal = primaryGoal(ctx.goals)
  const today = todayKey()
  const workout = ctx.contextWorkout && ctx.contextWorkout.status !== 'completed' ? ctx.contextWorkout : ctx.todayWorkout
  const withWorkoutContext = (w: Workout) => ({ lastWorkoutId: w.id, topic: 'workout' as const })

  switch (intent.kind) {
    case 'greeting': {
      const tod = timeOfDayGreeting(ctx.now)
      const w = ctx.todayWorkout
      const lines: string[] = [voice.greeting(name, tod)]
      if (w && w.status === 'planned') lines.push(`${w.title} is on for today, about ${formatMinutes(w.estimatedMinutes)}.`)
      else if (w && w.status === 'completed') lines.push(`You already trained today. ${voice.cheer(today)}`)
      else lines.push('Nothing planned yet today. Want me to build something?')
      return {
        text: voice.compose({ core: lines.join(' '), quip: undefined, push: w?.status === 'planned' ? 'Let’s make it count.' : undefined, calm: 'No rush.' }),
        suggestions: w?.status === 'planned' ? ['Start my workout', 'Make it shorter', 'What should I eat?'] : ['Build today’s workout', 'Plan my week', 'What should I eat?'],
        thinkMs: 500,
      }
    }

    case 'today_plan': {
      const w = ctx.todayWorkout
      const r = ctx.readiness
      const rLine = r.hasCheckIn ? `Readiness is ${r.score}% (${r.label.toLowerCase()}).` : ''
      if (w && w.status === 'planned') {
        return {
          text: voice.compose({
            core: `Today is ${w.title}: ${formatMinutes(w.estimatedMinutes)}, ${w.exercises.length} exercises. ${rLine}`.trim(),
            reason: r.recommendation === 'push' ? 'You are fresh, so treat the compounds as an opportunity.' : r.recommendation === 'lighter' ? 'I would keep the accessories moderate and nail the main lifts.' : undefined,
            soft: 'If it helps,',
            extra: w.coachNote,
          }),
          cards: [workoutCard(w)],
          suggestions: ['Start it', 'Make it shorter', 'Something different'],
          contextPatch: withWorkoutContext(w),
        }
      }
      if (w && w.status === 'completed') {
        return {
          text: voice.compose({ core: `You already trained today (${w.title}). ${rLine} The best thing now is food, water and sleep.`, calm: 'Let it land.', push: 'Recover like you mean it.' }),
          suggestions: ['What should I eat?', 'Plan tomorrow', 'Analyze my progress'],
        }
      }
      if (r.recommendation === 'rest' && r.hasCheckIn) {
        const rest = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness: r, constraints: { focus: 'core_mobility', minutes: 20 }, seed: `${today}-rest` })
        rest.title = 'Recovery Flow'
        return {
          text: voice.compose({ core: `${rLine} I would take a real recovery day: a 20-minute mobility flow, a walk and an early night.`, soft: 'If you are open to it,', calm: 'Recovery is training too.', push: 'Rest is part of the plan, not a break from it.' }),
          cards: [workoutCard(rest)],
          actions: [{ type: 'create_workout', workout: rest }],
          suggestions: ['Start it', 'I want a real workout', 'What should I eat?'],
          contextPatch: withWorkoutContext(rest),
          status: 'Checking your recovery',
        }
      }
      const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness: r, seed: `${today}-${ctx.workouts.length}` })
      return {
        text: voice.compose({
          core: `Nothing was scheduled, so I built one: ${gen.title}, ${formatMinutes(gen.estimatedMinutes)}. ${rLine} ${readinessLine(ctx)}`.replace(/\s+/g, ' ').trim(),
          reason: `It follows what you trained last and keeps your ${GOAL_LABELS[goal].toLowerCase()} goal in focus.`,
          extra: 'Every load is a suggestion based on your history. Adjust in the session if it feels off.',
        }),
        cards: [workoutCard(gen)],
        actions: [{ type: 'create_workout', workout: gen }],
        suggestions: suggestionsForWorkout(),
        contextPatch: withWorkoutContext(gen),
        status: 'Building your workout',
        thinkMs: 1400,
      }
    }

    case 'tired': {
      if (intent.scale !== undefined) return handleFatigue(intent.scale, ctx, voice)
      return {
        text: voice.compose({ core: 'Understood. How tired are you, from 1 to 10?', reason: 'A 3 and an 8 need very different sessions.', soft: 'No judgement,', calm: 'Honest answer is the useful one.', push: 'Be honest, then we decide.' }),
        expects: 'fatigue_scale',
        suggestions: ['3', '5', '7', '9'],
        contextPatch: { topic: 'recovery' },
        thinkMs: 500,
      }
    }

    case 'scale_answer':
      return handleFatigue(intent.value, ctx, voice)

    case 'slept_badly': {
      if (intent.hours !== undefined) return handleSleep(intent.hours, ctx, voice)
      return {
        text: voice.compose({ core: 'Sorry to hear that. Roughly how many hours did you get?', reason: 'Under six changes what I will ask of you today.', soft: 'Rough guess is fine,' }),
        expects: 'sleep_hours',
        suggestions: ['4 hours', '5 hours', '6 hours'],
        contextPatch: { topic: 'recovery' },
        thinkMs: 450,
      }
    }

    case 'hours_answer':
      return handleSleep(intent.value, ctx, voice)

    case 'feeling_good': {
      const actions: CoachAction[] = [{ type: 'check_in', patch: { energy: 8, fatigue: 3, mood: 'great' } }]
      const w = ctx.todayWorkout
      if (w && w.status === 'planned' && !w.constraints?.intensity) {
        const harder = scaleIntensity(w, 'harder')
        actions.push({ type: 'update_workout', workout: harder })
        return {
          text: voice.compose({ core: `Good. I logged high energy and added a little to today's compounds.`, reason: 'Days like this are where progress gets made, so we use them.', push: 'Go earn it.', calm: 'Use it well.' }),
          cards: [workoutCard(harder)],
          actions,
          suggestions: ['Start it', 'Make it lighter', 'What should I eat?'],
          contextPatch: withWorkoutContext(harder),
        }
      }
      return {
        text: voice.compose({ core: 'Logged. High energy day.', reason: 'Want to use it? I can build a session that leans into it.', push: 'Let’s use it.' }),
        actions,
        suggestions: ['Build today’s workout', 'Plan my week'],
      }
    }

    case 'time_answer': {
      return respond({ kind: 'make_workout', constraints: { minutes: intent.minutes } }, req, ctx, voice)
    }

    case 'make_workout': {
      const c = intent.constraints
      const date = c.forDate === 'tomorrow' ? dayKey(addDays(ctx.now, 1)) : today
      const existing = date === today ? ctx.todayWorkout : ctx.workouts.find((w) => w.scheduledFor === date && w.status === 'planned')
      const constraints = {
        minutes: c.minutes,
        equipment: c.equipment,
        noCardio: c.noCardio,
        focus: c.focus,
        intensity: c.intensity,
      }
      // If a workout already exists and the request is a pure constraint tweak, modify instead of replacing.
      if (existing && existing.status === 'planned' && !c.focus && (c.minutes || c.equipment || c.noCardio) && !c.intensity) {
        let w = existing
        if (c.equipment) w = restrictEquipment(w, c.equipment, ctx.user, ctx.workouts)
        if (c.noCardio) w = removeCardio(w)
        if (c.minutes && c.minutes < w.estimatedMinutes) w = shortenWorkout(w, c.minutes)
        const what = [c.minutes ? `${c.minutes} minutes` : '', c.equipment ? c.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(' and ') : '', c.noCardio ? 'no cardio' : ''].filter(Boolean).join(', ')
        return {
          text: voice.compose({ core: `Adjusted today's session for ${what}: ${w.title}, ${formatMinutes(w.estimatedMinutes)}.`, reason: 'Same focus, same progression. Just fitted to what you have.', push: 'No excuses left.', calm: 'Good enough is the plan.' }),
          cards: [workoutCard(w)],
          actions: [{ type: 'update_workout', workout: w }],
          suggestions: ['Start it', 'Swap an exercise', 'Make it shorter'],
          contextPatch: withWorkoutContext(w),
          status: 'Adjusting your workout',
        }
      }
      // An explicit request for a workout gets a real session even on a low-readiness day (kept light).
      const readinessForGen = date === today ? (ctx.readiness.recommendation === 'rest' ? { ...ctx.readiness, recommendation: 'lighter' as const } : ctx.readiness) : undefined
      const gen = generateWorkout({
        user: ctx.user,
        goals: ctx.goals,
        history: ctx.workouts,
        readiness: readinessForGen,
        constraints,
        date,
        seed: `${date}-${ctx.workouts.length}-${JSON.stringify(constraints)}`,
      })
      const constraintNote = [
        c.minutes ? `fits in ${c.minutes} minutes` : '',
        c.equipment ? `uses ${c.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(' and ')} only` : '',
        c.noCardio ? 'no cardio' : '',
      ]
        .filter(Boolean)
        .join(', ')
      const core = existing
        ? `Done. I replaced ${date === today ? "today's" : "tomorrow's"} session with ${gen.title} (${formatMinutes(gen.estimatedMinutes)})${constraintNote ? `, ${constraintNote}` : ''}.`
        : `Done. ${gen.title}, ${formatMinutes(gen.estimatedMinutes)}${constraintNote ? `, ${constraintNote}` : ''}. I kept it focused on your ${GOAL_LABELS[goal].toLowerCase()} goal and recent training.`
      return {
        text: voice.compose({
          core: `${core} ${readinessLine(ctx)}`.trim(),
          reason: gen.focus === 'conditioning' ? 'Conditioning today because your last sessions were all lifting.' : `${FOCUS_LABELS[gen.focus]} is next in your rotation.`,
          extra: 'Loads are based on your last sessions with a small bump where you completed every set.',
          push: 'Go get it.',
          calm: 'Take it at your pace.',
        }),
        cards: [workoutCard(gen)],
        actions: [{ type: 'create_workout', workout: gen, replaceWorkoutId: existing?.status === 'planned' ? existing.id : undefined }],
        suggestions: suggestionsForWorkout(),
        contextPatch: withWorkoutContext(gen),
        status: 'Building your workout',
        thinkMs: 1500,
      }
    }

    case 'modify_workout': {
      if (!workout || workout.status === 'completed') {
        return {
          text: voice.compose({ core: 'There is no workout to change yet. Want me to build one first?', soft: 'Whenever you like,' }),
          suggestions: ['Build today’s workout', 'I only have 30 minutes'],
        }
      }
      return modifyWorkout(workout, intent.change, ctx, voice)
    }

    case 'start_workout': {
      const w = workout ?? ctx.todayWorkout
      if (!w || w.status === 'completed') {
        return {
          text: voice.compose({ core: 'Nothing is queued up. Want me to build a session for right now?', push: 'Say the word.' }),
          suggestions: ['Build today’s workout', 'I only have 30 minutes'],
        }
      }
      return {
        text: voice.compose({ core: `${w.title} is ready. Tap start when you are at the first station.`, push: 'Go.', calm: 'Warm up first.', quip: 'I will be here, judging nothing, timing everything.' }),
        cards: [workoutCard(w)],
        contextPatch: withWorkoutContext(w),
        thinkMs: 400,
      }
    }

    case 'skip_workout': {
      const w = ctx.todayWorkout
      if (!w || w.status !== 'planned') return { text: voice.compose({ core: 'Nothing to skip today. Enjoy the rest.', calm: 'Recovery counts.' }), suggestions: ['Plan tomorrow', 'What should I eat?'] }
      return {
        text: voice.compose({
          core: `Okay, today's session is marked as skipped. I will fold ${w.title.toLowerCase()} into the next slot so nothing gets lost.`,
          reason: 'One missed session changes nothing. Three in a row is a pattern, and I will notice.',
          soft: 'Totally fine,',
          push: 'Tomorrow we go.',
        }),
        actions: [{ type: 'skip_workout', workoutId: w.id }],
        suggestions: ['Plan tomorrow', 'Actually, give me 20 minutes', 'What should I eat?'],
        contextPatch: { topic: 'calendar' },
      }
    }

    case 'create_program': {
      // Adjusting an existing program ("3 days a week", "around fat loss") keeps its length.
      const weeks = intent.weeks ?? (ctx.activeProgram && (intent.daysPerWeek || intent.goalType) ? ctx.activeProgram.weeks : undefined)
      if (!weeks) {
        return {
          text: voice.compose({ core: 'How long do you want the program to run?', reason: 'Eight weeks is a good first block. Twelve lets me build in two deloads.', soft: 'Your call,' }),
          expects: 'program_weeks',
          suggestions: ['8 weeks', '12 weeks', '16 weeks'],
          contextPatch: { topic: 'program' },
          thinkMs: 400,
        }
      }
      const program = generateProgram({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, weeks, daysPerWeek: intent.daysPerWeek, goalType: intent.goalType })
      const { workouts, events } = materializeProgram(program, ctx.user, ctx.goals, ctx.workouts)
      const replacing = ctx.activeProgram
      return {
        text: voice.compose({
          core: `${replacing ? `I replaced ${replacing.name} with` : 'Built'} ${program.name}: ${program.daysPerWeek} days a week, starting ${formatShortDate(fromDayKey(program.startDate))}. It is on your calendar.`,
          reason: program.description,
          extra: 'I will adapt individual sessions as we go based on how you recover, and you can change or cancel it any time.',
          push: 'Twelve weeks from now you will be glad you started today.',
          calm: 'One week at a time.',
          quip: 'Deload weeks are mandatory. I have seen what happens without them.',
        }),
        cards: [{ id: uid('card'), type: 'program', refId: program.id, title: program.name, subtitle: `${program.weeks} weeks · ${program.daysPerWeek} days/week` }],
        actions: [{ type: 'create_program', program, workouts, events, replaceProgramId: replacing?.id }],
        suggestions: ['Show me week 1', 'Show my calendar', 'What should I eat on training days?'],
        contextPatch: { lastProgramId: program.id, topic: 'program' },
        status: 'Designing your program',
        thinkMs: 2200,
      }
    }

    case 'cancel_program': {
      if (!ctx.activeProgram) return { text: voice.compose({ core: 'You do not have an active program. Want one?' }), suggestions: ['Create a 12-week program'] }
      return {
        text: voice.compose({ core: `${ctx.activeProgram.name} is cancelled and its upcoming sessions are off your calendar. Completed sessions stay in your history.`, soft: 'No problem,', reason: 'We can go freestyle for a while: I will build each session on the day.' }),
        actions: [{ type: 'cancel_program', programId: ctx.activeProgram.id }],
        suggestions: ['Build today’s workout', 'Create a new program'],
        contextPatch: { topic: 'program' },
      }
    }

    case 'show_program': {
      const p = ctx.activeProgram
      if (!p) return { text: voice.compose({ core: 'No program running right now. I build each session fresh. Want a structured block?' }), suggestions: ['Create a 12-week program', 'Create an 8-week program'] }
      const week = clamp(programWeekFor(p, ctx.now), 1, p.weeks)
      return {
        text: voice.compose({ core: `You are in week ${week} of ${p.weeks} on ${p.name} (${p.weeksPlan[week - 1].phase} phase).`, reason: p.weeksPlan[week - 1].note }),
        cards: [{ id: uid('card'), type: 'program', refId: p.id, title: p.name, subtitle: `Week ${week} of ${p.weeks}` }],
        suggestions: ['Change my program', 'Cancel my program'],
        contextPatch: { lastProgramId: p.id, topic: 'program' },
      }
    }

    case 'nutrition': {
      const isTrainingDay = Boolean(ctx.todayWorkout && ctx.todayWorkout.status !== 'skipped')
      const plan = ctx.todayNutrition ?? generateNutritionPlan({ user: ctx.user, goals: ctx.goals, isTrainingDay, lowerCarb: intent.lowerCarb, seed: `${today}-${ctx.user.id}-${intent.lowerCarb ? 'lc' : ''}` })
      const actions: CoachAction[] = ctx.todayNutrition && !intent.lowerCarb ? [] : [{ type: 'create_nutrition_plan', plan }]
      const meal = intent.slot ? plan.meals.find((m) => m.slot === intent.slot) : undefined
      const n = ctx.nutrition
      const eaten = n.consumed.calories > 0
      let core: string
      let reason: string | undefined = plan.rationale
      if (meal && eaten) {
        // Size the suggestion to what is actually left today.
        const left = Math.max(0, n.remaining.calories)
        const leftP = Math.max(0, n.remaining.proteinG)
        const scale = left > 0 ? Math.min(1.4, Math.max(0.5, left / Math.max(1, meal.calories))) : 0.5
        const kcal = Math.round((meal.calories * scale) / 10) * 10
        const prot = Math.round(meal.proteinG * scale)
        core = `You’ve had ${n.consumed.calories.toLocaleString()} kcal and ${n.consumed.proteinG} g protein so far, so about ${left.toLocaleString()} kcal and ${leftP} g protein are left. ${capitalize(intent.slot!)}: ${meal.name} (${meal.items.join(', ')}), sized to roughly ${kcal} kcal and ${prot} g protein.`
        reason = leftP > 40 ? 'Protein is the priority for this one; the rest can be simple.' : leftP <= 10 ? 'Protein is already covered, so keep this one light and enjoyable.' : 'That closes the day neatly without forcing another big meal.'
      } else if (meal) {
        core = `${capitalize(intent.slot!)}: ${meal.name}. ${meal.items.join(', ')}. About ${meal.calories} kcal with ${meal.proteinG} g protein.`
      } else if (eaten) {
        core = `Today${isTrainingDay ? ' is a training day' : ' is a rest day'}: target ${plan.calories.toLocaleString()} kcal and ${plan.proteinG} g protein. You’ve logged ${n.consumed.calories.toLocaleString()} kcal and ${n.consumed.proteinG} g protein across ${plural(n.meals.length, 'meal')}, so ${Math.max(0, n.remaining.calories).toLocaleString()} kcal and ${Math.max(0, n.remaining.proteinG)} g protein remain.`
      } else {
        core = `Today${isTrainingDay ? ' is a training day' : ' is a rest day'}: ${plan.calories.toLocaleString()} kcal, ${plan.proteinG} g protein, ${plan.carbsG} g carbs, ${plan.fatG} g fat. ${plan.meals.length} meals, all in your plan.`
      }
      return {
        text: voice.compose({ core, reason, extra: 'Swap any meal for something with similar protein and it still works.', calm: 'Eat well, no stress.', push: 'Fuel matches the work.', quip: 'Protein first. Everything else is negotiable.' }),
        cards: [{ id: uid('card'), type: 'nutrition', refId: plan.id, title: 'Today’s nutrition', subtitle: `${plan.calories.toLocaleString()} kcal · ${plan.proteinG} g protein` }],
        actions,
        suggestions: eaten ? ['What have I eaten today?', 'I’m eating at a restaurant tonight', 'Log a meal'] : ['I’m eating at a restaurant tonight', 'Make it lower carb', 'What’s for dinner?'],
        contextPatch: { lastNutritionPlanId: plan.id, topic: 'nutrition' },
        status: 'Planning your meals',
        thinkMs: 1100,
      }
    }

    case 'restaurant': {
      const isTrainingDay = Boolean(ctx.todayWorkout && ctx.todayWorkout.status !== 'skipped')
      const plan = generateNutritionPlan({ user: ctx.user, goals: ctx.goals, isTrainingDay, restaurantDinner: true, seed: `${today}-${ctx.user.id}-rest` })
      return {
        text: voice.compose({
          core: 'No problem. I adjusted the rest of your day around it: lighter, protein-forward meals earlier so dinner has room.',
          reason: 'Order a protein main, add vegetables, and pick one indulgence you actually want rather than three you do not.',
          extra: 'One meal never decides the week. Consistency across seven days does.',
          calm: 'Enjoy it properly.',
          push: 'Protein first, then enjoy.',
          quip: 'Bread basket: allowed. Second bread basket: we talk.',
        }),
        cards: [{ id: uid('card'), type: 'nutrition', refId: plan.id, title: 'Adjusted for tonight', subtitle: `${plan.calories.toLocaleString()} kcal · restaurant dinner` }],
        actions: [{ type: 'create_nutrition_plan', plan }, { type: 'remember', item: { category: 'habit', text: `Ate out on ${weekdayName(ctx.now)} (${formatShortDate(ctx.now)})`, source: 'conversation' } }],
        suggestions: ['What would you choose?', 'What should I order?', 'Plan tomorrow’s meals'],
        contextPatch: { lastNutritionPlanId: plan.id, topic: 'nutrition' },
        status: 'Adjusting your day',
        thinkMs: 1100,
      }
    }

    case 'analyze_progress': {
      const stats = weeklyStats(ctx.workouts, 4)
      const sessions = stats.reduce((a, s) => a + s.sessions, 0)
      const streak = consistencyStreak(ctx.workouts, ctx.targetPerWeek)
      const trend = weightTrend(ctx.measurements)
      const prs = personalRecords(ctx.workouts).slice(0, 2)
      if (sessions === 0 && !trend.current) {
        return { text: voice.compose({ core: 'There is not much to analyze yet. Finish a couple of sessions and log your weight, and I will have real insights for you.', calm: 'Every log is a data point.' }), suggestions: ['Build today’s workout', 'Log my weight'] }
      }
      const parts: string[] = [`Last four weeks: ${plural(sessions, 'session')}${streak.current ? `, ${streak.current}-week consistency streak` : ''}.`]
      if (trend.current && trend.change30 !== undefined) parts.push(`Weight ${trend.change30 > 0 ? 'up' : trend.change30 < 0 ? 'down' : 'flat at'} ${trend.change30 === 0 ? '' : Math.abs(trend.change30) + ' kg '}this month (${trend.current} kg).`)
      if (prs.length) parts.push(`Best lifts: ${prs.map((p) => `${p.name} ${p.weightKg} kg × ${p.reps}`).join(', ')}.`)
      const top = ctx.insights[0]
      return {
        text: voice.compose({ core: parts.join(' '), reason: top ? `${top.text} ${top.detail ?? ''}`.trim() : undefined, extra: ctx.insights[1] ? ctx.insights[1].text : undefined, push: 'Keep stacking weeks.', calm: 'Steady progress, exactly as planned.', quip: 'Spreadsheets would be jealous.' }),
        cards: [{ id: uid('card'), type: 'progress', title: 'Progress snapshot', subtitle: `${plural(sessions, 'session')} · 4 weeks`, data: { sessions, streak: streak.current, weight: trend.current, change30: trend.change30, insights: ctx.insights.slice(0, 2).map((i) => i.text) } }],
        suggestions: ['Why has my weight stopped moving?', 'Plan my week', 'Set a new goal'],
        contextPatch: { topic: 'progress' },
        status: 'Reviewing your progress',
        thinkMs: 1300,
      }
    }

    case 'weight_stalled': {
      const trend = weightTrend(ctx.measurements)
      const wantsGain = goal === 'build_muscle' || goal === 'strength'
      const wantsLoss = goal === 'lose_fat'
      if (!trend.current) return { text: voice.compose({ core: 'I do not have enough weigh-ins to see a trend. Log your weight a few mornings a week and I will tell you exactly what is happening.' }), suggestions: ['Log my weight'] }
      const core = trend.stalled
        ? `Your weight has been flat for about three weeks at ${trend.current} kg. ${wantsGain ? 'For muscle gain that means intake has drifted to maintenance.' : wantsLoss ? 'For fat loss that usually means the deficit has closed, often through a little less daily movement and a little more food.' : 'That is a plateau, which is normal after an initial change.'}`
        : `It is moving, just slowly: ${(trend.change30 ?? 0) > 0 ? '+' : ''}${trend.change30} kg over the last month. Weekly noise hides that.`
      const fix = wantsGain ? 'Add about 150 kcal a day, mostly carbs around training, and hold it for two weeks.' : wantsLoss ? 'Trim 150–200 kcal or add 2,000 steps a day, and keep protein where it is. Weigh in the same way each morning.' : 'If you want it to move, tell me which way and I will adjust your targets.'
      return {
        text: voice.compose({ core, reason: fix, extra: 'Also check sleep: two weeks of short nights blunt both fat loss and muscle gain.', calm: 'Plateaus are normal, not failures.', push: 'Small change, then patience.', quip: 'The scale is a moody narrator. Trends are the story.' }),
        suggestions: wantsGain || wantsLoss ? ['Update my nutrition targets', 'Analyze my progress'] : ['Set a weight goal', 'Analyze my progress'],
        contextPatch: { topic: 'progress' },
        thinkMs: 1000,
      }
    }

    case 'remember': {
      const category = categorize(intent.text)
      const item: Omit<MemoryItem, 'id' | 'createdAt'> = { category, text: capitalize(intent.text), source: 'conversation' }
      return {
        text: voice.compose({ core: `Noted: “${item.text}.” I will factor that in from now on.`, reason: category === 'health' ? 'I will avoid anything that aggravates it and flag when something might.' : undefined, calm: undefined, push: undefined, quip: 'Filed under things I actually remember.' }),
        cards: [{ id: uid('card'), type: 'memory', title: 'Remembered', subtitle: item.text, data: { category } }],
        actions: [{ type: 'remember', item }],
        suggestions: ['What do you know about me?', 'Build today’s workout'],
        thinkMs: 500,
      }
    }

    case 'forget': {
      const q = intent.text.toLowerCase()
      const found = ctx.memory.find((m) => m.text.toLowerCase().includes(q) || q.includes(m.text.toLowerCase()))
      if (!found) return { text: voice.compose({ core: 'I could not find that in what I know about you. You can review and remove anything from your profile under Coach memory.' }), suggestions: ['What do you know about me?'] }
      return { text: voice.compose({ core: `Forgotten: “${found.text}.”` }), actions: [{ type: 'forget', memoryId: found.id }], thinkMs: 400 }
    }

    case 'what_do_you_know': {
      const top = ctx.memory.slice(0, 6)
      const bullets = top.map((m) => `• ${m.text}`).join('\n')
      return {
        text: voice.compose({ core: `Here is what shapes my coaching for you, ${name}:\n${bullets}${ctx.memory.length > 6 ? `\n…and ${ctx.memory.length - 6} more.` : ''}`, reason: 'You can edit or remove any of it from your profile. Nothing leaves this device.', quip: 'I remember everything except where you left your water bottle.' }),
        cards: [{ id: uid('card'), type: 'memory', title: 'Coach memory', subtitle: `${plural(ctx.memory.length, 'thing')} I keep in mind` }],
        suggestions: ['Remember I train at 7am', 'Forget something'],
        thinkMs: 500,
      }
    }

    case 'plan_week': {
      const days = ctx.user.availability.preferredDays.length ? ctx.user.availability.preferredDays : [1, 3, 5]
      const week = weekPlanEvents(ctx, days)
      const summary = week.map((e) => `${weekdayName(fromDayKey(e.date), true)}: ${e.title}`).join(' · ')
      return {
        text: voice.compose({ core: `Your week: ${summary}. All ${week.length} sessions are on your calendar.`, reason: 'Rest days sit between the harder sessions so you recover between them.', extra: 'Move any day by telling me, for example “move Monday to Wednesday”.', push: 'A week planned is a week won.', calm: 'Flexible, not fragile.' }),
        cards: [{ id: uid('card'), type: 'calendar', title: 'This week', subtitle: `${week.length} sessions planned`, data: { days: week.map((e) => ({ date: e.date, title: e.title })) } }],
        actions: week.map((e) => ({ type: 'create_workout', workout: e.workout }) as CoachAction),
        suggestions: ['Move Monday to Wednesday', 'Start today’s session', 'What should I eat?'],
        contextPatch: { topic: 'calendar' },
        status: 'Planning your week',
        thinkMs: 1600,
      }
    }

    case 'reschedule': {
      const fromDate = intent.from !== undefined ? dayKey(nextWeekdayIncludingPast(intent.from, ctx.now)) : today
      const toDate = intent.toRelative === 'tomorrow' ? dayKey(addDays(ctx.now, 1)) : intent.toRelative === 'today' ? today : intent.to !== undefined ? dayKey(nextWeekday(intent.to, ctx.now, true)) : undefined
      const ev = ctx.events.find((e) => e.type === 'workout' && e.date === fromDate && e.status === 'planned')
      if (!ev) {
        return { text: voice.compose({ core: `I do not see a planned workout on ${weekdayName(fromDayKey(fromDate))}. Want me to schedule one?` }), suggestions: ['Plan my week', 'Build today’s workout'] }
      }
      if (!toDate) return { text: voice.compose({ core: `Which day should I move ${ev.title} to?` }), expects: 'reschedule_day', suggestions: ['Tomorrow', 'Wednesday', 'Saturday'] }
      const clash = ctx.events.find((e) => e.type === 'workout' && e.date === toDate && e.status === 'planned' && e.id !== ev.id)
      return {
        text: voice.compose({ core: `Moved ${ev.title} from ${weekdayName(fromDayKey(fromDate))} to ${weekdayName(fromDayKey(toDate))}.${clash ? ` You now have two sessions on ${weekdayName(fromDayKey(toDate))}; tell me if you want the other one moved too.` : ''}`, reason: 'Your recovery spacing still works.', calm: 'Life happens, plans bend.', push: 'Rescheduled, not skipped. Good.' }),
        cards: [{ id: uid('card'), type: 'calendar', title: ev.title, subtitle: `${weekdayName(fromDayKey(fromDate), true)} → ${weekdayName(fromDayKey(toDate), true)}`, data: { from: fromDate, to: toDate } }],
        actions: [{ type: 'move_event', eventId: ev.id, toDate }],
        suggestions: ['Show my calendar', 'Plan my week'],
        contextPatch: { lastEventId: ev.id, topic: 'calendar' },
        thinkMs: 700,
      }
    }

    case 'set_goal': {
      const existingPrimary = ctx.goals.find((g) => g.rank === 'primary')
      if (!intent.goalType && !intent.metric && !intent.target) {
        return {
          text: voice.compose({ core: 'What do you want to work toward?', reason: 'A direction (build muscle, lose fat, get stronger) or a number (a body weight, a lift, sessions per week). Both is best.' }),
          expects: 'goal_choice',
          suggestions: ['Build muscle', 'Lose fat', 'Bench 100 kg', '4 workouts a week'],
          contextPatch: { topic: 'goal' },
          thinkMs: 300,
        }
      }
      const type = intent.goalType ?? existingPrimary?.type ?? 'general_fitness'
      const metric = intent.metric
      if (metric && !intent.target) {
        return { text: voice.compose({ core: `What number are we aiming for?`, reason: metric === 'body_weight' ? 'A target weight in kg.' : metric === 'workouts_per_week' ? 'Sessions per week.' : 'A target load in kg.' }), expects: 'goal_target', suggestions: metric === 'body_weight' ? [`${round(ctx.user.weightKg - 3)} kg`, `${round(ctx.user.weightKg + 3)} kg`] : ['4 per week', '100 kg'] }
      }
      const isMetricOnly = Boolean(metric) && !intent.goalType
      const goalObj: Goal = {
        id: isMetricOnly && existingPrimary ? existingPrimary.id : uid('goal'),
        type,
        rank: existingPrimary && !isMetricOnly ? 'primary' : existingPrimary ? existingPrimary.rank : 'primary',
        label: GOAL_LABELS[type],
        metric,
        targetValue: intent.target,
        targetUnit: metric === 'workouts_per_week' ? '/week' : metric === 'steps_per_day' ? 'steps' : metric ? 'kg' : undefined,
        startValue: metric === 'body_weight' ? ctx.user.weightKg : undefined,
        createdAt: existingPrimary && isMetricOnly ? existingPrimary.createdAt : new Date().toISOString(),
      }
      const summary = metric && intent.target ? `${GOAL_LABELS[type]} with a target of ${intent.target}${goalObj.targetUnit === 'kg' ? ' kg' : goalObj.targetUnit === '/week' ? ' sessions a week' : goalObj.targetUnit ? ' ' + goalObj.targetUnit : ''}` : GOAL_LABELS[type]
      return {
        text: voice.compose({ core: `Goal updated: ${summary}. Your training and nutrition will adjust from today.`, reason: type !== existingPrimary?.type && ctx.activeProgram ? `Your program was built for ${GOAL_LABELS[existingPrimary?.type ?? type].toLowerCase()}; say the word and I will rebuild it around the new goal.` : undefined, push: 'Now we chase it.', calm: 'Clear target, calm progress.' }),
        cards: [{ id: uid('card'), type: 'goal', refId: goalObj.id, title: goalObj.label, subtitle: intent.target ? `Target ${intent.target}${goalObj.targetUnit === 'kg' ? ' kg' : goalObj.targetUnit ?? ''}` : 'Primary goal' }],
        actions: [{ type: 'set_goal', goal: goalObj }, { type: 'remember', item: { category: 'goal', text: `Goal: ${summary}`, source: 'conversation' } }],
        suggestions: ctx.activeProgram && type !== existingPrimary?.type ? ['Rebuild my program', 'Build today’s workout'] : ['Build today’s workout', 'Analyze my progress'],
        contextPatch: { lastGoalId: goalObj.id, topic: 'goal' },
        thinkMs: 600,
      }
    }

    case 'log_weight': {
      const prev = weightTrend(ctx.measurements)
      const diff = prev.current ? round(intent.kg - prev.current, 1) : 0
      return {
        text: voice.compose({ core: `Logged ${intent.kg} kg for today.${prev.current ? ` That is ${diff > 0 ? '+' : ''}${diff} kg against your recent average.` : ''}`, reason: 'Morning, after the bathroom, before food gives me the cleanest trend.', calm: 'One reading is a data point, not a verdict.', quip: 'The scale has been informed. It remains unbothered.' }),
        actions: [{ type: 'log_measurement', measurement: { type: 'body_weight', value: intent.kg, unit: 'kg', date: today, source: 'user' } }],
        suggestions: ['Analyze my progress', 'What should I eat?'],
        thinkMs: 500,
      }
    }

    case 'pain': {
      if (intent.severe) {
        return {
          text: voice.compose({
            core: `Stop training for today. ${intent.area ? `Sharp or severe ${intent.area} pain` : 'What you describe'} is not something to push through, and I am a coach, not a doctor. Please get it looked at by a physio or physician, especially if it is swollen, numb, or does not ease in a day or two.`,
            reason: 'I will keep your plan paused and rebuild it around whatever they tell you.',
            calm: 'Looking after this now is the fastest way back.',
            push: 'Smart athletes protect the long game.',
          }),
          actions: [{ type: 'remember', item: { category: 'health', text: `Reported ${intent.area ? intent.area + ' ' : ''}pain on ${formatShortDate(ctx.now)}; advised professional evaluation`, source: 'conversation' } }],
          suggestions: ['Skip today', 'Give me a gentle mobility session'],
        }
      }
      if (!intent.area) return { text: voice.compose({ core: 'Where is it, and is it sharp or more of a dull ache?', soft: 'Take your time,' }), expects: 'pain_location', suggestions: ['Lower back, dull', 'Knee, sharp', 'Shoulder, achy'] }
      const w = ctx.todayWorkout
      const actions: CoachAction[] = [{ type: 'remember', item: { category: 'health', text: `${capitalize(intent.area)} discomfort reported on ${formatShortDate(ctx.now)}`, source: 'conversation' } }]
      let cards: CoachCard[] | undefined
      let core = `Got it. Mild ${intent.area} discomfort: we work around it, not through it.`
      if (w && w.status === 'planned') {
        const affected = w.exercises.filter((e) => exerciseTouches(e.exerciseId, intent.area!))
        let modified = w
        for (const e of affected) modified = replaceExercise(modified, e.exerciseId, ctx.user, ctx.workouts).workout
        if (affected.length) {
          modified = scaleIntensity(modified, 'lighter')
          actions.push({ type: 'update_workout', workout: modified })
          cards = [workoutCard(modified)]
          core += ` I swapped ${affected.map((e) => e.name).join(' and ')} and kept today lighter.`
        }
      }
      return {
        text: voice.compose({ core, reason: 'If it sharpens, swells, or lasts more than a few days, see a physio. That is not me being cautious, that is the rule.', calm: 'Listen to it.', push: 'Train around it, come back stronger.' }),
        cards,
        actions,
        suggestions: ['Start the adjusted workout', 'Skip today', 'Gentle mobility instead'],
      }
    }

    case 'rename_coach': {
      if (!intent.name) return { text: voice.compose({ core: 'What would you like to call me?' }), expects: 'coach_name', suggestions: ['Alex', 'Sam', 'Nova'] }
      return {
        text: voice.compose({ core: `${intent.name} it is. Same coach, new name.`, quip: 'I answer to most things, as long as it is followed by a completed set.' }),
        actions: [{ type: 'update_coach', patch: { name: intent.name } }],
        suggestions: ['Build today’s workout', 'Be more direct with me'],
        thinkMs: 400,
      }
    }

    case 'personality': {
      const p = intent.patch
      const desc: string[] = []
      if (p.tone !== undefined) desc.push(p.tone > 50 ? 'more direct' : 'gentler')
      if (p.motivation !== undefined) desc.push(p.motivation > 50 ? 'more intense' : 'calmer')
      if (p.humor !== undefined) desc.push(p.humor > 50 ? 'more playful' : 'more serious')
      if (p.communication !== undefined) desc.push(p.communication > 50 ? 'more detailed' : 'more concise')
      const merged = { ...ctx.coach.personality, ...p }
      const newVoice = buildVoice(merged)
      return {
        text: newVoice.compose({ core: `Done. I will be ${desc.join(' and ')} from here on.`, reason: 'You can fine-tune this any time under Profile → Coach.', push: 'Let’s get to work.', calm: 'Adjusted.', quip: 'Personality patched. No restart required.' }),
        actions: [{ type: 'update_coach', patch: { personality: merged } }],
        suggestions: ['Build today’s workout', 'What should I do today?'],
        thinkMs: 400,
      }
    }

    case 'attachment': {
      const att = req.attachments
      const kinds = new Set(att.map((a) => a.kind))
      const cards: CoachCard[] = att.map((a) => ({ id: uid('card'), type: 'attachment', refId: a.id, title: a.name, subtitle: a.kind }))
      const userText = req.text.trim()
      if (kinds.has('audio')) {
        const a = att.find((x) => x.kind === 'audio')!
        const transcript = a.transcript
        if (transcript) {
          const inner = parseIntent(transcript, { topic: ctx.conversation.context.topic, hasWorkout: Boolean(workout) })
          if (inner.kind !== 'unknown' && inner.kind !== 'attachment') {
            const r = respond(inner, { ...req, text: transcript, attachments: [] }, ctx, voice)
            return { ...r, text: `Heard you: “${transcript}”. ${r.text}` }
          }
        }
        return {
          text: voice.compose({ core: `Got your voice note${a.durationSec ? ` (${Math.round(a.durationSec)}s)` : ''}. I have saved it with today. Transcription is not connected on this device yet, so give me the gist in a line and I will act on it.`, soft: 'When you get a second,' }),
          cards,
          suggestions: ['It was about today’s workout', 'It was about food', 'Never mind'],
          expects: 'attachment_kind',
        }
      }
      if (kinds.has('image')) {
        const lowered = userText.toLowerCase()
        const foodish = /meal|food|ate|eat|plate|lunch|dinner|breakfast|snack|calories|protein|menu|restaurant/.test(lowered)
        // Context resolution: a photo sent while we are talking about a restaurant is a menu.
        const restaurantTalk = ctx.history.slice(-6).some((m) => /restaurant|menu|eating out|order/i.test(m.text))
        const fa = req.foodAnalysis
        if (!lowered && restaurantTalk && !(fa && fa.items.length)) return respond({ kind: 'menu_help' }, req, ctx, voice)
        // A real vision model recognised food (or a menu) in the photo.
        if (fa && fa.analysis === 'vision' && fa.items.length) return foodDraftReply(fa, req, ctx, voice, parseSlot(lowered))
        if (fa && fa.analysis === 'vision' && /menu/.test(fa.name.toLowerCase())) return respond({ kind: 'menu_help' }, req, ctx, voice)
        // Local engine: the text may describe the plate well enough to estimate now.
        if (fa && fa.items.length) return foodDraftReply(fa, req, ctx, voice, parseSlot(lowered))
        if (/menu/.test(lowered)) return respond({ kind: 'menu_help' }, req, ctx, voice)
        if (foodish) return respond({ kind: 'attachment_context', what: 'meal' }, req, ctx, voice)
        if (/gym|equipment/.test(lowered)) return respond({ kind: 'attachment_context', what: 'equipment' }, req, ctx, voice)
        if (/progress|physique|body/.test(lowered)) return respond({ kind: 'attachment_context', what: 'progress_photo' }, req, ctx, voice)
        if (/plan|program|routine/.test(lowered)) return respond({ kind: 'attachment_context', what: 'plan' }, req, ctx, voice)
        return {
          text: voice.compose({ core: `Got the image${att.length > 1 ? 's' : ''}. I have saved ${att.length > 1 ? 'them' : 'it'} to your history. What am I looking at?`, reason: 'Image analysis runs on-device only once you connect an AI provider; until then, tell me the context and I will use it properly.', soft: 'Quick question:' }),
          cards,
          suggestions: ['It’s a meal', 'It’s my gym equipment', 'It’s a progress photo', 'It’s a training plan'],
          expects: 'attachment_kind',
          contextPatch: { topic: 'general' },
        }
      }
      // PDF / document
      const a = att.find((x) => x.kind === 'pdf' || x.kind === 'document')!
      const excerpt = a.transcript?.slice(0, 400)
      if (excerpt) {
        const looksPlan = /week|sets?|reps?|squat|bench|day \d/i.test(excerpt)
        const looksDiet = /kcal|calories|protein|carb|meal/i.test(excerpt)
        const looksLabs = /cholesterol|glucose|hemoglobin|haemoglobin|ferritin|vitamin|mg\/dl|mmol/i.test(excerpt)
        const what = looksLabs ? 'bloodwork' : looksPlan ? 'plan' : looksDiet ? 'meal' : 'other'
        if (what !== 'other') return respond({ kind: 'attachment_context', what }, req, ctx, voice)
      }
      return {
        text: voice.compose({ core: `Saved “${a.name}”. To use it well I need to know what it is.`, reason: 'Full document analysis needs a connected AI provider; for now, tell me the type and I will pull the relevant parts into your plan.', soft: 'One thing:' }),
        cards,
        suggestions: ['It’s a training plan', 'It’s my bloodwork', 'It’s a diet plan', 'Something else'],
        expects: 'attachment_kind',
      }
    }

    case 'attachment_context': {
      const remember = (text: string, category: MemoryItem['category']): CoachAction => ({ type: 'remember', item: { category, text, source: 'conversation' } })
      switch (intent.what) {
        case 'meal': {
          return {
            text: voice.compose({
              core: ctx.foodVision
                ? 'I could not make out the food in that photo. Tell me what is on the plate and roughly how much, and I will estimate it.'
                : 'I can’t see photos on this device yet, so I won’t pretend to. Tell me what’s on the plate and roughly how much, and I’ll estimate calories and protein from that.',
              reason: 'A short description is usually within 15% of the real thing, which is plenty for coaching.',
              quip: 'Camera eats first. Coach estimates second.',
            }),
            suggestions: ['Chicken, rice and veg', 'Pasta with salmon', 'A big salad'],
            expects: 'meal_description',
            contextPatch: { topic: 'nutrition' },
          }
        }
        case 'equipment': {
          return {
            text: voice.compose({ core: 'Useful. Tell me what you see there in a few words (for example “dumbbells to 30 kg, a bench and bands”) and I will save it as your available equipment and build around it.', soft: 'Quick one:' }),
            suggestions: ['Dumbbells and a bench', 'Full gym', 'Just bands and bodyweight'],
            expects: 'equipment_list',
            actions: [remember(`Shared a photo of their training space on ${formatShortDate(ctx.now)}`, 'equipment')],
            contextPatch: { topic: 'workout' },
          }
        }
        case 'plan': {
          return {
            text: voice.compose({ core: 'Got it, a training plan. I have kept it with your history. Do you want me to follow it as-is, blend it with your goals, or use it as a reference only?', reason: 'If you follow it, I will schedule it in your calendar and track the loads for you.' }),
            actions: [remember(`Uploaded an external training plan on ${formatShortDate(ctx.now)}`, 'history')],
            suggestions: ['Blend it with my goals', 'Reference only', 'Follow it as-is'],
            expects: 'plan_choice',
            contextPatch: { topic: 'program' },
          }
        }
        case 'progress_photo': {
          return {
            text: voice.compose({ core: `Saved to your progress timeline with today's date. Take the next one in two to three weeks, same lighting, same time of day.`, reason: 'Photos show recomposition the scale cannot. Weight and photos together tell the real story.', calm: 'Trust the timeline.', push: 'Future you will want this one.' }),
            actions: [remember(`Progress photo taken on ${formatShortDate(ctx.now)}`, 'history')],
            suggestions: ['Analyze my progress', 'Log my weight'],
            contextPatch: { topic: 'progress' },
          }
        }
        case 'bloodwork': {
          return {
            text: voice.compose({ core: 'Thanks for sharing it. I have saved it, but I will not interpret medical results, that is for your doctor. If they have flagged anything (iron, vitamin D, cholesterol), tell me and I will adjust nutrition and training sensibly around it.', soft: 'To be clear,' }),
            actions: [remember(`Shared bloodwork on ${formatShortDate(ctx.now)}`, 'health')],
            suggestions: ['Low vitamin D', 'Low iron', 'All normal'],
            expects: 'bloodwork_flag',
          }
        }
        default:
          return { text: voice.compose({ core: 'Saved. If it matters for training or food, tell me how and I will use it.' }), suggestions: ['Build today’s workout'] }
      }
    }

    case 'show_calendar': {
      const start = ctx.now
      const week = Array.from({ length: 7 }, (_, i) => dayKey(addDays(start, i)))
      const evs = ctx.events.filter((e) => week.includes(e.date) && e.type === 'workout' && e.status !== 'skipped').sort((a, b) => a.date.localeCompare(b.date))
      if (!evs.length) return { text: voice.compose({ core: 'Nothing is on your calendar for the next seven days. Want me to plan the week?' }), suggestions: ['Plan my week', 'Create a 12-week program'], contextPatch: { topic: 'calendar' } }
      return {
        text: voice.compose({ core: `Next seven days: ${evs.map((e) => `${weekdayName(fromDayKey(e.date), true)} ${e.title}`).join(' · ')}.`, reason: 'Tell me to move any of them and I will keep the spacing sensible.' }),
        cards: [{ id: uid('card'), type: 'calendar', title: 'Next 7 days', subtitle: `${plural(evs.length, 'session')}`, data: { days: evs.map((e) => ({ date: e.date, title: e.title })) } }],
        suggestions: ['Move Monday to Wednesday', 'Plan my week'],
        contextPatch: { topic: 'calendar' },
        thinkMs: 500,
      }
    }

    case 'log_weight_prompt':
      return { text: voice.compose({ core: 'What did the scale say this morning?', soft: 'Whenever you have it,' }), expects: 'weight_value', suggestions: [`${round(ctx.user.weightKg - 0.3, 1)} kg`, `${ctx.user.weightKg} kg`, `${round(ctx.user.weightKg + 0.3, 1)} kg`], thinkMs: 300 }

    case 'order_advice': {
      const wantsLoss = goal === 'lose_fat'
      return {
        text: voice.compose({
          core: `Order a protein main first: grilled fish, steak, chicken or tofu. Add a vegetable side. ${wantsLoss ? 'Skip the second starch and keep drinks to one.' : 'Have the starch, you are training hard.'} Then pick the one indulgence you actually want.`,
          reason: 'A restaurant meal is a protein problem, not a calorie problem. Solve protein and the rest sorts itself out.',
          quip: 'Dessert is a valid choice. Two desserts is a cry for help.',
        }),
        suggestions: ['Plan tomorrow’s meals', 'What should I do tomorrow?'],
        contextPatch: { topic: 'nutrition' },
        thinkMs: 500,
      }
    }

    case 'meal_description': {
      const analysis = analyzeDescription(intent.text)
      if (analysis.needsDescription) {
        return { text: voice.compose({ core: analysis.notes[0] ?? 'Name the main parts of the meal and I will estimate it.', soft: 'Almost there:' }), suggestions: ['Chicken, rice and veg', 'Eggs and toast', 'Salmon and potatoes'], expects: 'meal_description', contextPatch: { topic: 'nutrition' } }
      }
      return foodDraftReply(analysis, req, ctx, voice, parseSlot(intent.text))
    }

    case 'bloodwork_flag': {
      const t = intent.text.toLowerCase()
      const normal = /normal|fine|all good|nothing/.test(t)
      const advice = /vitamin d/.test(t)
        ? 'Low vitamin D usually means a supplement your doctor sizes for you, plus daylight when you can. Training-wise nothing changes, but recovery often improves once it is corrected.'
        : /iron|ferritin/.test(t)
          ? 'Low iron blunts endurance and recovery. I will keep conditioning moderate for a few weeks and lean meals toward iron-rich foods: red meat, lentils, spinach with something acidic. Follow your doctor on supplements.'
          : /cholesterol|lipid/.test(t)
            ? 'For lipids, consistent training already helps. I will nudge meals toward fibre, oily fish and olive oil, and keep an eye on saturated fat.'
            : normal
              ? 'Good news. Nothing to adjust, so we keep training as planned.'
              : 'Noted. If your doctor gave you specific guidance, tell me and I will fit training and food around it.'
      return {
        text: voice.compose({ core: advice, soft: 'To be clear, this is coaching, not medical advice.' }),
        actions: normal ? [] : [{ type: 'remember', item: { category: 'health', text: `Bloodwork flag: ${intent.text}`, source: 'conversation' } }],
        suggestions: ['What should I eat today?', 'Build today’s workout'],
      }
    }

    case 'equipment_list': {
      const merged = [...new Set([...intent.equipment, 'bodyweight' as const])]
      return {
        text: voice.compose({ core: `Saved: ${intent.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(', ')}. Every workout from now on is built around that.`, push: 'Simple setup, serious results.', calm: 'That is plenty to work with.' }),
        actions: [{ type: 'update_user', patch: { equipment: merged } }, { type: 'remember', item: { category: 'equipment', text: `Available equipment: ${intent.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(', ')}`, source: 'conversation' } }],
        suggestions: ['Build today’s workout', 'Plan my week'],
        contextPatch: { topic: 'workout' },
      }
    }

    case 'plan_choice': {
      if (intent.choice === 'reference') return { text: voice.compose({ core: 'Kept as reference only. I will keep building your sessions around your goals and recovery.' }), suggestions: ['Build today’s workout'] }
      const program = generateProgram({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, weeks: 8, name: intent.choice === 'follow' ? '8-Week Uploaded Plan' : undefined })
      const { workouts, events } = materializeProgram(program, ctx.user, ctx.goals, ctx.workouts)
      return {
        text: voice.compose({ core: `${intent.choice === 'follow' ? 'Scheduled it as an 8-week block' : 'Blended it into an 8-week block around your goals'}: ${program.daysPerWeek} days a week, starting ${formatShortDate(fromDayKey(program.startDate))}. It is on your calendar.`, reason: 'I match loads to your history and adjust each session to how you recover.' }),
        cards: [{ id: uid('card'), type: 'program', refId: program.id, title: program.name, subtitle: `${program.weeks} weeks · ${program.daysPerWeek} days/week` }],
        actions: [{ type: 'create_program', program, workouts, events, replaceProgramId: ctx.activeProgram?.id }],
        suggestions: ['Show me week 1', 'Show my calendar'],
        contextPatch: { lastProgramId: program.id, topic: 'program' },
        status: 'Building your program',
        thinkMs: 1800,
      }
    }

    case 'food_log': {
      const analysis = req.foodAnalysis && req.foodAnalysis.items.length ? req.foodAnalysis : analyzeDescription(intent.text)
      if (analysis.needsDescription || !analysis.items.length) {
        return {
          text: voice.compose({ core: analysis.notes[0] ?? 'Tell me what was in it and roughly how much, and I will estimate it.', soft: 'One thing:' }),
          suggestions: ['Chicken, rice and veg', 'Eggs and toast', 'Salmon and potatoes'],
          expects: 'meal_description',
          contextPatch: { topic: 'nutrition' },
        }
      }
      const image = imageFromRequest(req, ctx)
      if (image) return foodDraftReply(analysis, req, ctx, voice, intent.slot)
      // Plain text: log it straight away (easily corrected or removed).
      const slot = intent.slot ?? slotForTime(ctx.now)
      const meal = buildMeal(analysis, { date: today, slot, source: 'text', status: 'logged' })
      return {
        text: voice.compose({
          core: `Logged as ${slotLabel(slot)}: ${meal.name}, about ${meal.calories} kcal, ${meal.proteinG} g protein, ${meal.carbsG} g carbs, ${meal.fatG} g fat. ${intakeLine(ctx, meal)}`,
          reason: analysis.notes[0],
          extra: 'Say “there was more rice”, “I only ate half” or “remove the sauce” and I will adjust it.',
          calm: 'Good, that is tracked.',
          push: 'Fuel logged. Keep stacking good decisions.',
          quip: 'Your macros have been notified.',
        }),
        cards: [foodCard(meal)],
        actions: [{ type: 'log_meal', meal }],
        suggestions: ['What should I eat tonight?', 'How much protein do I have left?', 'I only ate half'],
        contextPatch: { lastMealId: meal.id, topic: 'nutrition' },
        status: 'Estimating your meal',
        thinkMs: 900,
      }
    }

    case 'meal_correction': {
      const meal = ctx.contextMeal
      if (!meal) return { text: voice.compose({ core: 'Which meal do you mean? Log one first or tell me what you ate and I will adjust from there.' }), suggestions: ['What have I eaten today?', 'Log a meal'] }
      let current = meal
      const applied: string[] = []
      const failed: string[] = []
      for (const c of intent.corrections) {
        const r = applyCorrection(current, c)
        if (r.applied) {
          current = r.meal
          applied.push(r.summary)
        } else failed.push(r.summary)
      }
      if (!applied.length) {
        return {
          text: voice.compose({ core: `${failed[0] ?? 'I could not apply that.'} This meal has ${current.items.map((i) => i.name.toLowerCase()).join(', ')}.`, soft: 'Hmm,' }),
          cards: [foodCard(current)],
          suggestions: current.items.slice(0, 3).map((i) => `Remove the ${i.name.toLowerCase()}`),
          contextPatch: { lastMealId: current.id, topic: 'nutrition' },
        }
      }
      const isDraft = current.status === 'draft'
      return {
        text: voice.compose({
          core: `${applied.join(' ')} That makes it about ${current.calories} kcal and ${current.proteinG} g protein.${failed.length ? ` ${failed.join(' ')}` : ''}${isDraft ? '' : ` ${intakeLine(ctx, current, meal)}`}`,
          extra: isDraft ? `Say “add it to ${slotLabel(current.slot)}” when it looks right.` : undefined,
          calm: 'Updated.',
          push: 'Updated. Precision pays.',
        }),
        cards: [foodCard(current)],
        actions: [{ type: 'update_meal', meal: current }],
        suggestions: isDraft ? [`Add it to ${slotLabel(current.slot)}`, 'I only ate half', 'This was dinner'] : ['What should I eat tonight?', 'How much protein do I have left?'],
        contextPatch: { lastMealId: current.id, topic: 'nutrition' },
        thinkMs: 600,
      }
    }

    case 'meal_commit': {
      const meal = ctx.contextMeal
      if (!meal) return { text: voice.compose({ core: 'There is nothing waiting to be logged. Send a photo or tell me what you ate.' }), suggestions: ['I ate chicken, rice and veg', 'What have I eaten today?'] }
      const slot = intent.slot ?? meal.slot
      if (meal.status === 'logged' && slot === meal.slot) {
        return { text: voice.compose({ core: `That one is already in your ${slotLabel(slot)}. ${intakeLine(ctx)}` }), cards: [foodCard(meal)], suggestions: ['What should I eat tonight?', 'Remove that meal'], contextPatch: { lastMealId: meal.id, topic: 'nutrition' } }
      }
      const logged: LoggedMeal = { ...meal, slot, status: 'logged', updatedAt: new Date().toISOString() }
      return {
        text: voice.compose({
          core: `Added to ${slotLabel(slot)}: ${logged.name}, ${logged.calories} kcal and ${logged.proteinG} g protein. ${intakeLine(ctx, logged, meal.status === 'logged' ? meal : undefined)}`,
          calm: 'Tracked.',
          push: 'Logged. Keep the day honest.',
        }),
        cards: [foodCard(logged)],
        actions: [{ type: 'update_meal', meal: logged }],
        suggestions: ['What should I eat tonight?', 'How much protein do I have left?', 'What have I eaten today?'],
        contextPatch: { lastMealId: logged.id, topic: 'nutrition' },
        thinkMs: 500,
      }
    }

    case 'meal_discard': {
      const meal = ctx.contextMeal
      if (!meal) return { text: voice.compose({ core: 'Nothing to remove right now.' }), suggestions: ['What have I eaten today?'] }
      return {
        text: voice.compose({ core: meal.status === 'logged' ? `Removed ${meal.name.toLowerCase()} from your ${slotLabel(meal.slot)}.` : 'Discarded that estimate. Nothing was logged.', calm: 'Done.', push: 'Gone.' }),
        actions: [{ type: 'delete_meal', mealId: meal.id }],
        suggestions: ['What have I eaten today?', 'Log a meal'],
        contextPatch: { lastMealId: undefined, topic: 'nutrition' },
        thinkMs: 400,
      }
    }

    case 'eaten_today': {
      const n = ctx.nutrition
      if (!n.meals.length) return { text: voice.compose({ core: 'Nothing logged yet today. Send me a photo of a meal or tell me what you ate and I will keep the tally.', soft: 'Clean slate:' }), suggestions: ['I ate eggs and toast', 'What should I eat?'], contextPatch: { topic: 'nutrition' } }
      const lines = n.meals.map((m) => `• ${slotLabel(m.slot)}: ${m.name} (${m.calories} kcal, ${m.proteinG} g protein)`).join('\n')
      return {
        text: voice.compose({ core: `So far today:\n${lines}\n\nTotal ${n.consumed.calories.toLocaleString()} kcal, ${n.consumed.proteinG} g protein, ${n.consumed.carbsG} g carbs, ${n.consumed.fatG} g fat. ${intakeLine(ctx)}`, quip: 'I count everything. Lovingly.' }),
        cards: n.meals.slice(-1).map(foodCard),
        suggestions: ['What should I eat tonight?', 'How much protein do I have left?', 'Log a meal'],
        contextPatch: { lastMealId: n.meals[n.meals.length - 1].id, topic: 'nutrition' },
        thinkMs: 500,
      }
    }

    case 'remaining_nutrition': {
      const n = ctx.nutrition
      const r = n.remaining
      const m = intent.macro
      const core =
        m === 'protein'
          ? `${Math.max(0, r.proteinG)} g of protein left out of ${n.targets.proteinG} g${r.proteinG <= 0 ? ', so you are already there' : ''}.`
          : m === 'calories'
            ? `${Math.max(0, r.calories).toLocaleString()} kcal left out of ${n.targets.calories.toLocaleString()}${r.calories < 0 ? `, so you are about ${Math.abs(r.calories)} over` : ''}.`
            : m === 'carbs'
              ? `${Math.max(0, r.carbsG)} g of carbs left out of ${n.targets.carbsG} g.`
              : m === 'fat'
                ? `${Math.max(0, r.fatG)} g of fat left out of ${n.targets.fatG} g.`
                : `Left for today: ${Math.max(0, r.calories).toLocaleString()} kcal, ${Math.max(0, r.proteinG)} g protein, ${Math.max(0, r.carbsG)} g carbs, ${Math.max(0, r.fatG)} g fat. You have logged ${plural(n.meals.length, 'meal')}.`
      const advice = r.proteinG > 40 ? 'Make the next meal protein-forward and that closes it.' : r.proteinG <= 10 ? 'Protein is handled; the rest of the day can be relaxed.' : 'One normal meal covers it.'
      return {
        text: voice.compose({ core, reason: n.meals.length ? advice : 'Nothing is logged yet, so that is the full daily target.', calm: 'Easy.', push: 'Go hit it.' }),
        suggestions: ['What should I eat tonight?', 'What have I eaten today?', 'Log a meal'],
        contextPatch: { topic: 'nutrition' },
        thinkMs: 400,
      }
    }

    case 'menu_help': {
      const n = ctx.nutrition
      if (!intent.options?.length) {
        return {
          text: voice.compose({
            core: ctx.foodVision ? 'Tell me the two to four dishes you are torn between and I will pick for your day.' : 'I can’t read menu photos on this device yet, so tell me the two to four dishes you are considering and I will pick the best fit for today.',
            reason: `You have about ${Math.max(0, n.remaining.calories).toLocaleString()} kcal and ${Math.max(0, n.remaining.proteinG)} g protein left, which is what I will judge against.`,
            soft: 'No stress,',
          }),
          suggestions: ['Grilled salmon, chicken pasta or a burger', 'Steak and fries or a poke bowl'],
          expects: 'menu_options',
          contextPatch: { topic: 'nutrition' },
        }
      }
      const ranked = intent.options
        .map((o) => {
          const a = analyzeDescription(o)
          const t = totalsOf(a.items)
          const proteinScore = Math.min(1, t.proteinG / Math.max(20, Math.min(60, n.remaining.proteinG)))
          const calorieFit = n.remaining.calories > 0 ? 1 - Math.min(1, Math.abs(t.calories - n.remaining.calories * 0.8) / Math.max(400, n.remaining.calories)) : t.calories < 600 ? 0.8 : 0.3
          const goalBias = goal === 'lose_fat' ? (t.calories > 800 ? -0.3 : 0.1) : goal === 'build_muscle' ? (t.proteinG >= 35 ? 0.2 : -0.1) : 0
          return { name: o, t, score: a.items.length ? proteinScore * 0.6 + calorieFit * 0.4 + goalBias : 0.2 }
        })
        .sort((a, b) => b.score - a.score)
      const best = ranked[0]
      const others = ranked.slice(1)
      return {
        text: voice.compose({
          core: `I would go with the ${best.name}: roughly ${best.t.calories} kcal and ${best.t.proteinG} g protein${others.length ? `, versus ${listWithAnd(others.map((o) => `${o.name} (~${o.t.calories} kcal, ${o.t.proteinG} g protein)`))}` : ''}. It fits the ${Math.max(0, n.remaining.calories).toLocaleString()} kcal and ${Math.max(0, n.remaining.proteinG)} g protein you have left.`,
          reason: goal === 'lose_fat' ? 'Protein keeps you full and the calories stay honest.' : goal === 'build_muscle' ? 'Protein first, then enjoy the rest.' : 'Balanced and satisfying.',
          extra: 'Rough restaurant estimates, so treat them as a guide.',
          quip: 'Ordering is a skill. You just levelled up.',
        }),
        suggestions: [`I ate the ${best.name}`, 'What have I eaten today?'],
        contextPatch: { topic: 'nutrition' },
        thinkMs: 900,
      }
    }

    case 'availability': {
      const a = ctx.user.availability
      let days = intent.days
      const count = intent.count ?? days?.length ?? a.daysPerWeek
      if (!days) {
        // Pick from preferred days first, then sensible defaults, until we have `count`.
        const defaults = [1, 3, 5, 2, 4, 6, 0]
        days = [...a.preferredDays]
        for (const d of defaults) if (days.length < count && !days.includes(d)) days.push(d)
        days = days.slice(0, count).sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7))
      }
      const names = days.map((d) => WEEKDAY_NAMES_SHORT[d]).join(', ')
      if (intent.scope === 'always') {
        return {
          text: voice.compose({ core: `Got it: ${names}, ${plural(days.length, 'day')} a week from now on. Your schedule and future plans follow that.`, reason: ctx.activeProgram ? `${ctx.activeProgram.name} was built for ${ctx.activeProgram.daysPerWeek} days; say “rebuild my program” and I will refit it.` : 'I will slot sessions on those days and adapt if a week changes.', calm: 'Set.', push: 'Locked in.' }),
          actions: [
            { type: 'update_availability', patch: { preferredDays: days, daysPerWeek: days.length } },
            { type: 'remember', item: { category: 'availability', text: `Trains ${plural(days.length, 'day')} a week: ${names}`, source: 'conversation' } },
          ],
          suggestions: ['Plan my week', ctx.activeProgram ? 'Rebuild my program' : 'Create a 12-week program'],
          contextPatch: { lastAvailabilityScope: 'always', topic: 'calendar' },
          thinkMs: 500,
        }
      }
      // This week only: plan sessions on the chosen days without touching the persistent schedule.
      const week = weekPlanEvents(ctx, days, count)
      const keep = new Set(week.map((e) => e.workout.id))
      const windowEnd = dayKey(addDays(ctx.now, 6))
      // A shrinking plan (“actually make it three”) drops the coach-planned sessions that are no longer wanted.
      const dropped = ctx.workouts.filter((w) => w.status === 'planned' && !w.programId && w.scheduledFor >= today && w.scheduledFor <= windowEnd && !keep.has(w.id))
      const crossesWeek = week.some((e) => fromDayKey(e.date).getDay() === 1 && e.date > today)
      return {
        text: voice.compose({ core: `${crossesWeek ? 'Your next seven days' : 'This week'}: ${week.map((e) => `${weekdayName(fromDayKey(e.date), true)} ${e.title}`).join(' · ')}. ${plural(week.length, 'session')} on your calendar${dropped.length ? `, ${plural(dropped.length, 'session')} removed` : ''}, just for this week.`, reason: 'Your usual schedule stays as it is.', calm: 'Flexible weeks are fine.', push: 'Three good sessions beat five rushed ones.' }),
        cards: [{ id: uid('card'), type: 'calendar', title: crossesWeek ? 'Next seven days' : 'This week', subtitle: `${plural(week.length, 'session')} planned`, data: { days: week.map((e) => ({ date: e.date, title: e.title })) } }],
        actions: [...dropped.map((w) => ({ type: 'remove_workout', workoutId: w.id }) as CoachAction), ...week.map((e) => ({ type: 'create_workout', workout: e.workout }) as CoachAction)],
        suggestions: [week.length > 2 ? `Actually make it ${['zero', 'one', 'two', 'three', 'four', 'five', 'six'][week.length - 1]}` : `Make it ${['zero', 'one', 'two', 'three', 'four', 'five', 'six'][week.length + 1]}`, 'Show my calendar', ctx.todayWorkout && ctx.todayWorkout.status === 'planned' ? 'Start today’s session' : 'What should I eat today?'],
        contextPatch: { lastAvailabilityScope: 'week', topic: 'calendar' },
        status: 'Planning your week',
        thinkMs: 1200,
      }
    }

    case 'finished_workout': {
      const w = ctx.todayWorkout
      if (w && w.status === 'completed') return { text: voice.compose({ core: `Already logged: ${w.title} is done for today. ${voice.cheer(w.id)}` }), suggestions: ['What should I eat now?', 'How am I progressing?'] }
      if (w && (w.status === 'planned' || w.status === 'in_progress')) {
        const done = w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.completed).length, 0)
        const total = w.exercises.reduce((a, e) => a + e.sets.length, 0)
        return {
          text: voice.compose({ core: `${voice.cheer(w.id)} ${w.title} logged as complete${done && done < total ? ` (${done} of ${total} sets ticked; I counted the rest as done)` : ''}. Your streak, progress and calendar are updated.`, reason: 'Eat within a couple of hours and prioritise protein.', calm: 'Rest well.', push: 'Recover like it matters.' }),
          cards: [workoutCard({ ...w, status: 'completed' })],
          actions: [{ type: 'complete_workout', workoutId: w.id }],
          suggestions: ['What should I eat now?', 'How am I progressing?', 'Plan tomorrow'],
          contextPatch: { lastWorkoutId: w.id, topic: 'workout' },
          thinkMs: 700,
        }
      }
      // Nothing planned: log an ad-hoc session from the description.
      const focus = /upper|push|pull|chest|arms|back/.test(intent.text) ? 'upper' : /lower|legs?|squat/.test(intent.text) ? 'lower' : /run|cardio|bike|row|swim|hiit/.test(intent.text) ? 'conditioning' : 'full_body'
      const minutes = parseMinutesLoose(intent.text) ?? 45
      const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, constraints: { focus, minutes }, seed: `${today}-adhoc-${intent.text.length}` })
      gen.title = `${FOCUS_LABELS[focus]} · logged`
      gen.startedAt = new Date(Date.now() - minutes * 60_000).toISOString()
      return {
        text: voice.compose({ core: `Logged a ${minutes}-minute ${FOCUS_LABELS[focus].toLowerCase()} session for today. It counts toward your week and your streak.`, reason: 'If you tell me the main lifts and loads I can track those too.', calm: 'Nice work.', push: 'That is how weeks are won.' }),
        actions: [{ type: 'create_workout', workout: gen }, { type: 'complete_workout', workoutId: gen.id }],
        suggestions: ['What should I eat now?', 'How am I progressing?'],
        contextPatch: { lastWorkoutId: gen.id, topic: 'workout' },
        thinkMs: 700,
      }
    }

    case 'goal_delta': {
      const target = round(ctx.user.weightKg + (intent.direction === 'gain' ? intent.kg : -intent.kg), 1)
      const type = intent.direction === 'gain' ? 'build_muscle' : 'lose_fat'
      const r = respond({ kind: 'set_goal', goalType: type, metric: 'body_weight', target }, req, ctx, voice)
      const targets = computeTargets(ctx.user, [{ id: 'tmp', type, rank: 'primary', label: GOAL_LABELS[type], createdAt: '' }], Boolean(ctx.todayWorkout))
      return {
        ...r,
        text: voice.compose({
          core: `${intent.direction === 'gain' ? 'Gain' : 'Lose'} ${intent.kg} kg: goal set to ${GOAL_LABELS[type].toLowerCase()} with a target of ${target} kg (from ${ctx.user.weightKg} kg). Nutrition targets are now about ${targets.calories.toLocaleString()} kcal and ${targets.proteinG} g protein on training days, and every new workout follows the new goal.`,
          reason: intent.direction === 'gain' ? `At a clean ${0.25}–${0.5} kg a week that is roughly ${Math.ceil(intent.kg / 0.4)} weeks. Faster mostly adds fat.` : `At ${0.5} kg a week that is about ${Math.ceil(intent.kg / 0.5)} weeks while keeping your strength.`,
          extra: ctx.activeProgram ? `${ctx.activeProgram.name} was built for a different goal; say “rebuild my program” and I will refit it.` : undefined,
          push: 'Now we chase it.',
          calm: 'Clear target, steady pace.',
        }),
        suggestions: ['How does that affect my plan?', 'What should I eat today?', ctx.activeProgram ? 'Rebuild my program' : 'Build today’s workout'],
      }
    }

    case 'dislike_exercise': {
      const key = intent.text.toLowerCase().replace(/^(doing|the)\s+/, '').replace(/s$/, '')
      const existing = ctx.user.dislikedExercises ?? []
      const list = existing.includes(key) ? existing : [...existing, key]
      const actions: CoachAction[] = [
        { type: 'update_user', patch: { dislikedExercises: list } },
        { type: 'remember', item: { category: 'preference', text: `Dislikes ${intent.text.toLowerCase()}; avoid it in workouts`, source: 'conversation' } },
      ]
      let cards: CoachCard[] | undefined
      let swapped = ''
      const w = ctx.todayWorkout
      if (w && w.status === 'planned') {
        const affected = w.exercises.filter((e) => exerciseMatchesKeyword(e.exerciseId, e.name, key))
        if (affected.length) {
          let modified = w
          for (const e of affected) modified = replaceExercise(modified, e.exerciseId, { ...ctx.user, dislikedExercises: list }, ctx.workouts).workout
          actions.push({ type: 'update_workout', workout: modified })
          cards = [workoutCard(modified)]
          swapped = ` I swapped ${affected.map((e) => e.name.toLowerCase()).join(' and ')} out of today’s session.`
        }
      }
      return {
        text: voice.compose({ core: `Noted, no ${intent.text.toLowerCase()}. I will leave it out of your workouts from now on.${swapped}`, reason: 'If a goal really needs something similar I will offer an alternative first.', quip: 'Filed under “never again”.' }),
        cards,
        actions,
        suggestions: ['Build today’s workout', 'What do you know about me?'],
        thinkMs: 500,
      }
    }

    case 'goal_impact': {
      const primary = ctx.goals.find((g) => g.rank === 'primary')
      if (!primary) return respond({ kind: 'set_goal' }, req, ctx, voice)
      const targets = computeTargets(ctx.user, ctx.goals, Boolean(ctx.todayWorkout && ctx.todayWorkout.status !== 'skipped'))
      const lines = [
        `Your primary goal is ${primary.label.toLowerCase()}${primary.targetValue ? ` (target ${primary.targetValue} ${primary.targetUnit ?? ''})`.replace(/\s+\)/, ')') : ''}.`,
        `Nutrition: ${targets.calories.toLocaleString()} kcal and ${targets.proteinG} g protein today (${targets.rationale.toLowerCase().replace(/[.!]+$/, '')})`,
        `Training: sessions are built for ${primary.type === 'strength' ? 'heavier, lower-rep work' : primary.type === 'lose_fat' ? 'muscle-protecting lifting with shorter rests' : primary.type === 'conditioning' || primary.type === 'endurance' ? 'a stronger engine with intervals mixed in' : primary.type === 'build_muscle' ? 'progressive volume in the 8–12 rep range' : 'balanced, sustainable sessions'}.`,
      ]
      if (ctx.activeProgram && ctx.activeProgram.goalType !== primary.type) lines.push(`${ctx.activeProgram.name} was built for ${GOAL_LABELS[ctx.activeProgram.goalType].toLowerCase()}, so it no longer matches; I can rebuild it around the new goal.`)
      else if (ctx.activeProgram) lines.push(`${ctx.activeProgram.name} already matches this goal.`)
      return {
        text: voice.compose({ core: lines.join(' '), calm: 'Everything downstream follows the goal.', push: 'One goal, whole system aligned.' }),
        suggestions: ctx.activeProgram && ctx.activeProgram.goalType !== primary.type ? ['Rebuild my program', 'What should I eat today?'] : ['Build today’s workout', 'What should I eat today?'],
        contextPatch: { topic: 'goal' },
        thinkMs: 600,
      }
    }

    case 'tomorrow': {
      const tw = ctx.tomorrowWorkout
      const tomorrowDate = addDays(ctx.now, 1)
      const isTrainingDay = ctx.user.availability.preferredDays.includes(tomorrowDate.getDay())
      if (tw) {
        return {
          text: voice.compose({ core: `Tomorrow is ${tw.title}: about ${formatMinutes(tw.estimatedMinutes)}, ${tw.exercises.length} exercises${tw.programId ? ', from your program' : ''}.`, reason: tw.coachNote, calm: 'Sleep well tonight and it will feel easy.', push: 'Prep your kit tonight.' }),
          cards: [workoutCard(tw)],
          suggestions: ['Make it shorter', 'Move it to another day', 'What should I eat tomorrow?'],
          contextPatch: { lastWorkoutId: tw.id, topic: 'workout' },
        }
      }
      if (isTrainingDay) return respond({ kind: 'make_workout', constraints: { forDate: 'tomorrow' } }, req, ctx, voice)
      return {
        text: voice.compose({ core: `Tomorrow is a rest day on your schedule. ${ctx.tomorrowWorkout ? '' : 'A walk and good sleep, or say the word and I will plan something.'}`, calm: 'Rest is part of the plan.' }),
        suggestions: ['Plan a workout for tomorrow', 'Plan my week'],
        contextPatch: { topic: 'calendar' },
      }
    }

    case 'energy_report': {
      const scale = clamp(11 - intent.value, 1, 10)
      return handleFatigue(scale, ctx, voice)
    }

    case 'thanks':
      return { text: voice.compose({ core: voice.pick(req.text, ['Anytime.', 'That is what I am here for.', 'Of course.', 'Always.']), push: 'Now go do the work.', calm: 'Talk soon.', quip: 'Tip your coach in completed sets.' }), thinkMs: 300 }

    case 'yes': {
      const lastCoach = [...ctx.history].reverse().find((m) => m.role === 'coach')
      const lastCard = lastCoach?.cards?.[0]
      if (lastCard?.type === 'workout' && lastCard.refId) return respond({ kind: 'start_workout' }, req, ctx, voice)
      if (lastCoach?.text.match(/want me to build|want one|build something|want a structured/i)) return respond({ kind: 'make_workout', constraints: {} }, req, ctx, voice)
      if (lastCoach?.text.match(/rebuild it around/i)) return respond({ kind: 'create_program', weeks: ctx.activeProgram?.weeks ?? 12 }, req, ctx, voice)
      if (lastCoach?.text.match(/schedule one/i)) return respond({ kind: 'plan_week' }, req, ctx, voice)
      return { text: voice.compose({ core: 'Great. What do you want to do first?' }), suggestions: ['Build today’s workout', 'What should I eat?', 'Analyze my progress'], thinkMs: 300 }
    }

    case 'no':
      return { text: voice.compose({ core: voice.pick(req.text, ['No problem.', 'Understood.', 'Fair enough.']), calm: 'I am here when you need me.', push: 'When you are ready, I am ready.' }), suggestions: ['What should I do today?', 'Plan my week'], thinkMs: 300 }

    case 'help':
      return {
        text: voice.compose({
          core: `I am ${coachName}, your coach. Ask me for a workout (“build today’s workout”, “I only have 30 minutes”), tell me how you feel (“I’m tired”, “I slept badly”), ask about food (“what should I eat tonight?”), plan longer blocks (“create a 12-week program”), or ask me to analyze your progress. You can also send photos, PDFs and voice notes, and say “remember…” for anything I should keep in mind.`,
          extra: 'Everything I build becomes part of your real plan: workouts land on your calendar, meals in your nutrition, goals in your progress.',
          quip: 'I do not do taxes.',
        }),
        suggestions: ['Build today’s workout', 'Create a 12-week program', 'What should I eat?'],
        thinkMs: 500,
      }

    default: {
      // Unknown: keep it useful.
      const w = ctx.todayWorkout
      return {
        text: voice.compose({
          core: voice.pick(req.text, [
            'I want to get this right. Are you asking about training, food, your plan, or how you are feeling?',
            'Tell me a little more and I will act on it. Training, nutrition, schedule, or recovery?',
          ]),
          soft: 'Not sure I caught that:',
          quip: 'My reading comprehension is excellent for anything with reps in it.',
        }),
        suggestions: w && w.status === 'planned' ? ['Start my workout', 'Make it shorter', 'What should I eat?'] : ['Build today’s workout', 'What should I eat?', 'Analyze my progress'],
        thinkMs: 400,
      }
    }
  }
}

// ---------------------------------------------------------------------------

function handleFatigue(scale: number, ctx: CoachContext, voice: Voice): CoachReply {
  const today = todayKey()
  const actions: CoachAction[] = [{ type: 'check_in', patch: { fatigue: scale, energy: clamp(11 - scale, 1, 10) } }]
  const checkIn = { ...(ctx.todayCheckIn ?? { date: today, createdAt: new Date().toISOString() }), fatigue: scale, energy: clamp(11 - scale, 1, 10) }
  const readiness = computeReadiness(checkIn, ctx.workouts, today, ctx.user.sleepHoursTypical)
  const w = ctx.todayWorkout
  if (scale >= 8) {
    const rest = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness, constraints: { focus: 'core_mobility', minutes: 20, intensity: 'light' }, seed: `${today}-recovery` })
    rest.title = 'Recovery Flow'
    return {
      text: voice.compose({ core: `${scale} out of 10. That is a recovery day, not a training day. I swapped today for a 20-minute mobility flow; do that, eat properly, and get to bed early.`, reason: 'Training hard at this level of fatigue mostly adds stress without adding progress.', soft: 'Honestly,', calm: 'This is the plan working, not the plan failing.', push: 'Recover hard today, hit it tomorrow.' }),
      cards: [workoutCard(rest)],
      actions: [...actions, { type: 'create_workout', workout: rest, replaceWorkoutId: w?.status === 'planned' ? w.id : undefined }],
      suggestions: ['Start the flow', 'Skip today', 'What should I eat?'],
      contextPatch: { lastWorkoutId: rest.id, topic: 'recovery' },
      status: 'Adjusting your day',
    }
  }
  if (scale >= 5) {
    if (w && w.status === 'planned') {
      const lighter = shortenWorkout(scaleIntensity(w, 'lighter'), Math.max(25, w.estimatedMinutes - 15))
      return {
        text: voice.compose({ core: `${scale} out of 10. We still train, just lighter: I trimmed today to ${formatMinutes(lighter.estimatedMinutes)} and took the loads down a notch.`, reason: 'A moderate session on a tired day keeps the habit and usually leaves you feeling better than you started.', soft: 'If that sounds right,', calm: 'Easy does it.', push: 'Show up tired, leave better.' }),
        cards: [workoutCard(lighter)],
        actions: [...actions, { type: 'update_workout', workout: lighter }],
        suggestions: ['Start it', 'Make it even shorter', 'Skip today'],
        contextPatch: { lastWorkoutId: lighter.id, topic: 'workout' },
        status: 'Adjusting your workout',
      }
    }
    const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness, constraints: { intensity: 'light', minutes: Math.min(35, ctx.user.availability.sessionMinutes) }, seed: `${today}-light` })
    return {
      text: voice.compose({ core: `${scale} out of 10. A lighter session then: ${gen.title}, ${formatMinutes(gen.estimatedMinutes)}, nothing heroic.`, reason: 'Moving on tired days keeps the rhythm without digging the hole deeper.', calm: 'Gentle is still progress.', push: 'Tired is not the same as done.' }),
      cards: [workoutCard(gen)],
      actions: [...actions, { type: 'create_workout', workout: gen }],
      suggestions: ['Start it', 'Skip today', 'What should I eat?'],
      contextPatch: { lastWorkoutId: gen.id, topic: 'workout' },
      status: 'Building a lighter session',
    }
  }
  return {
    text: voice.compose({ core: `${scale} out of 10 is normal tiredness. Logged. Today's plan stands${w && w.status === 'planned' ? `: ${w.title}, ${formatMinutes(w.estimatedMinutes)}` : ''}.`, reason: 'Warm up a little longer and the first working set will tell you the truth.', push: 'Get after it.', calm: 'You have got this.' }),
    cards: w && w.status === 'planned' ? [workoutCard(w)] : undefined,
    actions,
    suggestions: w && w.status === 'planned' ? ['Start it', 'Make it shorter'] : ['Build today’s workout', 'What should I eat?'],
    contextPatch: w ? { lastWorkoutId: w.id, topic: 'workout' } : { topic: 'recovery' },
  }
}

function handleSleep(hours: number, ctx: CoachContext, voice: Voice): CoachReply {
  const today = todayKey()
  const actions: CoachAction[] = [
    { type: 'check_in', patch: { sleepHours: hours, sleepQuality: hours < 5 ? 1 : hours < 6.5 ? 2 : 3 } },
    { type: 'log_measurement', measurement: { type: 'sleep_hours', value: hours, unit: 'h', date: today, source: 'user' } },
  ]
  const w = ctx.todayWorkout
  if (hours < 5.5) {
    if (w && w.status === 'planned') {
      const lighter = shortenWorkout(scaleIntensity(w, 'lighter'), Math.max(25, w.estimatedMinutes - 15))
      return {
        text: voice.compose({ core: `${hours} hours is rough. I made today lighter and shorter (${formatMinutes(lighter.estimatedMinutes)}). If you would rather rest, say so; that is a valid choice today.`, reason: 'Under six hours, coordination and strength both drop, so we lower the risk and keep the habit.', soft: 'Genuinely,', calm: 'Sleep tonight is the real workout.', push: 'Show up, keep it clean, sleep early.' }),
        cards: [workoutCard(lighter)],
        actions: [...actions, { type: 'update_workout', workout: lighter }],
        suggestions: ['Start it', 'Skip today', 'Just a mobility flow'],
        contextPatch: { lastWorkoutId: lighter.id, topic: 'workout' },
        status: 'Adjusting your workout',
      }
    }
    return {
      text: voice.compose({ core: `${hours} hours. Logged. Nothing heavy today: a walk, a short mobility flow, and an early night will do more than a hard session.`, reason: 'I will plan a proper session for tomorrow.', calm: 'Recover first.', push: 'Rest is strategy today.' }),
      actions,
      suggestions: ['Give me a mobility flow', 'What should I eat?'],
      contextPatch: { topic: 'recovery' },
    }
  }
  return {
    text: voice.compose({ core: `${hours} hours, noted. Slightly short but workable. ${w && w.status === 'planned' ? `Today's ${w.title} stands; warm up properly and drop the last set if it feels heavy.` : 'I will keep today moderate.'}`, reason: 'I will watch for a pattern; two short nights in a row and we adjust more.', calm: 'You are fine.', push: 'Coffee, then work.' }),
    cards: w && w.status === 'planned' ? [workoutCard(w)] : undefined,
    actions,
    suggestions: w && w.status === 'planned' ? ['Start it', 'Make it lighter'] : ['Build today’s workout'],
    contextPatch: w ? { lastWorkoutId: w.id, topic: 'workout' } : { topic: 'recovery' },
  }
}

function modifyWorkout(w: Workout, change: WorkoutChange, ctx: CoachContext, voice: Voice): CoachReply {
  const ctxPatch = (x: Workout) => ({ lastWorkoutId: x.id, topic: 'workout' as const })
  const done = (x: Workout, core: string, extra?: Partial<Parameters<Voice['compose']>[0]>): CoachReply => ({
    text: voice.compose({ core, push: 'Now go.', calm: 'Good.', ...(extra ?? {}) }),
    cards: [workoutCard(x)],
    actions: [{ type: 'update_workout', workout: x }],
    suggestions: ['Start it', 'Swap an exercise', 'Something different'],
    contextPatch: ctxPatch(x),
    status: 'Adjusting your workout',
    thinkMs: 900,
  })
  switch (change.type) {
    case 'shorter': {
      const target = change.minutes ?? Math.max(20, Math.round((w.estimatedMinutes - 15) / 5) * 5)
      const x = shortenWorkout(w, target)
      return done(x, `Trimmed to about ${formatMinutes(x.estimatedMinutes)}: ${x.exercises.length} exercises, shorter rests.`, { reason: 'I dropped accessories first and kept the main lifts, so progress carries on.' })
    }
    case 'longer': {
      const target = change.minutes ?? w.estimatedMinutes + 15
      const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness: ctx.readiness, constraints: { ...(w.constraints ?? {}), focus: w.focus, minutes: target }, date: w.scheduledFor, seed: `${w.id}-longer` })
      const x = { ...gen, id: w.id, createdAt: w.createdAt, history: [...(w.history ?? []), `Extended to ${target} min`] }
      return done(x, `Extended to about ${formatMinutes(x.estimatedMinutes)} with ${x.exercises.length} exercises.`)
    }
    case 'replace': {
      let target = change.exerciseId
      if (!target && change.query) {
        const q = change.query.toLowerCase()
        target = w.exercises.find((e) => e.name.toLowerCase().includes(q) || q.includes(e.name.toLowerCase().split(' ')[0]))?.exerciseId
        if (!target) {
          // Try muscle words.
          const muscle = q.match(/squat|bench|press|row|curl|deadlift|lunge|plank|raise|pull|dip|fly|extension|crunch/)?.[0]
          if (muscle) target = w.exercises.find((e) => e.name.toLowerCase().includes(muscle))?.exerciseId
        }
      }
      if (!target || !w.exercises.some((e) => e.exerciseId === target)) {
        return {
          text: voice.compose({ core: `Which one should I swap? Today has ${w.exercises.map((e) => e.name).join(', ')}.` }),
          suggestions: w.exercises.slice(0, 4).map((e) => `Replace ${e.name}`),
          contextPatch: ctxPatch(w),
        }
      }
      const r = replaceExercise(w, target, ctx.user, ctx.workouts)
      if (!r.replacedWith) return { text: voice.compose({ core: `I could not find a good substitute for ${r.original.name} with your equipment. Want me to remove it instead?` }), suggestions: [`Remove ${r.original.name}`], contextPatch: ctxPatch(w) }
      return done(r.workout, `Swapped ${r.original.name} for ${r.replacedWith.name}.`, { reason: `Same movement pattern, so the session still hits ${getExercise(r.original.id).primary.replace('_', ' ')}.`, quip: `${r.original.name} will not take it personally.` })
    }
    case 'equipment': {
      const x = restrictEquipment(w, change.equipment, ctx.user, ctx.workouts)
      return done(x, `Rebuilt for ${change.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(' and ')} only. Same focus, same intent.`, { reason: 'I matched each swap to the original movement pattern, so the session still does its job.' })
    }
    case 'no_cardio': {
      const x = removeCardio(w)
      return done(x, `Cardio is out. ${x.title}, ${formatMinutes(x.estimatedMinutes)}.`, { reason: 'I will slot a conditioning piece in later this week so the goal still gets served.' })
    }
    case 'lighter':
      return done(scaleIntensity(w, 'lighter'), 'Loads down about 10% and one fewer set on each. Still a session, just kinder.', { reason: 'The habit matters more than any single day’s numbers.' })
    case 'harder':
      return done(scaleIntensity(w, 'harder'), 'Loads up about 5% with an extra set on the compounds. Earn it.', { reason: 'Only the compounds get more, so recovery stays manageable.' })
    case 'focus': {
      const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness: ctx.readiness, constraints: { ...(w.constraints ?? {}), focus: change.focus }, date: w.scheduledFor, seed: `${w.id}-${change.focus}` })
      const x = { ...gen, id: w.id, createdAt: w.createdAt, history: [...(w.history ?? []), `Changed focus to ${FOCUS_LABELS[change.focus]}`] }
      return done(x, `Switched to ${x.title}, ${formatMinutes(x.estimatedMinutes)}.`)
    }
    case 'regenerate':
    default: {
      const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness: ctx.readiness, constraints: w.constraints, date: w.scheduledFor, seed: `${w.id}-regen-${Date.now()}` })
      const x = { ...gen, id: w.id, createdAt: w.createdAt, history: [...(w.history ?? []), 'Regenerated'] }
      return done(x, `Here is a different take: ${x.title}, ${formatMinutes(x.estimatedMinutes)}.`)
    }
  }
}

function weekPlanEvents(ctx: CoachContext, days: number[], limit?: number): Array<{ date: string; title: string; workout: Workout }> {
  const out: Array<{ date: string; title: string; workout: Workout }> = []
  const history = [...ctx.workouts]
  const start = ctx.now
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i)
    const key = dayKey(d)
    if (!days.includes(d.getDay())) continue
    if (limit !== undefined && out.length >= limit) break
    const existing = ctx.workouts.find((w) => w.scheduledFor === key && w.status !== 'skipped')
    if (existing) {
      out.push({ date: key, title: existing.title, workout: existing })
      continue
    }
    const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: [...history, ...out.map((o) => ({ ...o.workout, status: 'completed' as const, completedAt: o.date }))], date: key, seed: `${key}-week`, constraints: {} })
    out.push({ date: key, title: gen.title, workout: gen })
  }
  return out
}

function nextWeekdayIncludingPast(weekday: number, from: Date): Date {
  // Prefer a date this week (Mon..Sun); fall back to next occurrence.
  const d = nextWeekday(weekday, from, true)
  return d
}

const WEEKDAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function listWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function slotLabel(slot: Meal['slot']): string {
  return { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'a snack', pre_workout: 'pre-workout', post_workout: 'post-workout' }[slot]
}

function foodCard(meal: LoggedMeal): CoachCard {
  return { id: uid('card'), type: 'food', refId: meal.id, title: meal.name, subtitle: `${meal.calories} kcal · ${meal.proteinG} g protein` }
}

function imageFromRequest(req: CoachRequest, ctx: CoachContext): { id: string; preview?: string } | undefined {
  const direct = req.attachments.find((a) => a.kind === 'image')
  if (direct) return { id: direct.id, preview: direct.previewDataUrl }
  // A photo sent a moment ago (the coach asked what it was).
  const recent = [...ctx.history].reverse().slice(0, 4).find((m) => m.role === 'user' && m.attachments?.some((a) => a.kind === 'image'))
  const att = recent?.attachments?.find((a) => a.kind === 'image')
  return att ? { id: att.id, preview: att.previewDataUrl } : undefined
}

/** One honest, contextual line about where the day stands after a meal. */
function intakeLine(ctx: CoachContext, adding?: LoggedMeal, replacing?: LoggedMeal): string {
  const n = ctx.nutrition
  const already = n.meals.some((m) => m.id === adding?.id)
  const base = { calories: n.consumed.calories, proteinG: n.consumed.proteinG }
  if (replacing && n.meals.some((m) => m.id === replacing.id)) {
    base.calories -= replacing.calories
    base.proteinG -= replacing.proteinG
  }
  if (adding && (!already || replacing)) {
    base.calories += adding.calories
    base.proteinG += adding.proteinG
  }
  const leftK = n.targets.calories - base.calories
  const leftP = n.targets.proteinG - base.proteinG
  const goal = primaryGoal(ctx.goals)
  const protein = `You are at about ${Math.round(base.proteinG)} g protein for the day`
  if (leftP <= 0) return `${protein}, which already covers your ${n.targets.proteinG} g target.${leftK < -150 ? ` You are ${Math.abs(leftK).toLocaleString()} kcal over, so keep the rest light.` : ''}`
  if (leftK <= 0) return `${protein}. Calories are at target, so anything else today should be light and protein-only.`
  const tail = goal === 'build_muscle' ? (leftP > 40 ? `keep the next meal protein-focused, ${Math.round(leftP)} g to go.` : `${Math.round(leftP)} g protein to go, no need to force a huge meal.`) : goal === 'lose_fat' ? `${leftK.toLocaleString()} kcal left, which is one solid meal.` : `${leftK.toLocaleString()} kcal and ${Math.round(leftP)} g protein left.`
  return `${protein}; ${tail}`
}

function foodDraftReply(analysis: FoodAnalysis, req: CoachRequest, ctx: CoachContext, voice: Voice, slotHint?: Meal['slot']): CoachReply {
  const image = imageFromRequest(req, ctx)
  const slot = slotHint ?? slotForTime(ctx.now)
  const meal = buildMeal(analysis, { date: todayKey(), slot, source: image ? 'scan' : 'text', status: 'draft', attachmentId: image?.id, previewDataUrl: image?.preview })
  const conf = confidenceLabel(meal.confidence)
  const parts = meal.items.map((i) => `${i.name}${i.unit === 'g' || i.unit === 'ml' ? ` ${i.grams} ${i.unit}` : i.quantity !== 1 ? ` ×${i.quantity}` : ''}`).join(', ')
  return {
    text: voice.compose({
      core: `${analysis.analysis === 'vision' ? 'From the photo I can see' : 'From your description I count'}: ${parts}. Estimated ${meal.calories} kcal, ${meal.proteinG} g protein, ${meal.carbsG} g carbs, ${meal.fatG} g fat (${conf} confidence).`,
      reason: analysis.notes[0] ?? (conf === 'high' ? 'Portions look standard.' : 'Portion sizes are the main uncertainty.'),
      extra: 'Correct anything (“more rice”, “200 g of rice”, “no sauce”, “I only ate half”) and then add it.',
      calm: 'Looks like a good plate.',
      push: 'Fuel, checked. Log it and move on.',
      quip: 'Your rice has been counted. It never stood a chance.',
    }),
    cards: [foodCard(meal)],
    actions: [{ type: 'log_meal', meal }],
    suggestions: [`Add it to ${slotLabel(slot)}`, 'There was more rice', 'I only ate half'],
    contextPatch: { lastMealId: meal.id, topic: 'nutrition' },
    status: 'Estimating your meal',
    thinkMs: 1000,
  }
}

function exerciseMatchesKeyword(exerciseId: string, name: string, key: string): boolean {
  const k = key.replace(/ing$/, '').replace(/s$/, '')
  const hay = `${exerciseId.replace(/_/g, ' ')} ${name}`.toLowerCase()
  if (hay.includes(k)) return true
  if (/^run/.test(k)) return /sprint|incline walk|jog|run/.test(hay)
  if (/^cardio/.test(k)) return /interval|sprint|burpee|jump rope|mountain climber|incline walk/.test(hay)
  return false
}

function parseMinutesLoose(text: string): number | undefined {
  const m = text.match(/(\d{1,3})\s*(?:min|mins|minutes)/i)
  return m ? Number(m[1]) : undefined
}

function categorize(text: string): MemoryItem['category'] {
  const t = text.toLowerCase()
  if (/goal|want to|aim/.test(t)) return 'goal'
  if (/dumbbell|barbell|kettlebell|bands?|gym|equipment|bench|machine/.test(t)) return 'equipment'
  if (/monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|am\b|pm\b|o'?clock|schedule|available|busy/.test(t)) return 'availability'
  if (/eat|food|vegan|vegetarian|allerg|lactose|gluten|protein|meal|snack|coffee|hate|love|dislike/.test(t)) return 'nutrition'
  if (/knee|back|shoulder|injur|pain|hurt|surgery|asthma|condition|doctor|physio/.test(t)) return 'health'
  if (/prefer|like|don'?t like|enjoy|favourite|favorite|hate/.test(t)) return 'preference'
  if (/sleep|wake|walk|steps|habit|usually|always|never/.test(t)) return 'habit'
  if (/talk|tone|direct|gentle|short|detailed|joke/.test(t)) return 'communication'
  return 'note'
}

function exerciseTouches(exerciseId: string, area: string): boolean {
  const ex = getExercise(exerciseId)
  const a = area.toLowerCase()
  if (/knee/.test(a)) return ['squat', 'lunge'].includes(ex.pattern) || ex.primary === 'quads'
  if (/back/.test(a)) return ['hinge', 'squat'].includes(ex.pattern) || ex.id === 'barbell_row'
  if (/shoulder/.test(a)) return ['vertical_push', 'horizontal_push'].includes(ex.pattern) || ex.primary === 'shoulders' || ex.id === 'dip'
  if (/elbow|wrist/.test(a)) return ex.primary === 'triceps' || ex.primary === 'biceps' || ex.pattern === 'horizontal_push'
  if (/hip/.test(a)) return ['hinge', 'lunge', 'squat'].includes(ex.pattern)
  if (/ankle|calf/.test(a)) return ['lunge', 'conditioning'].includes(ex.pattern) || ex.primary === 'calves'
  if (/hamstring/.test(a)) return ex.primary === 'hamstrings' || ex.pattern === 'hinge'
  if (/neck/.test(a)) return ex.pattern === 'vertical_push'
  return false
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}


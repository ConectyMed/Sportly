import { exerciseAliases, getExercise } from '@/domain/exercises'
import { equipmentLabel, exerciseName, focusLabel, goalLabel, mealSlotLabel, mealTemplateItems, mealTemplateName, muscleLabel, nutritionRationale, phaseLabel, phaseNote, programDescription, programDisplayName, programUploadedName, workoutCoachNote, workoutTitle } from '@/domain/labels'
import type { CoachCard, Goal, LoggedMeal, Meal, MemoryItem, Workout } from '@/domain/types'
import { translator, type Translator } from '@/i18n'
import type { Language } from '@/i18n/types'
import { analyzeDescription, applyCorrection, buildMeal, confidenceLabel, foodItemName, mealDisplayName, slotForTime, totalsOf, type FoodAnalysis } from './food/foodAnalysis'
import { computeTargets } from './nutritionGenerator'
import { addDays, dayKey, formatShortDate, fromDayKey, nextWeekday, timeOfDayGreeting, todayKey, weekdayName } from '@/lib/dates'
import { foldText, normalizeForMatching } from '@/lib/text'
import { clamp, formatMinutes, round, uid } from '@/lib/utils'
import { consistencyStreak, personalRecords, weeklyStats, weightTrend } from './insights'
import { parseIntent, parseSlot, type Intent, type WorkoutChange } from './intents'
import { generateNutritionPlan } from './nutritionGenerator'
import { buildVoice, type Voice } from './personality'
import { generateProgram, materializeProgram, programWeekFor } from './programGenerator'
import type { CoachAction, CoachContext, CoachProvider, CoachReply, CoachRequest } from './provider'
import { computeReadiness } from './readiness'
import { selectDaySummary } from './context'
import { categorizeMemory } from './memory'
import { labelForFrame, rangeFor } from './time'
import { generateWorkout, primaryGoal, removeCardio, replaceExercise, restrictEquipment, scaleIntensity, shortenWorkout, titledWorkout } from './workoutGenerator'

/**
 * The local coach. No network, no credentials: a structured, context-aware engine
 * that reads real app state, generates real entities and triggers real actions.
 * It is the default provider and the fallback when a remote model is unavailable.
 *
 * Language: the engine understands English and French and answers in the
 * user's selected language (ctx.language). Intents, actions and tools are the
 * same in both; only the language layer (parsing, phrasing, formatting) differs.
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
      language: ctx.language,
    })
    return respond(intent, req, ctx, buildVoice(ctx.coach.personality, ctx.language))
  }
}

/** Run the local engine for a pre-parsed intent (used by remote providers to materialise actions). */
export function respondToIntent(intent: Intent, req: CoachRequest, ctx: CoachContext): CoachReply {
  return respond(intent, req, ctx, buildVoice(ctx.coach.personality, ctx.language))
}

// ---------------------------------------------------------------------------

/** Everything a reply needs to speak the user's language. */
interface Speech {
  tr: Translator
  lang: Language
  voice: Voice
}

function firstName(ctx: CoachContext): string {
  return ctx.user.name.split(' ')[0]
}

function workoutCard(w: Workout, s: Speech): CoachCard {
  return { id: uid('card'), type: 'workout', refId: w.id, title: workoutTitle(w, s.lang), subtitle: s.tr.t('coach.card.workoutSubtitle', { minutes: formatMinutes(w.estimatedMinutes, s.lang), exercises: s.tr.tn('common.exercises', w.exercises.length) }) }
}

function programCard(p: { id: string; name: string; goalType: Goal['type']; weeks: number; daysPerWeek: number }, s: Speech, subtitle?: string): CoachCard {
  return { id: uid('card'), type: 'program', refId: p.id, title: programDisplayName(p, s.lang), subtitle: subtitle ?? s.tr.t('coach.card.programSubtitle', { weeks: s.tr.tn('common.weeks', p.weeks), days: s.tr.t('common.daysPerWeekShort', { count: p.daysPerWeek }) }) }
}

function readinessLine(ctx: CoachContext, s: Speech): string {
  const r = ctx.readiness
  if (!r.hasCheckIn) return ''
  if (r.recommendation === 'push') return s.tr.t('coach.readiness.push')
  if (r.recommendation === 'lighter') return s.tr.t('coach.readiness.lighter')
  if (r.recommendation === 'rest') return s.tr.t('coach.readiness.rest')
  return ''
}

function readinessScoreLine(ctx: CoachContext, s: Speech): string {
  const r = ctx.readiness
  return r.hasCheckIn ? s.tr.t('coach.readiness.line', { score: r.score, label: s.tr.t(`readiness.${r.label}`).toLowerCase() }) : ''
}

function suggestionsForWorkout(s: Speech): string[] {
  return [s.tr.t('coach.sug.makeShorter'), s.tr.t('coach.sug.onlyDumbbells'), s.tr.t('coach.sug.swapExercise'), s.tr.t('coach.sug.startIt')]
}

function respond(intent: Intent, req: CoachRequest, ctx: CoachContext, voice: Voice): CoachReply {
  const lang = ctx.language
  const tr = translator(lang)
  const s: Speech = { tr, lang, voice }
  const T = tr.t
  const name = firstName(ctx)
  const coachName = ctx.coach.name
  const goal = primaryGoal(ctx.goals)
  const today = todayKey()
  const workout = ctx.contextWorkout && ctx.contextWorkout.status !== 'completed' ? ctx.contextWorkout : ctx.todayWorkout
  const withWorkoutContext = (w: Workout) => ({ lastWorkoutId: w.id, topic: 'workout' as const })
  const wt = (w: Pick<Workout, 'title' | 'titleKey'>) => workoutTitle(w, lang)
  const mins = (n: number) => formatMinutes(n, lang)
  const day = (d: Date | string, short = false) => weekdayName(d, short, lang)
  const shortDate = (d: Date | string) => formatShortDate(d, lang)
  const exName = (e: { exerciseId: string; name: string }) => exerciseName(e.exerciseId, e.name, lang)
  const gl = (type: Goal['type']) => goalLabel(type, lang)
  const eq = (ids: readonly string[]) => tr.list(ids.map((e) => equipmentLabel(e as never, lang).toLowerCase()))
  const slotA = (slot: Meal['slot']) => T(`coach.slotA.${slot}`)
  const slotTo = (slot: Meal['slot']) => T(`coach.slotTo.${slot}`)
  const foodSug = (key: 'coach.sug.buildToday' | 'coach.sug.whatEat') => T(key)

  switch (intent.kind) {
    case 'greeting': {
      const tod = timeOfDayGreeting(ctx.now, lang)
      const w = ctx.todayWorkout
      const lines: string[] = [voice.greeting(name, tod)]
      if (w && w.status === 'planned') lines.push(T('coach.greeting.onToday', { title: wt(w), minutes: mins(w.estimatedMinutes) }))
      else if (w && w.status === 'completed') lines.push(T('coach.greeting.alreadyTrained', { cheer: voice.cheer(today) }))
      else lines.push(T('coach.greeting.nothingPlanned'))
      return {
        text: voice.compose({ core: lines.join(' '), quip: undefined, push: w?.status === 'planned' ? T('coach.greeting.push') : undefined, calm: T('coach.greeting.calm') }),
        suggestions: w?.status === 'planned' ? [T('coach.sug.startMyWorkout'), T('coach.sug.makeShorter'), T('coach.sug.whatEat')] : [T('coach.sug.buildToday'), T('coach.sug.planWeek'), T('coach.sug.whatEat')],
        thinkMs: 500,
      }
    }

    case 'today_plan': {
      const w = ctx.todayWorkout
      const r = ctx.readiness
      const rLine = readinessScoreLine(ctx, s)
      if (w && w.status === 'planned') {
        return {
          text: voice.compose({
            core: T('coach.today.core', { title: wt(w), minutes: mins(w.estimatedMinutes), exercises: tr.tn('common.exercises', w.exercises.length), readiness: rLine }).trim(),
            reason: r.recommendation === 'push' ? T('coach.today.reasonPush') : r.recommendation === 'lighter' ? T('coach.today.reasonLighter') : undefined,
            soft: T('coach.today.soft'),
            extra: workoutCoachNote(w, lang),
          }),
          cards: [workoutCard(w, s)],
          suggestions: [T('coach.sug.startIt'), T('coach.sug.makeShorter'), T('coach.sug.somethingDifferent')],
          contextPatch: withWorkoutContext(w),
        }
      }
      if (w && w.status === 'completed') {
        return {
          text: voice.compose({ core: T('coach.today.completed', { title: wt(w), readiness: rLine }).replace(/\s{2,}/g, ' '), calm: T('coach.today.completedCalm'), push: T('coach.today.completedPush') }),
          suggestions: [T('coach.sug.whatEat'), T('coach.sug.planTomorrow'), T('coach.sug.analyzeProgress')],
        }
      }
      if (r.recommendation === 'rest' && r.hasCheckIn) {
        const rest = titledWorkout(generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness: r, constraints: { focus: 'core_mobility', minutes: 20 }, seed: `${today}-rest` }), { recoveryFlow: true })
        return {
          text: voice.compose({ core: T('coach.today.restCore', { readiness: rLine }).trim(), soft: T('coach.today.restSoft'), calm: T('coach.today.restCalm'), push: T('coach.today.restPush') }),
          cards: [workoutCard(rest, s)],
          actions: [{ type: 'create_workout', workout: rest }],
          suggestions: [T('coach.sug.startIt'), T('coach.sug.realWorkout'), T('coach.sug.whatEat')],
          contextPatch: withWorkoutContext(rest),
          status: T('coach.status.checkingRecovery'),
        }
      }
      const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness: r, seed: `${today}-${ctx.workouts.length}` })
      return {
        text: voice.compose({
          core: T('coach.today.builtCore', { title: wt(gen), minutes: mins(gen.estimatedMinutes), readiness: rLine, line: readinessLine(ctx, s) }).replace(/\s+/g, ' ').trim(),
          reason: T('coach.today.builtReason', { goal: gl(goal).toLowerCase() }),
          extra: T('coach.today.builtExtra'),
        }),
        cards: [workoutCard(gen, s)],
        actions: [{ type: 'create_workout', workout: gen }],
        suggestions: suggestionsForWorkout(s),
        contextPatch: withWorkoutContext(gen),
        status: T('coach.status.buildingWorkout'),
        thinkMs: 1400,
      }
    }

    case 'tired': {
      if (intent.scale !== undefined) return handleFatigue(intent.scale, ctx, s)
      return {
        text: voice.compose({ core: T('coach.tired.ask'), reason: T('coach.tired.reason'), soft: T('coach.tired.soft'), calm: T('coach.tired.calm'), push: T('coach.tired.push') }),
        expects: 'fatigue_scale',
        suggestions: ['3', '5', '7', '9'],
        contextPatch: { topic: 'recovery' },
        thinkMs: 500,
      }
    }

    case 'scale_answer':
      return handleFatigue(intent.value, ctx, s)

    case 'slept_badly': {
      if (intent.hours !== undefined) return handleSleep(intent.hours, ctx, s)
      return {
        text: voice.compose({ core: T('coach.sleep.ask'), reason: T('coach.sleep.reason'), soft: T('coach.sleep.soft') }),
        expects: 'sleep_hours',
        suggestions: [tr.tn('common.hours', 4), tr.tn('common.hours', 5), tr.tn('common.hours', 6)],
        contextPatch: { topic: 'recovery' },
        thinkMs: 450,
      }
    }

    case 'hours_answer':
      return handleSleep(intent.value, ctx, s)

    case 'feeling_good': {
      const actions: CoachAction[] = [{ type: 'check_in', patch: { energy: 8, fatigue: 3, mood: 'great' } }]
      const w = ctx.todayWorkout
      if (w && w.status === 'planned' && !w.constraints?.intensity) {
        const harder = scaleIntensity(w, 'harder')
        actions.push({ type: 'update_workout', workout: harder })
        return {
          text: voice.compose({ core: T('coach.good.core'), reason: T('coach.good.reason'), push: T('coach.good.push'), calm: T('coach.good.calm') }),
          cards: [workoutCard(harder, s)],
          actions,
          suggestions: [T('coach.sug.startIt'), T('coach.sug.makeLighter'), T('coach.sug.whatEat')],
          contextPatch: withWorkoutContext(harder),
        }
      }
      return {
        text: voice.compose({ core: T('coach.good.logged'), reason: T('coach.good.loggedReason'), push: T('coach.good.loggedPush') }),
        actions,
        suggestions: [T('coach.sug.buildToday'), T('coach.sug.planWeek')],
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
        const what = [c.minutes ? T('coach.make.minutes', { n: c.minutes }) : '', c.equipment ? eq(c.equipment) : '', c.noCardio ? T('coach.make.noCardio') : ''].filter(Boolean).join(', ')
        return {
          text: voice.compose({ core: T('coach.make.adjustedCore', { what, title: wt(w), minutes: mins(w.estimatedMinutes) }), reason: T('coach.make.adjustedReason'), push: T('coach.make.adjustedPush'), calm: T('coach.make.adjustedCalm') }),
          cards: [workoutCard(w, s)],
          actions: [{ type: 'update_workout', workout: w }],
          suggestions: [T('coach.sug.startIt'), T('coach.sug.swapExercise'), T('coach.sug.makeShorter')],
          contextPatch: withWorkoutContext(w),
          status: T('coach.status.adjustingWorkout'),
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
      const constraintNote = [c.minutes ? T('coach.make.fitsIn', { n: c.minutes }) : '', c.equipment ? T('coach.make.usesOnly', { equipment: eq(c.equipment) }) : '', c.noCardio ? T('coach.make.noCardio') : '']
        .filter(Boolean)
        .join(', ')
      const note = constraintNote ? `, ${constraintNote}` : ''
      const core = existing
        ? T('coach.make.replacedCore', { day: date === today ? T('coach.todays') : T('coach.tomorrows'), title: wt(gen), minutes: mins(gen.estimatedMinutes), note })
        : T('coach.make.builtCore', { title: wt(gen), minutes: mins(gen.estimatedMinutes), note, goal: gl(goal).toLowerCase() })
      return {
        text: voice.compose({
          core: `${core} ${readinessLine(ctx, s)}`.trim(),
          reason: gen.focus === 'conditioning' ? T('coach.make.reasonConditioning') : T('coach.make.reasonRotation', { focus: focusLabel(gen.focus, lang) }),
          extra: T('coach.make.extra'),
          push: T('coach.make.push'),
          calm: T('coach.make.calm'),
        }),
        cards: [workoutCard(gen, s)],
        actions: [{ type: 'create_workout', workout: gen, replaceWorkoutId: existing?.status === 'planned' ? existing.id : undefined }],
        suggestions: suggestionsForWorkout(s),
        contextPatch: withWorkoutContext(gen),
        status: T('coach.status.buildingWorkout'),
        thinkMs: 1500,
      }
    }

    case 'modify_workout': {
      if (!workout || workout.status === 'completed') {
        return {
          text: voice.compose({ core: T('coach.make.noWorkout'), soft: T('coach.make.noWorkoutSoft') }),
          suggestions: [T('coach.sug.buildToday'), T('coach.sug.only30')],
        }
      }
      return modifyWorkout(workout, intent.change, ctx, s)
    }

    case 'start_workout': {
      const w = workout ?? ctx.todayWorkout
      if (!w || w.status === 'completed') {
        return {
          text: voice.compose({ core: T('coach.start.nothing'), push: T('coach.start.nothingPush') }),
          suggestions: [T('coach.sug.buildToday'), T('coach.sug.only30')],
        }
      }
      return {
        text: voice.compose({ core: T('coach.start.ready', { title: wt(w) }), push: T('coach.start.push'), calm: T('coach.start.calm'), quip: T('coach.start.quip') }),
        cards: [workoutCard(w, s)],
        contextPatch: withWorkoutContext(w),
        thinkMs: 400,
      }
    }

    case 'skip_workout': {
      const w = ctx.todayWorkout
      if (!w || w.status !== 'planned') return { text: voice.compose({ core: T('coach.skip.nothing'), calm: T('coach.skip.nothingCalm') }), suggestions: [T('coach.sug.planTomorrow'), T('coach.sug.whatEat')] }
      return {
        text: voice.compose({
          core: T('coach.skip.core', { title: lang === 'en' ? wt(w).toLowerCase() : wt(w) }),
          reason: T('coach.skip.reason'),
          soft: T('coach.skip.soft'),
          push: T('coach.skip.push'),
        }),
        actions: [{ type: 'skip_workout', workoutId: w.id }],
        suggestions: [T('coach.sug.planTomorrow'), T('coach.sug.actually20'), T('coach.sug.whatEat')],
        contextPatch: { topic: 'calendar' },
      }
    }

    case 'create_program': {
      // Adjusting an existing program ("3 days a week", "around fat loss") keeps its length.
      const weeks = intent.weeks ?? (ctx.activeProgram && (intent.daysPerWeek || intent.goalType) ? ctx.activeProgram.weeks : undefined)
      if (!weeks) {
        return {
          text: voice.compose({ core: T('coach.program.askWeeks'), reason: T('coach.program.askWeeksReason'), soft: T('coach.program.askWeeksSoft') }),
          expects: 'program_weeks',
          suggestions: [tr.tn('common.weeks', 8), tr.tn('common.weeks', 12), tr.tn('common.weeks', 16)],
          contextPatch: { topic: 'program' },
          thinkMs: 400,
        }
      }
      const program = generateProgram({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, weeks, daysPerWeek: intent.daysPerWeek, goalType: intent.goalType })
      const { workouts, events } = materializeProgram(program, ctx.user, ctx.goals, ctx.workouts)
      const replacing = ctx.activeProgram
      return {
        text: voice.compose({
          core: T('coach.program.core', { lead: replacing ? T('coach.program.replaced', { old: programDisplayName(replacing, lang) }) : T('coach.program.built'), name: programDisplayName(program, lang), days: program.daysPerWeek, date: shortDate(fromDayKey(program.startDate)) }),
          reason: programDescription(program, lang),
          extra: T('coach.program.extra'),
          push: T('coach.program.push'),
          calm: T('coach.program.calm'),
          quip: T('coach.program.quip'),
        }),
        cards: [programCard(program, s)],
        actions: [{ type: 'create_program', program, workouts, events, replaceProgramId: replacing?.id }],
        suggestions: [T('coach.sug.showWeek1'), T('coach.sug.showCalendar'), T('coach.sug.eatTrainingDays')],
        contextPatch: { lastProgramId: program.id, topic: 'program' },
        status: T('coach.status.designingProgram'),
        thinkMs: 2200,
      }
    }

    case 'cancel_program': {
      if (!ctx.activeProgram) return { text: voice.compose({ core: T('coach.program.noneToCancel') }), suggestions: [T('coach.sug.create12')] }
      return {
        text: voice.compose({ core: T('coach.program.cancelled', { name: programDisplayName(ctx.activeProgram, lang) }), soft: T('coach.program.cancelledSoft'), reason: T('coach.program.cancelledReason') }),
        actions: [{ type: 'cancel_program', programId: ctx.activeProgram.id }],
        suggestions: [T('coach.sug.buildToday'), T('coach.sug.createNew')],
        contextPatch: { topic: 'program' },
      }
    }

    case 'show_program': {
      const p = ctx.activeProgram
      if (!p) return { text: voice.compose({ core: T('coach.program.noneToShow') }), suggestions: [T('coach.sug.create12'), T('coach.sug.create8')] }
      const week = clamp(programWeekFor(p, ctx.now), 1, p.weeks)
      const phase = p.weeksPlan[week - 1].phase
      return {
        text: voice.compose({ core: T('coach.program.show', { week, total: p.weeks, name: programDisplayName(p, lang), phase: phaseLabel(phase, lang).toLowerCase() }), reason: phaseNote(phase, lang) }),
        cards: [programCard(p, s, T('coach.card.weekOf', { week, total: p.weeks }))],
        suggestions: [T('coach.sug.changeProgram'), T('coach.sug.cancelProgram')],
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
      const dayLead = isTrainingDay ? T('coach.nutrition.trainingDay') : T('coach.nutrition.restDay')
      let core: string
      let reason: string | undefined = nutritionRationale(plan, lang)
      if (meal && eaten) {
        // Size the suggestion to what is actually left today.
        const left = Math.max(0, n.remaining.calories)
        const leftP = Math.max(0, n.remaining.proteinG)
        const scale = left > 0 ? Math.min(1.4, Math.max(0.5, left / Math.max(1, meal.calories))) : 0.5
        const kcal = Math.round((meal.calories * scale) / 10) * 10
        const prot = Math.round(meal.proteinG * scale)
        core = T('coach.nutrition.eatenMeal', { kcal: tr.int(n.consumed.calories), protein: n.consumed.proteinG, leftKcal: tr.int(left), leftProtein: leftP, slot: mealSlotLabel(intent.slot!, lang), meal: mealTemplateName(meal.templateId, meal.name, lang), items: mealTemplateItems(meal.templateId, meal.items, lang).join(', '), mealKcal: kcal, mealProtein: prot })
        reason = leftP > 40 ? T('coach.nutrition.reasonProteinPriority') : leftP <= 10 ? T('coach.nutrition.reasonProteinCovered') : T('coach.nutrition.reasonCloses')
      } else if (meal) {
        core = T('coach.nutrition.meal', { slot: mealSlotLabel(intent.slot!, lang), meal: mealTemplateName(meal.templateId, meal.name, lang), items: mealTemplateItems(meal.templateId, meal.items, lang).join(', '), kcal: meal.calories, protein: meal.proteinG })
      } else if (eaten) {
        core = T('coach.nutrition.eatenDay', { day: dayLead, kcal: tr.int(plan.calories), protein: plan.proteinG, eatenKcal: tr.int(n.consumed.calories), eatenProtein: n.consumed.proteinG, meals: tr.tn('common.meals', n.meals.length), leftKcal: tr.int(Math.max(0, n.remaining.calories)), leftProtein: Math.max(0, n.remaining.proteinG) })
      } else {
        core = T('coach.nutrition.day', { day: dayLead, kcal: tr.int(plan.calories), protein: plan.proteinG, carbs: plan.carbsG, fat: plan.fatG, meals: plan.meals.length })
      }
      return {
        text: voice.compose({ core, reason, extra: T('coach.nutrition.extra'), calm: T('coach.nutrition.calm'), push: T('coach.nutrition.push'), quip: T('coach.nutrition.quip') }),
        cards: [{ id: uid('card'), type: 'nutrition', refId: plan.id, title: T('coach.card.nutritionTitle'), subtitle: T('coach.card.nutritionSubtitle', { kcal: tr.int(plan.calories), protein: plan.proteinG }) }],
        actions,
        suggestions: eaten ? [T('coach.sug.eatenToday'), T('coach.sug.restaurantTonight'), T('coach.sug.logMeal')] : [T('coach.sug.restaurantTonight'), T('coach.sug.lowerCarb'), T('coach.sug.whatsForDinner')],
        contextPatch: { lastNutritionPlanId: plan.id, topic: 'nutrition' },
        status: T('coach.status.planningMeals'),
        thinkMs: 1100,
      }
    }

    case 'restaurant': {
      const isTrainingDay = Boolean(ctx.todayWorkout && ctx.todayWorkout.status !== 'skipped')
      const plan = generateNutritionPlan({ user: ctx.user, goals: ctx.goals, isTrainingDay, restaurantDinner: true, seed: `${today}-${ctx.user.id}-rest` })
      return {
        text: voice.compose({
          core: T('coach.restaurant.core'),
          reason: T('coach.restaurant.reason'),
          extra: T('coach.restaurant.extra'),
          calm: T('coach.restaurant.calm'),
          push: T('coach.restaurant.push'),
          quip: T('coach.restaurant.quip'),
        }),
        cards: [{ id: uid('card'), type: 'nutrition', refId: plan.id, title: T('coach.restaurant.cardTitle'), subtitle: T('coach.restaurant.cardSubtitle', { kcal: tr.int(plan.calories) }) }],
        actions: [{ type: 'create_nutrition_plan', plan }, { type: 'remember', item: { category: 'habit', text: T('coach.restaurant.memory', { day: day(ctx.now), date: shortDate(ctx.now) }), source: 'conversation' } }],
        suggestions: [T('coach.sug.whatWouldYouChoose'), T('coach.sug.whatOrder'), T('coach.sug.planTomorrowMeals')],
        contextPatch: { lastNutritionPlanId: plan.id, topic: 'nutrition' },
        status: T('coach.status.adjustingDay'),
        thinkMs: 1100,
      }
    }

    case 'analyze_progress': {
      const stats = weeklyStats(ctx.workouts, 4)
      const sessions = stats.reduce((a, st) => a + st.sessions, 0)
      const streak = consistencyStreak(ctx.workouts, ctx.targetPerWeek)
      const trend = weightTrend(ctx.measurements)
      const prs = personalRecords(ctx.workouts).slice(0, 2)
      if (sessions === 0 && !trend.current) {
        return { text: voice.compose({ core: T('coach.progress.notYet'), calm: T('coach.progress.notYetCalm') }), suggestions: [T('coach.sug.buildToday'), T('coach.sug.logWeight')] }
      }
      const parts: string[] = [T('coach.progress.lastFour', { sessions: tr.tn('common.sessions', sessions), streak: streak.current ? T('coach.progress.streak', { n: streak.current }) : '' })]
      if (trend.current && trend.change30 !== undefined) {
        const kg = tr.num(Math.abs(trend.change30))
        const current = tr.num(trend.current)
        parts.push(trend.change30 > 0 ? T('coach.progress.weightUp', { kg, current }) : trend.change30 < 0 ? T('coach.progress.weightDown', { kg, current }) : T('coach.progress.weightFlat', { current }))
      }
      if (prs.length) parts.push(T('coach.progress.bestLifts', { lifts: prs.map((p) => T('coach.progress.lift', { name: exerciseName(p.exerciseId, p.name, lang), kg: tr.num(p.weightKg), reps: p.reps })).join(', ') }))
      const top = ctx.insights[0]
      return {
        text: voice.compose({ core: parts.join(' '), reason: top ? `${top.text} ${top.detail ?? ''}`.trim() : undefined, extra: ctx.insights[1] ? ctx.insights[1].text : undefined, push: T('coach.progress.push'), calm: T('coach.progress.calm'), quip: T('coach.progress.quip') }),
        cards: [{ id: uid('card'), type: 'progress', title: T('coach.progress.cardTitle'), subtitle: T('coach.progress.cardSubtitle', { sessions: tr.tn('common.sessions', sessions) }), data: { sessions, streak: streak.current, weight: trend.current, change30: trend.change30, insights: ctx.insights.slice(0, 2).map((i) => i.text) } }],
        suggestions: [T('coach.sug.whyWeightStopped'), T('coach.sug.planWeek'), T('coach.sug.setNewGoal')],
        contextPatch: { topic: 'progress' },
        status: T('coach.status.reviewingProgress'),
        thinkMs: 1300,
      }
    }

    case 'weight_stalled': {
      const trend = weightTrend(ctx.measurements)
      const wantsGain = goal === 'build_muscle' || goal === 'strength'
      const wantsLoss = goal === 'lose_fat'
      if (!trend.current) return { text: voice.compose({ core: T('coach.stall.noData') }), suggestions: [T('coach.sug.logWeight')] }
      const core = trend.stalled
        ? T('coach.stall.flat', { kg: tr.num(trend.current), why: wantsGain ? T('coach.stall.whyGain') : wantsLoss ? T('coach.stall.whyLoss') : T('coach.stall.whyPlateau') })
        : T('coach.stall.moving', { change: tr.signed(trend.change30 ?? 0) })
      const fix = wantsGain ? T('coach.stall.fixGain') : wantsLoss ? T('coach.stall.fixLoss') : T('coach.stall.fixOther')
      return {
        text: voice.compose({ core, reason: fix, extra: T('coach.stall.extra'), calm: T('coach.stall.calm'), push: T('coach.stall.push'), quip: T('coach.stall.quip') }),
        suggestions: wantsGain || wantsLoss ? [T('coach.sug.updateNutritionTargets'), T('coach.sug.analyzeProgress')] : [T('coach.sug.setWeightGoal'), T('coach.sug.analyzeProgress')],
        contextPatch: { topic: 'progress' },
        thinkMs: 1000,
      }
    }

    case 'remember': {
      const category = categorizeMemory(intent.text)
      const item: Omit<MemoryItem, 'id' | 'createdAt'> = { category, text: capitalize(intent.text), source: 'conversation' }
      return {
        text: voice.compose({ core: T('coach.remember.core', { text: item.text }), reason: category === 'health' ? T('coach.remember.health') : undefined, calm: undefined, push: undefined, quip: T('coach.remember.quip') }),
        cards: [{ id: uid('card'), type: 'memory', title: T('coach.remember.cardTitle'), subtitle: item.text, data: { category } }],
        actions: [{ type: 'remember', item }],
        suggestions: [T('coach.sug.whatDoYouKnow'), T('coach.sug.buildToday')],
        thinkMs: 500,
      }
    }

    case 'forget': {
      const q = normalizeForMatching(intent.text)
      const found = ctx.memory.find((m) => normalizeForMatching(m.text).includes(q) || q.includes(normalizeForMatching(m.text)))
      if (!found) return { text: voice.compose({ core: T('coach.forget.notFound') }), suggestions: [T('coach.sug.whatDoYouKnow')] }
      return { text: voice.compose({ core: T('coach.forget.done', { text: found.text }) }), actions: [{ type: 'forget', memoryId: found.id }], thinkMs: 400 }
    }

    case 'what_do_you_know': {
      const top = ctx.memory.slice(0, 6)
      const bullets = top.map((m) => `• ${m.text}`).join('\n')
      return {
        text: voice.compose({ core: T('coach.know.core', { name, bullets, more: ctx.memory.length > 6 ? T('coach.know.more', { n: ctx.memory.length - 6 }) : '' }), reason: T('coach.know.reason'), quip: T('coach.know.quip') }),
        cards: [{ id: uid('card'), type: 'memory', title: T('coach.know.cardTitle'), subtitle: T('coach.know.cardSubtitle', { things: tr.tn('common.things', ctx.memory.length) }) }],
        suggestions: [T('coach.sug.remember7am'), T('coach.sug.forgetSomething')],
        thinkMs: 500,
      }
    }

    case 'plan_week': {
      const days = ctx.user.availability.preferredDays.length ? ctx.user.availability.preferredDays : [1, 3, 5]
      const week = weekPlanEvents(ctx, days)
      const summary = week.map((e) => `${day(fromDayKey(e.date), true)}: ${wt(e.workout)}`).join(' · ')
      return {
        text: voice.compose({ core: T('coach.week.core', { summary, n: week.length }), reason: T('coach.week.reason'), extra: T('coach.week.extra'), push: T('coach.week.push'), calm: T('coach.week.calm') }),
        cards: [{ id: uid('card'), type: 'calendar', title: T('coach.week.cardTitle'), subtitle: T('coach.week.cardSubtitle', { sessions: tr.tn('common.sessions', week.length) }), data: { days: week.map((e) => ({ date: e.date, title: wt(e.workout) })) } }],
        actions: week.map((e) => ({ type: 'create_workout', workout: e.workout }) as CoachAction),
        suggestions: [T('coach.sug.moveMonWed'), T('coach.sug.startTodaySession'), T('coach.sug.whatEat')],
        contextPatch: { topic: 'calendar' },
        status: T('coach.status.planningWeek'),
        thinkMs: 1600,
      }
    }

    case 'reschedule': {
      const discussed = intent.fromContext && ctx.contextWorkout && ctx.contextWorkout.status === 'planned' ? ctx.contextWorkout : undefined
      const fromDate = discussed
        ? discussed.scheduledFor
        : intent.fromRelative === 'tomorrow'
          ? ctx.time.tomorrow
          : intent.from !== undefined
            ? dayKey(nextWeekdayIncludingPast(intent.from, ctx.now))
            : today
      const toDate = intent.toRelative === 'tomorrow' ? dayKey(addDays(ctx.now, 1)) : intent.toRelative === 'today' ? today : intent.to !== undefined ? dayKey(nextWeekday(intent.to, ctx.now, true)) : undefined
      const ev = discussed ? ctx.events.find((e) => e.workoutId === discussed.id) : ctx.events.find((e) => e.type === 'workout' && e.date === fromDate && e.status === 'planned')
      const evTitle = (e: { title: string; workoutId?: string }) => (e.workoutId && ctx.workouts.find((w) => w.id === e.workoutId) ? wt(ctx.workouts.find((w) => w.id === e.workoutId)!) : e.title)
      if (!ev) {
        return { text: voice.compose({ core: T('coach.reschedule.none', { day: day(fromDayKey(fromDate)) }) }), suggestions: [T('coach.sug.planWeek'), T('coach.sug.buildToday')] }
      }
      if (!toDate) return { text: voice.compose({ core: T('coach.reschedule.which', { title: evTitle(ev) }) }), expects: 'reschedule_day', suggestions: [T('common.tomorrow'), tr.weekday(3), tr.weekday(6)] }
      // "Move tomorrow's workout to Friday" on a Thursday: it is already there. Say so; a no-op is not a move.
      if (ev.date === toDate) {
        return {
          text: voice.compose({ core: T('coach.reschedule.sameDay', { title: evTitle(ev), day: day(fromDayKey(toDate)) }) }),
          suggestions: [T('coach.sug.showCalendar'), T('coach.sug.planWeek')],
          contextPatch: { lastEventId: ev.id, topic: 'calendar' },
        }
      }
      const clash = ctx.events.find((e) => e.type === 'workout' && e.date === toDate && e.status === 'planned' && e.id !== ev.id)
      return {
        text: voice.compose({ core: `${T('coach.reschedule.moved', { title: evTitle(ev), from: day(fromDayKey(fromDate)), to: day(fromDayKey(toDate)) })}${clash ? T('coach.reschedule.clash', { day: day(fromDayKey(toDate)) }) : ''}`, reason: T('coach.reschedule.reason'), calm: T('coach.reschedule.calm'), push: T('coach.reschedule.push') }),
        cards: [{ id: uid('card'), type: 'calendar', title: evTitle(ev), subtitle: `${day(fromDayKey(fromDate), true)} → ${day(fromDayKey(toDate), true)}`, data: { from: fromDate, to: toDate } }],
        actions: [{ type: 'move_event', eventId: ev.id, toDate }],
        suggestions: [T('coach.sug.showCalendar'), T('coach.sug.planWeek')],
        contextPatch: { lastEventId: ev.id, topic: 'calendar' },
        thinkMs: 700,
      }
    }

    case 'weekday_plan': {
      // “What’s on Friday?”: the next occurrence of that weekday, today included.
      const date = dayKey(nextWeekday(intent.weekday, ctx.now, true))
      const dayLabel = day(fromDayKey(date))
      const ws = ctx.workouts.filter((w) => w.scheduledFor === date).sort((a, b) => (a.status === 'planned' ? -1 : 1) - (b.status === 'planned' ? -1 : 1))
      const w = ws[0]
      if (!w) {
        return { text: voice.compose({ core: T('coach.weekday.nothing', { day: dayLabel }) }), suggestions: [T('coach.sug.planWeek'), T('coach.sug.buildNew')], contextPatch: { topic: 'calendar' } }
      }
      const status = w.status === 'completed' ? T('coach.weekday.done') : w.status === 'skipped' ? T('coach.weekday.skipped') : ''
      return {
        text: voice.compose({ core: T('coach.weekday.planned', { day: dayLabel, title: wt(w), status }), reason: w.status === 'planned' ? T('coach.weekday.reason') : undefined, extra: workoutCoachNote(w, lang) }),
        cards: [workoutCard(w, s)],
        references: [{ type: 'workout', id: w.id, label: wt(w) }],
        suggestions: w.status === 'planned' ? [T('coach.sug.makeShorter'), T('coach.sug.moveAnotherDay'), T('coach.sug.showCalendar')] : [T('coach.sug.showCalendar'), T('coach.sug.planWeek')],
        contextPatch: { lastWorkoutId: w.id, topic: 'calendar' },
        thinkMs: 400,
      }
    }

    case 'set_goal': {
      const existingPrimary = ctx.goals.find((g) => g.rank === 'primary')
      if (!intent.goalType && !intent.metric && !intent.target) {
        return {
          text: voice.compose({ core: T('coach.goal.ask'), reason: T('coach.goal.askReason') }),
          expects: 'goal_choice',
          suggestions: [T('coach.sug.buildMuscle'), T('coach.sug.loseFat'), T('coach.sug.bench100'), T('coach.sug.fourWorkoutsWeek')],
          contextPatch: { topic: 'goal' },
          thinkMs: 300,
        }
      }
      const type = intent.goalType ?? existingPrimary?.type ?? 'general_fitness'
      const metric = intent.metric
      if (metric && !intent.target) {
        return { text: voice.compose({ core: T('coach.goal.askNumber'), reason: metric === 'body_weight' ? T('coach.goal.numberWeight') : metric === 'workouts_per_week' ? T('coach.goal.numberSessions') : T('coach.goal.numberLoad') }), expects: 'goal_target', suggestions: metric === 'body_weight' ? [`${tr.int(round(ctx.user.weightKg - 3))} kg`, `${tr.int(round(ctx.user.weightKg + 3))} kg`] : [T('coach.sug.fourPerWeek'), T('coach.sug.hundredKg')] }
      }
      const isMetricOnly = Boolean(metric) && !intent.goalType
      // A change of primary goal updates the same goal in place (one primary, one id), never a second entity.
      const goalObj: Goal = {
        id: existingPrimary ? existingPrimary.id : uid('goal'),
        type,
        rank: 'primary',
        label: goalLabel(type, 'en'),
        metric,
        targetValue: intent.target,
        targetUnit: metric === 'workouts_per_week' ? '/week' : metric === 'steps_per_day' ? 'steps' : metric ? 'kg' : undefined,
        startValue: metric === 'body_weight' ? ctx.user.weightKg : undefined,
        createdAt: existingPrimary && isMetricOnly ? existingPrimary.createdAt : new Date().toISOString(),
      }
      const unit = goalObj.targetUnit === 'kg' ? T('coach.goal.unitKg') : goalObj.targetUnit === '/week' ? T('coach.goal.unitWeek') : goalObj.targetUnit ? ' ' + goalObj.targetUnit : ''
      const summary = metric && intent.target ? T('coach.goal.withTarget', { goal: gl(type), target: tr.num(intent.target, 1), unit }) : gl(type)
      return {
        text: voice.compose({ core: T('coach.goal.updated', { summary }), reason: type !== existingPrimary?.type && ctx.activeProgram ? T('coach.goal.programMismatch', { goal: gl(existingPrimary?.type ?? type).toLowerCase() }) : undefined, push: T('coach.goal.push'), calm: T('coach.goal.calm') }),
        cards: [{ id: uid('card'), type: 'goal', refId: goalObj.id, title: gl(type), subtitle: intent.target ? T('coach.goal.cardTarget', { target: tr.num(intent.target, 1), unit: goalObj.targetUnit === 'kg' ? ' kg' : goalObj.targetUnit ?? '' }) : T('coach.goal.cardPrimary') }],
        actions: [{ type: 'set_goal', goal: goalObj }, { type: 'remember', item: { category: 'goal', text: T('coach.goal.memory', { summary }), source: 'conversation' } }],
        suggestions: ctx.activeProgram && type !== existingPrimary?.type ? [T('coach.sug.rebuildProgram'), T('coach.sug.buildToday')] : [T('coach.sug.buildToday'), T('coach.sug.analyzeProgress')],
        contextPatch: { lastGoalId: goalObj.id, topic: 'goal' },
        thinkMs: 600,
      }
    }

    case 'log_weight': {
      const prev = weightTrend(ctx.measurements)
      const diff = prev.current ? round(intent.kg - prev.current, 1) : 0
      return {
        text: voice.compose({ core: T('coach.weight.logged', { kg: tr.num(intent.kg), diff: prev.current ? T('coach.weight.diff', { diff: tr.signed(diff) }) : '' }), reason: T('coach.weight.reason'), calm: T('coach.weight.calm'), quip: T('coach.weight.quip') }),
        actions: [{ type: 'log_measurement', measurement: { type: 'body_weight', value: intent.kg, unit: 'kg', date: today, source: 'user' } }],
        suggestions: [T('coach.sug.analyzeProgress'), T('coach.sug.whatEat')],
        thinkMs: 500,
      }
    }

    case 'pain': {
      if (intent.severe) {
        return {
          text: voice.compose({
            core: T('coach.pain.severe', { what: intent.area ? T('coach.pain.severeArea', { area: intent.area }) : T('coach.pain.severeWhat') }),
            reason: T('coach.pain.severeReason'),
            calm: T('coach.pain.severeCalm'),
            push: T('coach.pain.severePush'),
          }),
          actions: [{ type: 'remember', item: { category: 'health', text: T('coach.pain.severeMemory', { area: intent.area ? intent.area + ' ' : '', date: shortDate(ctx.now) }), source: 'conversation' } }],
          suggestions: [T('coach.sug.skipToday'), T('coach.sug.gentleMobility')],
        }
      }
      if (!intent.area) return { text: voice.compose({ core: T('coach.pain.where'), soft: T('coach.pain.whereSoft') }), expects: 'pain_location', suggestions: [T('coach.sug.lowerBackDull'), T('coach.sug.kneeSharp'), T('coach.sug.shoulderAchy')] }
      const w = ctx.todayWorkout
      const actions: CoachAction[] = [{ type: 'remember', item: { category: 'health', text: T('coach.pain.mildMemory', { area: capitalize(intent.area), date: shortDate(ctx.now) }), source: 'conversation' } }]
      let cards: CoachCard[] | undefined
      let core = T('coach.pain.mild', { area: intent.area })
      if (w && w.status === 'planned') {
        const affected = w.exercises.filter((e) => exerciseTouches(e.exerciseId, intent.area!))
        let modified = w
        for (const e of affected) modified = replaceExercise(modified, e.exerciseId, ctx.user, ctx.workouts).workout
        if (affected.length) {
          modified = scaleIntensity(modified, 'lighter')
          actions.push({ type: 'update_workout', workout: modified })
          cards = [workoutCard(modified, s)]
          core += T('coach.pain.swapped', { exercises: tr.list(affected.map(exName)) })
        }
      }
      return {
        text: voice.compose({ core, reason: T('coach.pain.reason'), calm: T('coach.pain.calm'), push: T('coach.pain.push') }),
        cards,
        actions,
        suggestions: [T('coach.sug.startAdjusted'), T('coach.sug.skipToday'), T('coach.sug.gentleMobilityInstead')],
      }
    }

    case 'rename_coach': {
      if (!intent.name) return { text: voice.compose({ core: T('coach.rename.ask') }), expects: 'coach_name', suggestions: ['Alex', 'Sam', 'Nova'] }
      return {
        text: voice.compose({ core: T('coach.rename.done', { name: intent.name }), quip: T('coach.rename.quip') }),
        actions: [{ type: 'update_coach', patch: { name: intent.name } }],
        suggestions: [T('coach.sug.buildToday'), T('coach.sug.moreDirect')],
        thinkMs: 400,
      }
    }

    case 'personality': {
      const p = intent.patch
      const desc: string[] = []
      if (p.tone !== undefined) desc.push(p.tone > 50 ? T('coach.personality.moreDirect') : T('coach.personality.gentler'))
      if (p.motivation !== undefined) desc.push(p.motivation > 50 ? T('coach.personality.moreIntense') : T('coach.personality.calmer'))
      if (p.humor !== undefined) desc.push(p.humor > 50 ? T('coach.personality.morePlayful') : T('coach.personality.moreSerious'))
      if (p.communication !== undefined) desc.push(p.communication > 50 ? T('coach.personality.moreDetailed') : T('coach.personality.moreConcise'))
      const merged = { ...ctx.coach.personality, ...p }
      const newVoice = buildVoice(merged, lang)
      return {
        text: newVoice.compose({ core: T('coach.personality.done', { desc: tr.list(desc) }), reason: T('coach.personality.reason'), push: T('coach.personality.push'), calm: T('coach.personality.calm'), quip: T('coach.personality.quip') }),
        actions: [{ type: 'update_coach', patch: { personality: merged } }],
        suggestions: [T('coach.sug.buildToday'), T('coach.sug.whatToday')],
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
          const inner = parseIntent(transcript, { topic: ctx.conversation.context.topic, hasWorkout: Boolean(workout), language: lang })
          if (inner.kind !== 'unknown' && inner.kind !== 'attachment') {
            const r = respond(inner, { ...req, text: transcript, attachments: [] }, ctx, voice)
            return { ...r, text: T('coach.attach.heard', { transcript, reply: r.text }) }
          }
        }
        return {
          text: voice.compose({ core: T('coach.attach.voice', { duration: a.durationSec ? ` (${Math.round(a.durationSec)}s)` : '' }), soft: T('coach.attach.voiceSoft') }),
          cards,
          suggestions: [T('coach.sug.aboutWorkout'), T('coach.sug.aboutFood'), T('coach.sug.neverMind')],
          expects: 'attachment_kind',
        }
      }
      if (kinds.has('image')) {
        const lowered = normalizeForMatching(userText)
        const foodish = /meal|food|ate|eat|plate|lunch|dinner|breakfast|snack|calories|protein|menu|restaurant|repas|mange|assiette|dejeuner|diner|petit-dej|collation|proteine|bouffe|nourriture/.test(lowered)
        // Context resolution: a photo sent while we are talking about a restaurant is a menu.
        const restaurantTalk = ctx.history.slice(-6).some((m) => /restaurant|menu|eating out|order|commande|resto/i.test(m.text))
        const fa = req.foodAnalysis
        if (!lowered && restaurantTalk && !(fa && fa.items.length)) return respond({ kind: 'menu_help' }, req, ctx, voice)
        // A real vision model recognised food (or a menu) in the photo.
        if (fa && fa.analysis === 'vision' && fa.items.length) return foodDraftReply(fa, req, ctx, s, parseSlot(lowered))
        if (fa && fa.analysis === 'vision' && /menu/.test(fa.name.toLowerCase())) return respond({ kind: 'menu_help' }, req, ctx, voice)
        // Local engine: the text may describe the plate well enough to estimate now.
        if (fa && fa.items.length) return foodDraftReply(fa, req, ctx, s, parseSlot(lowered))
        if (/menu/.test(lowered)) return respond({ kind: 'menu_help' }, req, ctx, voice)
        if (foodish) return respond({ kind: 'attachment_context', what: 'meal' }, req, ctx, voice)
        if (/gym|equipment|salle|materiel|equipement/.test(lowered)) return respond({ kind: 'attachment_context', what: 'equipment' }, req, ctx, voice)
        if (/progress|physique|body|progres|corps/.test(lowered)) return respond({ kind: 'attachment_context', what: 'progress_photo' }, req, ctx, voice)
        if (/plan|program|routine|programme/.test(lowered)) return respond({ kind: 'attachment_context', what: 'plan' }, req, ctx, voice)
        return {
          text: voice.compose({ core: att.length > 1 ? T('coach.attach.images') : T('coach.attach.image'), reason: T('coach.attach.imageReason'), soft: T('coach.attach.imageSoft') }),
          cards,
          suggestions: [T('coach.sug.itsMeal'), T('coach.sug.itsEquipment'), T('coach.sug.itsProgressPhoto'), T('coach.sug.itsPlan')],
          expects: 'attachment_kind',
          contextPatch: { topic: 'general' },
        }
      }
      // PDF / document
      const a = att.find((x) => x.kind === 'pdf' || x.kind === 'document')!
      const excerpt = a.transcript?.slice(0, 400)
      if (excerpt) {
        const ex = foldText(excerpt.toLowerCase())
        const looksPlan = /week|sets?|reps?|squat|bench|day \d|semaine|series?|developpe|jour \d/.test(ex)
        const looksDiet = /kcal|calories|protein|carb|meal|proteine|glucide|repas/.test(ex)
        const looksLabs = /cholesterol|glucose|hemoglobin|haemoglobin|ferritin|vitamin|mg\/dl|mmol|hemoglobine|ferritine|vitamine/.test(ex)
        const what = looksLabs ? 'bloodwork' : looksPlan ? 'plan' : looksDiet ? 'meal' : 'other'
        if (what !== 'other') return respond({ kind: 'attachment_context', what }, req, ctx, voice)
      }
      return {
        text: voice.compose({ core: T('coach.attach.doc', { name: a.name }), reason: T('coach.attach.docReason'), soft: T('coach.attach.docSoft') }),
        cards,
        suggestions: [T('coach.sug.itsPlan'), T('coach.sug.itsBloodwork'), T('coach.sug.itsDietPlan'), T('coach.sug.somethingElse')],
        expects: 'attachment_kind',
      }
    }

    case 'attachment_context': {
      const remember = (text: string, category: MemoryItem['category']): CoachAction => ({ type: 'remember', item: { category, text, source: 'conversation' } })
      switch (intent.what) {
        case 'meal': {
          return {
            text: voice.compose({
              core: ctx.foodVision ? T('coach.attach.mealVision') : T('coach.attach.mealNoVision'),
              reason: T('coach.attach.mealReason'),
              quip: T('coach.attach.mealQuip'),
            }),
            suggestions: [T('coach.sug.chickenRiceVeg'), T('coach.sug.pastaSalmon'), T('coach.sug.bigSalad')],
            expects: 'meal_description',
            contextPatch: { topic: 'nutrition' },
          }
        }
        case 'equipment': {
          return {
            text: voice.compose({ core: T('coach.attach.equipment'), soft: T('coach.attach.equipmentSoft') }),
            suggestions: [T('coach.sug.dumbbellsBench'), T('coach.sug.fullGym'), T('coach.sug.bandsBodyweight')],
            expects: 'equipment_list',
            actions: [remember(T('coach.attach.equipmentMemory', { date: shortDate(ctx.now) }), 'equipment')],
            contextPatch: { topic: 'workout' },
          }
        }
        case 'plan': {
          return {
            text: voice.compose({ core: T('coach.attach.plan'), reason: T('coach.attach.planReason') }),
            actions: [remember(T('coach.attach.planMemory', { date: shortDate(ctx.now) }), 'history')],
            suggestions: [T('coach.sug.blendGoals'), T('coach.sug.referenceOnly'), T('coach.sug.followAsIs')],
            expects: 'plan_choice',
            contextPatch: { topic: 'program' },
          }
        }
        case 'progress_photo': {
          return {
            text: voice.compose({ core: T('coach.attach.progress'), reason: T('coach.attach.progressReason'), calm: T('coach.attach.progressCalm'), push: T('coach.attach.progressPush') }),
            actions: [remember(T('coach.attach.progressMemory', { date: shortDate(ctx.now) }), 'history')],
            suggestions: [T('coach.sug.analyzeProgress'), T('coach.sug.logWeight')],
            contextPatch: { topic: 'progress' },
          }
        }
        case 'bloodwork': {
          return {
            text: voice.compose({ core: T('coach.attach.bloodwork'), soft: T('coach.attach.bloodworkSoft') }),
            actions: [remember(T('coach.attach.bloodworkMemory', { date: shortDate(ctx.now) }), 'health')],
            suggestions: [T('coach.sug.lowVitaminD'), T('coach.sug.lowIron'), T('coach.sug.allNormal')],
            expects: 'bloodwork_flag',
          }
        }
        default:
          return { text: voice.compose({ core: T('coach.attach.other') }), suggestions: [T('coach.sug.buildToday')] }
      }
    }

    case 'show_calendar': {
      const start = ctx.now
      const week = Array.from({ length: 7 }, (_, i) => dayKey(addDays(start, i)))
      const evs = ctx.events.filter((e) => week.includes(e.date) && e.type === 'workout' && e.status !== 'skipped').sort((a, b) => a.date.localeCompare(b.date))
      const evTitle = (e: { title: string; workoutId?: string }) => (e.workoutId && ctx.workouts.find((w) => w.id === e.workoutId) ? wt(ctx.workouts.find((w) => w.id === e.workoutId)!) : e.title)
      if (!evs.length) return { text: voice.compose({ core: T('coach.calendar.empty') }), suggestions: [T('coach.sug.planWeek'), T('coach.sug.create12')], contextPatch: { topic: 'calendar' } }
      return {
        text: voice.compose({ core: T('coach.calendar.core', { list: evs.map((e) => `${day(fromDayKey(e.date), true)} ${evTitle(e)}`).join(' · ') }), reason: T('coach.calendar.reason') }),
        cards: [{ id: uid('card'), type: 'calendar', title: T('coach.calendar.cardTitle'), subtitle: tr.tn('common.sessions', evs.length), data: { days: evs.map((e) => ({ date: e.date, title: evTitle(e) })) } }],
        suggestions: [T('coach.sug.moveMonWed'), T('coach.sug.planWeek')],
        contextPatch: { topic: 'calendar' },
        thinkMs: 500,
      }
    }

    case 'log_weight_prompt':
      return { text: voice.compose({ core: T('coach.weight.ask'), soft: T('coach.weight.askSoft') }), expects: 'weight_value', suggestions: [`${tr.num(round(ctx.user.weightKg - 0.3, 1))} kg`, `${tr.num(ctx.user.weightKg)} kg`, `${tr.num(round(ctx.user.weightKg + 0.3, 1))} kg`], thinkMs: 300 }

    case 'order_advice': {
      const wantsLoss = goal === 'lose_fat'
      return {
        text: voice.compose({
          core: T('coach.order.core', { tail: wantsLoss ? T('coach.order.loss') : T('coach.order.gain') }),
          reason: T('coach.order.reason'),
          quip: T('coach.order.quip'),
        }),
        suggestions: [T('coach.sug.planTomorrowMeals'), T('coach.sug.whatTomorrow')],
        contextPatch: { topic: 'nutrition' },
        thinkMs: 500,
      }
    }

    case 'meal_description': {
      const analysis = analyzeDescription(intent.text, lang)
      if (analysis.needsDescription) {
        return { text: voice.compose({ core: analysis.notes[0] ?? T('coach.food.describe'), soft: T('coach.food.describeSoft') }), suggestions: [T('coach.sug.chickenRiceVeg'), T('coach.sug.eggsToast'), T('coach.sug.salmonPotatoes')], expects: 'meal_description', contextPatch: { topic: 'nutrition' } }
      }
      return foodDraftReply(analysis, req, ctx, s, parseSlot(intent.text))
    }

    case 'bloodwork_flag': {
      const t = normalizeForMatching(intent.text)
      const normal = /normal|fine|all good|nothing|tout va bien|rien|ras\b|bon/.test(t)
      const advice = /vitamin d|vitamine d/.test(t)
        ? T('coach.blood.vitaminD')
        : /iron|ferritin|\bfer\b|ferritine/.test(t)
          ? T('coach.blood.iron')
          : /cholesterol|lipid/.test(t)
            ? T('coach.blood.lipids')
            : normal
              ? T('coach.blood.normal')
              : T('coach.blood.other')
      return {
        text: voice.compose({ core: advice, soft: T('coach.blood.soft') }),
        actions: normal ? [] : [{ type: 'remember', item: { category: 'health', text: T('coach.blood.memory', { text: intent.text }), source: 'conversation' } }],
        suggestions: [T('coach.sug.whatEatToday'), T('coach.sug.buildToday')],
      }
    }

    case 'equipment_list': {
      const merged = [...new Set([...intent.equipment, 'bodyweight' as const])]
      const list = intent.equipment.map((e) => equipmentLabel(e, lang).toLowerCase()).join(', ')
      return {
        text: voice.compose({ core: T('coach.equipment.saved', { list }), push: T('coach.equipment.push'), calm: T('coach.equipment.calm') }),
        actions: [{ type: 'update_user', patch: { equipment: merged } }, { type: 'remember', item: { category: 'equipment', text: T('coach.equipment.memory', { list }), source: 'conversation' } }],
        suggestions: [T('coach.sug.buildToday'), T('coach.sug.planWeek')],
        contextPatch: { topic: 'workout' },
      }
    }

    case 'plan_choice': {
      if (intent.choice === 'reference') return { text: voice.compose({ core: T('coach.program.referenceOnly') }), suggestions: [T('coach.sug.buildToday')] }
      const program = generateProgram({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, weeks: 8, name: intent.choice === 'follow' ? programUploadedName(8) : undefined })
      const { workouts, events } = materializeProgram(program, ctx.user, ctx.goals, ctx.workouts)
      return {
        text: voice.compose({ core: T('coach.program.scheduledCore', { lead: intent.choice === 'follow' ? T('coach.program.scheduledFollow') : T('coach.program.scheduledBlend'), days: program.daysPerWeek, date: shortDate(fromDayKey(program.startDate)) }), reason: T('coach.program.scheduledReason') }),
        cards: [programCard(program, s)],
        actions: [{ type: 'create_program', program, workouts, events, replaceProgramId: ctx.activeProgram?.id }],
        suggestions: [T('coach.sug.showWeek1'), T('coach.sug.showCalendar')],
        contextPatch: { lastProgramId: program.id, topic: 'program' },
        status: T('coach.status.buildingProgram'),
        thinkMs: 1800,
      }
    }

    case 'food_log': {
      const analysis = req.foodAnalysis && req.foodAnalysis.items.length ? req.foodAnalysis : analyzeDescription(intent.text, lang)
      if (analysis.needsDescription || !analysis.items.length) {
        return {
          text: voice.compose({ core: analysis.notes[0] ?? T('coach.food.describeMore'), soft: T('coach.food.describeMoreSoft') }),
          suggestions: [T('coach.sug.chickenRiceVeg'), T('coach.sug.eggsToast'), T('coach.sug.salmonPotatoes')],
          expects: 'meal_description',
          contextPatch: { topic: 'nutrition' },
        }
      }
      const image = imageFromRequest(req, ctx)
      if (image) return foodDraftReply(analysis, req, ctx, s, intent.slot)
      // Plain text: log it straight away (easily corrected or removed).
      const slot = intent.slot ?? slotForTime(ctx.now)
      const meal = buildMeal(analysis, { date: today, slot, source: 'text', status: 'logged' })
      return {
        text: voice.compose({
          core: T('coach.food.logged', { slot: slotA(slot), meal: mealDisplayName(meal, lang), kcal: meal.calories, protein: meal.proteinG, carbs: meal.carbsG, fat: meal.fatG, intake: intakeLine(ctx, s, meal) }),
          reason: analysis.notes[0],
          extra: T('coach.food.loggedExtra'),
          calm: T('coach.food.loggedCalm'),
          push: T('coach.food.loggedPush'),
          quip: T('coach.food.loggedQuip'),
        }),
        cards: [foodCard(meal, s)],
        actions: [{ type: 'log_meal', meal }],
        suggestions: [T('coach.sug.whatEatTonight'), T('coach.sug.proteinLeft'), T('coach.sug.ateHalf')],
        contextPatch: { lastMealId: meal.id, topic: 'nutrition' },
        status: T('coach.status.estimatingMeal'),
        thinkMs: 900,
      }
    }

    case 'meal_correction': {
      const meal = ctx.contextMeal
      if (!meal) return { text: voice.compose({ core: T('coach.food.whichMeal') }), suggestions: [T('coach.sug.eatenToday'), T('coach.sug.logMeal')] }
      let current = meal
      const applied: string[] = []
      const failed: string[] = []
      for (const c of intent.corrections) {
        const r = applyCorrection(current, c, lang)
        if (r.applied) {
          current = r.meal
          applied.push(r.summary)
        } else failed.push(r.summary)
      }
      if (!applied.length) {
        return {
          text: voice.compose({ core: T('coach.food.mealHas', { failed: failed[0] ?? T('coach.food.couldNotApply'), items: current.items.map((i) => foodItemName(i, lang).toLowerCase()).join(', ') }), soft: T('coach.food.hmm') }),
          cards: [foodCard(current, s)],
          suggestions: current.items.slice(0, 3).map((i) => T('coach.sug.removeFood', { food: foodItemName(i, lang).toLowerCase() })),
          contextPatch: { lastMealId: current.id, topic: 'nutrition' },
        }
      }
      const isDraft = current.status === 'draft'
      return {
        text: voice.compose({
          core: T('coach.food.corrected', { applied: applied.join(' '), kcal: current.calories, protein: current.proteinG, failed: failed.length ? ` ${failed.join(' ')}` : '', intake: isDraft ? '' : ` ${intakeLine(ctx, s, current, meal)}` }),
          extra: isDraft ? T('coach.food.correctedExtra', { slot: slotTo(current.slot) }) : undefined,
          calm: T('coach.food.correctedCalm'),
          push: T('coach.food.correctedPush'),
        }),
        cards: [foodCard(current, s)],
        actions: [{ type: 'update_meal', meal: current }],
        suggestions: isDraft ? [T('coach.sug.addItTo', { slot: slotTo(current.slot) }), T('coach.sug.ateHalf'), T('coach.sug.thisWasDinner')] : [T('coach.sug.whatEatTonight'), T('coach.sug.proteinLeft')],
        contextPatch: { lastMealId: current.id, topic: 'nutrition' },
        thinkMs: 600,
      }
    }

    case 'meal_commit': {
      const meal = ctx.contextMeal
      if (!meal) return { text: voice.compose({ core: T('coach.food.nothingWaiting') }), suggestions: [T('coach.sug.ateChickenRiceVeg'), T('coach.sug.eatenToday')] }
      const slot = intent.slot ?? meal.slot
      if (meal.status === 'logged' && slot === meal.slot) {
        return { text: voice.compose({ core: T('coach.food.alreadyIn', { slot: slotA(slot), intake: intakeLine(ctx, s) }) }), cards: [foodCard(meal, s)], suggestions: [T('coach.sug.whatEatTonight'), T('coach.sug.removeThatMeal')], contextPatch: { lastMealId: meal.id, topic: 'nutrition' } }
      }
      const logged: LoggedMeal = { ...meal, slot, status: 'logged', updatedAt: new Date().toISOString() }
      return {
        text: voice.compose({
          core: T('coach.food.added', { slot: slotTo(slot), meal: mealDisplayName(logged, lang), kcal: logged.calories, protein: logged.proteinG, intake: intakeLine(ctx, s, logged, meal.status === 'logged' ? meal : undefined) }),
          calm: T('coach.food.addedCalm'),
          push: T('coach.food.addedPush'),
        }),
        cards: [foodCard(logged, s)],
        actions: [{ type: 'update_meal', meal: logged }],
        suggestions: [T('coach.sug.whatEatTonight'), T('coach.sug.proteinLeft'), T('coach.sug.eatenToday')],
        contextPatch: { lastMealId: logged.id, topic: 'nutrition' },
        thinkMs: 500,
      }
    }

    case 'meal_discard': {
      const meal = ctx.contextMeal
      if (!meal) return { text: voice.compose({ core: T('coach.food.nothingToRemove') }), suggestions: [T('coach.sug.eatenToday')] }
      return {
        text: voice.compose({ core: meal.status === 'logged' ? T('coach.food.removed', { meal: lang === 'en' ? mealDisplayName(meal, lang).toLowerCase() : mealDisplayName(meal, lang), slot: slotA(meal.slot) }) : T('coach.food.discarded'), calm: T('coach.food.removedCalm'), push: T('coach.food.removedPush') }),
        actions: [{ type: 'delete_meal', mealId: meal.id }],
        suggestions: [T('coach.sug.eatenToday'), T('coach.sug.logMeal')],
        contextPatch: { lastMealId: undefined, topic: 'nutrition' },
        thinkMs: 400,
      }
    }

    case 'eaten_today': {
      const n = ctx.nutrition
      if (!n.meals.length) return { text: voice.compose({ core: T('coach.food.nothingLogged'), soft: T('coach.food.cleanSlate') }), suggestions: [T('coach.sug.ateEggsToast'), T('coach.sug.whatEat')], contextPatch: { topic: 'nutrition' } }
      const lines = n.meals.map((m) => T('coach.food.mealLine', { slot: slotA(m.slot), meal: mealDisplayName(m, lang), kcal: m.calories, protein: m.proteinG })).join('\n')
      return {
        text: voice.compose({ core: T('coach.food.soFar', { lines, kcal: tr.int(n.consumed.calories), protein: n.consumed.proteinG, carbs: n.consumed.carbsG, fat: n.consumed.fatG, intake: intakeLine(ctx, s) }), quip: T('coach.food.soFarQuip') }),
        cards: n.meals.slice(-1).map((m) => foodCard(m, s)),
        suggestions: [T('coach.sug.whatEatTonight'), T('coach.sug.proteinLeft'), T('coach.sug.logMeal')],
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
          ? T('coach.remaining.protein', { left: Math.max(0, r.proteinG), target: n.targets.proteinG, there: r.proteinG <= 0 ? T('coach.remaining.there') : '' })
          : m === 'calories'
            ? T('coach.remaining.calories', { left: tr.int(Math.max(0, r.calories)), target: tr.int(n.targets.calories), over: r.calories < 0 ? T('coach.remaining.over', { n: tr.int(Math.abs(r.calories)) }) : '' })
            : m === 'carbs'
              ? T('coach.remaining.carbs', { left: Math.max(0, r.carbsG), target: n.targets.carbsG })
              : m === 'fat'
                ? T('coach.remaining.fat', { left: Math.max(0, r.fatG), target: n.targets.fatG })
                : T('coach.remaining.all', { kcal: tr.int(Math.max(0, r.calories)), protein: Math.max(0, r.proteinG), carbs: Math.max(0, r.carbsG), fat: Math.max(0, r.fatG), meals: tr.tn('common.meals', n.meals.length) })
      const advice = r.proteinG > 40 ? T('coach.remaining.adviceHigh') : r.proteinG <= 10 ? T('coach.remaining.adviceDone') : T('coach.remaining.adviceOne')
      return {
        text: voice.compose({ core, reason: n.meals.length ? advice : T('coach.remaining.nothingLogged'), calm: T('coach.remaining.calm'), push: T('coach.remaining.push') }),
        suggestions: [T('coach.sug.whatEatTonight'), T('coach.sug.eatenToday'), T('coach.sug.logMeal')],
        contextPatch: { topic: 'nutrition' },
        thinkMs: 400,
      }
    }

    case 'menu_help': {
      const n = ctx.nutrition
      if (!intent.options?.length) {
        return {
          text: voice.compose({
            core: ctx.foodVision ? T('coach.menu.askVision') : T('coach.menu.askNoVision'),
            reason: T('coach.menu.askReason', { kcal: tr.int(Math.max(0, n.remaining.calories)), protein: Math.max(0, n.remaining.proteinG) }),
            soft: T('coach.menu.askSoft'),
          }),
          suggestions: [T('coach.sug.menuA'), T('coach.sug.menuB')],
          expects: 'menu_options',
          contextPatch: { topic: 'nutrition' },
        }
      }
      const ranked = intent.options
        .map((o) => {
          const a = analyzeDescription(o, lang)
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
          core: T('coach.menu.pick', { name: best.name, kcal: best.t.calories, protein: best.t.proteinG, others: others.length ? T('coach.menu.versus', { list: tr.list(others.map((o) => T('coach.menu.option', { name: o.name, kcal: o.t.calories, protein: o.t.proteinG }))) }) : '', leftKcal: tr.int(Math.max(0, n.remaining.calories)), leftProtein: Math.max(0, n.remaining.proteinG) }),
          reason: goal === 'lose_fat' ? T('coach.menu.reasonLoss') : goal === 'build_muscle' ? T('coach.menu.reasonMuscle') : T('coach.menu.reasonBalanced'),
          extra: T('coach.menu.extra'),
          quip: T('coach.menu.quip'),
        }),
        suggestions: [T('coach.sug.ateThe', { name: best.name }), T('coach.sug.eatenToday')],
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
      const names = days.map((d) => tr.weekday(d, true)).join(', ')
      if (intent.scope === 'always') {
        return {
          text: voice.compose({ core: T('coach.avail.always', { names, days: tr.tn('common.days', days.length) }), reason: ctx.activeProgram ? T('coach.avail.alwaysProgram', { name: programDisplayName(ctx.activeProgram, lang), days: ctx.activeProgram.daysPerWeek }) : T('coach.avail.alwaysReason'), calm: T('coach.avail.alwaysCalm'), push: T('coach.avail.alwaysPush') }),
          actions: [
            { type: 'update_availability', patch: { preferredDays: days, daysPerWeek: days.length } },
            { type: 'remember', item: { category: 'availability', text: T('coach.avail.memory', { days: tr.tn('common.days', days.length), names }), source: 'conversation' } },
          ],
          suggestions: [T('coach.sug.planWeek'), ctx.activeProgram ? T('coach.sug.rebuildProgram') : T('coach.sug.create12')],
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
      const numWord = (n: number) => T(`coach.numWord.${clamp(n, 0, 6)}` as 'coach.numWord.0')
      return {
        text: voice.compose({ core: T('coach.avail.week', { lead: crossesWeek ? T('coach.avail.nextSeven') : T('coach.avail.thisWeek'), list: week.map((e) => `${day(fromDayKey(e.date), true)} ${wt(e.workout)}`).join(' · '), sessions: tr.tn('common.sessions', week.length), removed: dropped.length ? T('coach.avail.removed', { sessions: tr.tn('common.sessions', dropped.length) }) : '' }), reason: T('coach.avail.weekReason'), calm: T('coach.avail.weekCalm'), push: T('coach.avail.weekPush') }),
        cards: [{ id: uid('card'), type: 'calendar', title: crossesWeek ? T('coach.avail.cardNextSeven') : T('coach.avail.thisWeek'), subtitle: T('coach.week.cardSubtitle', { sessions: tr.tn('common.sessions', week.length) }), data: { days: week.map((e) => ({ date: e.date, title: wt(e.workout) })) } }],
        actions: [...dropped.map((w) => ({ type: 'remove_workout', workoutId: w.id }) as CoachAction), ...week.map((e) => ({ type: 'create_workout', workout: e.workout }) as CoachAction)],
        suggestions: [week.length > 2 ? T('coach.sug.actuallyMakeIt', { n: numWord(week.length - 1) }) : T('coach.sug.makeIt', { n: numWord(week.length + 1) }), T('coach.sug.showCalendar'), ctx.todayWorkout && ctx.todayWorkout.status === 'planned' ? T('coach.sug.startTodaySession') : T('coach.sug.whatEatToday')],
        contextPatch: { lastAvailabilityScope: 'week', topic: 'calendar' },
        status: T('coach.status.planningWeek'),
        thinkMs: 1200,
      }
    }

    case 'finished_workout': {
      const w = ctx.todayWorkout
      if (w && w.status === 'completed') return { text: voice.compose({ core: T('coach.finished.already', { title: wt(w), cheer: voice.cheer(w.id) }) }), suggestions: [T('coach.sug.whatEatNow'), T('coach.sug.howProgressing')] }
      if (w && (w.status === 'planned' || w.status === 'in_progress')) {
        const done = w.exercises.reduce((a, e) => a + e.sets.filter((x) => x.completed).length, 0)
        const total = w.exercises.reduce((a, e) => a + e.sets.length, 0)
        return {
          text: voice.compose({ core: T('coach.finished.core', { cheer: voice.cheer(w.id), title: wt(w), partial: done && done < total ? T('coach.finished.partial', { done, total }) : '' }), reason: T('coach.finished.reason'), calm: T('coach.finished.calm'), push: T('coach.finished.push') }),
          cards: [workoutCard({ ...w, status: 'completed' }, s)],
          actions: [{ type: 'complete_workout', workoutId: w.id }],
          suggestions: [T('coach.sug.whatEatNow'), T('coach.sug.howProgressing'), T('coach.sug.planTomorrow')],
          contextPatch: { lastWorkoutId: w.id, topic: 'workout' },
          thinkMs: 700,
        }
      }
      // Nothing planned: log an ad-hoc session from the description.
      const txt = normalizeForMatching(intent.text)
      const focus = /upper|push|pull|chest|arms|back|haut du corps|pecs|bras|\bdos\b|pousse|tire/.test(txt) ? 'upper' : /lower|legs?|squat|bas du corps|jambes|cuisses/.test(txt) ? 'lower' : /run|cardio|bike|row|swim|hiit|cour(u|se|ir)|velo|rameur|nage|natation/.test(txt) ? 'conditioning' : 'full_body'
      const minutes = parseMinutesLoose(intent.text) ?? 45
      const gen = titledWorkout(generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, constraints: { focus, minutes }, seed: `${today}-adhoc-${intent.text.length}` }), { focus, logged: true })
      gen.startedAt = new Date(Date.now() - minutes * 60_000).toISOString()
      return {
        text: voice.compose({ core: T('coach.finished.adhoc', { minutes, focus: focusLabel(focus, lang).toLowerCase() }), reason: T('coach.finished.adhocReason'), calm: T('coach.finished.adhocCalm'), push: T('coach.finished.adhocPush') }),
        actions: [{ type: 'create_workout', workout: gen }, { type: 'complete_workout', workoutId: gen.id }],
        suggestions: [T('coach.sug.whatEatNow'), T('coach.sug.howProgressing')],
        contextPatch: { lastWorkoutId: gen.id, topic: 'workout' },
        thinkMs: 700,
      }
    }

    case 'goal_delta': {
      const target = round(ctx.user.weightKg + (intent.direction === 'gain' ? intent.kg : -intent.kg), 1)
      const type = intent.direction === 'gain' ? 'build_muscle' : 'lose_fat'
      const r = respond({ kind: 'set_goal', goalType: type, metric: 'body_weight', target }, req, ctx, voice)
      const targets = computeTargets(ctx.user, [{ id: 'tmp', type, rank: 'primary', label: goalLabel(type, 'en'), createdAt: '' }], Boolean(ctx.todayWorkout))
      return {
        ...r,
        text: voice.compose({
          core: T('coach.delta.core', { verb: intent.direction === 'gain' ? T('coach.delta.gain') : T('coach.delta.lose'), kg: tr.num(intent.kg), goal: gl(type).toLowerCase(), target: tr.num(target), from: tr.num(ctx.user.weightKg), kcal: tr.int(targets.calories), protein: targets.proteinG }),
          reason: intent.direction === 'gain' ? T('coach.delta.reasonGain', { weeks: Math.ceil(intent.kg / 0.4) }) : T('coach.delta.reasonLoss', { weeks: Math.ceil(intent.kg / 0.5) }),
          extra: ctx.activeProgram ? T('coach.delta.extra', { name: programDisplayName(ctx.activeProgram, lang) }) : undefined,
          push: T('coach.goal.push'),
          calm: T('coach.delta.calm'),
        }),
        suggestions: [T('coach.sug.howAffectPlan'), T('coach.sug.whatEatToday'), ctx.activeProgram ? T('coach.sug.rebuildProgram') : T('coach.sug.buildToday')],
      }
    }

    case 'dislike_exercise': {
      const key = normalizeForMatching(intent.text).replace(/^(doing|the|les|des|le|la|faire des|faire les)\s+/, '').replace(/s$/, '')
      const existing = ctx.user.dislikedExercises ?? []
      const list = existing.includes(key) ? existing : [...existing, key]
      const actions: CoachAction[] = [
        { type: 'update_user', patch: { dislikedExercises: list } },
        { type: 'remember', item: { category: 'preference', text: T('coach.dislike.memory', { text: intent.text.toLowerCase() }), source: 'conversation' } },
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
          cards = [workoutCard(modified, s)]
          swapped = T('coach.dislike.swapped', { exercises: tr.list(affected.map((e) => exName(e).toLowerCase())) })
        }
      }
      return {
        text: voice.compose({ core: T('coach.dislike.core', { text: intent.text.toLowerCase(), swapped }), reason: T('coach.dislike.reason'), quip: T('coach.dislike.quip') }),
        cards,
        actions,
        suggestions: [T('coach.sug.buildToday'), T('coach.sug.whatDoYouKnow')],
        thinkMs: 500,
      }
    }

    case 'goal_impact': {
      const primary = ctx.goals.find((g) => g.rank === 'primary')
      if (!primary) return respond({ kind: 'set_goal' }, req, ctx, voice)
      const targets = computeTargets(ctx.user, ctx.goals, Boolean(ctx.todayWorkout && ctx.todayWorkout.status !== 'skipped'))
      const style =
        primary.type === 'strength'
          ? T('coach.impact.styleStrength')
          : primary.type === 'lose_fat'
            ? T('coach.impact.styleLoseFat')
            : primary.type === 'conditioning' || primary.type === 'endurance'
              ? T('coach.impact.styleConditioning')
              : primary.type === 'build_muscle'
                ? T('coach.impact.styleMuscle')
                : T('coach.impact.styleBalanced')
      const lines = [
        T('coach.impact.primary', { goal: gl(primary.type).toLowerCase(), target: primary.targetValue ? T('coach.impact.target', { value: tr.num(primary.targetValue, 1), unit: primary.targetUnit ?? '' }).replace(/\s+\)/, ')') : '' }),
        T('coach.impact.nutrition', { kcal: tr.int(targets.calories), protein: targets.proteinG, rationale: nutritionRationale({ rationale: targets.rationale, rationaleKey: targets.rationaleKey }, lang).toLowerCase().replace(/[.!]+$/, '') }),
        T('coach.impact.training', { style }),
      ]
      if (ctx.activeProgram && ctx.activeProgram.goalType !== primary.type) lines.push(T('coach.impact.mismatch', { name: programDisplayName(ctx.activeProgram, lang), goal: gl(ctx.activeProgram.goalType).toLowerCase() }))
      else if (ctx.activeProgram) lines.push(T('coach.impact.matches', { name: programDisplayName(ctx.activeProgram, lang) }))
      return {
        text: voice.compose({ core: lines.join(' '), calm: T('coach.impact.calm'), push: T('coach.impact.push') }),
        suggestions: ctx.activeProgram && ctx.activeProgram.goalType !== primary.type ? [T('coach.sug.rebuildProgram'), T('coach.sug.whatEatToday')] : [T('coach.sug.buildToday'), T('coach.sug.whatEatToday')],
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
          text: voice.compose({ core: T('coach.tomorrow.core', { title: wt(tw), minutes: mins(tw.estimatedMinutes), exercises: tr.tn('common.exercises', tw.exercises.length), program: tw.programId ? T('coach.tomorrow.fromProgram') : '' }), reason: workoutCoachNote(tw, lang), calm: T('coach.tomorrow.calm'), push: T('coach.tomorrow.push') }),
          cards: [workoutCard(tw, s)],
          suggestions: [T('coach.sug.makeShorter'), T('coach.sug.moveAnotherDay'), T('coach.sug.whatEatTomorrow')],
          contextPatch: { lastWorkoutId: tw.id, topic: 'workout' },
        }
      }
      if (isTrainingDay) return respond({ kind: 'make_workout', constraints: { forDate: 'tomorrow' } }, req, ctx, voice)
      return {
        text: voice.compose({ core: T('coach.tomorrow.rest'), calm: T('coach.tomorrow.restCalm') }),
        suggestions: [T('coach.sug.planWorkoutTomorrow'), T('coach.sug.planWeek')],
        contextPatch: { topic: 'calendar' },
      }
    }

    case 'day_report': {
      // Temporal questions answer from the calendar and the journal, never from memory.
      const range = rangeFor(intent.frame, ctx.time)
      const days: string[] = []
      for (let d = fromDayKey(range.from); dayKey(d) <= range.to; d = addDays(d, 1)) days.push(dayKey(d))
      const summaries = days.map((k) => selectDaySummary({ workouts: Object.fromEntries(ctx.workouts.map((w) => [w.id, w])), meals: Object.fromEntries(ctx.meals.map((m) => [m.id, m])), checkIns: ctx.checkIns }, k))
      const label = labelForFrame(intent.frame, lang)
      const completed = summaries.flatMap((x) => x.completed)
      const planned = summaries.flatMap((x) => x.planned)
      const skipped = summaries.flatMap((x) => x.skipped)
      const single = days.length === 1
      const dayName = (date: string) => (single ? '' : `${day(fromDayKey(date), true)} `)
      const titleOf = (w: { id: string; title: string }) => {
        const full = ctx.workouts.find((x) => x.id === w.id)
        return full ? wt(full) : w.title
      }
      const lines: string[] = []
      if (intent.domain !== 'food') {
        if (intent.mode === 'planned') {
          const all = [...planned, ...completed, ...skipped]
          lines.push(all.length ? T('coach.report.planned', { label, list: all.map((w) => `${dayName(w.date)}${titleOf(w)}${w.status === 'completed' ? T('coach.weekday.done') : w.status === 'skipped' ? T('coach.weekday.skipped') : ''}`).join(' · ') }) : T('coach.report.nothingPlanned', { label }))
        } else if (intent.mode === 'did') {
          lines.push(completed.length ? T('coach.report.trained', { label, list: completed.map((w) => `${dayName(w.date)}${titleOf(w)}${w.volumeKg ? ` (${tr.int(w.volumeKg)} kg)` : ''}`).join(' · ') }) : T('coach.report.noCompleted', { label }))
          if (planned.length && intent.frame !== 'today') lines.push(T('coach.report.stillPlanned', { list: planned.map((w) => `${dayName(w.date)}${titleOf(w)}`).join(' · ') }))
          if (skipped.length) lines.push(T('coach.report.skipped', { list: skipped.map((w) => `${dayName(w.date)}${titleOf(w)}`).join(' · ') }))
        } else {
          lines.push(planned.length ? T('coach.report.upcoming', { label, list: planned.map((w) => `${dayName(w.date)}${titleOf(w)}`).join(' · ') }) : T('coach.report.nothingUpcoming', { label }))
        }
      }
      if (intent.domain !== 'training') {
        const foodDays = summaries.filter((x) => x.meals.length)
        if (intent.frame === 'today' || intent.frame === 'yesterday' || intent.frame === 'tomorrow') {
          const sm = summaries[0]
          if (intent.mode === 'upcoming') lines.push(T('coach.report.targets', { label, kcal: tr.int(ctx.nutrition.targets.calories), protein: ctx.nutrition.targets.proteinG }))
          else lines.push(sm.meals.length ? T('coach.report.food', { label, list: sm.meals.map((m) => `${slotA(m.slot as Meal['slot'])} ${mealDisplayName({ name: m.name, items: ctx.meals.find((x) => x.id === m.id)?.items ?? [] }, lang)}`).join(' · '), kcal: tr.int(sm.calories), protein: sm.proteinG }) : T('coach.report.noMeals', { label }))
        } else if (intent.mode !== 'upcoming') {
          const kcal = foodDays.reduce((a, x) => a + x.calories, 0)
          lines.push(foodDays.length ? T('coach.report.foodDays', { label, meals: tr.tn('common.meals', foodDays.reduce((a, x) => a + x.meals.length, 0)), days: tr.tn('common.days', foodDays.length), kcal: tr.int(kcal) }) : T('coach.report.noMealsJournal', { label }))
        }
      }
      const ci = single ? summaries[0].checkIn : undefined
      const readinessText = ci && intent.domain === 'all' && intent.mode !== 'upcoming' ? T('coach.report.checkIn', { parts: [ci.sleepHours !== undefined && T('coach.report.sleep', { n: tr.num(ci.sleepHours) }), ci.energy !== undefined && T('coach.report.energy', { n: ci.energy }), ci.fatigue !== undefined && T('coach.report.fatigue', { n: ci.fatigue })].filter(Boolean).join(', ') }) : undefined
      const refs = [...completed, ...planned].slice(0, 3).map((w) => ({ type: 'workout' as const, id: w.id, label: titleOf(w) }))
      return {
        text: voice.compose({ core: lines.join(' '), reason: readinessText, calm: T('coach.report.calm'), quip: T('coach.report.quip') }),
        cards: single && (completed[0] ?? planned[0]) ? [workoutCard(ctx.workouts.find((w) => w.id === (completed[0] ?? planned[0]).id)!, s)] : undefined,
        suggestions: intent.frame === 'today' ? [T('coach.sug.whatsOnTomorrow'), T('coach.sug.howProgressing'), T('coach.sug.eatenToday')] : [T('coach.sug.whatDidToday'), T('coach.sug.howProgressing'), T('coach.sug.planWeek')],
        references: refs,
        contextPatch: { topic: intent.domain === 'food' ? 'nutrition' : 'calendar', ...(refs[0] ? { lastWorkoutId: refs[0].id } : {}) },
        thinkMs: 500,
      }
    }

    case 'delete_workout': {
      // Resolve the reference from the words first, then from the conversation, and ask when it is ambiguous.
      const plannedAll = ctx.workouts.filter((w) => w.status === 'planned' && w.scheduledFor >= today).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
      let target: Workout | undefined
      if (intent.when === 'tomorrow') target = plannedAll.find((w) => w.scheduledFor === ctx.time.tomorrow)
      else if (intent.when === 'today') target = plannedAll.find((w) => w.scheduledFor === today)
      else if (intent.weekday !== undefined) target = plannedAll.find((w) => fromDayKey(w.scheduledFor).getDay() === intent.weekday)
      else if (ctx.contextWorkout && ctx.contextWorkout.status === 'planned') target = ctx.contextWorkout
      else if (plannedAll.length === 1) target = plannedAll[0]
      if (!target) {
        if (!plannedAll.length) return { text: voice.compose({ core: T('coach.delete.none') }), suggestions: [T('coach.sug.showCalendar'), T('coach.sug.planWeek')] }
        // Offer the coming week only, one session per weekday, with dates so “Monday” is unambiguous.
        const windowEnd = dayKey(addDays(ctx.now, 6))
        const seen = new Set<number>()
        const options = plannedAll.filter((w) => w.scheduledFor <= windowEnd && !seen.has(fromDayKey(w.scheduledFor).getDay()) && seen.add(fromDayKey(w.scheduledFor).getDay())).slice(0, 4)
        return {
          text: voice.compose({ core: T('coach.delete.which', { options: options.map((w) => `${day(fromDayKey(w.scheduledFor), true)} ${shortDate(fromDayKey(w.scheduledFor))}: ${wt(w)}`).join(' · ') }), reason: T('coach.delete.whichReason') }),
          suggestions: options.map((w) => T('coach.sug.deleteDays', { day: day(fromDayKey(w.scheduledFor)) })),
          references: options.map((w) => ({ type: 'workout' as const, id: w.id, label: wt(w) })),
          contextPatch: { topic: 'calendar' },
        }
      }
      return {
        text: voice.compose({ core: T('coach.delete.done', { title: wt(target), day: day(fromDayKey(target.scheduledFor)) }), reason: target.programId ? T('coach.delete.programKeeps') : undefined, calm: T('coach.delete.calm'), push: T('coach.delete.push') }),
        actions: [{ type: 'remove_workout', workoutId: target.id }],
        suggestions: [T('coach.sug.showCalendar'), T('coach.sug.planWeek'), T('coach.sug.buildNew')],
        contextPatch: { lastWorkoutId: undefined, topic: 'calendar' },
        thinkMs: 400,
      }
    }

    case 'energy_report': {
      const scale = clamp(11 - intent.value, 1, 10)
      return handleFatigue(scale, ctx, s)
    }

    case 'thanks':
      return { text: voice.compose({ core: voice.pick(req.text, [T('coach.thanks.0'), T('coach.thanks.1'), T('coach.thanks.2'), T('coach.thanks.3')]), push: T('coach.thanks.push'), calm: T('coach.thanks.calm'), quip: T('coach.thanks.quip') }), thinkMs: 300 }

    case 'yes': {
      const lastCoach = [...ctx.history].reverse().find((m) => m.role === 'coach')
      const lastCard = lastCoach?.cards?.[0]
      const said = normalizeForMatching(lastCoach?.text ?? '')
      if (lastCard?.type === 'workout' && lastCard.refId) return respond({ kind: 'start_workout' }, req, ctx, voice)
      if (/want me to build|want one|build something|want a structured|que je te prepare|tu en veux un|prepare quelque chose|bloc structure|que je t'en prepare/.test(said)) return respond({ kind: 'make_workout', constraints: {} }, req, ctx, voice)
      if (/rebuild it around|refais.*autour|refaire autour|reajuste/.test(said)) return respond({ kind: 'create_program', weeks: ctx.activeProgram?.weeks ?? 12 }, req, ctx, voice)
      if (/schedule one|planifie une|planifie la semaine|planifie quelque chose/.test(said)) return respond({ kind: 'plan_week' }, req, ctx, voice)
      return { text: voice.compose({ core: T('coach.yes.core') }), suggestions: [T('coach.sug.buildToday'), T('coach.sug.whatEat'), T('coach.sug.analyzeProgress')], thinkMs: 300 }
    }

    case 'no':
      return { text: voice.compose({ core: voice.pick(req.text, [T('coach.no.0'), T('coach.no.1'), T('coach.no.2')]), calm: T('coach.no.calm'), push: T('coach.no.push') }), suggestions: [T('coach.sug.whatToday'), T('coach.sug.planWeek')], thinkMs: 300 }

    case 'help':
      return {
        text: voice.compose({
          core: T('coach.help.core', { name: coachName }),
          extra: T('coach.help.extra'),
          quip: T('coach.help.quip'),
        }),
        suggestions: [T('coach.sug.buildToday'), T('coach.sug.create12'), T('coach.sug.whatEat')],
        thinkMs: 500,
      }

    default: {
      // Unknown: keep it useful.
      const w = ctx.todayWorkout
      return {
        text: voice.compose({
          core: voice.pick(req.text, [T('coach.unknown.0'), T('coach.unknown.1')]),
          soft: T('coach.unknown.soft'),
          quip: T('coach.unknown.quip'),
        }),
        suggestions: w && w.status === 'planned' ? [T('coach.sug.startMyWorkout'), T('coach.sug.makeShorter'), foodSug('coach.sug.whatEat')] : [foodSug('coach.sug.buildToday'), T('coach.sug.whatEat'), T('coach.sug.analyzeProgress')],
        thinkMs: 400,
      }
    }
  }
}

// ---------------------------------------------------------------------------

function handleFatigue(scale: number, ctx: CoachContext, s: Speech): CoachReply {
  const { tr, lang, voice } = s
  const T = tr.t
  const today = todayKey()
  const actions: CoachAction[] = [{ type: 'check_in', patch: { fatigue: scale, energy: clamp(11 - scale, 1, 10) } }]
  const checkIn = { ...(ctx.todayCheckIn ?? { date: today, createdAt: new Date().toISOString() }), fatigue: scale, energy: clamp(11 - scale, 1, 10) }
  const readiness = computeReadiness(checkIn, ctx.workouts, today, ctx.user.sleepHoursTypical)
  const w = ctx.todayWorkout
  if (scale >= 8) {
    const rest = titledWorkout(generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness, constraints: { focus: 'core_mobility', minutes: 20, intensity: 'light' }, seed: `${today}-recovery` }), { recoveryFlow: true })
    return {
      text: voice.compose({ core: T('coach.fatigue.rest', { scale }), reason: T('coach.fatigue.restReason'), soft: T('coach.fatigue.restSoft'), calm: T('coach.fatigue.restCalm'), push: T('coach.fatigue.restPush') }),
      cards: [workoutCard(rest, s)],
      actions: [...actions, { type: 'create_workout', workout: rest, replaceWorkoutId: w?.status === 'planned' ? w.id : undefined }],
      suggestions: [T('coach.sug.startFlow'), T('coach.sug.skipToday'), T('coach.sug.whatEat')],
      contextPatch: { lastWorkoutId: rest.id, topic: 'recovery' },
      status: T('coach.status.adjustingDay'),
    }
  }
  if (scale >= 5) {
    if (w && w.status === 'planned') {
      const lighter = shortenWorkout(scaleIntensity(w, 'lighter'), Math.max(25, w.estimatedMinutes - 15))
      return {
        text: voice.compose({ core: T('coach.fatigue.lighter', { scale, minutes: formatMinutes(lighter.estimatedMinutes, lang) }), reason: T('coach.fatigue.lighterReason'), soft: T('coach.fatigue.lighterSoft'), calm: T('coach.fatigue.lighterCalm'), push: T('coach.fatigue.lighterPush') }),
        cards: [workoutCard(lighter, s)],
        actions: [...actions, { type: 'update_workout', workout: lighter }],
        suggestions: [T('coach.sug.startIt'), T('coach.sug.makeEvenShorter'), T('coach.sug.skipToday')],
        contextPatch: { lastWorkoutId: lighter.id, topic: 'workout' },
        status: T('coach.status.adjustingWorkout'),
      }
    }
    const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness, constraints: { intensity: 'light', minutes: Math.min(35, ctx.user.availability.sessionMinutes) }, seed: `${today}-light` })
    return {
      text: voice.compose({ core: T('coach.fatigue.light', { scale, title: workoutTitle(gen, lang), minutes: formatMinutes(gen.estimatedMinutes, lang) }), reason: T('coach.fatigue.lightReason'), calm: T('coach.fatigue.lightCalm'), push: T('coach.fatigue.lightPush') }),
      cards: [workoutCard(gen, s)],
      actions: [...actions, { type: 'create_workout', workout: gen }],
      suggestions: [T('coach.sug.startIt'), T('coach.sug.skipToday'), T('coach.sug.whatEat')],
      contextPatch: { lastWorkoutId: gen.id, topic: 'workout' },
      status: T('coach.status.lighterSession'),
    }
  }
  return {
    text: voice.compose({ core: T('coach.fatigue.normal', { scale, workout: w && w.status === 'planned' ? T('coach.fatigue.normalWorkout', { title: workoutTitle(w, lang), minutes: formatMinutes(w.estimatedMinutes, lang) }) : '' }), reason: T('coach.fatigue.normalReason'), push: T('coach.fatigue.normalPush'), calm: T('coach.fatigue.normalCalm') }),
    cards: w && w.status === 'planned' ? [workoutCard(w, s)] : undefined,
    actions,
    suggestions: w && w.status === 'planned' ? [T('coach.sug.startIt'), T('coach.sug.makeShorter')] : [T('coach.sug.buildToday'), T('coach.sug.whatEat')],
    contextPatch: w ? { lastWorkoutId: w.id, topic: 'workout' } : { topic: 'recovery' },
  }
}

function handleSleep(hours: number, ctx: CoachContext, s: Speech): CoachReply {
  const { tr, lang, voice } = s
  const T = tr.t
  const today = todayKey()
  const actions: CoachAction[] = [
    { type: 'check_in', patch: { sleepHours: hours, sleepQuality: hours < 5 ? 1 : hours < 6.5 ? 2 : 3 } },
    { type: 'log_measurement', measurement: { type: 'sleep_hours', value: hours, unit: 'h', date: today, source: 'user' } },
  ]
  const w = ctx.todayWorkout
  const h = tr.num(hours, 1)
  if (hours < 5.5) {
    if (w && w.status === 'planned') {
      const lighter = shortenWorkout(scaleIntensity(w, 'lighter'), Math.max(25, w.estimatedMinutes - 15))
      return {
        text: voice.compose({ core: T('coach.sleepH.rough', { hours: h, minutes: formatMinutes(lighter.estimatedMinutes, lang) }), reason: T('coach.sleepH.roughReason'), soft: T('coach.sleepH.roughSoft'), calm: T('coach.sleepH.roughCalm'), push: T('coach.sleepH.roughPush') }),
        cards: [workoutCard(lighter, s)],
        actions: [...actions, { type: 'update_workout', workout: lighter }],
        suggestions: [T('coach.sug.startIt'), T('coach.sug.skipToday'), T('coach.sug.justMobility')],
        contextPatch: { lastWorkoutId: lighter.id, topic: 'workout' },
        status: T('coach.status.adjustingWorkout'),
      }
    }
    return {
      text: voice.compose({ core: T('coach.sleepH.nothingHeavy', { hours: h }), reason: T('coach.sleepH.nothingHeavyReason'), calm: T('coach.sleepH.nothingHeavyCalm'), push: T('coach.sleepH.nothingHeavyPush') }),
      actions,
      suggestions: [T('coach.sug.giveMobility'), T('coach.sug.whatEat')],
      contextPatch: { topic: 'recovery' },
    }
  }
  return {
    text: voice.compose({ core: T('coach.sleepH.ok', { hours: h, tail: w && w.status === 'planned' ? T('coach.sleepH.okStands', { title: workoutTitle(w, lang) }) : T('coach.sleepH.okModerate') }), reason: T('coach.sleepH.okReason'), calm: T('coach.sleepH.okCalm'), push: T('coach.sleepH.okPush') }),
    cards: w && w.status === 'planned' ? [workoutCard(w, s)] : undefined,
    actions,
    suggestions: w && w.status === 'planned' ? [T('coach.sug.startIt'), T('coach.sug.makeLighter')] : [T('coach.sug.buildToday')],
    contextPatch: w ? { lastWorkoutId: w.id, topic: 'workout' } : { topic: 'recovery' },
  }
}

function modifyWorkout(w: Workout, change: WorkoutChange, ctx: CoachContext, s: Speech): CoachReply {
  const { tr, lang, voice } = s
  const T = tr.t
  const wt = (x: Workout) => workoutTitle(x, lang)
  const mins = (n: number) => formatMinutes(n, lang)
  const exName = (e: { exerciseId: string; name: string }) => exerciseName(e.exerciseId, e.name, lang)
  const ctxPatch = (x: Workout) => ({ lastWorkoutId: x.id, topic: 'workout' as const })
  const done = (x: Workout, core: string, extra?: Partial<Parameters<Voice['compose']>[0]>): CoachReply => ({
    text: voice.compose({ core, push: T('coach.modify.push'), calm: T('coach.modify.calm'), ...(extra ?? {}) }),
    cards: [workoutCard(x, s)],
    actions: [{ type: 'update_workout', workout: x }],
    suggestions: [T('coach.sug.startIt'), T('coach.sug.swapExercise'), T('coach.sug.somethingDifferent')],
    contextPatch: ctxPatch(x),
    status: T('coach.status.adjustingWorkout'),
    thinkMs: 900,
  })
  switch (change.type) {
    case 'shorter': {
      const target = change.minutes ?? Math.max(20, Math.round((w.estimatedMinutes - 15) / 5) * 5)
      const x = shortenWorkout(w, target)
      return done(x, T('coach.modify.shorter', { minutes: mins(x.estimatedMinutes), exercises: tr.tn('common.exercises', x.exercises.length) }), { reason: T('coach.modify.shorterReason') })
    }
    case 'longer': {
      const target = change.minutes ?? w.estimatedMinutes + 15
      const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness: ctx.readiness, constraints: { ...(w.constraints ?? {}), focus: w.focus, minutes: target }, date: w.scheduledFor, seed: `${w.id}-longer` })
      const x = { ...gen, id: w.id, createdAt: w.createdAt, history: [...(w.history ?? []), T('workoutHistory.extended', { minutes: target })] }
      return done(x, T('coach.modify.longer', { minutes: mins(x.estimatedMinutes), exercises: tr.tn('common.exercises', x.exercises.length) }))
    }
    case 'replace': {
      let target = change.exerciseId
      if (!target && change.query) {
        const q = foldText(change.query.toLowerCase())
        const matches = (e: { exerciseId: string; name: string }) => exerciseAliases(getExercise(e.exerciseId)).some((a) => a.includes(q) || q.includes(a.split(' ')[0]))
        target = w.exercises.find(matches)?.exerciseId
        if (!target) {
          // Try muscle / pattern words in either language.
          const muscle = q.match(/squat|bench|press|row|curl|deadlift|lunge|plank|raise|pull|dip|fly|extension|crunch|developpe|rowing|fente|gainage|elevation|traction|souleve|tirage/)?.[0]
          if (muscle) target = w.exercises.find((e) => exerciseAliases(getExercise(e.exerciseId)).some((a) => a.includes(muscle)))?.exerciseId
        }
      }
      if (!target || !w.exercises.some((e) => e.exerciseId === target)) {
        return {
          text: voice.compose({ core: T('coach.modify.whichSwap', { exercises: w.exercises.map(exName).join(', ') }) }),
          suggestions: w.exercises.slice(0, 4).map((e) => T('coach.sug.replaceExercise', { exercise: exName(e) })),
          contextPatch: ctxPatch(w),
        }
      }
      const r = replaceExercise(w, target, ctx.user, ctx.workouts)
      if (!r.replacedWith) return { text: voice.compose({ core: T('coach.modify.noSubstitute', { exercise: exName({ exerciseId: r.original.id, name: r.original.name }) }) }), suggestions: [T('coach.sug.removeExercise', { exercise: exName({ exerciseId: r.original.id, name: r.original.name }) })], contextPatch: ctxPatch(w) }
      const from = exName({ exerciseId: r.original.id, name: r.original.name })
      const to = exName({ exerciseId: r.replacedWith.id, name: r.replacedWith.name })
      return done(r.workout, T('coach.modify.swapped', { from, to }), { reason: T('coach.modify.swappedReason', { muscle: muscleLabel(getExercise(r.original.id).primary, lang).toLowerCase() }), quip: T('coach.modify.swappedQuip', { exercise: from }) })
    }
    case 'equipment': {
      const x = restrictEquipment(w, change.equipment, ctx.user, ctx.workouts)
      return done(x, T('coach.modify.equipment', { equipment: tr.list(change.equipment.map((e) => equipmentLabel(e, lang).toLowerCase())) }), { reason: T('coach.modify.equipmentReason') })
    }
    case 'no_cardio': {
      const x = removeCardio(w)
      return done(x, T('coach.modify.noCardio', { title: wt(x), minutes: mins(x.estimatedMinutes) }), { reason: T('coach.modify.noCardioReason') })
    }
    case 'lighter':
      return done(scaleIntensity(w, 'lighter'), T('coach.modify.lighter'), { reason: T('coach.modify.lighterReason') })
    case 'harder':
      return done(scaleIntensity(w, 'harder'), T('coach.modify.harder'), { reason: T('coach.modify.harderReason') })
    case 'focus': {
      const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness: ctx.readiness, constraints: { ...(w.constraints ?? {}), focus: change.focus }, date: w.scheduledFor, seed: `${w.id}-${change.focus}` })
      const x = { ...gen, id: w.id, createdAt: w.createdAt, history: [...(w.history ?? []), T('workoutHistory.focus', { focus: focusLabel(change.focus, lang) })] }
      return done(x, T('coach.modify.focus', { title: wt(x), minutes: mins(x.estimatedMinutes) }))
    }
    case 'regenerate':
    default: {
      const gen = generateWorkout({ user: ctx.user, goals: ctx.goals, history: ctx.workouts, readiness: ctx.readiness, constraints: w.constraints, date: w.scheduledFor, seed: `${w.id}-regen-${Date.now()}` })
      const x = { ...gen, id: w.id, createdAt: w.createdAt, history: [...(w.history ?? []), T('workoutHistory.regenerated')] }
      return done(x, T('coach.modify.regen', { title: wt(x), minutes: mins(x.estimatedMinutes) }))
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

function foodCard(meal: LoggedMeal, s: Speech): CoachCard {
  return { id: uid('card'), type: 'food', refId: meal.id, title: mealDisplayName(meal, s.lang), subtitle: s.tr.t('coach.card.foodSubtitle', { kcal: meal.calories, protein: meal.proteinG }) }
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
function intakeLine(ctx: CoachContext, s: Speech, adding?: LoggedMeal, replacing?: LoggedMeal): string {
  const { tr } = s
  const T = tr.t
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
  const at = T('coach.intake.at', { protein: Math.round(base.proteinG) })
  if (leftP <= 0) return T('coach.intake.covers', { at, target: n.targets.proteinG, over: leftK < -150 ? T('coach.intake.over', { kcal: tr.int(Math.abs(leftK)) }) : '' })
  if (leftK <= 0) return T('coach.intake.caloriesAtTarget', { at })
  const tail =
    goal === 'build_muscle'
      ? leftP > 40
        ? T('coach.intake.muscleHigh', { protein: Math.round(leftP) })
        : T('coach.intake.muscleLow', { protein: Math.round(leftP) })
      : goal === 'lose_fat'
        ? T('coach.intake.loss', { kcal: tr.int(leftK) })
        : T('coach.intake.other', { kcal: tr.int(leftK), protein: Math.round(leftP) })
  return `${at}; ${tail}`
}

function foodDraftReply(analysis: FoodAnalysis, req: CoachRequest, ctx: CoachContext, s: Speech, slotHint?: Meal['slot']): CoachReply {
  const { tr, lang, voice } = s
  const T = tr.t
  const image = imageFromRequest(req, ctx)
  const slot = slotHint ?? slotForTime(ctx.now)
  const meal = buildMeal(analysis, { date: todayKey(), slot, source: image ? 'scan' : 'text', status: 'draft', attachmentId: image?.id, previewDataUrl: image?.preview })
  const conf = confidenceLabel(meal.confidence)
  const parts = meal.items.map((i) => `${foodItemName(i, lang)}${i.unit === 'g' || i.unit === 'ml' ? ` ${i.grams} ${i.unit}` : i.quantity !== 1 ? ` ×${i.quantity}` : ''}`).join(', ')
  return {
    text: voice.compose({
      core: T('coach.draft.core', { lead: analysis.analysis === 'vision' ? T('coach.draft.fromPhoto') : T('coach.draft.fromText'), parts, kcal: meal.calories, protein: meal.proteinG, carbs: meal.carbsG, fat: meal.fatG, confidence: T(`common.confidence.${conf}`) }),
      reason: analysis.notes[0] ?? (conf === 'high' ? T('coach.draft.standard') : T('coach.draft.uncertain')),
      extra: T('coach.draft.extra'),
      calm: T('coach.draft.calm'),
      push: T('coach.draft.push'),
      quip: T('coach.draft.quip'),
    }),
    cards: [foodCard(meal, s)],
    actions: [{ type: 'log_meal', meal }],
    suggestions: [T('coach.sug.addItTo', { slot: T(`coach.slotTo.${slot}`) }), T('coach.sug.moreRice'), T('coach.sug.ateHalf')],
    contextPatch: { lastMealId: meal.id, topic: 'nutrition' },
    status: T('coach.status.estimatingMeal'),
    thinkMs: 1000,
  }
}

function exerciseMatchesKeyword(exerciseId: string, name: string, key: string): boolean {
  const k = foldText(key.toLowerCase()).replace(/ing$/, '').replace(/s$/, '')
  const hay = [...exerciseAliases(getExercise(exerciseId)), foldText(name.toLowerCase())].join(' | ')
  if (hay.includes(k)) return true
  if (/^(run|cour|footing|jog)/.test(k)) return /sprint|incline walk|jog|run|course|marche inclinee/.test(hay)
  if (/^cardio/.test(k)) return /interval|sprint|burpee|jump rope|mountain climber|incline walk|corde a sauter|marche inclinee/.test(hay)
  return false
}

function parseMinutesLoose(text: string): number | undefined {
  const m = text.match(/(\d{1,3})\s*(?:min|mins|minutes)/i)
  return m ? Number(m[1]) : undefined
}

function exerciseTouches(exerciseId: string, area: string): boolean {
  const ex = getExercise(exerciseId)
  const a = foldText(area.toLowerCase())
  if (/knee|genou/.test(a)) return ['squat', 'lunge'].includes(ex.pattern) || ex.primary === 'quads'
  if (/back|\bdos\b|lombaire/.test(a)) return ['hinge', 'squat'].includes(ex.pattern) || ex.id === 'barbell_row'
  if (/shoulder|epaule/.test(a)) return ['vertical_push', 'horizontal_push'].includes(ex.pattern) || ex.primary === 'shoulders' || ex.id === 'dip'
  if (/elbow|wrist|coude|poignet/.test(a)) return ex.primary === 'triceps' || ex.primary === 'biceps' || ex.pattern === 'horizontal_push'
  if (/hip|hanche/.test(a)) return ['hinge', 'lunge', 'squat'].includes(ex.pattern)
  if (/ankle|calf|cheville|mollet/.test(a)) return ['lunge', 'conditioning'].includes(ex.pattern) || ex.primary === 'calves'
  if (/hamstring|ischio/.test(a)) return ex.primary === 'hamstrings' || ex.pattern === 'hinge'
  if (/neck|\bcou\b|nuque/.test(a)) return ex.pattern === 'vertical_push'
  return false
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

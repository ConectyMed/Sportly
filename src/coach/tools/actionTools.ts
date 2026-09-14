import type { DomainChange, EntityRef, MemoryItem } from '@/domain/types'
import { GOAL_TYPES, goalLabel, mealSlotIn, programDisplayName, workoutTitle } from '@/domain/labels'
import { t, translator } from '@/i18n'
import { mealDisplayName } from '../food/foodAnalysis'
import { formatShortDate, fromDayKey, todayKey, weekdayName } from '@/lib/dates'
import { useStore } from '@/store/useStore'
import { classifyPersistence, findConflictingMemories, findDuplicateMemory, isWorthRemembering, memorySubjects } from '../memory'
import type { CoachAction } from '../provider'
import { completeWorkoutRecord, ensureEventForWorkout, tickRemainingSets } from '../workoutCompletion'
import { change, fail, ok, type ToolResult } from './contracts'

/**
 * Action tools: the only code path that turns a coach decision into a state
 * change. Each tool validates its input against the CURRENT store, executes,
 * and reports exactly what changed. Repeats are detected per entity so a
 * retried or double-parsed request cannot create duplicates.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/

const ref = (type: EntityRef['type'], id: string, label?: string): EntityRef => ({ type, id, label })

export interface ActionData {
  /** Human sentence describing what happened, in past tense. */
  summary: string
  entity?: EntityRef
}

export function runAction(action: CoachAction): ToolResult<ActionData> {
  const s = useStore.getState()
  const tr = translator()
  const wt = (w: { title: string; titleKey?: string }) => workoutTitle(w)
  const pn = (p: { name: string; goalType: import('@/domain/types').GoalType; weeks: number }) => programDisplayName(p)
  const mn = (m: { name: string; items: import('@/domain/types').FoodItem[] }) => mealDisplayName(m)
  try {
    switch (action.type) {
      case 'create_workout': {
        const w = action.workout
        if (!w?.id || !w.exercises?.length) return fail('invalid_input', t('tool.workout.needsExercise'))
        if (!DAY.test(w.scheduledFor)) return fail('invalid_input', t('tool.workout.needsDate'))
        if (s.workouts[w.id]) {
          // Same entity again: keep the latest shape, report it as an update, never duplicate.
          s.upsertWorkout(w)
          ensureEventForWorkout(w)
          return ok({ summary: t('tool.workout.updated', { title: wt(w) }), entity: ref('workout', w.id, wt(w)) }, [change('WORKOUT_UPDATED', ref('workout', w.id, wt(w)), t('tool.workout.updatedChange', { title: wt(w) }))], { idempotent: true })
        }
        const changes: DomainChange[] = []
        if (action.replaceWorkoutId && action.replaceWorkoutId !== w.id) {
          const old = s.workouts[action.replaceWorkoutId]
          if (old && old.status === 'planned') {
            s.deleteWorkout(old.id)
            changes.push(change('WORKOUT_DELETED', ref('workout', old.id, wt(old)), t('tool.workout.replaced', { title: wt(old) })))
          }
        }
        // One planned coach/user workout per day: retire other planned ones for that date.
        for (const other of Object.values(useStore.getState().workouts)) {
          if (other.id !== w.id && other.scheduledFor === w.scheduledFor && other.status === 'planned' && !other.programId) {
            s.deleteWorkout(other.id)
            changes.push(change('WORKOUT_DELETED', ref('workout', other.id, wt(other)), t('tool.workout.replacedBy', { old: wt(other), new: wt(w) })))
          }
        }
        s.upsertWorkout(w)
        ensureEventForWorkout(w)
        changes.push(change('WORKOUT_CREATED', ref('workout', w.id, wt(w)), t('tool.workout.plannedFor', { title: wt(w), date: formatShortDate(fromDayKey(w.scheduledFor)) })))
        return ok({ summary: t('tool.workout.planned', { title: wt(w), day: weekdayName(fromDayKey(w.scheduledFor)) }), entity: ref('workout', w.id, wt(w)) }, changes, { references: [ref('workout', w.id, wt(w))] })
      }

      case 'update_workout': {
        const w = action.workout
        if (!s.workouts[w?.id]) return fail('not_found', t('tool.workout.gone'))
        if (!w.exercises?.length) return fail('invalid_input', t('tool.workout.needsExercise'))
        s.upsertWorkout(w)
        ensureEventForWorkout(w)
        return ok({ summary: t('tool.workout.updated', { title: wt(w) }), entity: ref('workout', w.id, wt(w)) }, [change('WORKOUT_UPDATED', ref('workout', w.id, wt(w)), t('tool.workout.updatedChange', { title: wt(w) }))], { references: [ref('workout', w.id, wt(w))] })
      }

      case 'skip_workout': {
        const w = s.workouts[action.workoutId]
        if (!w) return fail('not_found', t('tool.workout.gone'))
        if (w.status === 'skipped') return ok({ summary: t('tool.workout.alreadySkipped', { title: wt(w) }), entity: ref('workout', w.id, wt(w)) }, [], { idempotent: true })
        if (w.status === 'completed') return fail('conflict', t('tool.workout.completedCannotSkip', { title: wt(w) }))
        s.skipWorkout(w.id)
        ensureEventForWorkout({ ...w, status: 'skipped' })
        return ok({ summary: t('tool.workout.skipped', { title: wt(w) }), entity: ref('workout', w.id, wt(w)) }, [change('WORKOUT_SKIPPED', ref('workout', w.id, wt(w)), t('tool.workout.skippedChange', { title: wt(w) }))])
      }

      case 'remove_workout': {
        const w = s.workouts[action.workoutId]
        if (!w) return fail('not_found', t('tool.workout.gone'))
        if (w.status !== 'planned') return fail('not_allowed', t('tool.workout.onlyPlannedRemovable', { title: wt(w), status: w.status === 'completed' ? t('tool.status.completed') : w.status === 'in_progress' ? t('tool.status.started') : t('tool.status.skipped') }))
        s.deleteWorkout(w.id)
        return ok({ summary: t('tool.workout.removed', { title: wt(w), day: weekdayName(fromDayKey(w.scheduledFor)) }), entity: ref('workout', w.id, wt(w)) }, [change('WORKOUT_DELETED', ref('workout', w.id, wt(w)), t('tool.workout.removedChange', { title: wt(w) }))])
      }

      case 'complete_workout': {
        const w = s.workouts[action.workoutId]
        if (!w) return fail('not_found', t('tool.workout.gone'))
        if (w.status === 'completed') return ok({ summary: t('tool.workout.alreadyCompleted', { title: wt(w) }), entity: ref('workout', w.id, wt(w)) }, [], { idempotent: true })
        if (w.status === 'skipped') return fail('conflict', t('tool.workout.skippedCannotComplete', { title: wt(w) }))
        s.upsertWorkout(tickRemainingSets(w))
        const summary = completeWorkoutRecord(w.id)
        if (!summary) return fail('failed', t('tool.workout.couldNotComplete'))
        return ok({ summary: t('tool.workout.completed', { title: wt(w), done: summary.setsCompleted, total: summary.setsPlanned }), entity: ref('workout', w.id, wt(w)) }, [change('WORKOUT_COMPLETED', ref('workout', w.id, wt(w)), t('tool.workout.completedChange', { title: wt(w) }))], { references: [ref('workout', w.id, wt(w))] })
      }

      case 'reschedule_workout': {
        const w = s.workouts[action.workoutId]
        if (!w) return fail('not_found', t('tool.workout.gone'))
        if (!DAY.test(action.toDate)) return fail('invalid_input', t('tool.workout.invalidDate'))
        if (w.status !== 'planned') return fail('not_allowed', t('tool.workout.onlyPlannedMove', { title: wt(w), status: t(`tool.status.${w.status}`) }))
        if (w.scheduledFor === action.toDate) return ok({ summary: t('tool.workout.alreadyOn', { title: wt(w), day: weekdayName(fromDayKey(action.toDate)) }), entity: ref('workout', w.id, wt(w)) }, [], { idempotent: true })
        const from = w.scheduledFor
        s.updateWorkout(w.id, { scheduledFor: action.toDate })
        ensureEventForWorkout({ ...w, scheduledFor: action.toDate })
        const ev = useStore.getState().events.find((e) => e.workoutId === w.id)
        if (ev) s.upsertEvent({ ...ev, movedFrom: from })
        return ok({ summary: t('tool.workout.moved', { title: wt(w), from: weekdayName(fromDayKey(from)), to: weekdayName(fromDayKey(action.toDate)) }), entity: ref('workout', w.id, wt(w)) }, [change('WORKOUT_RESCHEDULED', ref('workout', w.id, wt(w)), t('tool.workout.movedChange', { title: wt(w), date: action.toDate }))], { references: [ref('workout', w.id, wt(w))] })
      }

      case 'move_event': {
        const ev = s.events.find((e) => e.id === action.eventId)
        if (!ev) return fail('not_found', t('tool.event.gone'))
        if (!DAY.test(action.toDate)) return fail('invalid_input', t('tool.workout.invalidDate'))
        if (ev.date === action.toDate) return ok({ summary: t('tool.event.alreadyOn', { title: ev.title, day: weekdayName(fromDayKey(ev.date)) }), entity: ref('event', ev.id, ev.title) }, [], { idempotent: true })
        if (ev.workoutId) return runAction({ type: 'reschedule_workout', workoutId: ev.workoutId, toDate: action.toDate })
        s.moveEvent(ev.id, action.toDate)
        return ok({ summary: t('tool.event.moved', { title: ev.title, day: weekdayName(fromDayKey(action.toDate)) }), entity: ref('event', ev.id, ev.title) }, [change('EVENT_UPDATED', ref('event', ev.id, ev.title), t('tool.event.movedChange', { title: ev.title, date: action.toDate }))])
      }

      case 'create_event': {
        const e = action.event
        if (!e?.id || !DAY.test(e.date) || !e.title) return fail('invalid_input', t('tool.event.invalid'))
        const exists = s.events.some((x) => x.id === e.id)
        s.upsertEvent(e)
        return ok({ summary: t(exists ? 'tool.event.updatedOn' : 'tool.event.addedOn', { title: e.title, day: weekdayName(fromDayKey(e.date)) }), entity: ref('event', e.id, e.title) }, [change(exists ? 'EVENT_UPDATED' : 'EVENT_CREATED', ref('event', e.id, e.title), t('tool.event.onDate', { title: e.title, date: e.date }))], { idempotent: exists })
      }

      case 'update_event': {
        const ev = s.events.find((e) => e.id === action.eventId)
        if (!ev) return fail('not_found', t('tool.event.gone'))
        if (action.patch.date && !DAY.test(action.patch.date)) return fail('invalid_input', t('tool.workout.invalidDate'))
        if (action.patch.date && action.patch.date !== ev.date && ev.workoutId) return runAction({ type: 'reschedule_workout', workoutId: ev.workoutId, toDate: action.patch.date })
        s.upsertEvent({ ...ev, ...action.patch, id: ev.id })
        return ok({ summary: t('tool.event.updated', { title: ev.title }), entity: ref('event', ev.id, ev.title) }, [change('EVENT_UPDATED', ref('event', ev.id, ev.title), t('tool.event.updatedChange', { title: ev.title }))])
      }

      case 'delete_event': {
        const ev = s.events.find((e) => e.id === action.eventId)
        if (!ev) return fail('not_found', t('tool.event.gone'))
        if (ev.workoutId && s.workouts[ev.workoutId]) return runAction({ type: 'remove_workout', workoutId: ev.workoutId })
        s.removeEvent(ev.id)
        return ok({ summary: t('tool.event.removed', { title: ev.title }), entity: ref('event', ev.id, ev.title) }, [change('EVENT_DELETED', ref('event', ev.id, ev.title), t('tool.event.removedChange', { title: ev.title }))])
      }

      case 'create_program': {
        const p = action.program
        if (!p?.id || !(p.weeks > 0) || !(p.daysPerWeek > 0)) return fail('invalid_input', t('tool.program.invalid'))
        if (s.programs[p.id]) return ok({ summary: t('tool.program.exists', { name: pn(p) }), entity: ref('program', p.id, pn(p)) }, [], { idempotent: true })
        const changes: DomainChange[] = []
        if (action.replaceProgramId && s.programs[action.replaceProgramId]) {
          s.updateProgram(action.replaceProgramId, { status: 'cancelled' })
          s.removeEventsForProgram(action.replaceProgramId, todayKey())
          const old = s.programs[action.replaceProgramId]
          changes.push(change('PROGRAM_CANCELLED', ref('program', old.id, pn(old)), t('tool.program.replaced', { name: pn(old) })))
        }
        s.upsertProgram(p)
        for (const w of action.workouts) s.upsertWorkout(w)
        s.upsertEvents(action.events)
        s.addNotification({ kind: 'plan_ready', title: t('tool.program.readyTitle', { name: pn(p) }), body: t('tool.program.readyBody', { weeks: p.weeks, days: p.daysPerWeek, date: formatShortDate(p.startDate) }), action: { label: t('tool.program.view'), to: `/program/${p.id}` } })
        changes.push(change('PROGRAM_CREATED', ref('program', p.id, pn(p)), t('tool.program.createdChange', { name: pn(p), weeks: p.weeks, days: p.daysPerWeek })))
        return ok({ summary: t('tool.program.created', { name: pn(p), weeks: p.weeks, days: p.daysPerWeek, sessions: action.workouts.length }), entity: ref('program', p.id, pn(p)) }, changes, { references: [ref('program', p.id, pn(p))] })
      }

      case 'cancel_program': {
        const p = s.programs[action.programId]
        if (!p) return fail('not_found', t('tool.program.gone'))
        if (p.status === 'cancelled') return ok({ summary: t('tool.program.alreadyCancelled', { name: pn(p) }), entity: ref('program', p.id, pn(p)) }, [], { idempotent: true })
        s.updateProgram(p.id, { status: 'cancelled' })
        s.removeEventsForProgram(p.id, todayKey())
        return ok({ summary: t('tool.program.cancelled', { name: pn(p) }), entity: ref('program', p.id, pn(p)) }, [change('PROGRAM_CANCELLED', ref('program', p.id, pn(p)), t('tool.program.cancelledChange', { name: pn(p) }))])
      }

      case 'create_nutrition_plan': {
        const p = action.plan
        if (!p?.id || !(p.calories > 0)) return fail('invalid_input', t('tool.nutrition.invalid'))
        const exists = Boolean(s.nutritionPlans[p.id])
        s.upsertNutritionPlan(p)
        return ok({ summary: t('tool.nutrition.set', { kcal: tr.int(p.calories), protein: p.proteinG }), entity: ref('nutrition_plan', p.id) }, [change('NUTRITION_TARGET_UPDATED', ref('nutrition_plan', p.id), t('tool.nutrition.setChange', { kcal: p.calories, protein: p.proteinG, date: p.date }))], { idempotent: exists, references: [ref('nutrition_plan', p.id)] })
      }

      case 'log_meal': {
        const m = action.meal
        if (!m?.id || !m.items?.length) return fail('invalid_input', t('tool.meal.needsItem'))
        if (!DAY.test(m.date)) return fail('invalid_input', t('tool.meal.needsDate'))
        const existing = s.meals[m.id]
        s.upsertMeal(m)
        const name = mn(m)
        const label = `${name} (${m.calories} kcal)`
        if (existing) return ok({ summary: t('tool.meal.updated', { name }), entity: ref('meal', m.id, name) }, [change('MEAL_UPDATED', ref('meal', m.id, label), t('tool.meal.updatedChange', { name }))], { idempotent: true, references: [ref('meal', m.id, name)] })
        return ok({ summary: m.status === 'logged' ? t('tool.meal.logged', { name, slot: mealSlotIn(m.slot) }) : t('tool.meal.drafted', { name }), entity: ref('meal', m.id, name) }, [change('MEAL_ADDED', ref('meal', m.id, label), t(m.status === 'logged' ? 'tool.meal.loggedChange' : 'tool.meal.draftedChange', { name, date: m.date }))], { references: [ref('meal', m.id, name)] })
      }

      case 'update_meal': {
        const m = action.meal
        if (!s.meals[m?.id]) return fail('not_found', t('tool.meal.gone'))
        if (!m.items?.length) return fail('invalid_input', t('tool.meal.needsItem'))
        const before = s.meals[m.id]
        s.upsertMeal(m)
        const became = before.status !== 'logged' && m.status === 'logged'
        const name = mn(m)
        return ok({ summary: became ? t('tool.meal.logged', { name, slot: mealSlotIn(m.slot) }) : t('tool.meal.updated', { name }), entity: ref('meal', m.id, name) }, [change(became ? 'MEAL_ADDED' : 'MEAL_UPDATED', ref('meal', m.id, `${name} (${m.calories} kcal)`), became ? t('tool.meal.loggedShort', { name }) : t('tool.meal.updatedChange', { name }))], { references: [ref('meal', m.id, name)] })
      }

      case 'delete_meal': {
        const m = s.meals[action.mealId]
        if (!m) return fail('not_found', t('tool.meal.alreadyRemoved'))
        s.deleteMeal(m.id)
        const name = mn(m)
        return ok({ summary: m.status === 'logged' ? t('tool.meal.removed', { name, slot: mealSlotIn(m.slot) }) : t('tool.meal.discarded', { name }), entity: ref('meal', m.id, name) }, [change('MEAL_DELETED', ref('meal', m.id, name), t('tool.meal.removedChange', { name }))])
      }

      case 'remember': {
        const item = action.item
        if (!item?.text || !isWorthRemembering(item.text)) return fail('invalid_input', t('tool.memory.nothing'))
        const subjects = item.subjects ?? memorySubjects(item.text)
        const duplicate = findDuplicateMemory(s.memory, { text: item.text, category: item.category, subjects })
        if (duplicate) {
          s.updateMemory(duplicate.id, { updatedAt: new Date().toISOString(), confidence: Math.max(duplicate.confidence ?? 0.8, item.confidence ?? 1) })
          return ok({ summary: t('tool.memory.already', { text: duplicate.text }), entity: ref('memory', duplicate.id, duplicate.text) }, [], { idempotent: true })
        }
        const changes: DomainChange[] = []
        const conflicts = findConflictingMemories(s.memory, { text: item.text, category: item.category, subjects })
        for (const c of conflicts) {
          s.removeMemory(c.id)
          changes.push(change('MEMORY_REMOVED', ref('memory', c.id, c.text), t('tool.memory.replacedChange', { text: c.text })))
        }
        const persistence = item.persistence ?? classifyPersistence(item.text)
        const saved: MemoryItem = s.addMemory({
          ...item,
          subjects,
          persistence,
          confidence: item.confidence ?? (item.source === 'inferred' ? 0.6 : 1),
          updatedAt: new Date().toISOString(),
          expiresAt: item.expiresAt ?? (persistence === 'temporary' ? new Date(Date.now() + 7 * 86_400_000).toISOString() : undefined),
          supersedes: conflicts[0]?.id,
        })
        changes.push(change('MEMORY_SAVED', ref('memory', saved.id, saved.text), t('tool.memory.savedChange', { text: saved.text })))
        return ok({ summary: conflicts.length ? t('tool.memory.savedAndDropped', { text: saved.text, old: conflicts[0].text }) : t('tool.memory.saved', { text: saved.text }), entity: ref('memory', saved.id, saved.text) }, changes, { references: [ref('memory', saved.id, saved.text)] })
      }

      case 'forget': {
        const m = s.memory.find((x) => x.id === action.memoryId)
        if (!m) return fail('not_found', t('tool.memory.alreadyRemoved'))
        s.removeMemory(m.id)
        return ok({ summary: t('tool.memory.forgot', { text: m.text }), entity: ref('memory', m.id, m.text) }, [change('MEMORY_REMOVED', ref('memory', m.id, m.text), t('tool.memory.forgot', { text: m.text }).replace(/\.$/, ''))])
      }

      case 'set_goal': {
        const g = action.goal
        if (!g?.id || !g.type || !GOAL_TYPES.includes(g.type)) return fail('invalid_input', t('tool.goal.unknown'))
        if (g.targetValue !== undefined && !(Number.isFinite(g.targetValue) && g.targetValue > 0)) return fail('invalid_input', t('tool.goal.target'))
        const existing = s.goals.find((x) => x.id === g.id)
        const same = existing && existing.type === g.type && existing.targetValue === g.targetValue && existing.metric === g.metric && existing.rank === g.rank
        s.upsertGoal(g)
        const label = `${goalLabel(g.type)}${g.targetValue ? ` · ${tr.num(g.targetValue, 1)} ${g.targetUnit ?? ''}`.trim() : ''}`
        const rank = t(g.rank === 'primary' ? 'common.primary' : 'common.secondary')
        if (same) return ok({ summary: t('tool.goal.unchanged', { label }), entity: ref('goal', g.id, label) }, [], { idempotent: true })
        return ok({ summary: t(existing ? 'tool.goal.updated' : 'tool.goal.set', { rank, label }), entity: ref('goal', g.id, label) }, [change(existing ? 'GOAL_UPDATED' : 'GOAL_CREATED', ref('goal', g.id, label), t(existing ? 'tool.goal.updatedChange' : 'tool.goal.setChange', { rank, label }))], { references: [ref('goal', g.id, label)] })
      }

      case 'delete_goal': {
        const g = s.goals.find((x) => x.id === action.goalId)
        if (!g) return fail('not_found', t('tool.goal.gone'))
        s.removeGoal(g.id)
        return ok({ summary: t('tool.goal.removed', { label: goalLabel(g.type) }), entity: ref('goal', g.id, goalLabel(g.type)) }, [change('GOAL_DELETED', ref('goal', g.id, goalLabel(g.type)), t('tool.goal.removedChange', { label: goalLabel(g.type) }))])
      }

      case 'check_in': {
        const p = action.patch
        const scale = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 1 && v <= 10)
        if (!scale(p.fatigue) || !scale(p.energy) || !scale(p.soreness)) return fail('invalid_input', t('tool.checkin.scale'))
        if (p.sleepHours !== undefined && !(p.sleepHours >= 0 && p.sleepHours <= 16)) return fail('invalid_input', t('tool.checkin.sleep'))
        const date = todayKey()
        s.setCheckIn(date, p)
        const parts = [p.fatigue !== undefined && t('tool.checkin.fatigue', { n: p.fatigue }), p.energy !== undefined && t('tool.checkin.energy', { n: p.energy }), p.sleepHours !== undefined && t('tool.checkin.sleepHours', { n: tr.num(p.sleepHours, 1) }), p.soreness !== undefined && t('tool.checkin.soreness', { n: p.soreness })].filter(Boolean).join(', ')
        return ok({ summary: t('tool.checkin.updated', { parts: parts || t('tool.checkin.noted') }), entity: ref('check_in', date) }, [change('READINESS_UPDATED', ref('check_in', date), t('tool.checkin.change', { parts: parts || t('common.updated').toLowerCase() }))])
      }

      case 'log_measurement': {
        const m = action.measurement
        if (!m || !Number.isFinite(m.value) || m.value <= 0) return fail('invalid_input', t('tool.measurement.positive'))
        if (!DAY.test(m.date)) return fail('invalid_input', t('tool.measurement.date'))
        if (m.type === 'body_weight' && !(m.value > 20 && m.value < 400)) return fail('invalid_input', t('tool.measurement.weightRange'))
        if (m.type === 'body_fat' && !(m.value > 1 && m.value < 70)) return fail('invalid_input', t('tool.measurement.fatRange'))
        const dup = s.measurements.find((x) => x.type === m.type && x.date === m.date && x.value === m.value)
        if (dup) return ok({ summary: t('tool.measurement.already', { value: tr.num(m.value, 1), unit: m.unit, date: formatShortDate(fromDayKey(m.date)) }), entity: ref('measurement', dup.id) }, [], { idempotent: true })
        s.addMeasurement(m)
        if (m.type === 'body_weight' && s.user) s.updateUser({ weightKg: m.value })
        const saved = useStore.getState().measurements.find((x) => x.type === m.type && x.date === m.date && x.value === m.value)
        return ok({ summary: t('tool.measurement.logged', { type: t(`tool.measurement.type.${m.type}` as 'tool.measurement.type.body_weight'), value: tr.num(m.value, 1), unit: m.unit }), entity: ref('measurement', saved?.id ?? m.date) }, [change('MEASUREMENT_LOGGED', ref('measurement', saved?.id ?? m.date), `${m.type} ${m.value} ${m.unit} on ${m.date}`)])
      }

      case 'update_coach': {
        if (!action.patch || !Object.keys(action.patch).length) return fail('invalid_input', t('tool.coach.nothing'))
        s.updateCoach(action.patch)
        return ok({ summary: action.patch.name ? t('tool.coach.renamed', { name: action.patch.name }) : t('tool.coach.updated'), entity: ref('coach', 'coach') }, [change('COACH_UPDATED', ref('coach', 'coach'), Object.keys(action.patch).join(', '))])
      }

      case 'update_user': {
        if (!s.user) return fail('not_allowed', t('tool.profile.none'))
        if (!action.patch || !Object.keys(action.patch).length) return fail('invalid_input', t('tool.profile.nothing'))
        if (action.patch.weightKg !== undefined && !(action.patch.weightKg > 20 && action.patch.weightKg < 400)) return fail('invalid_input', t('tool.profile.weight'))
        s.updateUser(action.patch)
        return ok({ summary: t('tool.profile.updated', { fields: Object.keys(action.patch).join(', ') }), entity: ref('user', s.user.id) }, [change('PROFILE_UPDATED', ref('user', s.user.id), Object.keys(action.patch).join(', '))])
      }

      case 'update_availability': {
        if (!s.user) return fail('not_allowed', t('tool.profile.none'))
        const p = action.patch
        if (p.daysPerWeek !== undefined && !(p.daysPerWeek >= 1 && p.daysPerWeek <= 7)) return fail('invalid_input', t('tool.availability.days'))
        if (p.preferredDays && p.preferredDays.some((d) => d < 0 || d > 6)) return fail('invalid_input', t('tool.availability.weekdays'))
        if (p.sessionMinutes !== undefined && !(p.sessionMinutes >= 10 && p.sessionMinutes <= 240)) return fail('invalid_input', t('tool.availability.minutes'))
        const next = { ...s.user.availability, ...p }
        const same = JSON.stringify(next) === JSON.stringify(s.user.availability)
        if (same) return ok({ summary: t('tool.availability.unchanged'), entity: ref('user', s.user.id) }, [], { idempotent: true })
        s.updateUser({ availability: next })
        return ok({ summary: t('tool.availability.set', { days: next.daysPerWeek, names: next.preferredDays.map((d) => weekdayName(new Date(2024, 0, 7 + d), true)).join(', ') }), entity: ref('user', s.user.id) }, [change('AVAILABILITY_UPDATED', ref('user', s.user.id), `${next.daysPerWeek} days/week: ${next.preferredDays.join(',')}`)])
      }

      case 'notify': {
        if (!action.title) return fail('invalid_input', t('tool.notify.title'))
        s.addNotification({ kind: 'insight', title: action.title, body: action.body })
        return ok({ summary: t('tool.notify.sent', { title: action.title }) }, [change('NOTIFICATION_SENT', ref('notification', action.title), action.title)])
      }
    }
  } catch (err) {
    return fail('failed', err instanceof Error ? err.message : t('tool.unexpected'))
  }
}

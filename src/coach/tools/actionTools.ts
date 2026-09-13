import type { DomainChange, EntityRef, MemoryItem } from '@/domain/types'
import { GOAL_LABELS, MEAL_SLOT_LABELS } from '@/domain/labels'
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
  try {
    switch (action.type) {
      case 'create_workout': {
        const w = action.workout
        if (!w?.id || !w.exercises?.length) return fail('invalid_input', 'A workout needs at least one exercise.')
        if (!DAY.test(w.scheduledFor)) return fail('invalid_input', 'A workout needs a valid date.')
        if (s.workouts[w.id]) {
          // Same entity again: keep the latest shape, report it as an update, never duplicate.
          s.upsertWorkout(w)
          ensureEventForWorkout(w)
          return ok({ summary: `Updated ${w.title}.`, entity: ref('workout', w.id, w.title) }, [change('WORKOUT_UPDATED', ref('workout', w.id, w.title), `${w.title} updated`)], { idempotent: true })
        }
        const changes: DomainChange[] = []
        if (action.replaceWorkoutId && action.replaceWorkoutId !== w.id) {
          const old = s.workouts[action.replaceWorkoutId]
          if (old && old.status === 'planned') {
            s.deleteWorkout(old.id)
            changes.push(change('WORKOUT_DELETED', ref('workout', old.id, old.title), `${old.title} replaced`))
          }
        }
        // One planned coach/user workout per day: retire other planned ones for that date.
        for (const other of Object.values(useStore.getState().workouts)) {
          if (other.id !== w.id && other.scheduledFor === w.scheduledFor && other.status === 'planned' && !other.programId) {
            s.deleteWorkout(other.id)
            changes.push(change('WORKOUT_DELETED', ref('workout', other.id, other.title), `${other.title} replaced by ${w.title}`))
          }
        }
        s.upsertWorkout(w)
        ensureEventForWorkout(w)
        changes.push(change('WORKOUT_CREATED', ref('workout', w.id, w.title), `${w.title} planned for ${formatShortDate(fromDayKey(w.scheduledFor))}`))
        return ok({ summary: `Planned ${w.title} for ${weekdayName(fromDayKey(w.scheduledFor))}.`, entity: ref('workout', w.id, w.title) }, changes, { references: [ref('workout', w.id, w.title)] })
      }

      case 'update_workout': {
        const w = action.workout
        if (!s.workouts[w?.id]) return fail('not_found', 'That workout no longer exists.')
        if (!w.exercises?.length) return fail('invalid_input', 'A workout needs at least one exercise.')
        s.upsertWorkout(w)
        ensureEventForWorkout(w)
        return ok({ summary: `Updated ${w.title}.`, entity: ref('workout', w.id, w.title) }, [change('WORKOUT_UPDATED', ref('workout', w.id, w.title), `${w.title} updated`)], { references: [ref('workout', w.id, w.title)] })
      }

      case 'skip_workout': {
        const w = s.workouts[action.workoutId]
        if (!w) return fail('not_found', 'That workout no longer exists.')
        if (w.status === 'skipped') return ok({ summary: `${w.title} was already skipped.`, entity: ref('workout', w.id, w.title) }, [], { idempotent: true })
        if (w.status === 'completed') return fail('conflict', `${w.title} is already completed; it cannot be skipped.`)
        s.skipWorkout(w.id)
        ensureEventForWorkout({ ...w, status: 'skipped' })
        return ok({ summary: `Skipped ${w.title}.`, entity: ref('workout', w.id, w.title) }, [change('WORKOUT_SKIPPED', ref('workout', w.id, w.title), `${w.title} skipped`)])
      }

      case 'remove_workout': {
        const w = s.workouts[action.workoutId]
        if (!w) return fail('not_found', 'That workout no longer exists.')
        if (w.status !== 'planned') return fail('not_allowed', `${w.title} has already been ${w.status === 'completed' ? 'completed' : w.status === 'in_progress' ? 'started' : 'skipped'}; only planned sessions can be removed.`)
        s.deleteWorkout(w.id)
        return ok({ summary: `Removed ${w.title} from ${weekdayName(fromDayKey(w.scheduledFor))}.`, entity: ref('workout', w.id, w.title) }, [change('WORKOUT_DELETED', ref('workout', w.id, w.title), `${w.title} removed`)])
      }

      case 'complete_workout': {
        const w = s.workouts[action.workoutId]
        if (!w) return fail('not_found', 'That workout no longer exists.')
        if (w.status === 'completed') return ok({ summary: `${w.title} was already completed.`, entity: ref('workout', w.id, w.title) }, [], { idempotent: true })
        if (w.status === 'skipped') return fail('conflict', `${w.title} was marked as skipped. Say “unskip it” if you actually did it.`)
        s.upsertWorkout(tickRemainingSets(w))
        const summary = completeWorkoutRecord(w.id)
        if (!summary) return fail('failed', 'Could not complete that workout.')
        return ok({ summary: `Completed ${w.title} (${summary.setsCompleted} of ${summary.setsPlanned} sets).`, entity: ref('workout', w.id, w.title) }, [change('WORKOUT_COMPLETED', ref('workout', w.id, w.title), `${w.title} completed`)], { references: [ref('workout', w.id, w.title)] })
      }

      case 'reschedule_workout': {
        const w = s.workouts[action.workoutId]
        if (!w) return fail('not_found', 'That workout no longer exists.')
        if (!DAY.test(action.toDate)) return fail('invalid_input', 'The new date is not valid.')
        if (w.status !== 'planned') return fail('not_allowed', `${w.title} is ${w.status}; only planned sessions move.`)
        if (w.scheduledFor === action.toDate) return ok({ summary: `${w.title} is already on ${weekdayName(fromDayKey(action.toDate))}.`, entity: ref('workout', w.id, w.title) }, [], { idempotent: true })
        const from = w.scheduledFor
        s.updateWorkout(w.id, { scheduledFor: action.toDate })
        ensureEventForWorkout({ ...w, scheduledFor: action.toDate })
        const ev = useStore.getState().events.find((e) => e.workoutId === w.id)
        if (ev) s.upsertEvent({ ...ev, movedFrom: from })
        return ok({ summary: `Moved ${w.title} from ${weekdayName(fromDayKey(from))} to ${weekdayName(fromDayKey(action.toDate))}.`, entity: ref('workout', w.id, w.title) }, [change('WORKOUT_RESCHEDULED', ref('workout', w.id, w.title), `${w.title} moved to ${action.toDate}`)], { references: [ref('workout', w.id, w.title)] })
      }

      case 'move_event': {
        const ev = s.events.find((e) => e.id === action.eventId)
        if (!ev) return fail('not_found', 'That calendar entry no longer exists.')
        if (!DAY.test(action.toDate)) return fail('invalid_input', 'The new date is not valid.')
        if (ev.date === action.toDate) return ok({ summary: `${ev.title} is already on ${weekdayName(fromDayKey(ev.date))}.`, entity: ref('event', ev.id, ev.title) }, [], { idempotent: true })
        if (ev.workoutId) return runAction({ type: 'reschedule_workout', workoutId: ev.workoutId, toDate: action.toDate })
        s.moveEvent(ev.id, action.toDate)
        return ok({ summary: `Moved ${ev.title} to ${weekdayName(fromDayKey(action.toDate))}.`, entity: ref('event', ev.id, ev.title) }, [change('EVENT_UPDATED', ref('event', ev.id, ev.title), `${ev.title} moved to ${action.toDate}`)])
      }

      case 'create_event': {
        const e = action.event
        if (!e?.id || !DAY.test(e.date) || !e.title) return fail('invalid_input', 'A calendar entry needs an id, a date and a title.')
        const exists = s.events.some((x) => x.id === e.id)
        s.upsertEvent(e)
        return ok({ summary: `${exists ? 'Updated' : 'Added'} ${e.title} on ${weekdayName(fromDayKey(e.date))}.`, entity: ref('event', e.id, e.title) }, [change(exists ? 'EVENT_UPDATED' : 'EVENT_CREATED', ref('event', e.id, e.title), `${e.title} on ${e.date}`)], { idempotent: exists })
      }

      case 'update_event': {
        const ev = s.events.find((e) => e.id === action.eventId)
        if (!ev) return fail('not_found', 'That calendar entry no longer exists.')
        if (action.patch.date && !DAY.test(action.patch.date)) return fail('invalid_input', 'The new date is not valid.')
        if (action.patch.date && action.patch.date !== ev.date && ev.workoutId) return runAction({ type: 'reschedule_workout', workoutId: ev.workoutId, toDate: action.patch.date })
        s.upsertEvent({ ...ev, ...action.patch, id: ev.id })
        return ok({ summary: `Updated ${ev.title}.`, entity: ref('event', ev.id, ev.title) }, [change('EVENT_UPDATED', ref('event', ev.id, ev.title), `${ev.title} updated`)])
      }

      case 'delete_event': {
        const ev = s.events.find((e) => e.id === action.eventId)
        if (!ev) return fail('not_found', 'That calendar entry no longer exists.')
        if (ev.workoutId && s.workouts[ev.workoutId]) return runAction({ type: 'remove_workout', workoutId: ev.workoutId })
        s.removeEvent(ev.id)
        return ok({ summary: `Removed ${ev.title} from the calendar.`, entity: ref('event', ev.id, ev.title) }, [change('EVENT_DELETED', ref('event', ev.id, ev.title), `${ev.title} removed`)])
      }

      case 'create_program': {
        const p = action.program
        if (!p?.id || !(p.weeks > 0) || !(p.daysPerWeek > 0)) return fail('invalid_input', 'A program needs a length in weeks and days per week.')
        if (s.programs[p.id]) return ok({ summary: `${p.name} already exists.`, entity: ref('program', p.id, p.name) }, [], { idempotent: true })
        const changes: DomainChange[] = []
        if (action.replaceProgramId && s.programs[action.replaceProgramId]) {
          s.updateProgram(action.replaceProgramId, { status: 'cancelled' })
          s.removeEventsForProgram(action.replaceProgramId, todayKey())
          const old = s.programs[action.replaceProgramId]
          changes.push(change('PROGRAM_CANCELLED', ref('program', old.id, old.name), `${old.name} replaced`))
        }
        s.upsertProgram(p)
        for (const w of action.workouts) s.upsertWorkout(w)
        s.upsertEvents(action.events)
        s.addNotification({ kind: 'plan_ready', title: `${p.name} is ready`, body: `${p.weeks} weeks, ${p.daysPerWeek} days a week. First session ${formatShortDate(p.startDate)}.`, action: { label: 'View program', to: `/program/${p.id}` } })
        changes.push(change('PROGRAM_CREATED', ref('program', p.id, p.name), `${p.name}: ${p.weeks} weeks, ${p.daysPerWeek} days a week`))
        return ok({ summary: `Created ${p.name}: ${p.weeks} weeks, ${p.daysPerWeek} days a week, ${action.workouts.length} sessions on the calendar.`, entity: ref('program', p.id, p.name) }, changes, { references: [ref('program', p.id, p.name)] })
      }

      case 'cancel_program': {
        const p = s.programs[action.programId]
        if (!p) return fail('not_found', 'That program no longer exists.')
        if (p.status === 'cancelled') return ok({ summary: `${p.name} was already cancelled.`, entity: ref('program', p.id, p.name) }, [], { idempotent: true })
        s.updateProgram(p.id, { status: 'cancelled' })
        s.removeEventsForProgram(p.id, todayKey())
        return ok({ summary: `Cancelled ${p.name}; future sessions removed from the calendar.`, entity: ref('program', p.id, p.name) }, [change('PROGRAM_CANCELLED', ref('program', p.id, p.name), `${p.name} cancelled`)])
      }

      case 'create_nutrition_plan': {
        const p = action.plan
        if (!p?.id || !(p.calories > 0)) return fail('invalid_input', 'A nutrition plan needs a calorie target.')
        const exists = Boolean(s.nutritionPlans[p.id])
        s.upsertNutritionPlan(p)
        return ok({ summary: `Set today's targets to ${p.calories.toLocaleString()} kcal and ${p.proteinG} g protein.`, entity: ref('nutrition_plan', p.id) }, [change('NUTRITION_TARGET_UPDATED', ref('nutrition_plan', p.id), `${p.calories} kcal / ${p.proteinG} g protein for ${p.date}`)], { idempotent: exists, references: [ref('nutrition_plan', p.id)] })
      }

      case 'log_meal': {
        const m = action.meal
        if (!m?.id || !m.items?.length) return fail('invalid_input', 'A meal needs at least one food item.')
        if (!DAY.test(m.date)) return fail('invalid_input', 'A meal needs a valid date.')
        const existing = s.meals[m.id]
        s.upsertMeal(m)
        const label = `${m.name} (${m.calories} kcal)`
        if (existing) return ok({ summary: `Updated ${m.name}.`, entity: ref('meal', m.id, m.name) }, [change('MEAL_UPDATED', ref('meal', m.id, label), `${m.name} updated`)], { idempotent: true, references: [ref('meal', m.id, m.name)] })
        return ok({ summary: m.status === 'logged' ? `Logged ${m.name} to ${MEAL_SLOT_LABELS[m.slot].toLowerCase()}.` : `Estimated ${m.name} as a draft.`, entity: ref('meal', m.id, m.name) }, [change('MEAL_ADDED', ref('meal', m.id, label), `${m.name} ${m.status === 'logged' ? 'logged' : 'drafted'} for ${m.date}`)], { references: [ref('meal', m.id, m.name)] })
      }

      case 'update_meal': {
        const m = action.meal
        if (!s.meals[m?.id]) return fail('not_found', 'That meal no longer exists.')
        if (!m.items?.length) return fail('invalid_input', 'A meal needs at least one food item.')
        const before = s.meals[m.id]
        s.upsertMeal(m)
        const became = before.status !== 'logged' && m.status === 'logged'
        return ok({ summary: became ? `Logged ${m.name} to ${MEAL_SLOT_LABELS[m.slot].toLowerCase()}.` : `Updated ${m.name}.`, entity: ref('meal', m.id, m.name) }, [change(became ? 'MEAL_ADDED' : 'MEAL_UPDATED', ref('meal', m.id, `${m.name} (${m.calories} kcal)`), became ? `${m.name} logged` : `${m.name} updated`)], { references: [ref('meal', m.id, m.name)] })
      }

      case 'delete_meal': {
        const m = s.meals[action.mealId]
        if (!m) return fail('not_found', 'That meal was already removed.')
        s.deleteMeal(m.id)
        return ok({ summary: m.status === 'logged' ? `Removed ${m.name} from ${MEAL_SLOT_LABELS[m.slot].toLowerCase()}.` : `Discarded the ${m.name} estimate.`, entity: ref('meal', m.id, m.name) }, [change('MEAL_DELETED', ref('meal', m.id, m.name), `${m.name} removed`)])
      }

      case 'remember': {
        const item = action.item
        if (!item?.text || !isWorthRemembering(item.text)) return fail('invalid_input', 'There is nothing specific to remember there.')
        const subjects = item.subjects ?? memorySubjects(item.text)
        const duplicate = findDuplicateMemory(s.memory, { text: item.text, category: item.category, subjects })
        if (duplicate) {
          s.updateMemory(duplicate.id, { updatedAt: new Date().toISOString(), confidence: Math.max(duplicate.confidence ?? 0.8, item.confidence ?? 1) })
          return ok({ summary: `Already remembered: “${duplicate.text}”.`, entity: ref('memory', duplicate.id, duplicate.text) }, [], { idempotent: true })
        }
        const changes: DomainChange[] = []
        const conflicts = findConflictingMemories(s.memory, { text: item.text, category: item.category, subjects })
        for (const c of conflicts) {
          s.removeMemory(c.id)
          changes.push(change('MEMORY_REMOVED', ref('memory', c.id, c.text), `“${c.text}” replaced by newer information`))
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
        changes.push(change('MEMORY_SAVED', ref('memory', saved.id, saved.text), `Remembered “${saved.text}”`))
        return ok({ summary: conflicts.length ? `Remembered “${saved.text}” and dropped “${conflicts[0].text}”.` : `Remembered “${saved.text}”.`, entity: ref('memory', saved.id, saved.text) }, changes, { references: [ref('memory', saved.id, saved.text)] })
      }

      case 'forget': {
        const m = s.memory.find((x) => x.id === action.memoryId)
        if (!m) return fail('not_found', 'That memory was already removed.')
        s.removeMemory(m.id)
        return ok({ summary: `Forgot “${m.text}”.`, entity: ref('memory', m.id, m.text) }, [change('MEMORY_REMOVED', ref('memory', m.id, m.text), `Forgot “${m.text}”`)])
      }

      case 'set_goal': {
        const g = action.goal
        if (!g?.id || !g.type || !(g.type in GOAL_LABELS)) return fail('invalid_input', 'That goal is not recognised.')
        if (g.targetValue !== undefined && !(Number.isFinite(g.targetValue) && g.targetValue > 0)) return fail('invalid_input', 'The goal target must be a positive number.')
        const existing = s.goals.find((x) => x.id === g.id)
        const same = existing && existing.type === g.type && existing.targetValue === g.targetValue && existing.metric === g.metric && existing.rank === g.rank
        s.upsertGoal(g)
        const label = `${GOAL_LABELS[g.type]}${g.targetValue ? ` · ${g.targetValue} ${g.targetUnit ?? ''}`.trim() : ''}`
        if (same) return ok({ summary: `Goal unchanged: ${label}.`, entity: ref('goal', g.id, label) }, [], { idempotent: true })
        return ok({ summary: `${existing ? 'Updated' : 'Set'} ${g.rank} goal: ${label}.`, entity: ref('goal', g.id, label) }, [change(existing ? 'GOAL_UPDATED' : 'GOAL_CREATED', ref('goal', g.id, label), `${g.rank} goal ${existing ? 'updated to' : 'set to'} ${label}`)], { references: [ref('goal', g.id, label)] })
      }

      case 'delete_goal': {
        const g = s.goals.find((x) => x.id === action.goalId)
        if (!g) return fail('not_found', 'That goal no longer exists.')
        s.removeGoal(g.id)
        return ok({ summary: `Removed the goal ${GOAL_LABELS[g.type]}.`, entity: ref('goal', g.id, g.label) }, [change('GOAL_DELETED', ref('goal', g.id, g.label), `${g.label} removed`)])
      }

      case 'check_in': {
        const p = action.patch
        const scale = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 1 && v <= 10)
        if (!scale(p.fatigue) || !scale(p.energy) || !scale(p.soreness)) return fail('invalid_input', 'Fatigue, energy and soreness are rated from 1 to 10.')
        if (p.sleepHours !== undefined && !(p.sleepHours >= 0 && p.sleepHours <= 16)) return fail('invalid_input', 'Sleep hours must be between 0 and 16.')
        const date = todayKey()
        s.setCheckIn(date, p)
        const parts = [p.fatigue !== undefined && `fatigue ${p.fatigue}/10`, p.energy !== undefined && `energy ${p.energy}/10`, p.sleepHours !== undefined && `sleep ${p.sleepHours} h`, p.soreness !== undefined && `soreness ${p.soreness}/10`].filter(Boolean).join(', ')
        return ok({ summary: `Updated today's check-in (${parts || 'noted'}).`, entity: ref('check_in', date) }, [change('READINESS_UPDATED', ref('check_in', date), `Check-in: ${parts || 'updated'}`)])
      }

      case 'log_measurement': {
        const m = action.measurement
        if (!m || !Number.isFinite(m.value) || m.value <= 0) return fail('invalid_input', 'A measurement needs a positive value.')
        if (!DAY.test(m.date)) return fail('invalid_input', 'A measurement needs a valid date.')
        const dup = s.measurements.find((x) => x.type === m.type && x.date === m.date && x.value === m.value)
        if (dup) return ok({ summary: `${m.value} ${m.unit} was already logged for ${formatShortDate(fromDayKey(m.date))}.`, entity: ref('measurement', dup.id) }, [], { idempotent: true })
        s.addMeasurement(m)
        if (m.type === 'body_weight' && s.user) s.updateUser({ weightKg: m.value })
        const saved = useStore.getState().measurements.find((x) => x.type === m.type && x.date === m.date && x.value === m.value)
        return ok({ summary: `Logged ${m.type.replace('_', ' ')}: ${m.value} ${m.unit}.`, entity: ref('measurement', saved?.id ?? m.date) }, [change('MEASUREMENT_LOGGED', ref('measurement', saved?.id ?? m.date), `${m.type} ${m.value} ${m.unit} on ${m.date}`)])
      }

      case 'update_coach': {
        if (!action.patch || !Object.keys(action.patch).length) return fail('invalid_input', 'Nothing to change about the coach.')
        s.updateCoach(action.patch)
        return ok({ summary: action.patch.name ? `Coach renamed to ${action.patch.name}.` : 'Coach settings updated.', entity: ref('coach', 'coach') }, [change('COACH_UPDATED', ref('coach', 'coach'), Object.keys(action.patch).join(', '))])
      }

      case 'update_user': {
        if (!s.user) return fail('not_allowed', 'No profile yet.')
        if (!action.patch || !Object.keys(action.patch).length) return fail('invalid_input', 'Nothing to change in the profile.')
        if (action.patch.weightKg !== undefined && !(action.patch.weightKg > 20 && action.patch.weightKg < 400)) return fail('invalid_input', 'That body weight does not look right.')
        s.updateUser(action.patch)
        return ok({ summary: `Profile updated (${Object.keys(action.patch).join(', ')}).`, entity: ref('user', s.user.id) }, [change('PROFILE_UPDATED', ref('user', s.user.id), Object.keys(action.patch).join(', '))])
      }

      case 'update_availability': {
        if (!s.user) return fail('not_allowed', 'No profile yet.')
        const p = action.patch
        if (p.daysPerWeek !== undefined && !(p.daysPerWeek >= 1 && p.daysPerWeek <= 7)) return fail('invalid_input', 'Days per week must be between 1 and 7.')
        if (p.preferredDays && p.preferredDays.some((d) => d < 0 || d > 6)) return fail('invalid_input', 'Preferred days must be weekdays (0–6).')
        if (p.sessionMinutes !== undefined && !(p.sessionMinutes >= 10 && p.sessionMinutes <= 240)) return fail('invalid_input', 'Session length must be between 10 and 240 minutes.')
        const next = { ...s.user.availability, ...p }
        const same = JSON.stringify(next) === JSON.stringify(s.user.availability)
        if (same) return ok({ summary: 'Availability unchanged.', entity: ref('user', s.user.id) }, [], { idempotent: true })
        s.updateUser({ availability: next })
        return ok({ summary: `Availability set to ${next.daysPerWeek} days a week (${next.preferredDays.map((d) => weekdayName(new Date(2024, 0, 7 + d), true)).join(', ')}).`, entity: ref('user', s.user.id) }, [change('AVAILABILITY_UPDATED', ref('user', s.user.id), `${next.daysPerWeek} days/week: ${next.preferredDays.join(',')}`)])
      }

      case 'notify': {
        if (!action.title) return fail('invalid_input', 'A notification needs a title.')
        s.addNotification({ kind: 'insight', title: action.title, body: action.body })
        return ok({ summary: `Sent a note: ${action.title}.` }, [change('NOTIFICATION_SENT', ref('notification', action.title), action.title)])
      }
    }
  } catch (err) {
    return fail('failed', err instanceof Error ? err.message : 'Unexpected error while applying the action.')
  }
}

import { findExerciseByName } from '@/domain/exercises'
import type { EquipmentId, ExpectSlot, GoalType, Meal, WorkoutFocus } from '@/domain/types'
import { getLanguage } from '@/i18n/runtime'
import type { Language } from '@/i18n/types'
import { normalizeForMatching, straightenQuotes } from '@/lib/text'
import type { MealCorrection } from './food/foodAnalysis'
import { findFoodsInText } from './food/foodDatabase'
import { parseIntentFr, parseMealCorrectionsFr, splitClausesFr } from './intents.fr'
import { resolveTimeReference, type TimeFrame, type TimeMode } from './time'
import { parseWeekday } from '@/lib/dates'

export type Intent =
  | { kind: 'greeting' }
  | { kind: 'today_plan' }
  | { kind: 'tired'; scale?: number }
  | { kind: 'slept_badly'; hours?: number }
  | { kind: 'feeling_good' }
  | { kind: 'scale_answer'; value: number }
  | { kind: 'hours_answer'; value: number }
  | { kind: 'make_workout'; constraints: WorkoutConstraintsParsed }
  | { kind: 'modify_workout'; change: WorkoutChange }
  | { kind: 'start_workout' }
  | { kind: 'skip_workout' }
  | { kind: 'create_program'; weeks?: number; goalType?: GoalType; daysPerWeek?: number }
  | { kind: 'cancel_program' }
  | { kind: 'show_program' }
  | { kind: 'nutrition'; slot?: 'breakfast' | 'lunch' | 'dinner' | 'snack'; lowerCarb?: boolean }
  | { kind: 'restaurant' }
  | { kind: 'analyze_progress' }
  | { kind: 'weight_stalled' }
  | { kind: 'remember'; text: string }
  | { kind: 'forget'; text: string }
  | { kind: 'what_do_you_know' }
  | { kind: 'plan_week' }
  | { kind: 'reschedule'; from?: number; to?: number; toRelative?: 'tomorrow' | 'today'; fromRelative?: 'tomorrow' | 'today'; /** “Move that to Friday”: the session in conversation context. */ fromContext?: boolean }
  /** “What’s on Friday?”: what is planned or was done on the next occurrence of a weekday. */
  | { kind: 'weekday_plan'; weekday: number }
  | { kind: 'set_goal'; goalType?: GoalType; metric?: 'body_weight' | 'bench_press' | 'squat' | 'deadlift' | 'workouts_per_week' | 'steps_per_day'; target?: number }
  | { kind: 'log_weight'; kg: number }
  | { kind: 'pain'; area?: string; severe: boolean }
  | { kind: 'rename_coach'; name: string }
  | { kind: 'personality'; patch: { motivation?: number; tone?: number; humor?: number; communication?: number } }
  | { kind: 'attachment' }
  | { kind: 'attachment_context'; what: 'meal' | 'equipment' | 'plan' | 'progress_photo' | 'bloodwork' | 'other' }
  | { kind: 'thanks' }
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'help' }
  | { kind: 'time_answer'; minutes: number }
  | { kind: 'show_calendar' }
  | { kind: 'log_weight_prompt' }
  | { kind: 'meal_description'; text: string }
  | { kind: 'bloodwork_flag'; text: string }
  | { kind: 'equipment_list'; equipment: EquipmentId[] }
  | { kind: 'plan_choice'; choice: 'follow' | 'blend' | 'reference' }
  | { kind: 'order_advice' }
  | { kind: 'food_log'; text: string; slot?: Meal['slot'] }
  | { kind: 'meal_correction'; corrections: MealCorrection[] }
  | { kind: 'meal_commit'; slot?: Meal['slot'] }
  | { kind: 'meal_discard' }
  | { kind: 'eaten_today' }
  | { kind: 'remaining_nutrition'; macro?: 'protein' | 'calories' | 'carbs' | 'fat' }
  | { kind: 'menu_help'; options?: string[] }
  | { kind: 'availability'; days?: number[]; count?: number; scope: 'week' | 'always' }
  | { kind: 'finished_workout'; text: string }
  | { kind: 'goal_delta'; kg: number; direction: 'gain' | 'lose' }
  | { kind: 'dislike_exercise'; text: string }
  | { kind: 'goal_impact' }
  | { kind: 'tomorrow' }
  /** What happened / was planned / was eaten in a timeframe (“what did I do yesterday?”). */
  | { kind: 'day_report'; frame: TimeFrame; mode: TimeMode; domain: 'training' | 'food' | 'all' }
  | { kind: 'delete_workout'; when?: 'today' | 'tomorrow'; weekday?: number }
  | { kind: 'energy_report'; value: number }
  | { kind: 'unknown' }

export interface WorkoutConstraintsParsed {
  minutes?: number
  equipment?: EquipmentId[]
  noCardio?: boolean
  focus?: WorkoutFocus
  intensity?: 'light' | 'moderate' | 'hard'
  forDate?: 'today' | 'tomorrow'
}

export type WorkoutChange =
  | { type: 'shorter'; minutes?: number }
  | { type: 'longer'; minutes?: number }
  | { type: 'replace'; exerciseId?: string; query?: string }
  | { type: 'equipment'; equipment: EquipmentId[] }
  | { type: 'no_cardio' }
  | { type: 'lighter' }
  | { type: 'harder' }
  | { type: 'focus'; focus: WorkoutFocus }
  | { type: 'regenerate' }

/**
 * Word lists are bilingual (English + accent-folded French): the same structured
 * intent comes out whichever language the user writes in. Matching runs on
 * folded, lower-case text; displayed content is never folded.
 */
const EQUIPMENT_WORDS: Array<[RegExp, EquipmentId]> = [
  [/dumbbells?|db\b|halteres?/i, 'dumbbell'],
  [/barbell|\bbarre\b(?! de traction)|barre olympique/i, 'barbell'],
  [/kettlebells?|kb\b/i, 'kettlebell'],
  [/cables?|poulies?/i, 'cable'],
  [/machines?/i, 'machine'],
  [/bands?|elastiques?|bandes? (elastiques?|de resistance)/i, 'band'],
  [/pull[- ]?up bar|barre de traction|barre fixe/i, 'pullup_bar'],
  [/bench|\bbanc\b/i, 'bench'],
  [/bodyweight|body weight|no equipment|nothing|without equipment|hotel room|at home|poids du corps|poids de corps|sans materiel|sans equipement|rien du tout|a la maison|chambre d'hotel/i, 'bodyweight'],
]

const FOCUS_WORDS: Array<[RegExp, WorkoutFocus]> = [
  [/\bupper\b|haut du corps|\bhaut\b/i, 'upper'],
  [/\blower\b|bas du corps|\bbas\b/i, 'lower'],
  [/\bpush\b|poussee|pousser/i, 'push'],
  [/\bpull\b|tirage|tirer/i, 'pull'],
  [/\blegs?\b|jambes?|cuisses/i, 'legs'],
  [/full[- ]?body|corps entier|corps complet|tout le corps/i, 'full_body'],
  [/cardio|conditioning|hiit|intervals|engine|intervalles|fractionne|condition physique/i, 'conditioning'],
  [/mobility|stretch|core|mobilite|etirements?|gainage|abdos/i, 'core_mobility'],
  [/recovery|active recovery|recuperation|recup\b/i, 'recovery'],
]

const GOAL_WORDS: Array<[RegExp, GoalType]> = [
  [/muscle|hypertrophy|bulk|bigger|size|gain|masse|muscler|prise de masse|volume musculaire/i, 'build_muscle'],
  [/\bfat\b|lose weight|lean|\bcut\b|slim|shred|gras|graisse|perdre du poids|maigrir|secher|seche\b|mincir|affiner|perte de poids|perdre des kilos/i, 'lose_fat'],
  [/recomp/i, 'recomposition'],
  [/condition|cardio|fitness engine|hiit|souffle/i, 'conditioning'],
  [/strength|stronger|powerlift|\bforce\b|plus fort|plus forte|force athletique/i, 'strength'],
  [/consisten|habit|routine|regularite|regulier|reguliere|assidu/i, 'consistency'],
  [/mobility|flexib|mobilite|souplesse|souple/i, 'mobility'],
  [/endurance|marathon|\brun\b|running|courir|course a pied|semi/i, 'endurance'],
  [/general|overall|healthy|health|\bforme\b|sante|remise en forme|bien-etre|bien etre/i, 'general_fitness'],
]

export function parseMinutes(text: string): number | undefined {
  const t = normalizeForMatching(text)
  const m = t.match(/(\d{1,3})\s*(?:min|mins|minutes|mn\b|m\b)/)
  if (m) return Number(m[1])
  const hm = t.match(/(\d)\s*h\s*(\d{2})\b/)
  if (hm) return Number(hm[1]) * 60 + Number(hm[2])
  const h = t.match(/(\d(?:[.,]\d)?)\s*(?:hours?|hrs?|heures?|h\b)/)
  if (h) return Math.round(Number(h[1].replace(',', '.')) * 60)
  if (/half an hour|demi[- ]heure|demie heure/.test(t)) return 30
  if (/an hour|une heure/.test(t)) return 60
  if (/quarter of an hour|15 min|quart d'heure/.test(t)) return 15
  return undefined
}

export function parseEquipment(text: string): EquipmentId[] | undefined {
  const t = normalizeForMatching(text)
  const found: EquipmentId[] = []
  for (const [re, id] of EQUIPMENT_WORDS) if (re.test(t)) found.push(id)
  if (!found.length) return undefined
  if (found.includes('bodyweight') && found.length === 1) return ['bodyweight']
  return [...new Set(found)]
}

export function parseFocus(text: string): WorkoutFocus | undefined {
  const t = normalizeForMatching(text)
  for (const [re, f] of FOCUS_WORDS) if (re.test(t)) return f
  return undefined
}

export function parseGoalType(text: string): GoalType | undefined {
  const t = normalizeForMatching(text)
  for (const [re, g] of GOAL_WORDS) if (re.test(t)) return g
  return undefined
}

export function parseScale(text: string): number | undefined {
  const m = text.match(/\b(10|[1-9])\b(?:\s*(?:\/|out of|of|sur)\s*10)?/)
  return m ? Number(m[1]) : undefined
}

export function parseWeeks(text: string): number | undefined {
  const t = normalizeForMatching(text).replace(/\b(douze)\b/, '12').replace(/\b(huit)\b/, '8').replace(/\b(six)\b/, '6').replace(/\b(quatre)\b/, '4').replace(/\b(seize)\b/, '16')
  const m = t.match(/(\d{1,2})\s*[- ]?\s*(?:weeks?|semaines?|sem\b)/)
  if (m) return Number(m[1])
  const months = t.match(/(\d{1,2})\s*[- ]?\s*(?:months?|mois)/)
  if (months) return Number(months[1]) * 4
  if (/three months|quarter|trois mois|un trimestre/.test(t)) return 12
  return undefined
}

export function parseDaysPerWeek(text: string): number | undefined {
  const t = normalizeForMatching(text).replace(/\b(deux)\b/, '2').replace(/\b(trois)\b/, '3').replace(/\b(quatre)\b/, '4').replace(/\b(cinq)\b/, '5').replace(/\b(six)\b/, '6')
  const m = t.match(/(\d)\s*(?:x|times|days?|sessions?|fois|jours?|seances?)\s*(?:a|per|\/|par)\s*(?:week|semaine|sem\b)/)
  return m ? Number(m[1]) : undefined
}

export function parseKg(text: string): number | undefined {
  const m = text.match(/(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilos?|kilograms?|kilogrammes?)/i)
  return m ? Number(m[1].replace(',', '.')) : undefined
}

/**
 * Parse the user's message into an intent, using the slot the coach was waiting
 * on and the conversation topic so that "6" or "make it shorter" resolve correctly.
 */
export interface ParseOptions {
  expects?: ExpectSlot
  topic?: string
  hasAttachments?: boolean
  hasWorkout?: boolean
  /** A meal (draft or logged) is in conversational context. */
  hasMeal?: boolean
  lastAvailabilityScope?: 'week' | 'always'
  /** The user's selected language: its parser runs first, the other one is a fallback. */
  language?: Language
}

/**
 * USER MESSAGE → language-aware normalisation → intent understanding → one
 * structured Intent, whatever the language. The selected language's parser is
 * tried first; when it finds nothing the other language's parser gets a chance,
 * so a French user typing an English chip (or vice versa) is still understood.
 */
export function parseIntent(raw: string, opts: ParseOptions): Intent {
  const lang = opts.language ?? getLanguage()
  const primary = lang === 'fr' ? parseIntentFr : parseIntentEn
  const secondary = lang === 'fr' ? parseIntentEn : parseIntentFr
  const first = primary(raw, opts)
  if (first.kind !== 'unknown') return first
  const second = secondary(raw, opts)
  return second.kind !== 'unknown' ? second : first
}

/** The English parser. */
export function parseIntentEn(raw: string, opts: ParseOptions): Intent {
  const text = raw.trim()
  // Phone keyboards type curly apostrophes; every pattern below assumes the straight one.
  const t = straightenQuotes(text.toLowerCase())
  if (opts.hasAttachments && !t) return { kind: 'attachment' }

  // ---- Slot answers first: the coach asked a question and the user answered.
  if (opts.expects === 'fatigue_scale' || opts.expects === 'energy_scale') {
    const v = parseScale(t)
    if (v !== undefined && t.length < 40) return { kind: 'scale_answer', value: v }
  }
  if (opts.expects === 'sleep_hours') {
    const m = t.match(/(\d{1,2}(?:[.,]\d)?)/)
    if (m && t.length < 40) return { kind: 'hours_answer', value: Number(m[1].replace(',', '.')) }
  }
  if (opts.expects === 'time_available') {
    const mins = parseMinutes(t) ?? (t.match(/^\d{1,3}$/) ? Number(t) : undefined)
    if (mins) return { kind: 'time_answer', minutes: mins }
  }
  if (opts.expects === 'program_weeks') {
    const w = parseWeeks(t) ?? (t.match(/^\d{1,2}$/) ? Number(t) : undefined)
    if (w) return { kind: 'create_program', weeks: w, goalType: parseGoalType(t) }
  }
  if (opts.expects === 'coach_name' && t.length < 24 && !/\s{2,}/.test(t) && !/^(no|yes|ok)/.test(t)) {
    return { kind: 'rename_coach', name: text.replace(/^(call you|name you|you're|you are)\s+/i, '').replace(/[.!]$/, '') }
  }
  if (opts.expects === 'pain_location' && t.length < 60) {
    return { kind: 'pain', area: text, severe: /sharp|severe|can't|cannot|unbearable|swollen|numb/.test(t) }
  }
  if (opts.expects === 'weight_value') {
    const m = t.match(/(\d{2,3}(?:[.,]\d)?)/)
    if (m && t.length < 30) return { kind: 'log_weight', kg: Number(m[1].replace(',', '.')) }
  }
  if (opts.expects === 'goal_choice') {
    const g = parseGoalType(t)
    const kg = parseKg(t)
    if (/bench/.test(t)) return { kind: 'set_goal', metric: 'bench_press', target: Number(t.match(/(\d{2,3})/)?.[1]) || undefined }
    if (/squat/.test(t)) return { kind: 'set_goal', metric: 'squat', target: Number(t.match(/(\d{2,3})/)?.[1]) || undefined }
    if (/deadlift/.test(t)) return { kind: 'set_goal', metric: 'deadlift', target: Number(t.match(/(\d{2,3})/)?.[1]) || undefined }
    if (/workouts?|sessions?|times/.test(t) && /week/.test(t)) return { kind: 'set_goal', metric: 'workouts_per_week', target: Number(t.match(/(\d)/)?.[1]) || undefined }
    if (kg) return { kind: 'set_goal', metric: 'body_weight', target: kg, goalType: g }
    if (g) return { kind: 'set_goal', goalType: g }
  }
  if (opts.expects === 'goal_target') {
    const kg = parseKg(t) ?? (t.match(/^\s*(\d{1,3}(?:[.,]\d)?)\s*$/) ? Number(t.replace(',', '.')) : undefined)
    const perWeek = t.match(/(\d)\s*(?:per|a|\/)?\s*week/)
    if (perWeek) return { kind: 'set_goal', metric: 'workouts_per_week', target: Number(perWeek[1]) }
    if (kg) return { kind: 'set_goal', target: kg }
  }
  if (opts.expects === 'meal_description' && t.length > 2 && !/^(no|never mind|skip)/.test(t)) return { kind: 'meal_description', text }
  if (opts.expects === 'bloodwork_flag') return { kind: 'bloodwork_flag', text }
  if (opts.expects === 'equipment_list') {
    const equipment = parseEquipment(t) ?? (/full gym|everything|commercial/.test(t) ? (['barbell', 'dumbbell', 'cable', 'machine', 'bench', 'pullup_bar', 'cardio_machine', 'bodyweight'] as EquipmentId[]) : undefined)
    if (equipment) return { kind: 'equipment_list', equipment }
  }
  if (opts.expects === 'plan_choice') {
    if (/follow|as[- ]is|use it/.test(t)) return { kind: 'plan_choice', choice: 'follow' }
    if (/blend|mix|combine|with my goals/.test(t)) return { kind: 'plan_choice', choice: 'blend' }
    if (/reference|only|just keep/.test(t)) return { kind: 'plan_choice', choice: 'reference' }
  }

  if (opts.expects === 'meal_slot') {
    const slot = parseSlot(t)
    if (slot) return { kind: 'meal_commit', slot }
  }
  if (opts.expects === 'menu_options' && t.length > 3 && !/^(no|never mind|skip|nothing)/.test(t)) {
    return { kind: 'menu_help', options: splitOptions(text) }
  }
  if (opts.expects === 'finish_confirm') {
    if (/^(yes|yep|yeah|sure|do it|log it|ok)/.test(t)) return { kind: 'finished_workout', text: 'yes' }
    if (/^(no|nope|not yet|nah)/.test(t)) return { kind: 'no' }
  }

  // ---- Attachment follow-ups (only when the coach just asked what an attachment is)
  if (opts.expects === 'attachment_kind') {
    if (/(workout|session)/.test(t)) return { kind: 'today_plan' }
    if (/(meal|food|lunch|dinner|breakfast|plate|what i ate|diet)/.test(t)) return { kind: 'attachment_context', what: 'meal' }
    if (/(gym|equipment|home gym)/.test(t)) return { kind: 'attachment_context', what: 'equipment' }
    if (/(plan|program|programme|routine|spreadsheet)/.test(t)) return { kind: 'attachment_context', what: 'plan' }
    if (/(progress|physique|body)/.test(t)) return { kind: 'attachment_context', what: 'progress_photo' }
    if (/(blood|lab|test results|bloodwork)/.test(t)) return { kind: 'attachment_context', what: 'bloodwork' }
    if (/(something else|other|never mind|nothing)/.test(t)) return { kind: 'attachment_context', what: 'other' }
  }

  if (opts.hasAttachments) return { kind: 'attachment' }

  // ---- Safety first
  if (/\b(pain|hurts?|injur|strain|sprain|tweak|pulled|sore knee|sore back|sore shoulder|chest pain|dizzy|faint|numb)\b/.test(t) && !/no pain/.test(t)) {
    const severe = /sharp|severe|can'?t (walk|move|lift)|unbearable|swollen|numb|chest pain|dizzy|faint|shooting/.test(t)
    const area = t.match(/\b(knee|back|lower back|shoulder|neck|elbow|wrist|hip|ankle|hamstring|quad|calf|chest)\b/)?.[1]
    return { kind: 'pain', area, severe }
  }

  // ---- Food journal questions (before corrections, so a question never mutates the meal in context)
  // ---- Temporal reports: what happened vs what was planned, for a given period.
  const report = /\bwhat (did|have) i (do|done|train|trained|eat|eaten|had|have|log|logged)\b|\bwhat (was|were) (planned|scheduled|on the (plan|schedule|calendar))\b|\bwhat did i (do|eat|train)\b|\bhow did (yesterday|today|this week|last week|the week) go\b|\bwhat happened (yesterday|today|this week|last week)\b|\bdid i (train|work out|workout|eat well)\b/.test(t)
  if (report) {
    const time = resolveTimeReference(t) ?? { frame: 'today' as const, mode: /planned|scheduled|supposed|on the (plan|schedule)/.test(t) ? ('planned' as const) : ('did' as const) }
    const domain = /\b(eat|eaten|ate|food|meal|meals)\b/.test(t) ? 'food' : /\b(train|trained|workout|work out|session|lift)\b/.test(t) ? 'training' : 'all'
    if (!(time.frame === 'today' && domain === 'food' && time.mode === 'did')) return { kind: 'day_report', frame: time.frame, mode: time.mode, domain }
  }
  if (/\b(what|everything) (have|did) i (eat|eaten|had|have)\b|\bwhat i'?ve eaten\b|\bmy (food|meals|intake) (today|so far)\b|\beaten today\b/.test(t)) return { kind: 'eaten_today' }
  if (/\b(how (much|many)|what'?s?)\b.*\b(protein|calories|kcal|carbs|fat)\b.*\b(left|remaining|to go|have i got)\b|\b(remaining|left)\b.*\b(protein|calories|kcal|carbs|fat|for today)\b|\bhow (am i|'?m i) doing on (food|protein|calories|nutrition)|\bwhat (do|have) i (have |got )?left( to eat)?( today| tonight)?\??$|\bwhat'?s left (for |to eat )?(today|tonight)\b/.test(t)) {
    const macro = /protein/.test(t) ? 'protein' : /carb/.test(t) ? 'carbs' : /\bfat\b/.test(t) ? 'fat' : /calorie|kcal/.test(t) ? 'calories' : undefined
    return { kind: 'remaining_nutrition', macro }
  }
  if (/\b(what would you (choose|pick|order|go for)|what should i (choose|pick|go for)|help me (choose|pick|order)|which (one|dish|option))\b/.test(t)) {
    // Options can ride along in the same message: “…choose: salmon, pasta or a burger?”
    const inline = text.match(/(?::|—|–|\?|\bbetween\b|\bfrom\b)\s*(.+?)\??$/i)
    const options = inline ? splitOptions(inline[1]).filter((o) => findFoodsInText(o).length > 0) : []
    return { kind: 'menu_help', options: options.length >= 2 ? options : undefined }
  }

  // ---- Meal in context: corrections, commit, discard
  // “I had X” starts a new meal unless it is clearly an addition (“I also had…”).
  const startsNewMeal = /^(i )?(just )?(ate|had|have eaten|'?ve had|'?ve eaten)\b/.test(t) && !/\b(also|too|as well|on top|with it|to it|plus)\b/.test(t)
  // A correction must be about food: a known food, a portion word or a meal slot, and nothing about training, programs or goals.
  const mealish = findFoodsInText(t).length > 0 || /\b(half|third|quarter|double|twice|sauce|portion|plate|meal|breakfast|lunch|dinner|snack)\b/.test(t)
  const notMeal = /\b(workout|session|training|program|week|weeks|minutes?|goal|exercises?|sets?|weight|kg|calendar|tired|slept|direct|progress|mobility|cardio|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t)
  if (opts.hasMeal && !startsNewMeal) {
    if (/^(add|log|save|put)\b.*\b(it|this|that|the meal|meal)\b|^(log|add|save) it|^(looks|that'?s|it'?s) (right|correct|good|fine)|^(confirm|yes,? (log|add) it)/.test(t) || /^(add|log) (it |this |that )?(to|as) (my )?(breakfast|lunch|dinner|snack)/.test(t)) {
      return { kind: 'meal_commit', slot: parseSlot(t) }
    }
    if (/^(don'?t|do not) (log|add|save)|^(discard|forget|scrap|delete|remove) (it|this|that|the meal|that meal)|^never mind|^cancel (it|that|the meal)/.test(t)) return { kind: 'meal_discard' }
    if (mealish && !notMeal) {
      const corrections = parseMealCorrections(text)
      if (corrections.length) return { kind: 'meal_correction', corrections }
    }
  }

  // ---- Food journal: logging
  const foodLog = t.match(/^(?:i )?(?:just )?(?:ate|had|eat|have eaten|'?ve eaten|'?ve had|am eating|'?m eating|i'?m having|having|ate this|log(?:ged)?)\b\s*(?::)?\s*(.*)$/) ?? t.match(/^for (breakfast|lunch|dinner|(?:a )?snack)(?:,| i (?:had|ate))\s+(.*)$/) ?? t.match(/^(?:log|add|track) (?:my )?(breakfast|lunch|dinner|snack)\s*(?::|of|-)?\s*(.*)$/)
  if (foodLog) {
    const body = foodLog[2] ?? foodLog[1]
    const slot = parseSlot(t)
    const explicitEating = /^(?:i )?(?:just )?(?:ate|eaten|'?ve eaten|have eaten|am eating|'?m eating)\b/.test(t)
    const notFood = /\b(weight|workout|session|run|walk|steps|sleep|nap|rest|shower|meeting|day|time|minutes?|hours?)\b/.test(body ?? '')
    const mentionsFood = Boolean(body) && (findFoodsInText(body).length > 0 || Boolean(slot))
    if (body && body.length > 2 && !/^(this|it|that|my workout|my session)$/.test(body.trim()) && (explicitEating ? !/\b(weight|workout|session)\b/.test(body) : mentionsFood && !notFood)) return { kind: 'food_log', text: body, slot }
  }
  if (/^i ate this|^this is what i ate|^my (lunch|dinner|breakfast|meal)\b/.test(t)) return { kind: 'food_log', text: text, slot: parseSlot(t) }

  // ---- Finished a workout
  if (/\b(i )?(just )?(finished|done with|completed|wrapped up)\b.*\b(workout|session|training|lifting|gym)\b|\b(workout|session|training) (is )?(done|finished|complete)\b|^done training\b/.test(t) && !/haven'?t|not yet|didn'?t/.test(t)) return { kind: 'finished_workout', text }

  // ---- Availability (persistent vs this week)
  const dayList = t.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/g)
  if (dayList && dayList.length >= 2 && /\b(can|able to|available|free|train|workout|work out|gym)\b/.test(t) && !/move|reschedule|switch/.test(t)) {
    const days = [...new Set(dayList.map((d) => parseWeekday(d)).filter((d): d is number => d !== null))]
    const scope: 'week' | 'always' = /this week|next week|only this|just this/.test(t) ? 'week' : 'always'
    return { kind: 'availability', days, scope }
  }
  const countDays = t.match(/\b(i can|i'?ll|i will|i'?m able to|able to|can only|only)\s+(?:only )?(?:train|work ?out|do|manage|make)\s+(\d|one|two|three|four|five|six)\s+(?:days?|times?|sessions?)\b/) ?? t.match(/\b(\d|one|two|three|four|five|six)\s+(?:days?|times?|sessions?)\s+(?:a|per|this|next)\s+week\b/)
  if (countDays && /train|work ?out|session|day|gym|week/.test(t) && !/program|goal|target/.test(t)) {
    const n = wordToNumber(countDays[2] ?? countDays[1])
    // “this week” is a one-off; “four days a week / per week / from now on” is the standing schedule.
    if (n) return { kind: 'availability', count: n, scope: /this week|next week|only this/.test(t) ? 'week' : /always|usually|from now on|every week|going forward|\ba week\b|per week|\/\s*week|each week|weekly/.test(t) ? 'always' : opts.lastAvailabilityScope ?? 'week' }
  }
  if (opts.lastAvailabilityScope && /^(actually|no,?|hmm,?)?\s*(make it|let'?s (do|say)|change (it|that) to)\s+(\d|one|two|three|four|five|six)\b/.test(t)) {
    const n = wordToNumber(t.match(/(\d|one|two|three|four|five|six)\b/)![1])
    if (n) return { kind: 'availability', count: n, scope: opts.lastAvailabilityScope }
  }

  // ---- Goal deltas, dislikes, goal impact, tomorrow, energy
  const delta = t.match(/\b(gain|put on|add|lose|drop|shed)\s+(?:about |around |roughly )?(\d{1,2}(?:[.,]\d)?)\s*(?:kg|kilos?|kilograms?)\b/)
  if (delta && !/bench|squat|deadlift|bar\b/.test(t)) return { kind: 'goal_delta', kg: Number(delta[2].replace(',', '.')), direction: /gain|put on|add/.test(delta[1]) ? 'gain' : 'lose' }
  const dislike = t.match(/\b(?:i )?(?:hate|can'?t stand|don'?t like|dislike|never (?:give me|make me do|program)|no more|stop giving me|not a fan of)\s+([a-z][a-z\- ]{2,30}?)(?:\s+(?:please|today|anymore|again)|[.,!]|$)/)
  if (dislike && !/(this|it|that|the (plan|program|workout))$/.test(dislike[1].trim())) return { kind: 'dislike_exercise', text: dislike[1].trim() }
  // “I changed my goal” is a request to set it (handled by the goal block below); “how does that affect my plan” is the impact question.
  if (/\b(how does (that|this|it) (affect|change|impact)|what (changes|does that change|does that mean for)|does (that|this) change (my|the) plan|what am i training for|what'?s my goal|what is my goal|what are my goals|remind me (of )?my goal)\b/.test(t)) return { kind: 'goal_impact' }
  if (/^(what about|what'?s|and|how about)\s+(?:(?:on|up|planned|happening|scheduled)\s+(?:for\s+)?)?tomorrow\b|^tomorrow\??$|\btomorrow'?s (plan|workout|session)\b|what (am i|do i) (do|have|doing|training) tomorrow|\b(am i|do i) (train|training|working out|lifting) tomorrow/.test(t) && !/meal|eat|food/.test(t) && !/\b(move|reschedule|push|shift|delete|remove|cancel|skip)\b/.test(t)) {
    // “And tomorrow?” keeps the domain of what we were just talking about.
    if (opts.topic === 'nutrition' && /^(and|what about|how about)\s+tomorrow/.test(t)) return { kind: 'day_report', frame: 'tomorrow', mode: 'upcoming', domain: 'food' }
    return { kind: 'tomorrow' }
  }
  const energy = t.match(/\b(?:my )?energy (?:is |at |level )?(?:a |an )?(10|[1-9])(?:\s*(?:\/|out of|of)\s*10)?\b/)
  if (energy) return { kind: 'energy_report', value: Number(energy[1]) }

  // ---- Coach identity
  const rename = t.match(/(?:call you|name you|your name is|rename you(?: to)?|be called)\s+([a-z][a-z'-]{1,20})/i)
  if (rename) return { kind: 'rename_coach', name: capitalize(rename[1]) }
  if (/change your name|rename you|what should i call you/.test(t)) return { kind: 'rename_coach', name: '' }

  const personality = parsePersonality(t)
  if (personality) return { kind: 'personality', patch: personality }

  // ---- Memory
  const remember = text.match(/^(?:please\s+)?(?:remember|note|keep in mind|don'?t forget)(?: that)?[:,]?\s+(.+)/i)
  if (remember) return { kind: 'remember', text: remember[1].replace(/[.!]$/, '') }
  const forget = text.match(/^(?:please\s+)?forget(?: that| about)?[:,]?\s+(.+)/i)
  if (forget) return { kind: 'forget', text: forget[1] }
  if (/what do you (know|remember) about me|what have you learned|what do you know/.test(t)) return { kind: 'what_do_you_know' }

  // ---- Weight log
  const kg = parseKg(t)
  if (kg && /\b(weigh|weighed|weight is|i'?m at|scale|this morning|log)\b/.test(t) && !/goal|target|want to|get to|reach|bench|squat|deadlift/.test(t)) return { kind: 'log_weight', kg }
  if (/\b(log|record|track|enter)\b.*\bweight\b/.test(t) || /^weigh[- ]?in/.test(t)) return { kind: 'log_weight_prompt' }

  // ---- Goals
  const statesGoal = /\bi (want|would like|'d like|am trying|'m trying|need)\b/.test(t) && !/\d/.test(t) && parseGoalType(t) !== undefined && !/\b(workout|session|program|plan|eat|meal|minutes?|today|tomorrow)\b/.test(t)
  // “Actually, make that strength” / “change it to fat loss”: a change of mind about the goal just discussed.
  const changesGoal = /^(?:(?:actually|no|hmm|wait|ok),?)?\s*(?:make (?:that|it)|change (?:that|it) to|let'?s (?:do|say|go with)|switch (?:that|it) to|go with)\s+([a-z ]{3,30})[.!]?$/.exec(t)
  if (changesGoal && !opts.lastAvailabilityScope && parseGoalType(changesGoal[1]) !== undefined && !/\b(shorter|longer|lighter|harder|cardio|minutes?|upper|lower|legs?)\b/.test(changesGoal[1])) return { kind: 'set_goal', goalType: parseGoalType(changesGoal[1]) }
  if ((/\b(goal|target|aim|want to (reach|get to|hit|weigh|be)|my new goal)\b/.test(t) || statesGoal) && !/program|plan for|progress/.test(t)) {
    const metric = /bench/.test(t) ? 'bench_press' : /squat/.test(t) ? 'squat' : /deadlift/.test(t) ? 'deadlift' : /workouts?|sessions?|train/.test(t) && /week/.test(t) ? 'workouts_per_week' : /steps/.test(t) ? 'steps_per_day' : kg ? 'body_weight' : undefined
    const num = metric === 'workouts_per_week' ? parseDaysPerWeek(t) ?? Number(t.match(/(\d)\s*(?:workouts?|sessions?)/)?.[1]) : metric === 'steps_per_day' ? Number((t.match(/([\d,]{4,6})\s*steps/)?.[1] ?? '').replace(/,/g, '')) : kg ?? Number(t.match(/(\d{2,3})\s*(?:kg)?/)?.[1])
    return { kind: 'set_goal', goalType: parseGoalType(t), metric, target: Number.isFinite(num) && num ? num : undefined }
  }

  // ---- Programs
  if (/\b(program|programme|plan)\b/.test(t) && /\b(\d+|twelve|eight|six|four)[- ]?(week|month)|build me|create|make me|design|new program|start a program|rebuild|regenerate|redo|change my program|adjust my program|switch my program/.test(t)) {
    const weeks = parseWeeks(t.replace(/twelve/, '12').replace(/eight/, '8').replace(/six/, '6').replace(/four/, '4'))
    return { kind: 'create_program', weeks, goalType: parseGoalType(t), daysPerWeek: parseDaysPerWeek(t) }
  }
  if (/\b(cancel|stop|end|delete|drop)\b.*\bprogram/.test(t) || /\bprogram\b.*\b(cancel|stop)/.test(t)) return { kind: 'cancel_program' }
  if (/(show|open|view|see|where is|what'?s)\b.*\bprogram/.test(t) || /^my program/.test(t) || /^show me week \d/.test(t)) return { kind: 'show_program' }
  if (/(show|open|view|see)\b.*\b(calendar|schedule|my week)\b/.test(t) || /^(calendar|my calendar|my schedule)$/.test(t)) return { kind: 'show_calendar' }

  // ---- Calendar
  const move = t.match(/\b(move|switch|swap|reschedule|shift|change)\b.*?\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b.*?\b(?:to|for|→|->)\s*\b(mon|tue|wed|thu|fri|sat|sun|tomorrow|today)[a-z]*/)
  if (move) {
    const from = parseWeekday(move[2]) ?? undefined
    const toWord = move[3]
    return toWord.startsWith('tom') || toWord.startsWith('tod') ? { kind: 'reschedule', from, toRelative: toWord.startsWith('tom') ? 'tomorrow' : 'today' } : { kind: 'reschedule', from, to: parseWeekday(toWord) ?? undefined }
  }
  if (/^(?:can you |please )?(?:move|push|shift|reschedule)\s+(?:it|that|this|that one|this one)\s+(?:to\s+)?(?:another|a different|some other)\s+(?:day|date|time)/.test(t)) return { kind: 'reschedule', fromContext: true }
  const moveThat = t.match(/^(?:can you |please )?(?:move|push|shift|reschedule|switch)\s+(?:it|that|this|that one|this one)\s+(?:to|for|onto)\s+(tomorrow|today|mon|tue|wed|thu|fri|sat|sun)[a-z]*/)
  if (moveThat) {
    const w = moveThat[1]
    return w.startsWith('tom') || w.startsWith('tod') ? { kind: 'reschedule', fromContext: true, toRelative: w.startsWith('tom') ? 'tomorrow' : 'today' } : { kind: 'reschedule', fromContext: true, to: parseWeekday(w) ?? undefined }
  }
  const moveTodays = t.match(/\b(move|reschedule|push|shift)\b.*?\b(today'?s|tomorrow'?s|this|my)?\s*(workout|session)\b.*\b(to\s+)?(tomorrow|mon|tue|wed|thu|fri|sat|sun)[a-z]*/)
  if (moveTodays) {
    const w = moveTodays[5]
    const fromRelative = moveTodays[2]?.startsWith('tomorrow') ? ('tomorrow' as const) : undefined
    return w.startsWith('tom') ? { kind: 'reschedule', toRelative: 'tomorrow', fromRelative } : { kind: 'reschedule', to: parseWeekday(w) ?? undefined, fromRelative }
  }
  const weekdayPlan = t.match(/^(?:what'?s|what is|what do i have|what have i got|what'?s planned|what is planned|what'?s on)\s+(?:on\s+|for\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\??$/)
  if (weekdayPlan) return { kind: 'weekday_plan', weekday: parseWeekday(weekdayPlan[1]) ?? 1 }
  if (/\b(plan|organi[sz]e|schedule|map out|structure)\b.*\b(my |the |this )?week\b/.test(t) || /^(week plan|weekly plan)/.test(t)) return { kind: 'plan_week' }

  // ---- Progress
  if (/\b(why|what).*\b(weight|scale)\b.*\b(stopped|stuck|stall|plateau|not moving|isn'?t moving|won'?t move|same)\b/.test(t) || /plateau/.test(t)) return { kind: 'weight_stalled' }
  if (/\b(analy[sz]e|review|how am i doing|how'?s my|assess|check|look at)\b.*\b(progress|numbers|stats|results|going)\b/.test(t) || /^(progress|my progress|how am i doing|how am i progressing|am i progressing|am i making progress|how'?s (my|the) progress)/.test(t) || /how (did|have) i (do|done|been doing)|how was my (week|month)|how did that session go/.test(t)) return { kind: 'analyze_progress' }

  // ---- Nutrition
  if (/\b(what should i order|what to order|order|menu)\b/.test(t) && !/program/.test(t)) return { kind: 'order_advice' }
  if (/\b(restaurant|eating out|dinner out|going out for (dinner|food)|takeaway|take-out|takeout|party|wedding|birthday dinner)\b/.test(t)) return { kind: 'restaurant' }
  if (/\b(eat|food|meal|meals|nutrition|diet|calories|macros|protein|carbs?|breakfast|lunch|dinner|snack|hungry|cook)\b/.test(t)) {
    const slot = /breakfast/.test(t) ? 'breakfast' : /lunch/.test(t) ? 'lunch' : /dinner|tonight|evening/.test(t) ? 'dinner' : /snack/.test(t) ? 'snack' : undefined
    return { kind: 'nutrition', slot, lowerCarb: /low[- ]?carb|less carbs|fewer carbs/.test(t) }
  }

  // ---- Workout: start / skip
  if (/^(start|begin|let'?s go|go|let'?s start|start it|start the workout|start workout|i'?m ready|ready)\b/.test(t) && !/program/.test(t)) return { kind: 'start_workout' }
  if (/\b(delete|remove|cancel|drop|scrap)\b.*\b(workout|session|training)\b/.test(t) && !/program|plan\b|meal/.test(t)) {
    const dayWord = t.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/)?.[1]
    const weekday = dayWord ? parseWeekday(dayWord) : null
    return { kind: 'delete_workout', when: /\btomorrow/.test(t) ? 'tomorrow' : /\btoday|this one|it\b/.test(t) ? 'today' : undefined, weekday: weekday ?? undefined }
  }
  if (/\b(skip|not today|rest day|take today off|day off)\b/.test(t) && /(workout|session|today|it)/.test(t)) return { kind: 'skip_workout' }

  // ---- Workout: modifications (require a workout in context)
  if (opts.hasWorkout || opts.topic === 'workout') {
    const eqOnly = /\b(only|just)\b.*\b(dumbbells?|barbell|kettlebells?|bands?|bodyweight|machines?|cables?)\b|\b(dumbbells?|bodyweight|bands?|kettlebells?) only\b|\bi (only )?have (a |some )?(dumbbells?|kettlebell|bands?|barbell)/.test(t)
    if (eqOnly) {
      const equipment = parseEquipment(t)
      // “I only have 30 minutes and dumbbells”: two constraints at once → rebuild with both.
      if (equipment && parseMinutes(t) && /\b(only|just)\s+(have|got)\b/.test(t)) return { kind: 'make_workout', constraints: { minutes: parseMinutes(t), equipment } }
      if (equipment) return { kind: 'modify_workout', change: { type: 'equipment', equipment } }
    }
    if ((/\b(shorter|shorten|less time|quicker|faster|cut it down|trim|reduce)\b/.test(t) || (/\b(only have|just have|got)\b/.test(t) && parseMinutes(t))) && !/replace|swap/.test(t)) return { kind: 'modify_workout', change: { type: 'shorter', minutes: parseMinutes(t) } }
    if (/\b(longer|more time|extend|add more)\b/.test(t)) return { kind: 'modify_workout', change: { type: 'longer', minutes: parseMinutes(t) } }
    const rep = t.match(/\b(replace|swap|switch|change|remove|drop|no|skip|don'?t want|hate|can'?t do)\b\s+(?:the\s+|out\s+)?([a-z][a-z\- ]{2,30}?)(?:\s+(?:with|for|please|today)\b|[.,!?]|$)/)
    if (rep && !/workout|session|cardio|it$/.test(rep[2].trim())) {
      const ex = findExerciseByName(rep[2].trim())
      return { kind: 'modify_workout', change: { type: 'replace', exerciseId: ex?.id, query: rep[2].trim() } }
    }
    if (/\b(no|skip|without|don'?t want|drop|remove)\b.*\b(cardio|conditioning|intervals|running)\b/.test(t)) return { kind: 'modify_workout', change: { type: 'no_cardio' } }
    if (/\b(easier|lighter|less intense|tone it down|go easy|too hard|too much)\b/.test(t)) return { kind: 'modify_workout', change: { type: 'lighter' } }
    if (/\b(harder|heavier|more intense|push me|too easy|not enough)\b/.test(t)) return { kind: 'modify_workout', change: { type: 'harder' } }
    if (/\b(different|something else|another|regenerate|redo|new one|change (it|the workout|today'?s workout))\b/.test(t)) {
      const focus = parseFocus(t)
      return focus ? { kind: 'modify_workout', change: { type: 'focus', focus } } : { kind: 'modify_workout', change: { type: 'regenerate' } }
    }
  }

  // ---- Workout: generation
  if (/\b(workout|session|train|training|exercise|lift|routine|wod)\b/.test(t) && /\b(make|build|create|generate|give|plan|design|do|want|need|today|now|what should|suggest|new|quick|program me)\b/.test(t) && !/program\b/.test(t)) {
    return { kind: 'make_workout', constraints: parseWorkoutConstraints(t) }
  }
  if (/^(workout|make my workout|today'?s workout|build my workout|build today'?s workout)$/.test(t)) return { kind: 'make_workout', constraints: {} }
  if (/\b(plan|build|prep|prepare|set up)\b.*\btomorrow\b|^plan tomorrow/.test(t) && !/meal|eat|food/.test(t)) return { kind: 'make_workout', constraints: { forDate: 'tomorrow' } }
  if (/\b(i )?only have (\d+)|\bi have (\d+) ?min|\b(\d+) ?min(ute)?s? (today|only)|got (\d+) ?min|\b(give me|i want|make it|i need) (\d+) ?min/.test(t) && !/meal|eat/.test(t)) return { kind: 'make_workout', constraints: parseWorkoutConstraints(t) }
  if (/\b(mobility|stretching|stretch)\b/.test(t) && /\b(give me|just|instead|gentle|flow|session|a bit of|some|do)\b/.test(t) && !/program|meal/.test(t)) return { kind: 'make_workout', constraints: { ...parseWorkoutConstraints(t), focus: 'core_mobility', intensity: 'light', minutes: parseMinutes(t) ?? 20 } }
  if (/\b(i )?only have (dumbbells?|bands?|a kettlebell|bodyweight)|\bno gym\b|\bat home today\b|\bhotel gym\b/.test(t)) return { kind: 'make_workout', constraints: parseWorkoutConstraints(t) }

  // ---- Day state
  if (/\b(slept (badly|poorly|terribly|bad|like crap)|bad (night|sleep)|didn'?t sleep|no sleep|barely slept|rough night|poor sleep|up all night|insomnia)\b/.test(t)) {
    const h = t.match(/(\d(?:[.,]\d)?)\s*(?:hours?|hrs?|h\b)/)
    return { kind: 'slept_badly', hours: h ? Number(h[1].replace(',', '.')) : undefined }
  }
  if (/\b(tired|exhausted|drained|wiped|knackered|fatigued|low energy|no energy|sluggish|worn out|beat|dead)\b/.test(t)) {
    // “I'm exhausted today, 6 out of 10” carries its own rating.
    const inline = t.match(/\b(10|[1-9])\s*(?:\/|out of|on)\s*10\b/)
    return { kind: 'tired', scale: opts.expects === 'fatigue_scale' ? parseScale(t) : inline ? Number(inline[1]) : undefined }
  }
  if (/\b(feel(ing)? (great|amazing|strong|fresh|good|energi[sz]ed)|full of energy|ready to go|fired up|slept (great|well|amazing))\b/.test(t)) return { kind: 'feeling_good' }
  if (/\b(what should i do|what'?s (today|the plan|on today|next)|plan for today|today'?s plan|what do i do|what'?s up today|what are we doing)\b/.test(t) || /^(today|today\?)$/.test(t)) return { kind: 'today_plan' }

  // ---- Small talk
  if (/^(hi|hey|hello|yo|good (morning|afternoon|evening)|morning|evening|sup|hiya)\b/.test(t)) return { kind: 'greeting' }
  if (/^(thanks|thank you|cheers|ty|thx|appreciate it|perfect|great|awesome|nice|cool|love it)\b/.test(t)) return { kind: 'thanks' }
  if (/^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please|sounds good|let'?s do it|absolutely|y)\b/.test(t)) return { kind: 'yes' }
  if (/^(no|nope|nah|not now|later|no thanks|n)\b/.test(t)) return { kind: 'no' }
  if (/\b(what can you do|help|how does this work|what are you|who are you|capabilities)\b/.test(t)) return { kind: 'help' }

  return { kind: 'unknown' }
}

export function parseWorkoutConstraints(t: string): WorkoutConstraintsParsed {
  const c: WorkoutConstraintsParsed = {}
  const minutes = parseMinutes(t)
  if (minutes) c.minutes = Math.min(120, Math.max(10, minutes))
  const eq = parseEquipment(t)
  if (eq && /\b(only|just|have|with|using|at home|hotel|no gym)\b/.test(t)) c.equipment = eq
  if (/\bno cardio\b|without cardio|skip cardio/.test(t)) c.noCardio = true
  const focus = parseFocus(t)
  if (focus) c.focus = focus
  if (/\b(light|easy|gentle|recovery|chill)\b/.test(t)) c.intensity = 'light'
  if (/\b(hard|brutal|intense|heavy|crush|smash)\b/.test(t)) c.intensity = 'hard'
  if (/tomorrow/.test(t)) c.forDate = 'tomorrow'
  return c
}

function parsePersonality(t: string): { motivation?: number; tone?: number; humor?: number; communication?: number } | undefined {
  if (!/\b(be|talk|speak|sound|keep it|go|tone it|can you be|i want you|i'?d like you|you'?re too|you are too)\b/.test(t)) return undefined
  const p: { motivation?: number; tone?: number; humor?: number; communication?: number } = {}
  if (/\b(more direct|blunt|straight|no fluff|less soft|harsher|tougher)\b/.test(t)) p.tone = 85
  if (/\b(gentler|softer|kinder|nicer|less harsh|less direct|too harsh|too blunt)\b/.test(t)) p.tone = 15
  if (/\b(more intense|hype me|push me harder|fire me up|more motivat|pump me)\b/.test(t)) p.motivation = 88
  if (/\b(calmer|chill|relax|less intense|too intense|tone it down|less hype)\b/.test(t)) p.motivation = 15
  if (/\b(funnier|more fun|more jokes|playful|lighten up|be funny)\b/.test(t)) p.humor = 85
  if (/\b(serious|no jokes|less jokes|fewer jokes|stop joking|too silly)\b/.test(t)) p.humor = 8
  if (/\b(shorter answers|concise|brief|less talk|too long|keep it short|less detail|too wordy)\b/.test(t)) p.communication = 12
  if (/\b(more detail|explain more|longer answers|elaborate|more context|why)\b/.test(t) && /\b(more detail|explain more|longer|elaborate|more context)\b/.test(t)) p.communication = 88
  return Object.keys(p).length ? p : undefined
}


/** Meal slot from English or French words (“lunch”, “au déjeuner”, “ce soir”). */
export function parseSlot(t: string): Meal['slot'] | undefined {
  const s = normalizeForMatching(t)
  if (/\bbreakfast\b|petit[- ]dej(?:euner)?\b|\bpetit dej\b|\bau reveil\b|\ble matin\b|\bce matin\b/.test(s)) return 'breakfast'
  if (/\blunch\b|\bdejeuner\b|\bce midi\b|\ba midi\b|\ble midi\b/.test(s)) return 'lunch'
  if (/\bdinner\b|\btonight\b|\bsupper\b|\bdiner\b|\bce soir\b|\ble soir\b|\bsouper\b/.test(s)) return 'dinner'
  if (/\bsnack\b|\bcollation\b|\bgouter\b|\bencas\b|\ben-cas\b/.test(s)) return 'snack'
  if (/\bpre[- ]?workout\b|\bavant (la |ma |l')?(seance|entrainement|sport)\b|\bpre[- ]?seance\b/.test(s)) return 'pre_workout'
  if (/\bpost[- ]?workout\b|\bafter (my |the )?workout\b|\bapres (la |ma |l')?(seance|entrainement|sport)\b|\bpost[- ]?seance\b/.test(s)) return 'post_workout'
  return undefined
}

export function wordToNumber(w: string): number | undefined {
  const map: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, zero: 0 }
  if (/^\d$/.test(w)) return Number(w)
  return map[normalizeForMatching(w)]
}

/** Split “salmon with rice, chicken pasta or a burger and fries” into dishes; “and” only separates inside a comma list. */
function splitOptions(text: string): string[] {
  const body = text
    .replace(/^.*?(?:what would you (?:choose|pick|order|go for)|what should i (?:choose|pick|go for)|help me (?:choose|pick|order)|which (?:one|dish|option))\??\s*(?::|—|–|between|from)?\s*/i, '')
    .replace(/\?+$/, '')
  const chunks = body.split(/,|\bor\b|\n|;|\//i)
  // “salmon, pasta and burger” is three dishes; “pasta or a burger and fries” keeps “burger and fries” together.
  const parts = body.includes(',') && !/\bor\b/i.test(body) ? chunks.flatMap((c) => c.split(/\band\b/i)) : chunks
  return parts
    .map((s) => s.replace(/^(the|a|an|maybe|either)\s+/i, '').trim())
    .filter((s) => s.length > 2)
    .slice(0, 6)
}

/** Parse natural corrections to a meal in context, in either language. Order-preserving; several can stack. */
export function parseMealCorrections(raw: string, language: Language = getLanguage()): MealCorrection[] {
  const primary = language === 'fr' ? parseMealCorrectionsFr : parseMealCorrectionsEn
  const secondary = language === 'fr' ? parseMealCorrectionsEn : parseMealCorrectionsFr
  const first = primary(raw)
  return first.length ? first : secondary(raw)
}

export function parseMealCorrectionsEn(raw: string): MealCorrection[] {
  const t = raw.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[.!]+$/, '')
  const out: MealCorrection[] = []
  const slot = parseSlot(t)
  if (slot && /\b(was|is|it'?s|make it|actually|not lunch|not dinner|not breakfast|this was|that was|log (it )?as|count (it )?as)\b/.test(t) && !/^(add|log|save)/.test(t)) out.push({ type: 'slot', slot })
  // Portion of the whole meal
  const half = t.match(/\b(only )?(ate|had|finished|eat)\s+(about |around |roughly )?(half|a half|a third|two thirds|three quarters|a quarter|most|all)\b/) ?? t.match(/^(only )?(half|a third|two thirds|three quarters|a quarter)( of it| of that| of this)?$/)
  if (half) {
    const w = half[4] ?? half[2]
    const factor = /half/.test(w) ? 0.5 : /two thirds/.test(w) ? 0.67 : /third/.test(w) ? 0.33 : /three quarters/.test(w) ? 0.75 : /quarter/.test(w) ? 0.25 : /most/.test(w) ? 0.8 : 1
    if (factor !== 1) out.push({ type: 'scale', factor })
  }
  if (/\b(double|twice) (that|it|the portion|as much)\b|\bi had two of (these|those|them)\b/.test(t)) out.push({ type: 'scale', factor: 2 })
  // Explicit grams: "200g of rice", "the rice was 200g", "rice 200 g"
  const gramsRe = /(\d{2,4})\s?(?:g|gr|grams?)\s+(?:of\s+)?([a-z][a-z ]{2,25}?)(?=$|,|\band\b|\bnot\b|\.)|([a-z][a-z ]{2,25}?)\s+(?:was|were|is|are)\s+(?:about |around |roughly |more like )?(\d{2,4})\s?(?:g|gr|grams?)\b/g
  let m: RegExpExecArray | null
  while ((m = gramsRe.exec(t))) {
    const grams = Number(m[1] ?? m[4])
    const food = (m[2] ?? m[3]).replace(/^(the|of|my)\s+/, '').trim()
    if (grams && food) out.push({ type: 'set_grams', food, grams })
  }
  // Counts: "there were two chicken breasts", "3 eggs", "two slices of bread"
  const countRe = /\b(?:there (?:were|was)|it was|i had|i ate|had)?\s*(\d|one|two|three|four|five|six)\s+(?:(?:big|large|small|whole)\s+)?(?:(?:slices?|pieces?|cups?|bowls?|scoops?|glasses|fillets?) of\s+)?([a-z][a-z ]{2,25}?)(?=s?\b(?:,|$|\band\b|\bnot\b))/g
  while ((m = countRe.exec(t))) {
    const count = wordToNumber(m[1])
    const food = m[2].trim()
    if (!count || /^(g|gr|grams?|kg|ml|minutes?|hours?|of)$/.test(food)) continue
    if (out.some((c) => c.type === 'set_grams' && c.food === food)) continue
    out.push({ type: 'set_count', food, count })
  }
  // Remove: "no sauce", "remove the cheese", "without the sauce", "take out the rice", "skip the bread", "there was no sauce"
  const removeRe = /\b(?:no|without|remove|take out|take off|drop|skip|minus|forget|delete|wasn'?t any|there was no|there wasn'?t)\s+(?:the |any |that )?([a-z][a-z ]{2,25}?)(?=$|,|\band\b|\bthough\b|\bactually\b|\.)/g
  while ((m = removeRe.exec(t))) {
    const food = m[1].trim()
    if (/^(sauce|cheese|rice|bread|oil|butter|dressing|mayo|fries|chips|dessert|potato|potatoes|pasta|salad|veg|vegetables|avocado|egg|eggs|beans|chicken|salmon|nuts|honey|sugar|cream|wine|beer|juice|milk|bacon|ham|tomato|tomatoes)$/.test(food) || out.length === 0) {
      if (!/^(it|this|that|the meal|meal|lunch|dinner|breakfast)$/.test(food)) out.push({ type: 'remove', food })
    }
  }
  // More / less: "more rice", "there was more rice", "less sauce", "not that much rice", "bigger portion of rice"
  const moreRe = /\b(?:there was |it had |with |i had )?(more|less|fewer|extra|bigger|smaller|a lot more|way more|a bit more|a bit less|much more|much less|barely any|hardly any|not (?:that |so )?much|double the|half the)\s+(?:portion of |of )?([a-z][a-z ]{2,25}?)(?=$|,|\band\b|\bthan\b|\bthough\b|\.)/g
  while ((m = moreRe.exec(t))) {
    const word = m[1]
    const food = m[2].replace(/^the\s+/, '').trim()
    if (out.some((c) => (c.type === 'set_grams' || c.type === 'set_count' || c.type === 'remove') && c.food === food)) continue
    const isLess = /less|fewer|smaller|barely|hardly|not|half/.test(word)
    const factor = /a lot|way|much|double/.test(word) ? (isLess ? 0.5 : 2) : /a bit/.test(word) ? (isLess ? 0.8 : 1.25) : isLess ? 0.6 : 1.5
    out.push(isLess ? { type: 'less', food, factor } : { type: 'more', food, factor })
  }
  // Add: "add an egg", "there was also cheese", "plus a beer", "and a slice of bread", "with cheese"
  const addRe = /(?:^|\b)(?:add|plus|also had|there was also|also|and also|with)\s+(?:an? |some |the )?([a-z][a-z ]{2,30}?)(?=$|,|\.|\band\b)/g
  while ((m = addRe.exec(t))) {
    const food = m[1].trim()
    if (/^(it|this|that|to (my )?(lunch|dinner|breakfast|snack)|the meal|meal|sauce on the side)$/.test(food)) continue
    if (out.some((c) => c.type !== 'slot' && c.type !== 'scale' && c.type !== 'add' && c.food === food)) continue
    if (/^(more|less)\b/.test(food)) continue
    out.push({ type: 'add', text: food })
  }
  return out
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/* ------------------------------------------------------------------ Compound requests */

export interface CompoundPart {
  text: string
  intent: Intent
}

/** Intents that make sense as one step of a multi-part request, with their execution order. */
const COMPOUND_ORDER: Partial<Record<Intent['kind'], number>> = {
  set_goal: 1,
  goal_delta: 1,
  availability: 2,
  remember: 3,
  personality: 3,
  rename_coach: 3,
  dislike_exercise: 3,
  log_weight: 4,
  tired: 4,
  slept_badly: 4,
  energy_report: 4,
  make_workout: 5,
  modify_workout: 5,
  create_program: 6,
  nutrition: 7,
  food_log: 7,
  reschedule: 8,
  plan_week: 8,
}

/**
 * Split “I want to build muscle, train four days a week, and create a 12-week
 * program” into ordered parts. Returns undefined unless at least two distinct
 * actionable requests are found, so ordinary sentences are never chopped up.
 */
export function splitCompound(text: string, opts: ParseOptions): CompoundPart[] | undefined {
  if (opts.expects) return undefined
  const lang = opts.language ?? getLanguage()
  const clauses = (lang === 'fr' ? splitClausesFr(text) : splitClausesEn(text)).map((c) => c.trim()).filter((c) => c.length > 2)
  if (clauses.length < 2) return undefined
  const parts: CompoundPart[] = []
  for (const clause of clauses) {
    const intent = parseIntent(clause, { topic: opts.topic, language: lang })
    const order = COMPOUND_ORDER[intent.kind]
    if (order === undefined) continue
    if (parts.some((p) => p.intent.kind === intent.kind)) continue
    parts.push({ text: clause, intent })
  }
  if (parts.length < 2) return undefined
  return parts.sort((a, b) => (COMPOUND_ORDER[a.intent.kind] ?? 9) - (COMPOUND_ORDER[b.intent.kind] ?? 9))
}

function splitClausesEn(text: string): string[] {
  return text.split(/\s*[,;]\s*(?:and\s+|then\s+)?|\s+and\s+(?:then\s+)?(?=i\b|i'|train|create|make|plan|build|remember|set|log|give|move|call|be\b|eat|only|also|my|make|a\b|an\b|the\b)|\s+then\s+/i)
}

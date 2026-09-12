import { findExerciseByName } from '@/domain/exercises'
import type { EquipmentId, ExpectSlot, GoalType, WorkoutFocus } from '@/domain/types'
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
  | { kind: 'reschedule'; from?: number; to?: number; toRelative?: 'tomorrow' | 'today' }
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

const EQUIPMENT_WORDS: Array<[RegExp, EquipmentId]> = [
  [/dumbbells?|db\b/i, 'dumbbell'],
  [/barbell/i, 'barbell'],
  [/kettlebells?|kb\b/i, 'kettlebell'],
  [/cables?/i, 'cable'],
  [/machines?/i, 'machine'],
  [/bands?/i, 'band'],
  [/pull[- ]?up bar/i, 'pullup_bar'],
  [/bench/i, 'bench'],
  [/bodyweight|body weight|no equipment|nothing|without equipment|hotel room|at home/i, 'bodyweight'],
]

const FOCUS_WORDS: Array<[RegExp, WorkoutFocus]> = [
  [/\bupper\b/i, 'upper'],
  [/\blower\b/i, 'lower'],
  [/\bpush\b/i, 'push'],
  [/\bpull\b/i, 'pull'],
  [/\blegs?\b/i, 'legs'],
  [/full[- ]?body/i, 'full_body'],
  [/cardio|conditioning|hiit|intervals|engine/i, 'conditioning'],
  [/mobility|stretch|core/i, 'core_mobility'],
  [/recovery|active recovery/i, 'recovery'],
]

const GOAL_WORDS: Array<[RegExp, GoalType]> = [
  [/muscle|hypertrophy|bulk|bigger|size|gain/i, 'build_muscle'],
  [/fat|lose weight|lean|cut|slim|shred/i, 'lose_fat'],
  [/recomp/i, 'recomposition'],
  [/condition|cardio|fitness engine|hiit/i, 'conditioning'],
  [/strength|stronger|powerlift/i, 'strength'],
  [/consisten|habit|routine/i, 'consistency'],
  [/mobility|flexib/i, 'mobility'],
  [/endurance|marathon|run/i, 'endurance'],
  [/general|overall|healthy|health/i, 'general_fitness'],
]

export function parseMinutes(text: string): number | undefined {
  const m = text.match(/(\d{1,3})\s*(?:min|mins|minutes|m\b)/i)
  if (m) return Number(m[1])
  const h = text.match(/(\d(?:[.,]\d)?)\s*(?:hours?|hrs?|h\b)/i)
  if (h) return Math.round(Number(h[1].replace(',', '.')) * 60)
  if (/half an hour/i.test(text)) return 30
  if (/an hour/i.test(text)) return 60
  if (/quarter of an hour|15 min/i.test(text)) return 15
  return undefined
}

export function parseEquipment(text: string): EquipmentId[] | undefined {
  const found: EquipmentId[] = []
  for (const [re, id] of EQUIPMENT_WORDS) if (re.test(text)) found.push(id)
  if (!found.length) return undefined
  if (found.includes('bodyweight') && found.length === 1) return ['bodyweight']
  return [...new Set(found)]
}

function parseFocus(text: string): WorkoutFocus | undefined {
  for (const [re, f] of FOCUS_WORDS) if (re.test(text)) return f
  return undefined
}

export function parseGoalType(text: string): GoalType | undefined {
  for (const [re, g] of GOAL_WORDS) if (re.test(text)) return g
  return undefined
}

function parseScale(text: string): number | undefined {
  const m = text.match(/\b(10|[1-9])\b(?:\s*(?:\/|out of|of)\s*10)?/)
  return m ? Number(m[1]) : undefined
}

function parseWeeks(text: string): number | undefined {
  const m = text.match(/(\d{1,2})\s*[- ]?\s*weeks?/i)
  if (m) return Number(m[1])
  const months = text.match(/(\d{1,2})\s*[- ]?\s*months?/i)
  if (months) return Number(months[1]) * 4
  if (/three months|quarter/i.test(text)) return 12
  return undefined
}

function parseDaysPerWeek(text: string): number | undefined {
  const m = text.match(/(\d)\s*(?:x|times|days?|sessions?)\s*(?:a|per|\/)\s*week/i)
  return m ? Number(m[1]) : undefined
}

function parseKg(text: string): number | undefined {
  const m = text.match(/(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilos?|kilograms?)/i)
  return m ? Number(m[1].replace(',', '.')) : undefined
}

/**
 * Parse the user's message into an intent, using the slot the coach was waiting
 * on and the conversation topic so that "6" or "make it shorter" resolve correctly.
 */
export function parseIntent(raw: string, opts: { expects?: ExpectSlot; topic?: string; hasAttachments?: boolean; hasWorkout?: boolean }): Intent {
  const text = raw.trim()
  const t = text.toLowerCase()
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

  // ---- Attachment follow-ups (only when the coach just asked what an attachment is)
  if (opts.expects === 'attachment_kind') {
    if (/(meal|food|lunch|dinner|breakfast|plate|what i ate|diet)/.test(t)) return { kind: 'attachment_context', what: /diet plan/.test(t) ? 'meal' : 'meal' }
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

  // ---- Coach identity
  const rename = t.match(/(?:call you|name you|your name is|rename you(?: to)?|be called)\s+([a-z][a-z'\-]{1,20})/i)
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
  if (kg && /\b(weigh|weighed|weight is|i'?m at|scale|this morning)\b/.test(t) && !/goal|target|want to|get to|reach|bench|squat|deadlift/.test(t)) return { kind: 'log_weight', kg }

  // ---- Goals
  if (/\b(goal|target|aim|want to (reach|get to|hit|weigh|be)|my new goal)\b/.test(t) && !/program|plan for|progress/.test(t)) {
    const metric = /bench/.test(t) ? 'bench_press' : /squat/.test(t) ? 'squat' : /deadlift/.test(t) ? 'deadlift' : /workouts?|sessions?|train/.test(t) && /week/.test(t) ? 'workouts_per_week' : /steps/.test(t) ? 'steps_per_day' : kg ? 'body_weight' : undefined
    const num = metric === 'workouts_per_week' ? parseDaysPerWeek(t) ?? Number(t.match(/(\d)\s*(?:workouts?|sessions?)/)?.[1]) : metric === 'steps_per_day' ? Number((t.match(/([\d,]{4,6})\s*steps/)?.[1] ?? '').replace(/,/g, '')) : kg ?? Number(t.match(/(\d{2,3})\s*(?:kg)?/)?.[1])
    return { kind: 'set_goal', goalType: parseGoalType(t), metric, target: Number.isFinite(num) && num ? num : undefined }
  }

  // ---- Programs
  if (/\b(program|programme|plan)\b/.test(t) && /\b(\d+|twelve|eight|six|four)[- ]?(week|month)|build me|create|make me|design|new program|start a program/.test(t)) {
    const weeks = parseWeeks(t.replace(/twelve/, '12').replace(/eight/, '8').replace(/six/, '6').replace(/four/, '4'))
    return { kind: 'create_program', weeks, goalType: parseGoalType(t), daysPerWeek: parseDaysPerWeek(t) }
  }
  if (/\b(cancel|stop|end|delete|drop)\b.*\bprogram/.test(t) || /\bprogram\b.*\b(cancel|stop)/.test(t)) return { kind: 'cancel_program' }
  if (/(show|open|view|see|where is|what'?s)\b.*\bprogram/.test(t) || /^my program/.test(t)) return { kind: 'show_program' }

  // ---- Calendar
  const move = t.match(/\b(move|switch|swap|reschedule|shift|change)\b.*?\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b.*?\b(?:to|for|→|->)\s*\b(mon|tue|wed|thu|fri|sat|sun|tomorrow|today)[a-z]*/)
  if (move) {
    const from = parseWeekday(move[2]) ?? undefined
    const toWord = move[3]
    return toWord.startsWith('tom') || toWord.startsWith('tod') ? { kind: 'reschedule', from, toRelative: toWord.startsWith('tom') ? 'tomorrow' : 'today' } : { kind: 'reschedule', from, to: parseWeekday(toWord) ?? undefined }
  }
  const moveTodays = t.match(/\b(move|reschedule|push|shift)\b.*\b(today'?s|this|my)?\s*(workout|session)\b.*\b(to\s+)?(tomorrow|mon|tue|wed|thu|fri|sat|sun)[a-z]*/)
  if (moveTodays) {
    const w = moveTodays[5]
    return w.startsWith('tom') ? { kind: 'reschedule', toRelative: 'tomorrow' } : { kind: 'reschedule', to: parseWeekday(w) ?? undefined }
  }
  if (/\b(plan|organi[sz]e|schedule|map out|structure)\b.*\b(my |the |this )?week\b/.test(t) || /^(week plan|weekly plan)/.test(t)) return { kind: 'plan_week' }

  // ---- Progress
  if (/\b(why|what).*\b(weight|scale)\b.*\b(stopped|stuck|stall|plateau|not moving|isn'?t moving|won'?t move|same)\b/.test(t) || /plateau/.test(t)) return { kind: 'weight_stalled' }
  if (/\b(analy[sz]e|review|how am i doing|how'?s my|assess|check|look at)\b.*\b(progress|numbers|stats|results|going)\b/.test(t) || /^(progress|my progress|how am i doing|am i progressing|am i making progress)/.test(t)) return { kind: 'analyze_progress' }

  // ---- Nutrition
  if (/\b(restaurant|eating out|dinner out|going out for (dinner|food)|takeaway|take-out|takeout|party|wedding|birthday dinner)\b/.test(t)) return { kind: 'restaurant' }
  if (/\b(eat|food|meal|meals|nutrition|diet|calories|macros|protein|breakfast|lunch|dinner|snack|hungry|cook)\b/.test(t)) {
    const slot = /breakfast/.test(t) ? 'breakfast' : /lunch/.test(t) ? 'lunch' : /dinner|tonight|evening/.test(t) ? 'dinner' : /snack/.test(t) ? 'snack' : undefined
    return { kind: 'nutrition', slot, lowerCarb: /low[- ]?carb|less carbs|fewer carbs/.test(t) }
  }

  // ---- Workout: start / skip
  if (/^(start|begin|let'?s go|go|let'?s start|start it|start the workout|start workout|i'?m ready|ready)\b/.test(t) && !/program/.test(t)) return { kind: 'start_workout' }
  if (/\b(skip|not today|rest day|take today off|day off)\b/.test(t) && /(workout|session|today|it)/.test(t)) return { kind: 'skip_workout' }

  // ---- Workout: modifications (require a workout in context)
  if (opts.hasWorkout || opts.topic === 'workout') {
    const eqOnly = /\b(only|just)\b.*\b(dumbbells?|barbell|kettlebells?|bands?|bodyweight|machines?|cables?)\b|\b(dumbbells?|bodyweight|bands?|kettlebells?) only\b|\bi (only )?have (a |some )?(dumbbells?|kettlebell|bands?|barbell)/.test(t)
    if (eqOnly) {
      const equipment = parseEquipment(t)
      if (equipment) return { kind: 'modify_workout', change: { type: 'equipment', equipment } }
    }
    if ((/\b(shorter|less time|quicker|faster|cut it down|trim|reduce)\b/.test(t) || (/\b(only have|just have|got)\b/.test(t) && parseMinutes(t))) && !/replace|swap/.test(t)) return { kind: 'modify_workout', change: { type: 'shorter', minutes: parseMinutes(t) } }
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
  if (/\b(i )?only have (\d+)|\bi have (\d+) ?min|\b(\d+) ?min(ute)?s? (today|only)|got (\d+) ?min/.test(t)) return { kind: 'make_workout', constraints: parseWorkoutConstraints(t) }
  if (/\b(i )?only have (dumbbells?|bands?|a kettlebell|bodyweight)|\bno gym\b|\bat home today\b|\bhotel gym\b/.test(t)) return { kind: 'make_workout', constraints: parseWorkoutConstraints(t) }

  // ---- Day state
  if (/\b(slept (badly|poorly|terribly|bad|like crap)|bad (night|sleep)|didn'?t sleep|no sleep|barely slept|rough night|poor sleep|up all night|insomnia)\b/.test(t)) {
    const h = t.match(/(\d(?:[.,]\d)?)\s*(?:hours?|hrs?|h\b)/)
    return { kind: 'slept_badly', hours: h ? Number(h[1].replace(',', '.')) : undefined }
  }
  if (/\b(tired|exhausted|drained|wiped|knackered|fatigued|low energy|no energy|sluggish|worn out|beat|dead)\b/.test(t)) return { kind: 'tired', scale: opts.expects === 'fatigue_scale' ? parseScale(t) : undefined }
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

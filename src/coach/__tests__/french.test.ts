import './clock'
import { beforeEach, describe, expect, it } from 'vitest'
import { sendMessage, serviceOptions, startFirstConversation } from '@/coach/coachService'
import { parseIntent, parseMealCorrections } from '@/coach/intents'
import { analyzeDescription } from '@/coach/food/foodAnalysis'
import { buildVoice, describePersonality } from '@/coach/personality'
import type { CoachResponse } from '@/coach/provider'
import { resetActionLedger } from '@/coach/tools/registry'
import { buildDemoSeed } from '@/domain/demo'
import { en } from '@/i18n/en'
import { fr as frDict } from '@/i18n/fr'
import { getLanguage, setActiveLanguage } from '@/i18n'
import { addDays, dayKey, fromDayKey, todayKey } from '@/lib/dates'
import { selectDailyNutrition } from '@/store/selectors'
import { useStore } from '@/store/useStore'

/**
 * The French coach, end to end: the same intents, tools and state as the
 * English one, spoken in natural French. Three standing rules at every turn:
 *  - NO LIE: a claim of change is backed by an executed action.
 *  - NO DEAD END: every chip parses back into a real intent in French.
 *  - FRENCH ONLY: no English leaks into a French reply.
 */

serviceOptions.simulateThinking = false
const state = () => useStore.getState()
const today = todayKey()

function reset(language: 'fr' | 'en' = 'fr') {
  state().resetAll()
  state().setLanguage(language)
  state().seed(buildDemoSeed())
  useStore.setState({ meals: {} })
  resetActionLedger()
  const conv = state().createConversation('Parcours')
  state().setActiveConversation(conv.id)
}

const CLAIMS_FR = /(?<!\b(?:pas|rien|jamais|deja|déjà|aucun|aucune|encore)\s)\b(ajouté|ajoutée|enregistré|enregistrée|enregistrés|retiré|retirée|supprimé|supprimée|mis à jour|mise à jour|déplacé|déplacée|terminée|noté :|planifié|planifiée|créé|réglé|reconstruite|ajustée|réduite|allongée|remplacé)\b/i
const FALLBACK_FR = /Je veux bien faire|Dis-m’en un peu plus|Pas sûr d’avoir saisi/i
const FALLBACK_EN = /I want to get this right|Tell me a little more|Not sure I caught that/i
// Common English function words and fitness nouns that must never appear in a French reply.
const ENGLISH = /\b(the|you|your|with|and|workout|session|protein|today|tomorrow|week|minutes|exercises|meal|lunch|dinner|breakfast|goal|program|calendar|planned|logged|added|removed|ready|start)\b/i

async function say(text: string, opts: { allowEnglish?: boolean } = {}): Promise<CoachResponse> {
  const r = await sendMessage(text)
  expect(r, `pas de réponse à « ${text} »`).toBeDefined()
  const res = r!
  expect(res.message, `réponse de secours à « ${text} » : ${res.message}`).not.toMatch(FALLBACK_FR)
  expect(res.message).not.toMatch(FALLBACK_EN)
  if (!opts.allowEnglish) {
    // Exercise and food names are localised; the only English allowed is a proper noun the user typed.
    const cleaned = res.message.replace(/«[^»]*»/g, '').replace(/“[^”]*”/g, '')
    expect(cleaned, `anglais dans la réponse à « ${text} » : ${res.message}`).not.toMatch(ENGLISH)
  }
  const positive = res.message
    .split(/(?<=[.!?])\s+|\n/)
    .filter((s) => !/^(pas|rien|aucun|aucune|jamais|encore|déjà)\b/i.test(s.trim()))
    .join(' ')
  if (CLAIMS_FR.test(positive) && !/déjà|ne (correspond|tient) plus/i.test(res.message)) {
    expect(res.actions.some((a) => a.ok), `« ${text} » prétend un changement sans action exécutée : ${res.message}`).toBe(true)
  }
  const conv = state().conversations.find((c) => c.id === state().activeConversationId)!
  for (const chip of res.suggestedFollowups) {
    const next = parseIntent(chip, { expects: res.expects, topic: conv.context.topic, hasWorkout: true, hasMeal: Boolean(conv.context.lastMealId), lastAvailabilityScope: conv.context.lastAvailabilityScope, language: 'fr' })
    expect(next.kind, `puce « ${chip} » après « ${text} » est une impasse`).not.toBe('unknown')
  }
  return res
}

const todayWorkout = () => Object.values(state().workouts).find((w) => w.scheduledFor === today && w.status !== 'skipped')

describe('French intents map to the same structured intents as English', () => {
  const fr = (text: string, extra: Parameters<typeof parseIntent>[1] = {}) => parseIntent(text, { language: 'fr', ...extra })
  const enP = (text: string, extra: Parameters<typeof parseIntent>[1] = {}) => parseIntent(text, { language: 'en', ...extra })

  it('covers the brief’s twenty-two sentences', () => {
    expect(fr('Je veux prendre du muscle.')).toEqual(enP('I want to build muscle.'))
    expect(fr('Je veux perdre du poids.')).toMatchObject({ kind: 'set_goal', goalType: 'lose_fat' })
    expect(fr('Je veux améliorer ma condition physique.')).toMatchObject({ kind: 'set_goal', goalType: 'conditioning' })
    expect(fr('Je m’entraîne quatre fois par semaine.')).toMatchObject({ kind: 'availability', count: 4, scope: 'always' })
    expect(fr('Je suis fatigué aujourd’hui.')).toMatchObject({ kind: 'tired' })
    expect(fr('Je suis à 6 sur 10.')).toMatchObject({ kind: 'scale_answer', value: 6 })
    expect(fr('Fais-moi une séance.')).toMatchObject({ kind: 'make_workout' })
    expect(fr('Fais-la plus courte.', { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'shorter' } })
    expect(fr('Je n’ai que 30 minutes.', { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'shorter', minutes: 30 } })
    expect(fr('Je n’ai que 30 minutes.')).toMatchObject({ kind: 'make_workout', constraints: { minutes: 30 } })
    expect(fr('Je n’ai que des haltères.', { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'equipment', equipment: ['dumbbell'] } })
    expect(fr('Qu’est-ce que j’ai prévu demain ?')).toMatchObject({ kind: 'tomorrow' })
    expect(fr('Qu’est-ce que j’ai mangé aujourd’hui ?')).toMatchObject({ kind: 'eaten_today' })
    expect(fr('Il me reste combien de protéines ?')).toMatchObject({ kind: 'remaining_nutrition', macro: 'protein' })
    expect(fr('J’ai mangé du poulet et du riz.')).toMatchObject({ kind: 'food_log' })
    expect(fr('Il y avait plus de riz.', { hasMeal: true })).toMatchObject({ kind: 'meal_correction', corrections: [{ type: 'more', food: 'riz' }] })
    expect(fr('En fait je n’en ai mangé que la moitié.', { hasMeal: true })).toMatchObject({ kind: 'meal_correction', corrections: [{ type: 'scale', factor: 0.5 }] })
    expect(fr('Supprime mon repas.', { hasMeal: true })).toMatchObject({ kind: 'meal_discard' })
    expect(fr('Déplace ma séance à vendredi.')).toMatchObject({ kind: 'reschedule', to: 5 })
    expect(fr('Change mon objectif.')).toMatchObject({ kind: 'set_goal' })
    expect(fr('Comment je progresse ?')).toMatchObject({ kind: 'analyze_progress' })
    expect(fr('Qu’est-ce qui est prévu cette semaine ?')).toMatchObject({ kind: 'day_report', frame: 'this_week', mode: 'planned' })
    expect(fr('Retiens que je n’aime pas les burpees.')).toMatchObject({ kind: 'dislike_exercise', text: 'burpees' })
  })

  it('resolves conversational references in French', () => {
    expect(fr('Raccourcis-la.', { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'shorter' } })
    expect(fr('Déplace-la à vendredi.', { hasWorkout: true })).toMatchObject({ kind: 'reschedule', fromContext: true, to: 5 })
    expect(fr('Supprime celui de demain.')).toMatchObject({ kind: 'delete_workout', when: 'tomorrow' })
    expect(fr('Ajoute-le au déjeuner.', { hasMeal: true })).toMatchObject({ kind: 'meal_commit', slot: 'lunch' })
    expect(fr('En fait, fais-en trois.', { lastAvailabilityScope: 'week' })).toMatchObject({ kind: 'availability', count: 3, scope: 'week' })
    expect(fr('Et demain ?')).toMatchObject({ kind: 'tomorrow' })
    expect(fr('Et pour ce soir ?', { topic: 'nutrition' })).toMatchObject({ kind: 'nutrition', slot: 'dinner' })
    expect(fr('Et pour ce soir ?', { topic: 'workout' })).toMatchObject({ kind: 'today_plan' })
    expect(fr('Qu’est-ce qui est prévu vendredi ?')).toMatchObject({ kind: 'weekday_plan', weekday: 5 })
  })

  it('is accent-tolerant for matching and keeps accents in what is stored', () => {
    expect(fr('Je suis fatigue aujourd hui')).toMatchObject({ kind: 'tired' })
    expect(fr('Deplace ma seance a vendredi')).toMatchObject({ kind: 'reschedule', to: 5 })
    expect(fr('Retiens que j’ai mal à l’épaule gauche le matin')).toMatchObject({ kind: 'pain' })
    expect(fr('Retiens que je préfère m’entraîner le matin')).toMatchObject({ kind: 'remember', text: 'je préfère m’entraîner le matin' })
    expect(fr('Souviens-toi que j’adore les fentes bulgares')).toMatchObject({ kind: 'remember', text: 'j’adore les fentes bulgares' })
  })

  it('accepts straight, curly and iPhone apostrophes alike', () => {
    for (const apostrophe of ["'", '’', '‘', '´']) {
      const text = `Je n${apostrophe}ai que 30 minutes`
      expect(fr(text, { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'shorter', minutes: 30 } })
    }
  })

  it('understands English chips while French is selected, and French chips while English is selected', () => {
    expect(fr('Make it shorter', { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'shorter' } })
    expect(enP('Raccourcis-la', { hasWorkout: true })).toMatchObject({ kind: 'modify_workout', change: { type: 'shorter' } })
    expect(fr('Move tomorrow’s workout to Friday.')).toMatchObject({ kind: 'reschedule', fromRelative: 'tomorrow', to: 5 })
  })

  it('parses French meal corrections in order', () => {
    expect(parseMealCorrections('il y avait 200 g de riz et pas de sauce', 'fr')).toEqual([{ type: 'set_grams', food: 'riz', grams: 200 }, { type: 'remove', food: 'sauce' }])
    // “œufs” is matched accent-folded (the fold keeps string length so photo/text offsets stay aligned).
    expect(parseMealCorrections('deux œufs et un peu plus de pain', 'fr')).toEqual([{ type: 'set_count', food: expect.stringMatching(/^o(e)?ufs$/), count: 2 }, { type: 'more', food: 'pain', factor: 1.25 }])
  })

  it('analyses a French plate to the same foods as the English one', () => {
    const a = analyzeDescription('J’ai mangé 200 g de poulet, 150 g de riz et des brocolis', 'fr')
    const b = analyzeDescription('I ate 200 g chicken, 150 g rice and broccoli', 'en')
    expect(a.items.map((i) => i.foodId).sort()).toEqual(b.items.map((i) => i.foodId).sort())
    expect(a.items.find((i) => i.foodId === 'rice')?.grams).toBe(150)
    expect(a.notes.join(' ')).not.toMatch(/portions were assumed/i)
  })

  it('every French chip of the coach dictionary parses (no dead end by construction)', () => {
    const EXPECTS: Record<string, string> = { allNormal: 'bloodwork_flag', lowIron: 'bloodwork_flag', lowVitaminD: 'bloodwork_flag', kneeSharp: 'pain_location', lowerBackDull: 'pain_location', shoulderAchy: 'pain_location', fullGym: 'equipment_list', dumbbellsBench: 'equipment_list', bandsBodyweight: 'equipment_list', itsBloodwork: 'attachment_kind', itsEquipment: 'attachment_kind', itsMeal: 'attachment_kind', itsPlan: 'attachment_kind', itsProgressPhoto: 'attachment_kind', itsDietPlan: 'attachment_kind', somethingElse: 'attachment_kind', aboutFood: 'attachment_kind', aboutWorkout: 'attachment_kind', neverMind: 'attachment_kind', blendGoals: 'plan_choice', followAsIs: 'plan_choice', referenceOnly: 'plan_choice', hundredKg: 'goal_target', fourPerWeek: 'goal_target', buildMuscle: 'goal_choice', loseFat: 'goal_choice', bench100: 'goal_choice', fourWorkoutsWeek: 'goal_choice', pastaSalmon: 'meal_description', chickenRiceVeg: 'meal_description', bigSalad: 'meal_description', eggsToast: 'meal_description', salmonPotatoes: 'meal_description', menuA: 'menu_options', menuB: 'menu_options', feelingGreat: 'energy_scale', bitTired: 'energy_scale', sleptBadly: 'energy_scale' }
    const fill = (v: string) => v.replace('{slot}', 'au déjeuner').replace('{food}', 'le riz').replace('{name}', 'burger').replace('{n}', 'trois').replace('{day}', 'lundi').replace('{exercise}', 'le squat')
    const dead: string[] = []
    for (const [k, v] of Object.entries(frDict as Record<string, string>)) {
      if (!k.startsWith('coach.sug.') || k === 'coach.sug.tryAgain') continue
      const i = parseIntent(fill(v), { language: 'fr', hasWorkout: true, hasMeal: true, lastAvailabilityScope: 'week', expects: EXPECTS[k.replace('coach.sug.', '')] as never })
      if (i.kind === 'unknown') dead.push(`${k}: ${v}`)
    }
    expect(dead).toEqual([])
    // The English chips still parse too (regression).
    const deadEn: string[] = []
    const fillEn = (v: string) => v.replace('{slot}', 'to lunch').replace('{food}', 'rice').replace('{name}', 'burger').replace('{n}', 'three').replace('{day}', 'Monday').replace('{exercise}', 'Squat')
    for (const [k, v] of Object.entries(en as Record<string, string>)) {
      if (!k.startsWith('coach.sug.') || k === 'coach.sug.tryAgain') continue
      const i = parseIntent(fillEn(v), { language: 'en', hasWorkout: true, hasMeal: true, lastAvailabilityScope: 'week', expects: EXPECTS[k.replace('coach.sug.', '')] as never })
      if (i.kind === 'unknown') deadEn.push(`${k}: ${v}`)
    }
    expect(deadEn).toEqual([])
  })
})

describe('French conversational journey (real pipeline, real state)', () => {
  beforeEach(() => reset('fr'))

  it('the coach answers in French, executes the same tools and updates the same state', async () => {
    expect(getLanguage()).toBe('fr')
    const w0 = todayWorkout()
    const r1 = await say('Je veux prendre du muscle.')
    expect(r1.actions.some((a) => a.tool === 'set_goal' && a.ok)).toBe(true)
    expect(state().goals.find((g) => g.rank === 'primary')?.type).toBe('build_muscle')
    expect(state().goals.find((g) => g.rank === 'primary')?.label).toBe('Build muscle')
    expect(r1.message).toMatch(/Objectif mis à jour/)

    const r2 = await say('Fais-moi une séance.')
    expect(r2.actions.some((a) => a.tool === 'create_workout' && a.ok)).toBe(true)
    const w = todayWorkout()!
    expect(w).toBeDefined()
    expect(w.title).toMatch(/^[A-Z]/) // canonical English stays in storage
    expect(r2.message).not.toContain(w.title) // …but is rendered in French
    expect(r2.cards?.[0]?.subtitle).toMatch(/exercices/)
    void w0

    const r3 = await say('Raccourcis-la.')
    expect(r3.actions.some((a) => a.tool === 'update_workout' && a.ok)).toBe(true)
    expect(todayWorkout()!.estimatedMinutes).toBeLessThanOrEqual(w.estimatedMinutes)
    expect(r3.message).toMatch(/Réduite/)

    const r3b = await say('Je n’ai que des haltères.')
    expect(r3b.actions.some((a) => a.tool === 'update_workout' && a.ok)).toBe(true)
    expect(r3b.message).toMatch(/haltères/)

    const r4 = await say('Je suis fatigué aujourd’hui.')
    expect(r4.expects).toBe('fatigue_scale')
    const r5 = await say('Je suis à 6 sur 10.')
    expect(r5.actions.some((a) => a.tool === 'check_in' && a.ok)).toBe(true)
    expect(state().checkIns[today]?.fatigue).toBe(6)
    expect(r5.message).toMatch(/6 sur 10/)

    const r6 = await say('J’ai mangé du poulet et du riz.')
    expect(r6.actions.some((a) => a.tool === 'log_meal' && a.ok)).toBe(true)
    expect(selectDailyNutrition(state(), today).meals.length).toBe(1)
    expect(r6.message).toMatch(/poulet/i)
    expect(r6.message).toMatch(/protéines/)

    const before = selectDailyNutrition(state(), today).meals[0]
    const r7 = await say('Il y avait plus de riz.')
    expect(r7.actions.some((a) => a.tool === 'update_meal' && a.ok)).toBe(true)
    expect(selectDailyNutrition(state(), today).meals[0].calories).toBeGreaterThan(before.calories)

    const r8 = await say('En fait je n’en ai mangé que la moitié.')
    expect(r8.actions.some((a) => a.tool === 'update_meal' && a.ok)).toBe(true)
    expect(r8.message).toMatch(/Tout divisé par deux|moitié/i)

    const r9 = await say('Il me reste combien de protéines ?')
    expect(r9.message).toMatch(/g de protéines/)

    const r10 = await say('Qu’est-ce que j’ai mangé aujourd’hui ?')
    expect(r10.message).toMatch(/Jusqu’ici aujourd’hui/)

    const r11 = await say('Supprime mon repas.')
    expect(r11.actions.some((a) => a.tool === 'delete_meal' && a.ok)).toBe(true)
    expect(selectDailyNutrition(state(), today).meals.length).toBe(0)

    const r12 = await say('Comment je progresse ?')
    expect(r12.message).toMatch(/quatre dernières semaines/)
    expect(r12.cards?.[0]?.title).toBe('Bilan de progression')

    const r13 = await say('Qu’est-ce qui est prévu cette semaine ?')
    expect(r13.message).toMatch(/Prévu cette semaine|Rien n’était prévu/)

    const r14 = await say('Retiens que je n’aime pas les burpees.')
    expect(r14.actions.some((a) => a.tool === 'update_user' && a.ok)).toBe(true)
    expect(state().user?.dislikedExercises).toContain('burpee')
    expect(r14.message).toMatch(/burpees/)
  })

  it('references: “Déplace-la à vendredi”, “Supprime celui de demain”, “Et demain ?”, “En fait, fais-en trois”', async () => {
    await say('Planifie ma semaine')
    const planned = () => Object.values(state().workouts).filter((w) => w.status === 'planned' && w.scheduledFor >= today)
    expect(planned().length).toBeGreaterThan(1)
    const tomorrow = dayKey(addDays(new Date(), 1))
    const r1 = await say('Et demain ?')
    expect(r1.message).toMatch(/Demain/)
    const hadTomorrow = planned().some((w) => w.scheduledFor === tomorrow)
    if (hadTomorrow) {
      const r2 = await say('Supprime celui de demain.')
      expect(r2.actions.some((a) => a.tool === 'remove_workout' && a.ok)).toBe(true)
      expect(planned().some((w) => w.scheduledFor === tomorrow)).toBe(false)
    }
    const r3 = await say('Je peux m’entraîner quatre jours cette semaine')
    expect(r3.actions.filter((a) => a.tool === 'create_workout' && a.ok).length).toBeGreaterThan(0)
    const window = dayKey(addDays(new Date(), 6))
    const inWindow = () => Object.values(state().workouts).filter((x) => x.scheduledFor >= today && x.scheduledFor <= window && x.status === 'planned').length
    expect(inWindow()).toBe(4)
    await say('En fait, fais-en trois.')
    expect(inWindow()).toBe(3)
    // "la" needs an antecedent. A week rebuild leaves none in the conversation, and whether today
    // happens to hold a session depends on the weekday; asking about the next session's day sets it
    // on every date.
    const next = planned().sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0]
    const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
    const r3b = await say(`Qu’est-ce qui est prévu ${jours[fromDayKey(next.scheduledFor).getDay()]} ?`)
    expect(r3b.references?.some((x) => x.id === next.id)).toBe(true)
    const before = state().workouts[next.id].estimatedMinutes
    const r3c = await say('Fais-la plus courte.')
    expect(r3c.actions.some((a) => a.tool === 'update_workout' && a.ok)).toBe(true)
    expect(state().workouts[next.id].estimatedMinutes).toBeLessThan(before)
    const r4 = await say('Déplace-la à vendredi.')
    const moved = r4.actions.some((a) => (a.tool === 'reschedule_workout' || a.tool === 'move_event') && a.ok)
    // Already on a Friday: the coach says so and moves nothing. Otherwise it lands on a Friday.
    expect(moved || /déjà/.test(r4.message)).toBe(true)
    if (moved) expect(fromDayKey(state().workouts[next.id].scheduledFor).getDay()).toBe(5)
  })

  it('dates, numbers and plurals are French in replies', async () => {
    state().addMeasurement({ type: 'body_weight', value: 74.6, unit: 'kg', date: today, source: 'user' })
    const r = await say('Je pèse 74,2 kg ce matin')
    expect(r.actions.some((a) => a.tool === 'log_measurement' && a.ok)).toBe(true)
    expect(r.message).toMatch(/74,2 kg/)
    expect(state().measurements.find((m) => m.type === 'body_weight' && m.date === today && m.value === 74.2)).toBeDefined()
    const r2 = await say('Montre mon calendrier')
    expect(r2.message).toMatch(/lun|mar|mer|jeu|ven|sam|dim/)
    expect(r2.cards?.[0]?.subtitle).toMatch(/séances?/)
  })

  it('the first conversation and workout completion speak French', () => {
    startFirstConversation()
    const conv = state().conversations[0]
    const msgs = state().messages[conv.id]
    expect(conv.title).toBe('Premiers pas')
    expect(msgs[0].text).toMatch(/Salut Alex\. Moi c’est Nova, ton coach\./)
    expect(msgs[0].text).toMatch(/prendre du muscle/)
    expect(msgs[0].suggestions).toContain('Prépare ma séance du jour')
  })
})

describe('personality dials keep working in French', () => {
  it('composes different French voices for different dials', () => {
    const base = { motivation: 50, tone: 50, humor: 30, communication: 50 }
    const parts = { core: 'Je pense que la séance du jour est prête.', reason: 'Parce que tu récupères bien.', extra: 'Détail supplémentaire.', soft: 'Si tu le sens,', quip: 'Petite blague.' }
    const neutral = buildVoice(base, 'fr').compose(parts)
    const intense = buildVoice({ ...base, motivation: 90 }, 'fr').compose(parts)
    const direct = buildVoice({ ...base, tone: 90 }, 'fr').compose(parts)
    const gentle = buildVoice({ ...base, tone: 10 }, 'fr').compose(parts)
    const playful = buildVoice({ ...base, humor: 95 }, 'fr').compose(parts)
    const concise = buildVoice({ ...base, communication: 10 }, 'fr').compose(parts)
    expect(intense).not.toBe(neutral)
    expect(direct).not.toMatch(/Je pense que/)
    expect(gentle).toMatch(/^Si tu le sens, je pense/)
    expect(playful).toMatch(/Petite blague\./)
    expect(neutral).not.toMatch(/Petite blague\./)
    expect(concise).not.toMatch(/Parce que/)
    for (const v of [intense, direct, gentle, playful]) expect(v).not.toMatch(/\b(Let’s|No excuses|Attack|Take it steady)\b/)
    expect(buildVoice({ ...base, motivation: 90 }, 'en').compose(parts)).toMatch(/Let’s go|No excuses|Attack it|Show up hard|Earn it|This is the work/)
  })

  it('describes the personality in the selected language', () => {
    const p = { motivation: 90, tone: 90, humor: 90, communication: 90 }
    expect(describePersonality(p, 'en')).toBe('intense · direct · playful · detailed')
    expect(describePersonality(p, 'fr')).toBe('intense · direct · joueur · détaillé')
    expect(buildVoice(p, 'fr').greeting('Alex', 'Bonjour')).toBe('Alex. Au boulot.')
    expect(buildVoice(p, 'en').greeting('Alex', 'Good morning')).toBe('Alex. Let’s work.')
  })

  it('changing the dials from French chat is understood', async () => {
    reset('fr')
    const r = await say('Sois plus direct avec moi')
    expect(r.actions.some((a) => a.tool === 'update_coach' && a.ok)).toBe(true)
    expect(state().coach.personality.tone).toBeGreaterThan(60)
    expect(r.message).toMatch(/plus direct/)
  })
})

describe('cross-language state', () => {
  it('a state built in French is the same state when switching to English and back', async () => {
    reset('fr')
    await say('Je veux prendre du muscle.')
    expect(state().goals.find((g) => g.rank === 'primary')?.type).toBe('build_muscle')
    await say('Planifie ma semaine')
    const tomorrow = dayKey(addDays(new Date(), 1))
    const hasTomorrow = Object.values(state().workouts).some((w) => w.scheduledFor === tomorrow && w.status === 'planned')

    state().setLanguage('en')
    expect(getLanguage()).toBe('en')
    const r1 = await sendMessage('What am I training for?')
    expect(r1!.message).toMatch(/build muscle/i)
    expect(r1!.message).not.toMatch(/prendre du muscle/)
    if (hasTomorrow) {
      const r2 = await sendMessage('Move tomorrow’s workout to Friday.')
      expect(r2!.actions.some((a) => a.tool === 'reschedule_workout' && a.ok) || /already|two sessions/i.test(r2!.message)).toBe(true)
      expect(r2!.message).toMatch(/Moved .* from .* to Friday|already|two sessions/i)
    }

    state().setLanguage('fr')
    const r3 = await say('Qu’est-ce qui est prévu vendredi ?')
    expect(r3.message).toMatch(/vendredi/i)
    const friday = Object.values(state().workouts).find((w) => new Date(w.scheduledFor).getDay() === 5 && w.scheduledFor >= today && w.status === 'planned')
    if (friday) expect(r3.references?.some((x) => x.id === friday.id)).toBe(true)
    expect(state().goals.find((g) => g.rank === 'primary')?.type).toBe('build_muscle')
    expect(state().goals.length).toBe(useStore.getState().goals.length)
    setActiveLanguage('en')
  })

  it('English regression: the English coach is unchanged by the French layer', async () => {
    reset('en')
    const r = await sendMessage('Build today’s workout')
    expect(r!.message).toMatch(/Done\. .*|Adjusted today/)
    expect(r!.message).not.toMatch(/séance/)
    expect(r!.suggestedFollowups).toEqual(['Make it shorter', 'I only have dumbbells', 'Swap an exercise', 'Start it'])
    const r2 = await sendMessage('What should I eat today?')
    expect(r2!.message).toMatch(/Today is a (training|rest) day/)
    expect(r2!.cards?.[0]?.title).toBe('Today’s nutrition')
  })
})

describe('food scan in French', () => {
  it('estimates a French description as a draft and commits it with “Ajoute-le au déjeuner”', async () => {
    reset('fr')
    const r1 = await say('J’ai mangé ça : un bol de riz avec du saumon et de l’avocat', { allowEnglish: false })
    expect(r1.actions.some((a) => a.tool === 'log_meal' && a.ok)).toBe(true)
    expect(r1.message).toMatch(/saumon/i)
    const meal = Object.values(state().meals)[0]
    expect(meal.items.map((i) => i.foodId)).toEqual(expect.arrayContaining(['rice', 'salmon', 'avocado']))
    if (meal.status === 'draft') {
      const r2 = await say('Ajoute-le au déjeuner')
      expect(r2.actions.some((a) => a.tool === 'update_meal' && a.ok)).toBe(true)
      expect(state().meals[meal.id].status).toBe('logged')
      expect(state().meals[meal.id].slot).toBe('lunch')
    } else {
      expect(meal.status).toBe('logged')
    }
    expect(selectDailyNutrition(state(), today).consumed.calories).toBeGreaterThan(0)
    setActiveLanguage('en')
  })
})

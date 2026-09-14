import { findExerciseByName } from '@/domain/exercises'
import type { EquipmentId } from '@/domain/types'
import { parseWeekday } from '@/lib/dates'
import { normalizeForMatching, straightenQuotes } from '@/lib/text'
import type { MealCorrection } from './food/foodAnalysis'
import { findFoodsInText } from './food/foodDatabase'
import { parseDaysPerWeek, parseEquipment, parseFocus, parseGoalType, parseKg, parseMinutes, parseScale, parseSlot, parseWeeks, wordToNumber, type Intent, type ParseOptions, type WorkoutConstraintsParsed } from './intents'
import { resolveTimeReference } from './time'

/**
 * The French understanding layer. It produces exactly the same structured
 * intents as the English parser (same kinds, same fields) so that every tool,
 * generator and screen behaves identically whatever language the user writes.
 *
 * Every pattern runs on `normalizeForMatching(text)`: lower case, straight
 * apostrophes, accents folded (“séance” → “seance”). Displayed content is never
 * folded; only matching is accent-tolerant.
 */

const DAY = '(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lun|mar|mer|jeu|ven|sam|dim)'
const NUM = '(?:\\d|un|une|deux|trois|quatre|cinq|six)'

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function cleanTail(s: string): string {
  return s.replace(/[.!?]+$/, '').trim()
}

/** “vendredi” / “demain” / “aujourd'hui” → reschedule target fields. */
function toTarget(word: string): { to?: number; toRelative?: 'tomorrow' | 'today' } {
  if (word.startsWith('demain')) return { toRelative: 'tomorrow' }
  if (word.startsWith('aujourd')) return { toRelative: 'today' }
  return { to: parseWeekday(word) ?? undefined }
}

export function parseIntentFr(raw: string, opts: ParseOptions): Intent {
  // Captured text (memories, food, pain areas) keeps the user's typography; only matching folds it.
  const text = raw.trim()
  const t = normalizeForMatching(text)
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
  if (opts.expects === 'coach_name' && t.length < 24 && !/\s{2,}/.test(t) && !/^(non|oui|ok|d'accord)/.test(t)) {
    return { kind: 'rename_coach', name: cleanTail(straightenQuotes(text).replace(/^(appelle-toi|appelle toi|tu t'appelles|tu t'appelleras|ton nom (c'est|est|sera)|je t'appelle)\s+/i, '')) }
  }
  if (opts.expects === 'pain_location' && t.length < 60) {
    return { kind: 'pain', area: text, severe: /aigu|aigue|vive|forte|violente|insupportable|gonfle|engourdi|je ne peux (pas|plus)/.test(t) }
  }
  if (opts.expects === 'weight_value') {
    const m = t.match(/(\d{2,3}(?:[.,]\d)?)/)
    if (m && t.length < 30) return { kind: 'log_weight', kg: Number(m[1].replace(',', '.')) }
  }
  if (opts.expects === 'goal_choice') {
    const g = parseGoalType(t)
    const kg = parseKg(t)
    const num = () => Number(t.match(/(\d{2,3})/)?.[1]) || undefined
    if (/developpe|bench/.test(t)) return { kind: 'set_goal', metric: 'bench_press', target: num() }
    if (/squat/.test(t)) return { kind: 'set_goal', metric: 'squat', target: num() }
    if (/souleve de terre|deadlift/.test(t)) return { kind: 'set_goal', metric: 'deadlift', target: num() }
    if (/seances?|entrainements?|fois/.test(t) && /semaine/.test(t)) return { kind: 'set_goal', metric: 'workouts_per_week', target: Number(t.match(/(\d)/)?.[1]) || undefined }
    if (kg) return { kind: 'set_goal', metric: 'body_weight', target: kg, goalType: g }
    if (g) return { kind: 'set_goal', goalType: g }
  }
  if (opts.expects === 'goal_target') {
    const kg = parseKg(t) ?? (t.match(/^\s*(\d{1,3}(?:[.,]\d)?)\s*$/) ? Number(t.replace(',', '.')) : undefined)
    const perWeek = t.match(/(\d)\s*(?:par|\/|fois par|seances? par)?\s*(?:semaine|sem\b)/)
    if (perWeek) return { kind: 'set_goal', metric: 'workouts_per_week', target: Number(perWeek[1]) }
    if (kg) return { kind: 'set_goal', target: kg }
  }
  if (opts.expects === 'meal_description' && t.length > 2 && !/^(non|laisse tomber|oublie|passe|rien)/.test(t)) return { kind: 'meal_description', text }
  if (opts.expects === 'bloodwork_flag') return { kind: 'bloodwork_flag', text }
  if (opts.expects === 'equipment_list') {
    const equipment = parseEquipment(t) ?? (/salle complete|tout|salle de sport|commercial|une vraie salle/.test(t) ? (['barbell', 'dumbbell', 'cable', 'machine', 'bench', 'pullup_bar', 'cardio_machine', 'bodyweight'] as EquipmentId[]) : undefined)
    if (equipment) return { kind: 'equipment_list', equipment }
  }
  if (opts.expects === 'plan_choice') {
    if (/suis|tel quel|comme il est|utilise-le|utilise le|garde-le tel/.test(t)) return { kind: 'plan_choice', choice: 'follow' }
    if (/melange|mix|combine|avec mes objectifs|adapte/.test(t)) return { kind: 'plan_choice', choice: 'blend' }
    if (/reference|juste|seulement|garde/.test(t)) return { kind: 'plan_choice', choice: 'reference' }
  }
  if (opts.expects === 'meal_slot') {
    const slot = parseSlot(t)
    if (slot) return { kind: 'meal_commit', slot }
  }
  if (opts.expects === 'menu_options' && t.length > 3 && !/^(non|laisse tomber|passe|rien)/.test(t)) {
    return { kind: 'menu_help', options: splitOptionsFr(text) }
  }
  if (opts.expects === 'finish_confirm') {
    if (/^(oui|ouais|yes|vas-y|vas y|ok|d'accord|enregistre|note-le|c'est fait)/.test(t)) return { kind: 'finished_workout', text: 'yes' }
    if (/^(non|nan|pas encore|pas fini)/.test(t)) return { kind: 'no' }
  }

  // ---- Attachment follow-ups (only when the coach just asked what an attachment is)
  if (opts.expects === 'attachment_kind') {
    if (/(plan d'entrainement|plan alimentaire|programme|routine|tableau|fichier|un plan)/.test(t)) return { kind: 'attachment_context', what: 'plan' }
    if (/(seance|entrainement|training|workout)/.test(t)) return { kind: 'today_plan' }
    if (/(repas|nourriture|assiette|dejeuner|diner|petit-dej|ce que j'ai mange|bouffe|plat)/.test(t)) return { kind: 'attachment_context', what: 'meal' }
    if (/(salle|materiel|equipement|home gym)/.test(t)) return { kind: 'attachment_context', what: 'equipment' }
    if (/(plan)/.test(t)) return { kind: 'attachment_context', what: 'plan' }
    if (/(progres|physique|corps|evolution)/.test(t)) return { kind: 'attachment_context', what: 'progress_photo' }
    if (/(sang|analyse|bilan|prise de sang|resultats)/.test(t)) return { kind: 'attachment_context', what: 'bloodwork' }
    if (/(autre chose|autre|laisse tomber|rien)/.test(t)) return { kind: 'attachment_context', what: 'other' }
  }

  if (opts.hasAttachments) return { kind: 'attachment' }

  // ---- Safety first
  if (/\b(douleur|douloureux|douloureuse|j'ai mal(?! dormi)|mal (au|a la|aux|a l')|blessure|blesse|blessee|entorse|claquage|tiraille|tirailler|elancement|vertige|vertiges|engourdi|engourdie|coince|coincee|bloque le dos)\b/.test(t) && !/\b(pas mal|sans douleur|pas de douleur|plus mal)\b/.test(t)) {
    const severe = /aigu|aigue|vive|forte|violente|je ne peux (pas|plus) (marcher|bouger|lever)|insupportable|gonfle|engourdi|douleur thoracique|vertige|elancement/.test(t)
    const area = t.match(/\b(genou|genoux|dos|lombaires|bas du dos|epaule|epaules|cou|nuque|coude|poignet|hanche|cheville|ischio|ischios|quadri|cuisse|mollet|poitrine|thorax)\b/)?.[1]
    return { kind: 'pain', area, severe }
  }

  // ---- Temporal reports and food journal questions (before corrections, so a question never mutates the meal in context)
  const report = /\b(qu'est-ce que|qu'est ce que|qu'ai-je|est-ce que) (j'ai|je me suis) (fait|mange|manges|pris|bouge|entraine|entrainee|fini|termine)\b|\bj'ai (fait|mange) quoi\b|\bqu'est-ce qui (etait|a ete) (prevu|au programme)\b|\bc'etait quoi (le programme|le plan|la seance)\b|\bcomment (s'est passe|s'est passee|ca s'est passe) (hier|aujourd'hui|cette semaine|la semaine derniere)\b|\bqu'est-ce que (j'ai|j'avais) (de )?prevu\b|\bqu'est-ce qui est prevu\b|\bj'ai quoi (de prevu )?(demain|cette semaine|la semaine prochaine|aujourd'hui)\b|\bc'est quoi le programme (de |d')?(demain|cette semaine|la semaine prochaine)\b|\bquoi de prevu\b/.test(t)
  const time = resolveTimeReference(t)
  if (report && time) {
    const domain = /\b(mange|manges|mangee|repas|bouffe|nourriture|alimentation)\b/.test(t) ? 'food' : /\b(entraine|entrainee|entrainement|seance|seances|training|sport|souleve)\b/.test(t) ? 'training' : 'all'
    // "What have I planned tomorrow?" is a question about the session, answered by the tomorrow intent when the domain is training.
    if (time.frame === 'tomorrow' && time.mode === 'upcoming' && domain !== 'food') return { kind: 'tomorrow' }
    if (!(time.frame === 'today' && domain === 'food' && time.mode === 'did')) return { kind: 'day_report', frame: time.frame, mode: time.mode, domain }
  }
  const weekdayPlan = t.match(new RegExp(`^(?:qu'est-ce qui est prevu|qu'est-ce que j'ai(?: de prevu)?|j'ai quoi(?: de prevu)?|c'est quoi le programme|quoi de prevu|il y a quoi)\\s+(?:le |pour |ce )?(${DAY})[a-z]*\\s*\\??$`))
  if (weekdayPlan) return { kind: 'weekday_plan', weekday: parseWeekday(weekdayPlan[1]) ?? 1 }
  if (/\b(qu'est-ce que|qu'est ce que|qu'ai-je|est-ce que) j'ai mange\b|\bj'ai mange quoi\b|\bmes repas (d'aujourd'hui|du jour)\b|\bce que j'ai mange\b|\bj'ai mange aujourd'hui\b/.test(t)) return { kind: 'eaten_today' }
  if (/\bil (me |m')?reste (combien|quoi|encore)\b|\bcombien (de (proteines?|calories|kcal|glucides|lipides|gras)|il me reste)\b.*\b(reste|restant|encore)\b|\bqu'est-ce qu'il me reste\b|\bce qu'il me reste\b|\bou j'en suis (niveau|en|cote|pour les|sur les) (proteines?|calories|glucides|macros|nutrition)\b|\bje suis ou (niveau|en|cote) (proteines?|calories|glucides|nutrition)\b/.test(t)) {
    const macro = /proteine/.test(t) ? 'protein' : /glucide/.test(t) ? 'carbs' : /\b(lipide|gras)\b/.test(t) ? 'fat' : /calorie|kcal/.test(t) ? 'calories' : undefined
    return { kind: 'remaining_nutrition', macro }
  }
  if (/\b(qu'est-ce que tu (choisirais|prendrais|commanderais|me conseilles)|tu (prendrais|choisirais) quoi|je prends quoi|aide-moi a choisir|aide moi a choisir|lequel (choisir|prendre|je prends)|laquelle (choisir|prendre)|tu me conseilles quoi)\b/.test(t)) {
    const inline = text.match(/(?::|—|–|\?|\bentre\b|\bparmi\b)\s*(.+?)\??$/i)
    const options = inline ? splitOptionsFr(inline[1]).filter((o) => findFoodsInText(o).length > 0) : []
    return { kind: 'menu_help', options: options.length >= 2 ? options : undefined }
  }

  // ---- Meal in context: corrections, commit, discard
  const startsNewMeal = /^(j'ai (mange|pris|bouffe)|je viens de manger|je mange|j'ai eu)\b/.test(t) && !/\b(aussi|egalement|en plus|avec|et aussi)\b/.test(t)
  // A correction must be about food: a known food, a portion word or a meal slot, and nothing about training, programs or goals.
  const mealish = findFoodsInText(t).length > 0 || /\b(moitie|tiers|quart|le double|deux fois|sauce|portion|assiette|repas|dejeuner|diner|petit-dej|petit-dejeuner|collation|gouter|encas)\b/.test(t)
  const notMeal = /\b(seance|seances|entrainement|entrainements|training|programme|semaine|semaines|minutes?|objectif|objectifs|exercices?|series?|poids|kg|kilos?|calendrier|agenda|fatigue|fatiguee|dormi|direct|directe|progres|progression|mobilite|cardio|jour de|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.test(t)
  if (opts.hasMeal && !startsNewMeal) {
    if (/^(ajoute|enregistre|note|valide|confirme|mets|logue|log)(-le|-la| le| la| ca| ce repas| ceci| cela)?(\s+(au|a la|en|dans|pour le|pour la|comme|avant la seance|apres la seance)\b.*)?$/.test(t) || /^(c'est (bon|juste|ca|correct|parfait)|ca (me )?va|ok pour moi|oui,? (ajoute|enregistre|note)(-le| le| la)?)/.test(t)) {
      return { kind: 'meal_commit', slot: parseSlot(t) }
    }
    if (/^(n'enregistre pas|ne l'ajoute pas|ne l'enregistre pas|laisse tomber|oublie (ca|ce repas|le repas)|annule (ca|le repas|ce repas)|supprime (ca|ce repas|le repas|mon repas|ce brouillon)|enleve (ca|ce repas|le repas|mon repas)|retire (ca|ce repas|le repas|mon repas)|efface (ca|ce repas|le repas)|jette (ca|ce repas))/.test(t)) return { kind: 'meal_discard' }
    if (mealish && !notMeal) {
      const corrections = parseMealCorrectionsFr(text)
      if (corrections.length) return { kind: 'meal_correction', corrections }
    }
  }
  if (/^(supprime|enleve|retire|efface|annule) (mon|ce|le|ce dernier) (repas|dej|dejeuner|diner|petit-dej|petit-dejeuner|encas|collation)\b/.test(t)) return { kind: 'meal_discard' }

  // ---- Food journal: logging
  const foodLog =
    t.match(/^(?:j'ai (?:mange|pris|bouffe|avale)|je viens de manger|je mange|j'ai eu|je suis en train de manger|j'ai mange ca|voila ce que j'ai mange|enregistre|note)\b\s*(?::)?\s*(.*)$/) ??
    t.match(/^(?:au|pour le|pour mon|a mon|ce midi|ce matin|ce soir)\s*(petit-dej(?:euner)?|petit dej|dejeuner|diner|gouter|collation|midi|matin|soir)?(?:,| j'ai (?:mange|pris))?\s*[:,]?\s*(.*)$/) ??
    t.match(/^(?:mon|mes)\s+(petit-dej(?:euner)?|petit dej|dejeuner|diner|gouter|collation|repas)\s*[:,]?\s*(.*)$/)
  if (foodLog) {
    const body = (foodLog[2] ?? foodLog[1] ?? '').trim()
    const slot = parseSlot(t)
    const explicitEating = /^(j'ai (mange|pris|bouffe|avale)|je viens de manger|je mange|je suis en train de manger)\b/.test(t)
    const notFood = /\b(poids|seance|entrainement|course|couru|marche|pas|sommeil|sieste|repos|douche|reunion|journee|temps|minutes?|heures?|kilo|kilos)\b/.test(body)
    const mentionsFood = Boolean(body) && (findFoodsInText(body).length > 0 || Boolean(slot))
    if (body && body.length > 2 && !/^(ca|ceci|cela|ma seance|mon entrainement)$/.test(body) && (explicitEating ? !/\b(poids|seance|entrainement|restaurant|resto|dehors|au resto)\b/.test(body) : mentionsFood && !notFood)) return { kind: 'food_log', text: body, slot }
  }
  if (/^j'ai mange ca|^voila ce que j'ai mange|^mon (dejeuner|diner|petit-dej|petit-dejeuner|repas)\b/.test(t)) return { kind: 'food_log', text, slot: parseSlot(t) }
  if (/^(enregistre|note|logue|ajoute|entre) (un|mon|le) (repas|dejeuner|diner|petit-dej|petit-dejeuner|encas|collation)\s*[.!]?$/.test(t)) return { kind: 'attachment_context', what: 'meal' }

  // ---- Finished a workout
  if (/\b(j'ai (fini|termine|bouclé|boucle)|je viens de (finir|terminer)|c'est (fait|fini|termine|bon)|(seance|entrainement|training|sport) (est )?(fini|finie|termine|terminee|faite|bouclee))\b.*|\b(seance|entrainement|training|sport|muscu)\b.*\b(fini|finie|termine|terminee|faite|faite)\b|^(fini|termine|terminee|c'est fait|seance faite)\b/.test(t) && /\b(seance|entrainement|training|sport|muscu|salle|fini|termine|faite)\b/.test(t) && !/\b(pas encore|pas fini|pas termine|j'ai pas)\b/.test(t) && !/\b(repas|mange)\b/.test(t)) return { kind: 'finished_workout', text }

  // ---- Availability (persistent vs this week)
  const dayList = t.match(new RegExp(`\\b${DAY}[a-z]*\\b`, 'g'))
  if (dayList && dayList.length >= 2 && /\b(peux|pourrai|pourrais|dispo|disponible|libre|entraine|entrainer|m'entrainer|seance|seances|salle|venir|faire)\b/.test(t) && !/deplace|decale|bouge|change/.test(t)) {
    const days = [...new Set(dayList.map((d) => parseWeekday(d)).filter((d): d is number => d !== null))]
    const scope: 'week' | 'always' = /cette semaine|la semaine prochaine|semaine pro|juste cette|seulement cette|que cette/.test(t) ? 'week' : 'always'
    return { kind: 'availability', days, scope }
  }
  const countDays = t.match(new RegExp(`\\b(je peux|je pourrai|je pourrais|je vais|je ne peux|j'peux|je peux que|je peux seulement|je m'entraine|je m'entrainerai|je serai dispo|je suis dispo|je fais)\\s+(?:que |seulement |juste |uniquement |m'entrainer |venir |faire |m'entrainer que |m'entrainer seulement )*(${NUM})\\s+(?:jours?|fois|seances?|entrainements?)\\b`)) ?? t.match(new RegExp(`\\b(${NUM})\\s+(?:jours?|fois|seances?|entrainements?)\\s+(?:par|cette|la|chaque)\\s+semaine\\b`))
  if (countDays && /entrain|seance|jour|fois|salle|semaine/.test(t) && !/programme|objectif|cible/.test(t)) {
    const n = wordToNumber(countDays[2] ?? countDays[1])
    if (n) return { kind: 'availability', count: n, scope: /cette semaine|la semaine prochaine|semaine pro|juste cette|seulement cette/.test(t) ? 'week' : /toujours|d'habitude|en general|a partir de maintenant|desormais|dorenavant|chaque semaine|par semaine|toutes les semaines|\/\s*semaine|je m'entraine|hebdo/.test(t) ? 'always' : (opts.lastAvailabilityScope ?? 'week') }
  }
  if (opts.lastAvailabilityScope && new RegExp(`^(?:en fait|non|finalement|hmm|bon|plutot|ah non|non,?)?[,\\s]*(?:mets|fais|passe|dis|plutot|on dit|partons sur|mettons|faisons)?(?:-en|-le|-la| en)?\\s*(?:a |sur |plutot )?(${NUM})\\b(?!\\s*peu\\b)`).test(t) && !/\b(kg|kilos?|minutes?|semaines?|fatigue|fatiguee|dormi|heures?)\b/.test(t)) {
    const n = wordToNumber(t.match(new RegExp(`(${NUM})\\b`))![1])
    if (n) return { kind: 'availability', count: n, scope: opts.lastAvailabilityScope }
  }

  // ---- Goal deltas, dislikes, goal impact, tomorrow, energy
  const delta = t.match(/\b(prendre|gagner|perdre|lacher|virer)\s+(?:environ |a peu pres |dans les )?(\d{1,2}(?:[.,]\d)?)\s*(?:kg|kilos?|kilogrammes?)\b/)
  if (delta && !/developpe|squat|souleve|barre\b/.test(t)) return { kind: 'goal_delta', kg: Number(delta[2].replace(',', '.')), direction: /prendre|gagner/.test(delta[1]) ? 'gain' : 'lose' }
  const dislike = t.match(/\b(?:je )?(?:deteste|n'aime pas|aime pas|ne supporte pas|supporte pas|ne veux (?:plus|pas) (?:de|faire de|faire des|des)|veux plus de|plus jamais (?:de |d')|jamais de|jamais (?:d')?|arrete (?:avec |de me donner |de me mettre )?(?:les |des |le |la )?|stop (?:les |aux )?|pas fan (?:de |des |du )?|marre (?:de |des |du )?)\s*(?:les |des |le |la |l'|faire des |faire les |faire du |faire de la |de |du )?([a-z][a-z\- ]{2,30}?)(?:\s+(?:s'il te plait|stp|aujourd'hui|dans mes seances|dans les seances)|[.,!]|$)/)
  if (dislike && !/^(ca|ceci|cela|le plan|le programme|la seance|cette seance)$/.test(dislike[1].trim()) && /deteste|aime pas|supporte pas|veux (plus|pas)|jamais|arrete|stop|fan|marre/.test(t) && !/\b(sois|soit|parle|reponds)\b/.test(t)) return { kind: 'dislike_exercise', text: dislike[1].trim() }
  if (/\b(ca (change|affecte|impacte|modifie) quoi|comment ca (change|affecte|impacte|modifie)|qu'est-ce que ca change|qu'est ce que ca change|ca change (mon plan|mes seances|quelque chose|des choses)|quel impact|quelles consequences|c'est quoi mon objectif|quel est mon objectif|quels sont mes objectifs|je m'entraine pour quoi|pour quoi je m'entraine|rappelle-moi mon objectif|mon objectif c'est quoi)\b/.test(t)) return { kind: 'goal_impact' }
  if (/^(et|et pour|et le programme|et la seance|et la seance de)\s+demain\s*\??$|^demain\s*\??$|^c'est quoi demain|\bla seance de demain\b|\bqu'est-ce que je fais demain\b|\bje fais quoi demain\b|\bqu'est-ce que j'ai(?: de prevu)? demain\b|\bj'ai quoi demain\b|\bje m'entraine demain\b|\bentrainement demain\b|\bdemain (je fais quoi|c'est quoi|il y a quoi|y a quoi)\b/.test(t) && !/repas|mange|nourriture|bouffe/.test(t) && !/\b(deplace|decale|bouge|reporte|supprime|annule|saute|enleve)\b/.test(t)) {
    if (opts.topic === 'nutrition' && /^(et|et pour)\s+demain/.test(t)) return { kind: 'day_report', frame: 'tomorrow', mode: 'upcoming', domain: 'food' }
    return { kind: 'tomorrow' }
  }
  if (/^(et|et pour|et alors)\s+(ce soir|ce midi|ce matin|cet apres-midi)\s*\??$/.test(t)) {
    if (opts.topic === 'workout' || opts.topic === 'calendar') return { kind: 'today_plan' }
    const s = parseSlot(t)
    const slot = s === 'breakfast' || s === 'lunch' || s === 'dinner' || s === 'snack' ? s : 'dinner'
    return { kind: 'nutrition', slot, lowerCarb: false }
  }
  const energy = t.match(/\b(?:mon )?energie (?:est |a |c'est |niveau )?(?:a |un |une )?(10|[1-9])(?:\s*(?:\/|sur)\s*10)?\b/)
  if (energy) return { kind: 'energy_report', value: Number(energy[1]) }
  const bareScale = t.match(/^(?:je suis|je me sens|je dirais|plutot|niveau)?\s*(?:a |vers )?(10|[1-9])\s*(?:\/|sur)\s*10\s*[.!]?$/)
  if (bareScale) return { kind: 'scale_answer', value: Number(bareScale[1]) }

  // ---- Coach identity
  const rename = t.match(/(?:appelle-toi|appelle toi|je t'appelle|je vais t'appeler|tu t'appelles|tu t'appelleras|ton nom (?:c'est|sera|est)|tu seras)\s+([a-z][a-z'-]{1,20})/)
  if (rename) return { kind: 'rename_coach', name: capitalize(rename[1]) }
  if (/change de nom|change ton nom|renomme-toi|comment je t'appelle|comment dois-je t'appeler|je t'appelle comment/.test(t)) return { kind: 'rename_coach', name: '' }

  const personality = parsePersonalityFr(t)
  if (personality) return { kind: 'personality', patch: personality }

  // ---- Memory
  const remember = text.match(/^(?:s'il te plait\s+|stp\s+)?(?:retiens|souviens-toi|souviens toi|rappelle-toi|rappelle toi|note|garde en tete|garde en tête|n'oublie pas|noublie pas|memorise|mémorise)(?: bien)?(?: que| qu'| qu’)?[:,]?\s*(.+)/i)
  if (remember) return { kind: 'remember', text: cleanTail(remember[1]) }
  const forget = text.match(/^(?:s[’']il te plait\s+)?oublie(?: que| ca| ça| cela| ce que j[’']ai dit sur| l[’']histoire de| le truc de)?[:,]?\s+(.+)/i)
  if (forget) return { kind: 'forget', text: cleanTail(forget[1]) }
  if (/qu'est-ce que tu (sais|connais|as retenu|as appris|retiens) (sur|de|a propos de) moi|tu sais quoi (sur|de) moi|qu'est-ce que tu sais\b|tu retiens quoi/.test(t)) return { kind: 'what_do_you_know' }

  // ---- Weight log
  const kg = parseKg(t)
  if (kg && /\b(je pese|pese|je fais|je suis a|sur la balance|balance|ce matin|poids|note|enregistre)\b/.test(t) && !/objectif|cible|viser|vise|atteindre|arriver a|developpe|squat|souleve|veux (peser|faire|atteindre)/.test(t)) return { kind: 'log_weight', kg }
  if (/\b(note|enregistre|entre|logue|ajoute)\b.*\bpoids\b/.test(t) || /^(pesee|pesée|je me suis pese|je me suis pesee|je me pese)/.test(t)) return { kind: 'log_weight_prompt' }

  // ---- Goals
  const statesGoal = /\b(je (veux|voudrais|aimerais|souhaite|cherche a|essaie de|essaye de|dois)|j'aimerais|mon objectif|mon but|j'ai envie de)\b/.test(t) && !/\d/.test(t) && parseGoalType(t) !== undefined && !/\b(seance|entrainement|programme|plan|manger|repas|minutes?|aujourd'hui|demain)\b/.test(t)
  const changesGoal = /^(?:(?:en fait|non|finalement|hmm|attends|ok|bon),?)?\s*(?:mets|passe|plutot|fais|change (?:ca|le|mon objectif) (?:en|pour|vers)|on part sur|partons sur|va pour|je prefere|mettons)\s*(?:plutot\s+)?(?:a |en |sur |la |le |du |de la |des )?([a-z' ]{3,30})[.!?]?$/.exec(t)
  if (changesGoal && !opts.lastAvailabilityScope && parseGoalType(changesGoal[1]) !== undefined && !/\b(court|courte|long|longue|leger|legere|dur|dure|cardio|minutes?|haut|bas|jambes?)\b/.test(changesGoal[1])) return { kind: 'set_goal', goalType: parseGoalType(changesGoal[1]) }
  const liftTarget = /^(\d{2,3})\s*(?:kg|kilos?)\s+(?:au|en|de|sur le|sur la)\s+(developpe|squat|souleve de terre|bench|deadlift)/.test(t)
  if ((/\b(objectif|but|cible|viser|je vise|nouvel objectif|nouveau but|je veux (atteindre|arriver a|peser|faire|passer|monter a|descendre a))\b/.test(t) || statesGoal || liftTarget) && !/programme|plan pour|progres|progression/.test(t)) {
    const metric = /developpe|bench/.test(t) ? 'bench_press' : /squat/.test(t) ? 'squat' : /souleve de terre|deadlift/.test(t) ? 'deadlift' : /seances?|entrainements?|fois|m'entrainer/.test(t) && /semaine/.test(t) ? 'workouts_per_week' : /\bpas\b/.test(t) && /jour/.test(t) ? 'steps_per_day' : kg || /objectif de poids|poids cible|poids vise|poids de forme/.test(t) ? 'body_weight' : undefined
    const num = metric === 'workouts_per_week' ? (parseDaysPerWeek(t) ?? wordToNumber(t.match(new RegExp(`(${NUM})\\s*(?:seances?|fois|entrainements?)`))?.[1] ?? '')) : metric === 'steps_per_day' ? Number((t.match(/([\d ]{4,7})\s*pas/)?.[1] ?? '').replace(/\s/g, '')) : (kg ?? Number(t.match(/(\d{2,3})\s*(?:kg)?/)?.[1]))
    return { kind: 'set_goal', goalType: parseGoalType(t), metric, target: Number.isFinite(num) && num ? num : undefined }
  }

  // ---- Programs
  if (/\bprogramme\b/.test(t) && /\b(\d+|douze|huit|six|quatre|seize)[- ]?(semaines?|mois)|cree|crees|fais|construis|genere|prepare|nouveau programme|lance|demarre|refais|regenere|change mon programme|adapte mon programme|passe mon programme|modifie mon programme|un programme/.test(t) && !/\b(annule|arrete|stoppe|supprime|montre|affiche|voir|ouvre)\b/.test(t)) {
    return { kind: 'create_program', weeks: parseWeeks(t), goalType: parseGoalType(t), daysPerWeek: parseDaysPerWeek(t) }
  }
  if (/\b(annule|arrete|stoppe|supprime|termine|abandonne|laisse tomber)\b.*\bprogramme/.test(t) || /\bprogramme\b.*\b(annule|arrete|stop)/.test(t)) return { kind: 'cancel_program' }
  if (/(montre|affiche|voir|ouvre|ou est|c'est quoi|fais voir)\b.*\bprogramme/.test(t) || /^mon programme/.test(t) || /^(montre(-moi)?|affiche|voir) la semaine \d/.test(t)) return { kind: 'show_program' }
  if (/(montre|affiche|voir|ouvre|fais voir)\b.*\b(calendrier|agenda|planning|ma semaine)\b/.test(t) || /^(mon )?(calendrier|agenda|planning)$/.test(t)) return { kind: 'show_calendar' }

  // ---- Calendar
  const move = t.match(new RegExp(`\\b(deplace|decale|bouge|passe|mets|change|reporte|avance)\\b.*?\\b(${DAY})[a-z]*\\b.*?\\b(?:a|au|vers|sur|pour|→|->)\\s*\\b(${DAY}|demain|aujourd'hui)[a-z']*`))
  if (move) {
    const from = parseWeekday(move[2]) ?? undefined
    return { kind: 'reschedule', from, ...toTarget(move[3]) }
  }
  if (/^(?:tu peux |peux-tu )?(?:deplace|decale|bouge|reporte|mets)(?:-la|-le| la| le| ca| cette seance)?\s+(?:a |vers |sur )?(?:un autre (?:jour|moment)|une autre date|ailleurs|plus tard dans la semaine)/.test(t)) return { kind: 'reschedule', fromContext: true }
  const moveThat = t.match(new RegExp(`^(?:tu peux |peux-tu |s'il te plait )?(?:deplace|decale|bouge|mets|reporte|passe)(?:-la|-le| la| le| celle-ci| celui-ci| celle-la| celui-la| ca| cette seance| cette seance-la)?(?: plutot)?\\s+(?:a|au|vers|sur|pour)\\s+(demain|aujourd'hui|${DAY})[a-z']*`))
  if (moveThat) return { kind: 'reschedule', fromContext: true, ...toTarget(moveThat[1]) }
  const moveTodays = t.match(new RegExp(`\\b(deplace|decale|bouge|reporte|passe)\\b.*\\b(ma|la|cette|celle)\\s*(seance|entrainement|training)( d'aujourd'hui| de demain| du jour)?\\b.*\\b(?:a|au|vers|sur|pour)\\s+(demain|aujourd'hui|${DAY})[a-z']*`))
  if (moveTodays) {
    const fromRelative = moveTodays[4]?.includes('demain') ? ('tomorrow' as const) : undefined
    return { kind: 'reschedule', fromRelative, ...toTarget(moveTodays[5]) }
  }
  if (/\b(planifie|organise|prepare|structure|programme|fais|construis|cale)\b.*\b(ma |la |cette |toute la )?semaine\b/.test(t) && !/programme de/.test(t) || /^(plan|planning) de la semaine/.test(t)) return { kind: 'plan_week' }

  // ---- Progress
  if (/\b(pourquoi|comment ca se fait|c'est normal)\b.*\bpoids\b.*\b(bloque|bloquee|stagne|bouge plus|bouge pas|ne bouge|descend plus|descend pas|monte plus|monte pas|pareil|meme)\b|\bmon poids (ne )?(bouge|stagne|descend|monte) (plus|pas)\b|\bplateau\b|\bstagnation\b/.test(t)) return { kind: 'weight_stalled' }
  if (/\b(analyse|regarde|evalue|fais le point sur|fais un bilan de|resume|examine)\b.*\b(progres|progression|resultats|stats|chiffres|evolution|niveau)\b/.test(t) || /^(mes progres|ma progression|comment je progresse|comment est-ce que je progresse|est-ce que je progresse|je progresse|ou j'en suis|ou en suis-je|ou en sont mes progres|ou en est ma progression|comment ca avance|ca avance|bilan|fais le point|le point)\b/.test(t) || /comment (s'est passee|s'est passe|ca s'est passe|c'etait) (ma semaine|cette seance|la seance|mon mois|la semaine)|j'ai fait comment (cette semaine|ce mois)|comment j'ai (gere|fait) (cette semaine|ce mois)/.test(t)) return { kind: 'analyze_progress' }

  // ---- Nutrition
  if (/\b(qu'est-ce que je commande|je commande quoi|que commander|quoi commander|le menu|au menu)\b/.test(t) && !/programme/.test(t)) return { kind: 'order_advice' }
  if (/\b(restaurant|resto|je mange dehors|diner dehors|manger dehors|a emporter|livraison|soiree|mariage|anniversaire|fete)\b/.test(t)) return { kind: 'restaurant' }
  if (/\b(manger|mange|bouffer|nourriture|repas|nutrition|regime|alimentation|calories|macros|proteines?|glucides?|petit-dej|petit-dejeuner|dejeuner|diner|collation|gouter|encas|faim|cuisiner|cuisine|plat)\b/.test(t)) {
    const slot = parseSlot(t)
    return { kind: 'nutrition', slot: slot === 'pre_workout' || slot === 'post_workout' ? undefined : slot, lowerCarb: /moins de glucides|pauvre en glucides|low[- ]?carb|peu de glucides|sans glucides/.test(t) }
  }

  // ---- Workout: start / skip / delete
  if (/^(c'est parti|go|je suis pret|je suis prete|on y va|lance|lance-la|lance la seance|lance ma seance|demarre|demarre la seance|commence|commencons|allez|let's go|pret|prete|on commence|je commence|start)\b/.test(t) && !/programme/.test(t)) return { kind: 'start_workout' }
  if (/\b(supprime|enleve|retire|annule|vire|efface)\b.*\b(seance|entrainement|training|celui|celle)\b/.test(t) && !/programme|\bplan\b|repas/.test(t)) {
    const dayWord = t.match(new RegExp(`\\b(${DAY})[a-z]*\\b`))?.[1]
    const weekday = dayWord ? parseWeekday(dayWord) : null
    return { kind: 'delete_workout', when: /\bdemain/.test(t) ? 'tomorrow' : /\baujourd'hui|celle-ci|celui-ci|du jour\b/.test(t) ? 'today' : undefined, weekday: weekday ?? undefined }
  }
  if (/\b(saute|je saute|je passe mon tour|je passe aujourd'hui|je passe pour aujourd'hui|je passe la seance|je passe|je skip|pas aujourd'hui|jour de repos|repos aujourd'hui|je fais pas|pas de seance aujourd'hui|je m'entraine pas)\b/.test(t) && /(seance|entrainement|aujourd'hui|repos|la|tour|skip)/.test(t) && !/programme|repas|mange/.test(t)) return { kind: 'skip_workout' }

  // ---- Workout: modifications (require a workout in context)
  if (opts.hasWorkout || opts.topic === 'workout') {
    const eqOnly = /\b(que|seulement|juste|uniquement)\b.*\b(halteres?|barre|kettlebells?|elastiques?|poids du corps|machines?|poulies?|banc)\b|\b(halteres?|poids du corps|elastiques?|kettlebells?) (seulement|uniquement)\b|\bj'ai (que |seulement |juste )?(des |une |un |la )?(halteres?|kettlebell|elastiques?|barre)\b/.test(t)
    if (eqOnly) {
      const equipment = parseEquipment(t)
      if (equipment && parseMinutes(t) && /\b(que|seulement|juste)\b/.test(t)) return { kind: 'make_workout', constraints: { minutes: parseMinutes(t), equipment } }
      if (equipment) return { kind: 'modify_workout', change: { type: 'equipment', equipment } }
    }
    if ((/\b(raccourcis|raccourci|plus court|plus courte|moins long|moins longue|reduis|ecourte|coupe|abrege|version courte)\b/.test(t) || (/\b(que|seulement|juste)\b/.test(t) && parseMinutes(t))) && !/remplace|echange/.test(t)) return { kind: 'modify_workout', change: { type: 'shorter', minutes: parseMinutes(t) } }
    if (/\b(allonge|rallonge|plus long|plus longue|plus de temps|ajoute (du temps|des exercices|un exercice)|prolonge)\b/.test(t)) return { kind: 'modify_workout', change: { type: 'longer', minutes: parseMinutes(t) } }
    const rep = t.match(/\b(remplace|change|echange|enleve|retire|vire|supprime|pas de|je ne veux pas de|je veux pas de|je deteste|je ne peux pas faire|je peux pas faire|sans)\b\s+(?:les |le |la |l'|des |du |de la )?([a-z][a-z\- ]{2,30}?)(?:\s+(?:par|avec|contre|stp|s'il te plait|aujourd'hui)\b|[.,!?]|$)/)
    if (rep && !/seance|entrainement|cardio|ca$|la$|le$/.test(rep[2].trim())) {
      const ex = findExerciseByName(rep[2].trim())
      return { kind: 'modify_workout', change: { type: 'replace', exerciseId: ex?.id, query: rep[2].trim() } }
    }
    if (/\b(pas de|sans|enleve|retire|je ne veux pas de|je veux pas de|vire)\b.*\b(cardio|intervalles|course|courir|fractionne)\b/.test(t)) return { kind: 'modify_workout', change: { type: 'no_cardio' } }
    if (/\b(allege|allege-la|plus leger|plus legere|plus facile|moins intense|moins dur|moins dure|trop dur|trop dure|trop difficile|trop intense|vas-y doucement|doucement|moins lourd|version douce)\b/.test(t)) return { kind: 'modify_workout', change: { type: 'lighter' } }
    if (/\b(corse|corse-la|plus dur|plus dure|plus intense|plus lourd|plus lourde|pousse-moi|pousse moi|trop facile|pas assez|monte l'intensite|plus costaud|plus hard)\b/.test(t)) return { kind: 'modify_workout', change: { type: 'harder' } }
    if (/\b(autre chose|different|differente|change (la seance|de seance|tout|ca)|refais(-la| la)?|regenere|une autre|nouvelle seance|propose-moi autre chose|propose autre chose|autre seance)\b/.test(t)) {
      const focus = parseFocus(t)
      return focus ? { kind: 'modify_workout', change: { type: 'focus', focus } } : { kind: 'modify_workout', change: { type: 'regenerate' } }
    }
  }

  // ---- Workout: generation
  if (/\b(donne-moi|donne moi|fais-moi|fais moi|prepare-moi|prepare moi|je veux|il me faut)\s+(?:une seance de |un truc de |quelque chose en |un truc en |une seance en )?(\d{1,3})\s*(?:min|mn|minutes?)\b/.test(t) && !/repas|mange/.test(t)) return { kind: 'make_workout', constraints: parseWorkoutConstraintsFr(t) }
  if (/\b(mobilite|etirements?|stretching|souplesse)\b/.test(t) && /\b(plutot|juste|donne|donne-moi|fais|fais-moi|propose|seance|flow|un peu de|de la|session|a la place)\b/.test(t) && !/programme|repas/.test(t)) return { kind: 'make_workout', constraints: { ...parseWorkoutConstraintsFr(t), focus: 'core_mobility', intensity: 'light', minutes: parseMinutes(t) ?? 20 } }
  if (/\b(seance|entrainement|training|workout|exercices?|routine|wod|muscu)\b/.test(t) && /\b(fais|fais-moi|prepare|construis|cree|genere|donne|propose|planifie|veux|voudrais|faut|besoin|aujourd'hui|maintenant|nouvelle|nouveau|rapide|programme-moi|je fais quoi|c'est quoi|qu'est-ce que|lance|monte|construis-moi)\b/.test(t) && !/\bprogramme\b(?!-moi)/.test(t) && !/\b(deplace|decale|supprime|annule|saute)\b/.test(t)) {
    return { kind: 'make_workout', constraints: parseWorkoutConstraintsFr(t) }
  }
  if (/^(seance|ma seance|fais ma seance|la seance du jour|prepare ma seance du jour|ma seance du jour|seance du jour|prepare la seance|prepare ma seance)\s*[!.]?$/.test(t)) return { kind: 'make_workout', constraints: {} }
  if (/\b(planifie|prepare|prevois|organise|cale|construis)\b.*\bdemain\b|^(prepare|planifie) demain/.test(t) && !/repas|mange|nourriture/.test(t)) return { kind: 'make_workout', constraints: { forDate: 'tomorrow' } }
  if (/\b(je n'ai que|j'ai que|j'ai seulement|j'ai juste|je n'ai)\s+(\d+)|\bj'ai (\d+) ?min|\b(\d+) ?min(utes?)? (aujourd'hui|seulement|max)|\bque (\d+) ?min/.test(t)) return { kind: 'make_workout', constraints: parseWorkoutConstraintsFr(t) }
  if (/\b(je n'ai que|j'ai que|j'ai seulement|j'ai juste) (des |une |un |le |la )?(halteres?|elastiques?|kettlebell|poids du corps|barre)\b|\bpas de salle\b|\ba la maison aujourd'hui\b|\bsalle d'hotel\b|\bsans materiel\b/.test(t)) return { kind: 'make_workout', constraints: parseWorkoutConstraintsFr(t) }

  // ---- Day state
  if (/\b(mal dormi|pas bien dormi|mauvaise nuit|nuit (courte|blanche|pourrie|horrible|difficile)|pas dormi|peu dormi|tres peu dormi|insomnie|dormi (\d|que))\b/.test(t)) {
    const h = t.match(/(\d(?:[.,]\d)?)\s*(?:heures?|h\b)/)
    return { kind: 'slept_badly', hours: h ? Number(h[1].replace(',', '.')) : undefined }
  }
  if (/\b(fatigue|fatiguee|creve|crevee|epuise|epuisee|naze|mort|morte|vide|videe|a plat|pas d'energie|peu d'energie|claque|claquee|lessive|lessivee|hs|ko|au bout de ma vie|explose|explosee|vanne|vannee)\b/.test(t)) {
    const inline = t.match(/\b(10|[1-9])\s*(?:\/|sur)\s*10\b/)
    return { kind: 'tired', scale: opts.expects === 'fatigue_scale' ? parseScale(t) : inline ? Number(inline[1]) : undefined }
  }
  if (/\b(en (pleine |super |grande )?forme|plein d'energie|pleine d'energie|la peche|la patate|bien dormi|super bien dormi|pret a tout|prete a tout|chaud|chaude|motive|motivee|frais|fraiche|au top|d'attaque|en feu|je me sens (super |tres |vraiment |trop )?(bien|fort|forte|en forme)|ca va (super|tres bien|nickel)|je suis (super|tres) bien)\b/.test(t)) return { kind: 'feeling_good' }
  if (/\b(qu'est-ce que je fais aujourd'hui|qu'est ce que je fais aujourd'hui|je fais quoi aujourd'hui|c'est quoi (le programme|le plan|la seance|au programme) (du jour|d'aujourd'hui|aujourd'hui)|quoi de prevu aujourd'hui|au programme aujourd'hui|la seance du jour|qu'est-ce qu'on fait aujourd'hui|on fait quoi aujourd'hui|c'est quoi le plan|le plan du jour|programme du jour)\b/.test(t) || /^(aujourd'hui|aujourd'hui ?\?|et aujourd'hui ?\?)$/.test(t)) return { kind: 'today_plan' }

  // ---- Small talk
  if (/^(salut|bonjour|bonsoir|hello|coucou|hey|yo|bjr|slt|hola|re)\b/.test(t)) return { kind: 'greeting' }
  if (/^(merci|super|parfait|genial|top|nickel|cool|excellent|j'adore|impeccable|au top|merci beaucoup|trop bien)\b/.test(t)) return { kind: 'thanks' }
  if (/^(oui|ouais|ok|okay|d'accord|vas-y|vas y|allez|carrement|bien sur|volontiers|ca marche|ca me va|parfait|go|yes|absolument|evidemment|o)\b/.test(t)) return { kind: 'yes' }
  if (/^(non|nan|pas maintenant|plus tard|non merci|pas tout de suite|laisse tomber|n)\b/.test(t)) return { kind: 'no' }
  if (/\b(qu'est-ce que tu (sais|peux) faire|aide|aide-moi|comment ca marche|tu es qui|t'es qui|tu fais quoi|c'est quoi (sportly|cette app)|tes capacites)\b/.test(t)) return { kind: 'help' }

  return { kind: 'unknown' }
}

export function parseWorkoutConstraintsFr(t: string): WorkoutConstraintsParsed {
  const c: WorkoutConstraintsParsed = {}
  const minutes = parseMinutes(t)
  if (minutes) c.minutes = Math.min(120, Math.max(10, minutes))
  const eq = parseEquipment(t)
  if (eq && /\b(que|seulement|juste|uniquement|j'ai|avec|a la maison|hotel|pas de salle|sans)\b/.test(t)) c.equipment = eq
  if (/\bpas de cardio\b|sans cardio|zero cardio/.test(t)) c.noCardio = true
  const focus = parseFocus(t)
  if (focus) c.focus = focus
  if (/\b(leger|legere|facile|douce|doux|recup|tranquille|cool)\b/.test(t)) c.intensity = 'light'
  if (/\b(dur|dure|brutal|brutale|intense|lourd|lourde|costaud|hard|explosive|a fond)\b/.test(t)) c.intensity = 'hard'
  if (/demain/.test(t)) c.forDate = 'tomorrow'
  return c
}

function parsePersonalityFr(t: string): { motivation?: number; tone?: number; humor?: number; communication?: number } | undefined {
  if (!/\b(sois|soit|parle|reponds|reponds-moi|tu peux etre|je veux que tu|j'aimerais que tu|t'es trop|tu es trop|fais-moi des|fais moi des|change de ton|arrete d'etre|plus de|moins de|motive-moi|pousse-moi|calme-toi|explique)\b/.test(t)) return undefined
  const p: { motivation?: number; tone?: number; humor?: number; communication?: number } = {}
  if (/\b(plus direct|plus directe|plus cash|plus franc|plus franche|sans detour|moins doux|moins douce|plus sec|plus dur avec moi|plus ferme|dis-moi les choses)\b/.test(t)) p.tone = 85
  if (/\b(plus doux|plus douce|plus gentil|plus gentille|plus sympa|moins dur|moins dure|moins direct|moins directe|trop dur|trop direct|trop cash|plus bienveillant|plus bienveillante)\b/.test(t)) p.tone = 15
  if (/\b(plus intense|motive-moi|motive moi|pousse-moi|pousse moi|plus motivant|plus motivante|mets-moi la pression|chauffe-moi|booste-moi|plus d'energie)\b/.test(t)) p.motivation = 88
  if (/\b(plus calme|calme-toi|calme toi|moins intense|trop intense|moins de pression|plus posé|plus pose|plus zen|tranquille|moins hype|moins de hype)\b/.test(t)) p.motivation = 15
  if (/\b(plus drole|plus fun|plus de blagues|plus joueur|plus joueuse|plus leger|plus legere|fais-moi rire|plus d'humour|moins serieux|moins serieuse)\b/.test(t)) p.humor = 85
  if (/\b(plus serieux|plus serieuse|pas de blagues|sans blague|sans blagues|moins de blagues|arrete les blagues|arrete de blaguer|trop de blagues|reste serieux)\b/.test(t)) p.humor = 8
  if (/\b(plus court|plus courte|plus courtes|reponses plus courtes|concis|concise|bref|breve|moins long|moins longue|moins de blabla|trop long|trop longue|va droit au but|moins de details|moins de detail|sois bref)\b/.test(t)) p.communication = 12
  if (/\b(plus de details|plus de detail|explique plus|explique-moi plus|explique moi plus|plus long|plus longue|reponses plus longues|developpe|detaille|plus de contexte|explique pourquoi)\b/.test(t)) p.communication = 88
  return Object.keys(p).length ? p : undefined
}

/** Split “saumon grillé avec du riz, pâtes au poulet ou un burger et des frites” into dishes; “et” only separates inside a comma list. */
export function splitOptionsFr(text: string): string[] {
  const body = straightenQuotes(text)
    .replace(/^.*?(?:qu'est-ce que tu (?:choisirais|prendrais|commanderais|me conseilles)|tu (?:prendrais|choisirais) quoi|je prends quoi|aide-moi a choisir|aide moi a choisir|lequel (?:choisir|prendre|je prends)|laquelle (?:choisir|prendre)|tu me conseilles quoi)\??\s*(?::|—|–|entre|parmi)?\s*/i, '')
    .replace(/\?+$/, '')
  const chunks = body.split(/,|\bou\b|\n|;|\//i)
  const parts = body.includes(',') && !/\bou\b/i.test(body) ? chunks.flatMap((c) => c.split(/\bet\b/i)) : chunks
  return parts
    .map((s) => s.replace(/^(le|la|les|un|une|des|du|de la|peut-etre|peut-être|soit)\s+/i, '').trim())
    .filter((s) => s.length > 2)
    .slice(0, 6)
}

/** French clause splitting for compound requests (“…, …, et crée un programme de 12 semaines”). */
export function splitClausesFr(text: string): string[] {
  return text.split(/\s*[,;]\s*(?:et\s+|puis\s+|ensuite\s+)?|\s+et\s+(?:puis\s+|ensuite\s+)?(?=je\b|j'|j’|cree|crée|fais|planifie|prepare|prépare|construis|retiens|note|mets|enregistre|donne|deplace|déplace|appelle|sois|mange|seulement|aussi|mon|ma|mes|un\b|une\b|le\b|la\b|les\b|des\b|du\b)|\s+puis\s+|\s+ensuite\s+/i)
}

/* ------------------------------------------------------------------ Meal corrections */

const FOOD_WORD = "([a-z][a-z' \\-]{2,25}?)"

/** Parse natural French corrections to a meal in context. Order-preserving; several can stack. */
export function parseMealCorrectionsFr(raw: string): MealCorrection[] {
  const t = normalizeForMatching(raw).replace(/[.!]+$/, '').trim()
  const out: MealCorrection[] = []
  const slot = parseSlot(t)
  if (slot && /\b(c'etait|c'est|en fait|plutot|compte|note|mets|considere|enregistre|classe|c'etait pas|c'etait plutot)\b/.test(t) && !/^(ajoute|enregistre|note|mets)/.test(t)) out.push({ type: 'slot', slot })
  // Portion of the whole meal: “je n'en ai mangé que la moitié”, “j'ai mangé la moitié”, “seulement le tiers”
  const half = t.match(/\b(?:j'en ai |j'ai |j'ai pris |j'ai fini |j'en ai pris |j'ai bouffe )?(?:mange |pris |fini |bouffe )?(?:que |seulement |juste |environ |a peu pres )*(la moitie|une moitie|le tiers|un tiers|les deux tiers|les trois quarts|le quart|un quart|presque tout|tout)\b/) ?? t.match(/^(?:que |seulement |juste )?(la moitie|le tiers|un tiers|les deux tiers|les trois quarts|le quart|un quart)( du repas| de ca| de tout)?$/)
  if (half && /moitie|tiers|quart|tout/.test(half[1]) && !/\b(plus|moins) de\b/.test(t)) {
    const w = half[1]
    const factor = /moitie/.test(w) ? 0.5 : /deux tiers/.test(w) ? 0.67 : /tiers/.test(w) ? 0.33 : /trois quarts/.test(w) ? 0.75 : /quart/.test(w) ? 0.25 : /presque tout/.test(w) ? 0.8 : 1
    if (factor !== 1) out.push({ type: 'scale', factor })
  }
  if (/\b(le double|deux fois plus|j'en ai (pris|mange) deux|deux fois ca)\b/.test(t) && !/\bde (riz|poulet|pates|sauce|pain|salade|legumes|fromage|oeufs|frites)\b/.test(t)) out.push({ type: 'scale', factor: 2 })
  // Explicit grams: “200 g de riz”, “le riz c'était 200 g”, “riz 200 g”
  const gramsRe = new RegExp(`(\\d{2,4})\\s?(?:g|gr|grammes?)\\s+(?:de |d'|du |des |de la )?${FOOD_WORD}(?=$|,|\\bet\\b|\\bpas\\b|\\.)|(?:le |la |les |l')?${FOOD_WORD}\\s+(?:c'etait|c'est|faisait|faisaient|etait|etaient|pesait|pesaient|fait|font)\\s+(?:environ |a peu pres |plutot |dans les )?(\\d{2,4})\\s?(?:g|gr|grammes?)\\b`, 'g')
  let m: RegExpExecArray | null
  while ((m = gramsRe.exec(t))) {
    const grams = Number(m[1] ?? m[4])
    const food = (m[2] ?? m[3]).replace(/^(le |la |les |l'|de |du |des |mon |ma )+/, '').trim()
    if (grams && food && findFoodsInText(food).length > 0) out.push({ type: 'set_grams', food, grams })
  }
  // Counts: “il y avait deux blancs de poulet”, “3 oeufs”, “deux tranches de pain”
  const countRe = new RegExp(`\\b(?:il y avait|y avait|c'etait|j'ai mange|j'ai pris|j'en ai mange|j'en ai pris)?\\s*(${NUM})\\s+(?:(?:gros|grosse|grosses|grand|grande|grands|grandes|petit|petite|petits|petites|entier|entiere)\\s+)?(?:(?:tranches?|morceaux?|tasses?|bols?|assiettes?|doses?|verres?|filets?|parts?|poignees?) (?:de |d'|du |des |de la ))?${FOOD_WORD}(?=s?\\b(?:,|$|\\bet\\b|\\bpas\\b))`, 'g')
  while ((m = countRe.exec(t))) {
    const count = wordToNumber(m[1])
    const food = m[2].trim()
    if (!count || /^(g|gr|grammes?|kg|ml|cl|minutes?|heures?|de|fois)$/.test(food) || /^(peu|petit|petite|autre|seul|seule)\b/.test(food)) continue
    if (findFoodsInText(food).length === 0) continue
    if (out.some((c) => c.type === 'set_grams' && c.food === food)) continue
    out.push({ type: 'set_count', food, count })
  }
  // Remove: “sans sauce”, “enlève la sauce”, “retire le fromage”, “il n'y avait pas de sauce”, “pas de pain”
  const removeRe = new RegExp(`\\b(?:sans|enleve|retire|vire|supprime|efface|oublie|zappe|moins la|moins le|moins les|il n'y avait pas de|il n'y avait pas d'|y avait pas de|y avait pas d'|pas de|pas d'|il n'y a pas de)\\s+(?:la |le |les |l'|de |du |des |d'|ce |cette )?${FOOD_WORD}(?=$|,|\\bet\\b|\\bmais\\b|\\ben fait\\b|\\.)`, 'g')
  while ((m = removeRe.exec(t))) {
    const food = m[1].trim()
    if (/^(sauce|fromage|riz|pain|huile|beurre|vinaigrette|mayo|mayonnaise|frites|dessert|patates|pommes de terre|pates|salade|legumes|avocat|oeuf|oeufs|haricots|poulet|saumon|noix|miel|sucre|creme|vin|biere|jus|lait|bacon|jambon|tomate|tomates|ketchup)$/.test(food) || out.length === 0) {
      if (!/^(ca|ceci|cela|le repas|repas|dejeuner|diner|petit-dejeuner|cardio|seance)$/.test(food)) out.push({ type: 'remove', food })
    }
  }
  // More / less: “il y avait plus de riz”, “moins de sauce”, “un peu plus de pâtes”, “beaucoup moins de riz”
  const moreRe = new RegExp(`\\b(?:il y avait |y avait |avec |j'ai pris |c'etait |en fait )?(plus|moins|beaucoup plus|beaucoup moins|bien plus|bien moins|un peu plus|un peu moins|vraiment plus|vraiment moins|le double de|la moitie de|presque pas de|tres peu de|pas tant de|pas autant de|plus de|moins de)\\s+(?:de |d'|du |des |de la |la |le |les )?${FOOD_WORD}(?=$|,|\\bet\\b|\\bque\\b|\\bmais\\b|\\.)`, 'g')
  while ((m = moreRe.exec(t))) {
    const word = m[1]
    const food = m[2].replace(/^(le |la |les |l')/, '').trim()
    if (out.some((c) => (c.type === 'set_grams' || c.type === 'set_count' || c.type === 'remove') && c.food === food)) continue
    if (findFoodsInText(food).length === 0 && !/^(sauce|vinaigrette|huile|beurre|creme)$/.test(food)) continue
    const isLess = /moins|moitie|presque pas|tres peu|pas tant|pas autant/.test(word)
    const factor = /beaucoup|bien|vraiment|double/.test(word) ? (isLess ? 0.5 : 2) : /un peu/.test(word) ? (isLess ? 0.8 : 1.25) : isLess ? 0.6 : 1.5
    out.push(isLess ? { type: 'less', food, factor } : { type: 'more', food, factor })
  }
  // Add: “ajoute un oeuf”, “il y avait aussi du fromage”, “plus une bière”, “et une tranche de pain”, “avec du fromage”
  const addRe = new RegExp(`(?:^|\\b)(?:ajoute|rajoute|plus|aussi|il y avait aussi|y avait aussi|et aussi|avec|et)\\s+(?:un |une |des |du |de la |de l'|d'|le |la |les )?${FOOD_WORD}(?=$|,|\\.|\\bet\\b)`, 'g')
  while ((m = addRe.exec(t))) {
    const food = m[1].trim()
    if (/^(ca|ceci|cela|le repas|repas|sauce a part|au (dejeuner|diner|petit-dejeuner)|en collation)$/.test(food)) continue
    if (/^(de|d'|du|des)\s/.test(food) || out.some((c) => (c.type === 'more' || c.type === 'less') && food.includes(c.food))) continue
    if (out.some((c) => c.type !== 'slot' && c.type !== 'scale' && c.type !== 'add' && (c as { food?: string }).food === food)) continue
    if (/^(plus|moins|pas|sans|aucun|aucune)\b/.test(food)) continue
    if (findFoodsInText(food).length === 0) continue
    out.push({ type: 'add', text: food })
  }
  return out
}

import type { Attachment, FoodItem, FoodUnit, LoggedMeal, Meal } from '@/domain/types'
import { foodName, mealSlotIn } from '@/domain/labels'
import { translator } from '@/i18n'
import { getLanguage } from '@/i18n/runtime'
import type { Language } from '@/i18n/types'
import { foldText, straightenQuotes } from '@/lib/text'
import { round, uid } from '@/lib/utils'
import { findFood, findFoodsInText, FOOD_MAP, type FoodRef } from './foodDatabase'

/**
 * Food analysis is behind a provider interface so a real multimodal model can
 * slot in. The local provider is honest: it never claims to have "seen" an image.
 * Descriptions are understood in English and French; item ids, grams and macros
 * are language-independent and only the displayed names change.
 */
export interface FoodAnalysis {
  items: FoodItem[]
  name: string
  confidence: number
  notes: string[]
  /** 'vision' only when an image was genuinely interpreted by a model. */
  analysis: LoggedMeal['analysis']
  /** True when the input could not be interpreted and the user should describe it. */
  needsDescription?: boolean
}

export interface FoodAnalysisRequest {
  text?: string
  image?: { attachment: Attachment; base64?: string; mediaType?: string }
  locale?: string
  language?: Language
}

export interface FoodAnalysisProvider {
  id: 'local' | 'anthropic-vision'
  supportsImages: boolean
  analyze(req: FoodAnalysisRequest): Promise<FoodAnalysis>
}

/* ------------------------------------------------------------------ Quantity parsing */

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, quarter: 0.25, double: 2, couple: 2, few: 3, some: 1,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six_: 6, demi: 0.5, moitie: 0.5, quart: 0.25, quelques: 3,
}

function parseNumber(s: string | undefined): number | undefined {
  if (!s) return undefined
  const t = foldText(s.toLowerCase().trim())
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t]
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split('/').map(Number)
    return b ? a / b : undefined
  }
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

interface Portion {
  quantity: number
  unit: FoodUnit
  grams: number
  guessed: boolean
}

const OF = "(?:of|de|d'|des|du|de la)"
const NUMWORD = "\\d+(?:[.,]\\d)?|\\d\\/\\d|one|two|three|four|five|six|a|an|half(?: a| an)?|couple of|few|un|une|deux|trois|quatre|cinq|demi|une demi|la moitie d'un|la moitie d'une|quelques"
const MEASURE = '(slices?|pieces?|cups?|tbsp|tablespoons?|bowls?|plates?|handfuls?|scoops?|glass(?:es)?|portions?|servings?|fillets?|pints?|tranches?|morceaux?|tasses?|bols?|assiettes?|poignees?|doses?|verres?|filets?|cuilleres? a soupe|cuilleres?|parts?|pintes?)'

/** Resolve a portion for a food from any quantity phrase found near it. `before` and `after` are folded, lower-case text. */
function portionFor(ref: FoodRef, before: string, after: string): Portion {
  // A weight binds only to the food it sits next to (“80 g oats, a banana” must not make the banana 80 g):
  // directly before it (allowing “of”/“de” and one descriptor word) or directly after it (“chicken 200 g”, “poulet (200g)”).
  const b = before
  const a = after
  const gramsBefore = b.match(new RegExp(`(\\d{1,4}(?:[.,]\\d)?)\\s?(g|gr|grams?|grammes?|kg)\\b\\s+(?:${OF}\\s*)?(?:(?!(?:with|and|plus|or|then|of|avec|et|ou|puis|de|du|des)\\s)[a-z-]+\\s+)?$`))
  const gramsAfter = a.match(/^\s*[(,]?\s*(?:about|around|roughly|environ|a peu pres)?\s*(\d{1,4}(?:[.,]\d)?)\s?(g|gr|grams?|grammes?|kg)\b/)
  const gramsMatch = gramsAfter ?? gramsBefore
  if (gramsMatch) {
    const n = Number(gramsMatch[1].replace(',', '.'))
    const grams = gramsMatch[2] === 'kg' ? n * 1000 : n
    return { quantity: grams, unit: 'g', grams, guessed: false }
  }
  const mlMatch = b.match(new RegExp(`(\\d{2,4})\\s?(ml|millilit\\w*|cl)\\s+(?:${OF}\\s*)?(?:[a-z-]+\\s+)?$`)) ?? a.match(/^\s*[(,]?\s*(\d{2,4})\s?(ml|millilit|cl)/)
  if (mlMatch) {
    const n = Number(mlMatch[1]) * (mlMatch[2] === 'cl' ? 10 : 1)
    return { quantity: n, unit: 'ml', grams: n, guessed: false }
  }
  // Size words only count when they sit right next to the food.
  const near = `${b.split(/\s+/).slice(-3).join(' ')} ${a.split(/\s+/).slice(0, 2).join(' ')}`
  const bigness = /\b(big|large|huge|massive|double|extra|gros|grosse|grand|grande|enorme|geant|geante)\b/.test(near) ? 1.5 : /\b(small|little|mini|light|petit|petite|leger|legere)\b/.test(near) ? 0.65 : 1
  // "two chicken breasts", "3 eggs", "a slice of bread", "deux tranches de pain", "un bol de riz", "la moitié d'une pizza"
  const countMatch = b.match(new RegExp(`(${NUMWORD})\\s+(?:${MEASURE}\\s+(?:${OF}\\s*)?)?(?:[a-z]+\\s+)?$`))
  if (countMatch) {
    const raw = countMatch[1].replace(/ a$| an$|couple of|la moitie d'une?|une demi/, (m) => (m.startsWith('la moitie') || m === 'une demi' ? 'demi' : '')).trim()
    const n = parseNumber(raw) ?? 1
    const measure = countMatch[2]?.replace(/s$/, '')
    const isCup = measure === 'cup' || measure === 'tasse'
    const isTbsp = measure === 'tbsp' || measure === 'tablespoon' || measure === 'cuillere a soupe' || measure === 'cuillere'
    const isSlice = measure === 'slice' || measure === 'tranche' || measure === 'part'
    const isServing = measure === 'bowl' || measure === 'plate' || measure === 'portion' || measure === 'serving' || measure === 'bol' || measure === 'assiette' || measure === 'dose'
    const isHandful = measure === 'handful' || measure === 'scoop' || measure === 'poignee'
    const isGlass = measure === 'glass' || measure === 'glasse' || measure === 'pint' || measure === 'verre' || measure === 'pinte'
    const isPiece = measure === 'fillet' || measure === 'piece' || measure === 'morceau' || measure === 'morceaux' || measure === 'filet'
    if (isCup) return { quantity: n, unit: 'cup', grams: n * (ref.pieceGrams ?? ref.serving), guessed: false }
    if (isTbsp) return { quantity: n, unit: 'tbsp', grams: n * 15, guessed: false }
    if (isSlice) return { quantity: n, unit: 'slice', grams: n * (ref.pieceGrams ?? 30), guessed: false }
    if (isServing) return { quantity: n, unit: 'serving', grams: n * ref.serving * bigness, guessed: false }
    if (isHandful) return { quantity: n, unit: 'serving', grams: n * 30, guessed: false }
    if (isGlass) return { quantity: n, unit: 'serving', grams: n * (measure === 'pint' || measure === 'pinte' ? 568 : ref.pieceGrams ?? 250), guessed: false }
    if (isPiece) return { quantity: n, unit: 'piece', grams: n * (ref.pieceGrams ?? ref.serving), guessed: false }
    if (ref.pieceGrams && ref.unitLabel === 'piece') return { quantity: n, unit: 'piece', grams: n * ref.pieceGrams, guessed: false }
    if (ref.pieceGrams && ref.unitLabel === 'slice') return { quantity: n, unit: 'slice', grams: n * ref.pieceGrams, guessed: false }
    return { quantity: n, unit: 'serving', grams: n * ref.serving * bigness, guessed: n === 1 }
  }
  return { quantity: 1, unit: 'serving', grams: ref.serving * bigness, guessed: true }
}

export function itemFromRef(ref: FoodRef, grams: number, quantity: number, unit: FoodUnit, confidence: number): FoodItem {
  const k = grams / 100
  return {
    id: uid('fi'),
    foodId: ref.id,
    // Stored name is the English canonical; screens render foodItemName() in the user's language.
    name: ref.name,
    quantity: round(quantity, 2),
    unit,
    grams: round(grams),
    calories: round(ref.per100.kcal * k),
    proteinG: round(ref.per100.p * k, 1),
    carbsG: round(ref.per100.c * k, 1),
    fatG: round(ref.per100.f * k, 1),
    fiberG: ref.per100.fiber !== undefined ? round(ref.per100.fiber * k, 1) : undefined,
    confidence,
  }
}

/** Re-derive an item's macros after its grams changed. */
export function rescaleItem(item: FoodItem, grams: number): FoodItem {
  const ref = item.foodId ? FOOD_MAP[item.foodId] : undefined
  const factor = item.grams > 0 ? grams / item.grams : 1
  const base = ref ? itemFromRef(ref, grams, item.unit === 'g' || item.unit === 'ml' ? grams : item.quantity * factor, item.unit, item.confidence) : undefined
  if (base) return { ...base, id: item.id, name: item.name }
  return {
    ...item,
    grams: round(grams),
    quantity: item.unit === 'g' || item.unit === 'ml' ? round(grams) : round(item.quantity * factor, 2),
    calories: round(item.calories * factor),
    proteinG: round(item.proteinG * factor, 1),
    carbsG: round(item.carbsG * factor, 1),
    fatG: round(item.fatG * factor, 1),
    fiberG: item.fiberG !== undefined ? round(item.fiberG * factor, 1) : undefined,
  }
}

export function totalsOf(items: FoodItem[]): Pick<LoggedMeal, 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG'> {
  return {
    calories: round(items.reduce((a, i) => a + i.calories, 0)),
    proteinG: round(items.reduce((a, i) => a + i.proteinG, 0)),
    carbsG: round(items.reduce((a, i) => a + i.carbsG, 0)),
    fatG: round(items.reduce((a, i) => a + i.fatG, 0)),
    fiberG: round(items.reduce((a, i) => a + (i.fiberG ?? 0), 0)),
  }
}

/** Display name of a food item in the user's language. */
export function foodItemName(i: Pick<FoodItem, 'foodId' | 'name'>, lang: Language = getLanguage()): string {
  return foodName(i.foodId, i.name, lang)
}

/** Parse a free-text meal description (English or French) into food items. Pure and deterministic. */
export function analyzeDescription(text: string, lang: Language = getLanguage()): FoodAnalysis {
  const tr = translator(lang)
  const cleaned = straightenQuotes(text)
    .replace(/^(i (just )?(ate|had|eat)|i'?m eating|for (breakfast|lunch|dinner)|log|this (is|was)|it'?s|it was)\s*/i, '')
    .replace(/^(j'ai (mange|mangé|pris|bouffe|bouffé)|je viens de manger|je mange|j'ai eu|au (petit-dejeuner|petit-déjeuner|petit dej|dejeuner|déjeuner|diner|dîner|gouter|goûter)|pour (le )?(petit-dejeuner|petit-déjeuner|dejeuner|déjeuner|diner|dîner)|c'(est|etait|était)|ce (midi|soir|matin)|enregistre|note)\s*(?:,\s*)?/i, '')
    .trim()
  const found = findFoodsInText(cleaned)
  const items: FoodItem[] = []
  const notes: string[] = []
  const lower = foldText(cleaned.toLowerCase())
  for (let i = 0; i < found.length; i++) {
    const { ref, index, match } = found[i]
    const before = lower.slice(Math.max(0, index - 40), index)
    const after = lower.slice(index + match.length, index + match.length + 30)
    const p = portionFor(ref, before, after)
    items.push(itemFromRef(ref, p.grams, p.quantity, p.unit, p.guessed ? 0.55 : 0.85))
  }
  // Implicit oil/sauce for cooked proteins when the user mentions "fried"/"frit" or "creamy"/"à la crème".
  if (/\b(fried|frit|frits|frite|poele|poelee|poeles|sautes?|saute)\b/.test(lower) && !items.some((i) => i.foodId === 'olive_oil')) items.push(itemFromRef(FOOD_MAP.olive_oil, 12, 1, 'tbsp', 0.5))
  if (/\b(creamy|a la creme|cremeux|cremeuse)\b/.test(lower) && !items.some((i) => i.foodId === 'creamy_sauce')) items.push(itemFromRef(FOOD_MAP.creamy_sauce, 60, 4, 'tbsp', 0.5))
  const guessed = items.filter((i) => i.confidence < 0.7)
  if (!items.length) {
    return { items: [], name: cleaned, confidence: 0, notes: [tr.t('foodNote.noMatch')], analysis: 'local-estimate', needsDescription: true }
  }
  if (guessed.length) notes.push(tr.t('foodNote.assumedPortions', { foods: guessed.map((i) => foodItemName(i, lang).toLowerCase()).join(', ') }))
  const sauces = items.filter((i) => FOOD_MAP[i.foodId ?? '']?.category === 'sauce')
  if (sauces.length) notes.push(tr.t('foodNote.sauces'))
  const confidence = round(items.reduce((a, i) => a + i.confidence, 0) / items.length, 2)
  return { items, name: mealName(items), confidence, notes, analysis: 'local-estimate' }
}

/** The main items of a meal, protein first, then the main carb, then the rest. */
function mainItems(items: FoodItem[]): FoodItem[] {
  const rank = (i: FoodItem) => {
    const cat = FOOD_MAP[i.foodId ?? '']?.category
    return cat === 'protein' ? 0 : cat === 'mixed' ? 1 : cat === 'carb' ? 2 : cat === 'sauce' ? 5 : cat === 'fat' ? 4 : 3
  }
  return [...items].sort((a, b) => rank(a) - rank(b) || b.calories - a.calories).slice(0, 3)
}

/** English canonical meal name (stored): “Chicken breast, Rice & vegetables”. Screens render mealDisplayName(). */
export function mealName(items: FoodItem[], lang: Language = 'en'): string {
  const main = mainItems(items).map((i) => foodItemName(i, lang))
  if (!main.length) return foodName('meal', 'Meal', lang)
  if (main.length === 1) return main[0]
  const amp = lang === 'fr' ? 'et' : '&'
  return `${main.slice(0, -1).join(', ')} ${amp} ${main[main.length - 1].toLowerCase()}`
}

/**
 * The meal name in the user's language. A meal whose items all come from the
 * food database is renamed from its items; anything else (vision results, older
 * data, user-named meals) keeps its stored name.
 */
export function mealDisplayName(meal: Pick<LoggedMeal, 'name' | 'items'>, lang: Language = getLanguage()): string {
  if (lang === 'en') return meal.name
  const derivable = meal.items.length > 0 && meal.items.every((i) => i.foodId && FOOD_MAP[i.foodId]) && meal.name === mealName(meal.items, 'en')
  return derivable ? mealName(meal.items, lang) : meal.name
}

/** Replace a meal's items and re-derive its totals and name. Used by UI edits and corrections alike. */
export function withItems(meal: LoggedMeal, items: FoodItem[], extra: Partial<LoggedMeal> = {}): LoggedMeal {
  const t = totalsOf(items)
  // Portion changes keep the name; only adding or removing foods renames the meal.
  const sameFoods = items.length === meal.items.length && items.every((i) => meal.items.some((m) => m.id === i.id))
  const name = extra.name ?? (sameFoods || !items.length ? meal.name : mealName(items))
  return { ...meal, ...extra, items, ...t, name, updatedAt: new Date().toISOString() }
}

/* ------------------------------------------------------------------ Corrections */

export type MealCorrection =
  | { type: 'scale'; factor: number }
  | { type: 'set_grams'; food: string; grams: number }
  | { type: 'set_count'; food: string; count: number }
  | { type: 'more'; food: string; factor?: number }
  | { type: 'less'; food: string; factor?: number }
  | { type: 'remove'; food: string }
  | { type: 'add'; text: string }
  | { type: 'slot'; slot: Meal['slot'] }

function matchItem(meal: LoggedMeal, food: string): FoodItem | undefined {
  const ref = findFood(food)
  const q = foldText(food.toLowerCase())
  const names = (i: FoodItem) => [i.name, foodName(i.foodId, i.name, 'fr')].map((n) => foldText(n.toLowerCase()))
  return meal.items.find((i) => (ref && i.foodId === ref.id) || names(i).some((n) => n.includes(q) || q.includes(n)))
}

export interface CorrectionResult {
  meal: LoggedMeal
  applied: boolean
  summary: string
}

/** Apply a correction to a meal, returning a new meal (no duplicates). Summaries are in the given language. */
export function applyCorrection(meal: LoggedMeal, c: MealCorrection, lang: Language = getLanguage()): CorrectionResult {
  const tr = translator(lang)
  const nameOf = (i: FoodItem) => foodItemName(i, lang).toLowerCase()
  const finish = (items: FoodItem[], summary: string, extra: Partial<LoggedMeal> = {}): CorrectionResult => ({ meal: withItems(meal, items, extra), applied: true, summary })
  switch (c.type) {
    case 'scale': {
      const items = meal.items.map((i) => rescaleItem(i, i.grams * c.factor))
      return finish(items, c.factor === 0.5 ? tr.t('foodCorrection.halved') : c.factor < 1 ? tr.t('foodCorrection.scaledDown', { pct: Math.round(c.factor * 100) }) : tr.t('foodCorrection.scaledUp', { pct: Math.round(c.factor * 100) }), { portionScale: round(meal.portionScale * c.factor, 2) })
    }
    case 'set_grams': {
      const item = matchItem(meal, c.food)
      if (!item) return { meal, applied: false, summary: tr.t('foodCorrection.notInMeal', { food: c.food }) }
      return finish(meal.items.map((i) => (i.id === item.id ? { ...rescaleItem(i, c.grams), unit: 'g', quantity: c.grams, confidence: 0.95 } : i)), tr.t('foodCorrection.setGrams', { food: nameOf(item), grams: c.grams }))
    }
    case 'set_count': {
      const item = matchItem(meal, c.food)
      if (!item) return { meal, applied: false, summary: tr.t('foodCorrection.notInMeal', { food: c.food }) }
      const ref = item.foodId ? FOOD_MAP[item.foodId] : undefined
      const per = ref?.pieceGrams ?? (item.quantity > 0 ? item.grams / item.quantity : item.grams)
      const unit: FoodUnit = ref?.unitLabel && ref.unitLabel !== 'g' ? ref.unitLabel : 'piece'
      return finish(meal.items.map((i) => (i.id === item.id ? { ...rescaleItem(i, per * c.count), quantity: c.count, unit, confidence: 0.9 } : i)), tr.t('foodCorrection.setCount', { food: foodItemName(item, lang), count: c.count }))
    }
    case 'more':
    case 'less': {
      const item = matchItem(meal, c.food)
      if (!item) return { meal, applied: false, summary: tr.t('foodCorrection.notInMeal', { food: c.food }) }
      const factor = c.factor ?? (c.type === 'more' ? 1.5 : 0.6)
      return finish(meal.items.map((i) => (i.id === item.id ? rescaleItem(i, i.grams * factor) : i)), tr.t(c.type === 'more' ? 'foodCorrection.more' : 'foodCorrection.less', { food: nameOf(item), grams: Math.round(item.grams * factor) }))
    }
    case 'remove': {
      const item = matchItem(meal, c.food)
      if (!item) return { meal, applied: false, summary: tr.t('foodCorrection.noSuch', { food: c.food }) }
      return finish(meal.items.filter((i) => i.id !== item.id), tr.t('foodCorrection.removed', { food: nameOf(item) }))
    }
    case 'add': {
      const extra = analyzeDescription(c.text, lang)
      if (!extra.items.length) return { meal, applied: false, summary: extra.notes[0] }
      const items = [...meal.items]
      for (const it of extra.items) {
        const existing = items.find((x) => x.foodId && x.foodId === it.foodId)
        if (existing) items[items.indexOf(existing)] = rescaleItem(existing, existing.grams + it.grams)
        else items.push(it)
      }
      return finish(items, tr.t('foodCorrection.added', { foods: extra.items.map(nameOf).join(', ') }))
    }
    case 'slot':
      return { meal: { ...meal, slot: c.slot, updatedAt: new Date().toISOString() }, applied: true, summary: tr.t('foodCorrection.movedSlot', { slot: mealSlotIn(c.slot, lang) }) }
  }
}

/* ------------------------------------------------------------------ Providers */

export class LocalFoodAnalysisProvider implements FoodAnalysisProvider {
  id = 'local' as const
  supportsImages = false
  async analyze(req: FoodAnalysisRequest): Promise<FoodAnalysis> {
    const lang = req.language ?? getLanguage()
    if (req.text?.trim()) return analyzeDescription(req.text, lang)
    // No vision model on this device: be explicit and ask for a description.
    return {
      items: [],
      name: foodName('meal', 'Meal', 'en'),
      confidence: 0,
      notes: [translator(lang).t('foodNote.noVision')],
      analysis: 'local-estimate',
      needsDescription: true,
    }
  }
}

/** Real multimodal analysis through the Anthropic API when the user supplied a key. */
export class AnthropicVisionFoodProvider implements FoodAnalysisProvider {
  id = 'anthropic-vision' as const
  supportsImages = true
  private apiKey: string
  private model: string
  private fallback: FoodAnalysisProvider
  constructor(apiKey: string, model: string | undefined, fallback: FoodAnalysisProvider) {
    this.apiKey = apiKey
    this.model = model || 'claude-sonnet-5'
    this.fallback = fallback
  }
  async analyze(req: FoodAnalysisRequest): Promise<FoodAnalysis> {
    if (!req.image?.base64) return this.fallback.analyze(req)
    const lang = req.language ?? getLanguage()
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 800,
          system: `You are a nutrition estimator. Given a photo of food (and optional user text), return ONLY JSON: {"items":[{"name":string,"grams":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"confidence":0-1}],"name":string,"confidence":0-1,"notes":[string],"is_food":boolean,"is_menu":boolean,"menu_items":[{"name":string,"calories":number,"protein_g":number}]}. Be realistic about portion uncertainty. If the image is a restaurant menu, set is_menu true and list the dishes with estimates. Write every name and note in ${lang === 'fr' ? 'French' : 'English'}.`,
          messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: req.image.mediaType ?? 'image/jpeg', data: req.image.base64 } }, { type: 'text', text: req.text?.trim() || 'Estimate this meal.' }] }],
        }),
      })
      if (!res.ok) throw new Error(`Anthropic ${res.status}`)
      const data = (await res.json()) as { content: Array<{ type: string; text?: string }> }
      const text = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('')
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { items?: Array<{ name: string; grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g?: number; confidence?: number }>; name?: string; confidence?: number; notes?: string[]; is_food?: boolean; is_menu?: boolean }
      if (json.is_food === false && !json.is_menu) return { items: [], name: foodName('notFood', 'Not food', 'en'), confidence: 0, notes: [translator(lang).t('foodNote.notFood')], analysis: 'vision', needsDescription: true }
      const items: FoodItem[] = (json.items ?? []).map((i) => {
        const ref = findFood(i.name)
        return { id: uid('fi'), foodId: ref?.id, name: i.name, quantity: i.grams, unit: 'g' as const, grams: round(i.grams), calories: round(i.calories), proteinG: round(i.protein_g, 1), carbsG: round(i.carbs_g, 1), fatG: round(i.fat_g, 1), fiberG: i.fiber_g !== undefined ? round(i.fiber_g, 1) : undefined, confidence: i.confidence ?? 0.7 }
      })
      return { items, name: json.name ?? mealName(items), confidence: json.confidence ?? 0.7, notes: json.notes ?? [], analysis: 'vision', needsDescription: items.length === 0 }
    } catch (err) {
      console.warn('[food] vision analysis failed, falling back', err)
      return this.fallback.analyze({ text: req.text, language: lang })
    }
  }
}

export function buildMeal(analysis: FoodAnalysis, opts: { date: string; slot: Meal['slot']; source: LoggedMeal['source']; attachmentId?: string; previewDataUrl?: string; status: LoggedMeal['status'] }): LoggedMeal {
  const t = totalsOf(analysis.items)
  const now = new Date().toISOString()
  return {
    id: uid('meal'),
    date: opts.date,
    slot: opts.slot,
    name: analysis.name,
    items: analysis.items,
    ...t,
    confidence: analysis.confidence,
    notes: analysis.notes.length ? analysis.notes : undefined,
    source: opts.source,
    analysis: analysis.analysis,
    attachmentId: opts.attachmentId,
    previewDataUrl: opts.previewDataUrl,
    status: opts.status,
    portionScale: 1,
    createdAt: now,
    updatedAt: now,
  }
}

/** Suggest a meal slot from the time of day. */
export function slotForTime(d = new Date()): Meal['slot'] {
  const h = d.getHours()
  if (h < 4) return 'dinner' // a late-night plate belongs to the evening, not to breakfast
  if (h < 10.5) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 17.5) return 'snack'
  return 'dinner'
}

export function confidenceLabel(c: number): 'high' | 'medium' | 'low' {
  return c >= 0.8 ? 'high' : c >= 0.55 ? 'medium' : 'low'
}

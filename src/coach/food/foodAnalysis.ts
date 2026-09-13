import type { Attachment, FoodItem, FoodUnit, LoggedMeal, Meal } from '@/domain/types'
import { round, uid } from '@/lib/utils'
import { findFood, findFoodsInText, FOOD_MAP, type FoodRef } from './foodDatabase'

/**
 * Food analysis is behind a provider interface so a real multimodal model can
 * slot in. The local provider is honest: it never claims to have "seen" an image.
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
}

export interface FoodAnalysisProvider {
  id: 'local' | 'anthropic-vision'
  supportsImages: boolean
  analyze(req: FoodAnalysisRequest): Promise<FoodAnalysis>
}

/* ------------------------------------------------------------------ Quantity parsing */

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, quarter: 0.25, double: 2, couple: 2, few: 3, some: 1 }

function parseNumber(s: string | undefined): number | undefined {
  if (!s) return undefined
  const t = s.toLowerCase().trim()
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

/** Resolve a portion for a food from any quantity phrase found near it. */
function portionFor(ref: FoodRef, before: string, after: string): Portion {
  // A weight binds only to the food it sits next to (“80 g oats, a banana” must not make the banana 80 g):
  // directly before it (allowing “of” and one descriptor word) or directly after it (“chicken 200 g”, “chicken (200g)”).
  const b = before.toLowerCase()
  const a = after.toLowerCase()
  const gramsBefore = b.match(/(\d{1,4}(?:[.,]\d)?)\s?(g|gr|grams?|grammes?|kg)\b\s+(?:of\s+)?(?:(?!(?:with|and|plus|or|then|of)\s)[a-z-]+\s+)?$/)
  const gramsAfter = a.match(/^\s*[(,]?\s*(?:about|around|roughly)?\s*(\d{1,4}(?:[.,]\d)?)\s?(g|gr|grams?|grammes?|kg)\b/)
  const gramsMatch = gramsAfter ?? gramsBefore
  if (gramsMatch) {
    const n = Number(gramsMatch[1].replace(',', '.'))
    const grams = gramsMatch[2] === 'kg' ? n * 1000 : n
    return { quantity: grams, unit: 'g', grams, guessed: false }
  }
  const mlMatch = b.match(/(\d{2,4})\s?(ml|millilit\w*)\s+(?:of\s+)?(?:[a-z-]+\s+)?$/) ?? a.match(/^\s*[(,]?\s*(\d{2,4})\s?(ml|millilit)/)
  if (mlMatch) return { quantity: Number(mlMatch[1]), unit: 'ml', grams: Number(mlMatch[1]), guessed: false }
  // Size words only count when they sit right next to the food.
  const near = `${b.split(/\s+/).slice(-3).join(' ')} ${a.split(/\s+/).slice(0, 2).join(' ')}`
  const bigness = /\b(big|large|huge|massive|double|extra)\b/.test(near) ? 1.5 : /\b(small|little|mini|light)\b/.test(near) ? 0.65 : 1
  // "two chicken breasts", "3 eggs", "a slice of bread", "two cups of rice", "half a plate of pasta"
  const countMatch = before.toLowerCase().match(/(\d+(?:[.,]\d)?|\d\/\d|one|two|three|four|five|six|a|an|half(?: a| an)?|couple of|few)\s+(?:(slices?|pieces?|cups?|tbsp|tablespoons?|bowls?|plates?|handfuls?|scoops?|glass(?:es)?|portions?|servings?|fillets?|pints?)\s+(?:of\s+)?)?(?:[a-z]+\s+)?$/)
  if (countMatch) {
    const n = parseNumber(countMatch[1].replace(/ a| an|couple of/, '').trim()) ?? 1
    const measure = countMatch[2]?.replace(/s$/, '')
    if (measure === 'cup') return { quantity: n, unit: 'cup', grams: n * (ref.pieceGrams ?? ref.serving), guessed: false }
    if (measure === 'tbsp' || measure === 'tablespoon') return { quantity: n, unit: 'tbsp', grams: n * 15, guessed: false }
    if (measure === 'slice') return { quantity: n, unit: 'slice', grams: n * (ref.pieceGrams ?? 30), guessed: false }
    if (measure === 'bowl' || measure === 'plate' || measure === 'portion' || measure === 'serving') return { quantity: n, unit: 'serving', grams: n * ref.serving * bigness, guessed: false }
    if (measure === 'handful' || measure === 'scoop') return { quantity: n, unit: 'serving', grams: n * 30, guessed: false }
    if (measure === 'glass' || measure === 'pint') return { quantity: n, unit: 'serving', grams: n * (measure === 'pint' ? 568 : ref.pieceGrams ?? 250), guessed: false }
    if (measure === 'fillet' || measure === 'piece') return { quantity: n, unit: 'piece', grams: n * (ref.pieceGrams ?? ref.serving), guessed: false }
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

/** Parse a free-text meal description into food items. Pure and deterministic. */
export function analyzeDescription(text: string): FoodAnalysis {
  const cleaned = text.replace(/^(i (just )?(ate|had|eat)|i'?m eating|for (breakfast|lunch|dinner)|log|this (is|was)|it'?s|it was)\s*/i, '').trim()
  const found = findFoodsInText(cleaned)
  const items: FoodItem[] = []
  const notes: string[] = []
  const lower = cleaned.toLowerCase()
  for (let i = 0; i < found.length; i++) {
    const { ref, index, match } = found[i]
    const before = lower.slice(Math.max(0, index - 40), index)
    const after = lower.slice(index + match.length, index + match.length + 30)
    const p = portionFor(ref, before, after)
    items.push(itemFromRef(ref, p.grams, p.quantity, p.unit, p.guessed ? 0.55 : 0.85))
  }
  // Implicit oil/sauce for cooked proteins when the user mentions "fried" or "creamy".
  if (/\bfried\b/.test(lower) && !items.some((i) => i.foodId === 'olive_oil')) items.push(itemFromRef(FOOD_MAP.olive_oil, 12, 1, 'tbsp', 0.5))
  if (/\bcreamy\b/.test(lower) && !items.some((i) => i.foodId === 'creamy_sauce')) items.push(itemFromRef(FOOD_MAP.creamy_sauce, 60, 4, 'tbsp', 0.5))
  const guessed = items.filter((i) => i.confidence < 0.7)
  if (!items.length) {
    return { items: [], name: cleaned, confidence: 0, notes: ['I could not match that to foods I know. Try naming the main parts, for example “chicken, rice and vegetables”.'], analysis: 'local-estimate', needsDescription: true }
  }
  if (guessed.length) notes.push(`Portions were assumed for ${guessed.map((i) => i.name.toLowerCase()).join(', ')}. Tell me if any were bigger or smaller.`)
  const sauces = items.filter((i) => FOOD_MAP[i.foodId ?? '']?.category === 'sauce')
  if (sauces.length) notes.push('Sauces are the biggest source of uncertainty.')
  const confidence = round(items.reduce((a, i) => a + i.confidence, 0) / items.length, 2)
  return { items, name: mealName(items), confidence, notes, analysis: 'local-estimate' }
}

export function mealName(items: FoodItem[]): string {
  // Protein first, then the main carb, then the rest: “Chicken breast, Rice & vegetables”, whatever the portions.
  const rank = (i: FoodItem) => {
    const cat = FOOD_MAP[i.foodId ?? '']?.category
    return cat === 'protein' ? 0 : cat === 'mixed' ? 1 : cat === 'carb' ? 2 : cat === 'sauce' ? 5 : cat === 'fat' ? 4 : 3
  }
  const main = [...items]
    .sort((a, b) => rank(a) - rank(b) || b.calories - a.calories)
    .slice(0, 3)
    .map((i) => i.name)
  if (!main.length) return 'Meal'
  if (main.length === 1) return main[0]
  return `${main.slice(0, -1).join(', ')} & ${main[main.length - 1].toLowerCase()}`
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
  const q = food.toLowerCase()
  return meal.items.find((i) => (ref && i.foodId === ref.id) || i.name.toLowerCase().includes(q) || q.includes(i.name.toLowerCase()))
}

export interface CorrectionResult {
  meal: LoggedMeal
  applied: boolean
  summary: string
}

/** Apply a correction to a meal, returning a new meal (no duplicates). */
export function applyCorrection(meal: LoggedMeal, c: MealCorrection): CorrectionResult {
  const finish = (items: FoodItem[], summary: string, extra: Partial<LoggedMeal> = {}): CorrectionResult => ({ meal: withItems(meal, items, extra), applied: true, summary })
  switch (c.type) {
    case 'scale': {
      const items = meal.items.map((i) => rescaleItem(i, i.grams * c.factor))
      return finish(items, c.factor === 0.5 ? 'Halved everything.' : c.factor < 1 ? `Scaled the meal to ${Math.round(c.factor * 100)}%.` : `Scaled the meal up to ${Math.round(c.factor * 100)}%.`, { portionScale: round(meal.portionScale * c.factor, 2) })
    }
    case 'set_grams': {
      const item = matchItem(meal, c.food)
      if (!item) return { meal, applied: false, summary: `I do not see ${c.food} in this meal.` }
      return finish(meal.items.map((i) => (i.id === item.id ? { ...rescaleItem(i, c.grams), unit: 'g', quantity: c.grams, confidence: 0.95 } : i)), `Set ${item.name.toLowerCase()} to ${c.grams} g.`)
    }
    case 'set_count': {
      const item = matchItem(meal, c.food)
      if (!item) return { meal, applied: false, summary: `I do not see ${c.food} in this meal.` }
      const ref = item.foodId ? FOOD_MAP[item.foodId] : undefined
      const per = ref?.pieceGrams ?? (item.quantity > 0 ? item.grams / item.quantity : item.grams)
      const unit: FoodUnit = ref?.unitLabel && ref.unitLabel !== 'g' ? ref.unitLabel : 'piece'
      return finish(meal.items.map((i) => (i.id === item.id ? { ...rescaleItem(i, per * c.count), quantity: c.count, unit, confidence: 0.9 } : i)), `${item.name}: ${c.count}.`)
    }
    case 'more':
    case 'less': {
      const item = matchItem(meal, c.food)
      if (!item) return { meal, applied: false, summary: `I do not see ${c.food} in this meal.` }
      const factor = c.factor ?? (c.type === 'more' ? 1.5 : 0.6)
      return finish(meal.items.map((i) => (i.id === item.id ? rescaleItem(i, i.grams * factor) : i)), `${c.type === 'more' ? 'More' : 'Less'} ${item.name.toLowerCase()}: now about ${Math.round(item.grams * factor)} g.`)
    }
    case 'remove': {
      const item = matchItem(meal, c.food)
      if (!item) return { meal, applied: false, summary: `There is no ${c.food} in this meal.` }
      return finish(meal.items.filter((i) => i.id !== item.id), `Removed ${item.name.toLowerCase()}.`)
    }
    case 'add': {
      const extra = analyzeDescription(c.text)
      if (!extra.items.length) return { meal, applied: false, summary: extra.notes[0] }
      const items = [...meal.items]
      for (const it of extra.items) {
        const existing = items.find((x) => x.foodId && x.foodId === it.foodId)
        if (existing) items[items.indexOf(existing)] = rescaleItem(existing, existing.grams + it.grams)
        else items.push(it)
      }
      return finish(items, `Added ${extra.items.map((i) => i.name.toLowerCase()).join(', ')}.`)
    }
    case 'slot':
      return { meal: { ...meal, slot: c.slot, updatedAt: new Date().toISOString() }, applied: true, summary: `Moved to ${c.slot.replace('_', '-')}.` }
  }
}

/* ------------------------------------------------------------------ Providers */

export class LocalFoodAnalysisProvider implements FoodAnalysisProvider {
  id = 'local' as const
  supportsImages = false
  async analyze(req: FoodAnalysisRequest): Promise<FoodAnalysis> {
    if (req.text?.trim()) return analyzeDescription(req.text)
    // No vision model on this device: be explicit and ask for a description.
    return {
      items: [],
      name: 'Meal',
      confidence: 0,
      notes: ['I can’t see photos on this device yet. Tell me what’s on the plate and roughly how much, and I’ll estimate it.'],
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
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 800,
          system: 'You are a nutrition estimator. Given a photo of food (and optional user text), return ONLY JSON: {"items":[{"name":string,"grams":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"confidence":0-1}],"name":string,"confidence":0-1,"notes":[string],"is_food":boolean,"is_menu":boolean,"menu_items":[{"name":string,"calories":number,"protein_g":number}]}. Be realistic about portion uncertainty. If the image is a restaurant menu, set is_menu true and list the dishes with estimates.',
          messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: req.image.mediaType ?? 'image/jpeg', data: req.image.base64 } }, { type: 'text', text: req.text?.trim() || 'Estimate this meal.' }] }],
        }),
      })
      if (!res.ok) throw new Error(`Anthropic ${res.status}`)
      const data = (await res.json()) as { content: Array<{ type: string; text?: string }> }
      const text = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('')
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { items?: Array<{ name: string; grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g?: number; confidence?: number }>; name?: string; confidence?: number; notes?: string[]; is_food?: boolean; is_menu?: boolean }
      if (json.is_food === false && !json.is_menu) return { items: [], name: 'Not food', confidence: 0, notes: ['That does not look like food to me. Tell me what it is if I got that wrong.'], analysis: 'vision', needsDescription: true }
      const items: FoodItem[] = (json.items ?? []).map((i) => {
        const ref = findFood(i.name)
        return { id: uid('fi'), foodId: ref?.id, name: i.name, quantity: i.grams, unit: 'g' as const, grams: round(i.grams), calories: round(i.calories), proteinG: round(i.protein_g, 1), carbsG: round(i.carbs_g, 1), fatG: round(i.fat_g, 1), fiberG: i.fiber_g !== undefined ? round(i.fiber_g, 1) : undefined, confidence: i.confidence ?? 0.7 }
      })
      return { items, name: json.name ?? mealName(items), confidence: json.confidence ?? 0.7, notes: json.notes ?? [], analysis: 'vision', needsDescription: items.length === 0 }
    } catch (err) {
      console.warn('[food] vision analysis failed, falling back', err)
      return this.fallback.analyze({ text: req.text })
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

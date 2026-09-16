import { ciqualAttribution, offAttribution, sportlyAttribution } from './attribution.js'
import { DEFAULT_SIMILARITY, similarityBand, type SimilarityThresholds } from './matching.js'
import { lookupBarcode, type BarcodeLookupDeps } from './off.js'
import type { CiqualFoodRow, FoodSynonymRow, NutritionStore, OffProductRow, SportlyFoodRow } from './store.js'
import type { FoodQuery, FoodSource, MatchedBy, Resolution, ResolvedFood, UnresolvedCandidate, UnresolvedReason } from './types.js'

/**
 * Food resolution, in one fixed order:
 *
 *   barcode → off.products (via the OFF API on a miss)
 *   label   → sportly_food_synonyms   exact term; the subject's own correction, then the shared seed
 *           → ciqual_foods            exact label
 *           → sportly_foods           exact name or alias
 *           → ciqual_foods            trigram similarity, three bands (./matching.ts)
 *           → unresolved, returned as such
 *
 * A synonym is an explicit statement — a user said "this term is that food",
 * or the seed did because the test set proved similarity could not — so a
 * hit there wins over any score. Exact matches come next, on the same normal
 * form. Similarity is last and never guesses: one candidate above the high
 * band resolves; anything else above the gate is reported as ambiguous with
 * the candidates ranked and scored; nothing above the gate is no_match. What
 * the resolver cannot resolve, it says it cannot.
 */

export interface ResolveDeps extends Omit<BarcodeLookupDeps, 'store'> {
  store: NutritionStore
  /** The band policy's numbers; the defaults are the measured ones. Tests override them. */
  similarity?: SimilarityThresholds
}

export function offProductToFood(product: OffProductRow): ResolvedFood {
  return {
    source: 'off',
    sourceId: product.barcode,
    kind: 'product',
    name: product.productName ?? product.productNameFr ?? product.barcode,
    nameFr: product.productNameFr,
    brand: product.brands,
    barcode: product.barcode,
    per100g: { kcal: product.per100g.kcal, proteinG: product.per100g.proteinG, carbsG: product.per100g.carbsG, fatG: product.per100g.fatG, fibreG: product.per100g.fibreG },
    typicalPortion: product.servingQuantityG === null ? null : { grams: product.servingQuantityG, unit: 'serving', label: product.servingSize },
    attribution: offAttribution(product.barcode),
  }
}

export function ciqualToFood(row: CiqualFoodRow): ResolvedFood {
  return {
    source: 'ciqual',
    sourceId: String(row.alimCode),
    kind: 'ingredient',
    name: row.nameEn ?? row.nameFr,
    nameFr: row.nameFr,
    brand: null,
    barcode: null,
    per100g: { kcal: row.energyKcal, proteinG: row.proteinG, carbsG: row.carbsG, fatG: row.fatG, fibreG: row.fibreG },
    // Ciqual publishes composition, not portions. Typical portions are Sportly's own table.
    typicalPortion: null,
    attribution: ciqualAttribution(row.alimCode, row.ciqualVersion),
  }
}

export function sportlyToFood(row: SportlyFoodRow): ResolvedFood {
  return {
    source: 'sportly',
    sourceId: row.foodId,
    kind: row.kind,
    name: row.nameEn,
    nameFr: row.nameFr,
    brand: null,
    barcode: null,
    per100g: { kcal: row.energyKcal100g, proteinG: row.proteinG100g, carbsG: row.carbsG100g, fatG: row.fatG100g, fibreG: row.fibreG100g },
    typicalPortion: row.typicalPortionG === null ? null : { grams: row.typicalPortionG, unit: row.portionUnit, label: row.portionLabel },
    attribution: sportlyAttribution(),
  }
}

const cleanLabel = (label: string | undefined): string | null => {
  const trimmed = label?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** The food a synonym points at, fetched through the port; null if the target row is gone or belongs to another subject. */
async function synonymTarget(synonym: FoodSynonymRow, store: NutritionStore, subjectId: string | undefined): Promise<ResolvedFood | null> {
  if (synonym.target.source === 'ciqual') {
    const row = await store.getCiqualFood(synonym.target.alimCode)
    return row ? ciqualToFood(row) : null
  }
  const row = await store.getSportlyFood(synonym.target.foodId, subjectId)
  return row ? sportlyToFood(row) : null
}

export async function resolveFood(query: FoodQuery, deps: ResolveDeps): Promise<Resolution> {
  const tried: FoodSource[] = []
  const barcodeInput = cleanLabel(query.barcode)
  const label = cleanLabel(query.label)
  const echo = { barcode: barcodeInput, label }
  const unresolved = (reason: UnresolvedReason, candidates: UnresolvedCandidate[] = []): Resolution => ({ status: 'unresolved', reason, query: echo, tried, candidates })
  const resolved = (matchedBy: MatchedBy, food: ResolvedFood, score: number | null = null): Resolution => ({ status: 'resolved', matchedBy, food, tried, score })

  if (barcodeInput === null && label === null) return unresolved('empty_query')

  let sourceUnavailable = false

  // 1. barcode → OFF
  if (barcodeInput !== null) {
    tried.push('off')
    const lookup = await lookupBarcode(barcodeInput, deps)
    if (lookup.status === 'found') return resolved('barcode', offProductToFood(lookup.product))
    if (lookup.status === 'unavailable') sourceUnavailable = true
    // not_found and invalid_barcode fall through to the label, if there is one.
  }

  if (label !== null) {
    // 2. label → synonyms. Not a food source, so not in `tried`: a redirect
    // to one. The subject's own correction comes first, then the shared seed.
    for (const synonym of await deps.store.findFoodSynonyms(label, query.subjectId)) {
      const food = await synonymTarget(synonym, deps.store, query.subjectId)
      if (food) {
        if (!tried.includes(food.source)) tried.push(food.source)
        return resolved('synonym', food)
      }
    }

    // 3. label → Ciqual, exact
    tried.push('ciqual')
    const ciqual = await deps.store.findCiqualByLabel(label)
    if (ciqual.length === 1) return resolved('label', ciqualToFood(ciqual[0]))
    if (ciqual.length > 1) {
      return unresolved('ambiguous', ciqual.map((r) => ({ source: 'ciqual', sourceId: String(r.alimCode), name: r.nameFr, score: 1 })))
    }

    // 4. label → Sportly, exact. A subject's own correction wins over a shared row; two shared rows are ambiguous.
    tried.push('sportly')
    const sportly = await deps.store.findSportlyByLabel(label, query.subjectId)
    const own = sportly.filter((r) => r.subjectId !== null)
    const pick = own.length === 1 ? own[0] : sportly.length === 1 ? sportly[0] : null
    if (pick) return resolved('label', sportlyToFood(pick))
    if (sportly.length > 1) {
      return unresolved('ambiguous', sportly.map((r) => ({ source: 'sportly', sourceId: r.foodId, name: r.nameEn, score: 1 })))
    }

    // 5. label → Ciqual, similar. The store gates and ranks; the band is decided here.
    const thresholds = deps.similarity ?? DEFAULT_SIMILARITY
    const similar = await deps.store.findCiqualSimilar(label, thresholds)
    const band = similarityBand(similar, thresholds.high)
    if (band.band === 'resolved') return resolved('similarity', ciqualToFood(band.pick), band.pick.score)
    if (band.band === 'ambiguous') {
      return unresolved('ambiguous', similar.map((r) => ({ source: 'ciqual', sourceId: String(r.alimCode), name: r.nameFr, score: r.score })))
    }
  }

  // 6. unresolved, and honest about why.
  return unresolved(sourceUnavailable ? 'source_unavailable' : 'no_match')
}

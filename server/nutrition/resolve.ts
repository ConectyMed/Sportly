import { ciqualAttribution, offAttribution, sportlyAttribution } from './attribution.js'
import { lookupBarcode, type BarcodeLookupDeps } from './off.js'
import type { CiqualFoodRow, NutritionStore, OffProductRow, SportlyFoodRow } from './store.js'
import type { FoodQuery, FoodSource, Resolution, ResolvedFood, UnresolvedCandidate, UnresolvedReason } from './types.js'

/**
 * Food resolution, in one fixed order:
 *
 *   barcode → off.products (via the OFF API on a miss)
 *   label   → ciqual_foods
 *           → sportly_foods
 *           → unresolved, returned as such
 *
 * A match is exact — the same normalised label on both sides — and a label
 * that matches more than one food is reported as ambiguous with the
 * candidates, never picked from. There is no fuzzy step and no fallback that
 * guesses; what the resolver cannot resolve, it says it cannot.
 */

export interface ResolveDeps extends Omit<BarcodeLookupDeps, 'store'> {
  store: NutritionStore
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

export async function resolveFood(query: FoodQuery, deps: ResolveDeps): Promise<Resolution> {
  const tried: FoodSource[] = []
  const barcodeInput = cleanLabel(query.barcode)
  const label = cleanLabel(query.label)
  const echo = { barcode: barcodeInput, label }
  const unresolved = (reason: UnresolvedReason, candidates: UnresolvedCandidate[] = []): Resolution => ({ status: 'unresolved', reason, query: echo, tried, candidates })

  if (barcodeInput === null && label === null) return unresolved('empty_query')

  let sourceUnavailable = false

  // 1. barcode → OFF
  if (barcodeInput !== null) {
    tried.push('off')
    const lookup = await lookupBarcode(barcodeInput, deps)
    if (lookup.status === 'found') return { status: 'resolved', matchedBy: 'barcode', food: offProductToFood(lookup.product), tried }
    if (lookup.status === 'unavailable') sourceUnavailable = true
    // not_found and invalid_barcode fall through to the label, if there is one.
  }

  if (label !== null) {
    // 2. label → Ciqual
    tried.push('ciqual')
    const ciqual = await deps.store.findCiqualByLabel(label)
    if (ciqual.length === 1) return { status: 'resolved', matchedBy: 'label', food: ciqualToFood(ciqual[0]), tried }
    if (ciqual.length > 1) {
      return unresolved('ambiguous', ciqual.map((r) => ({ source: 'ciqual', sourceId: String(r.alimCode), name: r.nameFr })))
    }

    // 3. label → Sportly. A subject's own correction wins over a shared row; two shared rows are ambiguous.
    tried.push('sportly')
    const sportly = await deps.store.findSportlyByLabel(label, query.subjectId)
    const own = sportly.filter((r) => r.subjectId !== null)
    const pick = own.length === 1 ? own[0] : sportly.length === 1 ? sportly[0] : null
    if (pick) return { status: 'resolved', matchedBy: 'label', food: sportlyToFood(pick), tried }
    if (sportly.length > 1) {
      return unresolved('ambiguous', sportly.map((r) => ({ source: 'sportly', sourceId: r.foodId, name: r.nameEn })))
    }
  }

  // 4. unresolved, and honest about why.
  return unresolved(sourceUnavailable ? 'source_unavailable' : 'no_match')
}

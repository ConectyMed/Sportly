/**
 * The nutrition data layer's vocabulary.
 *
 * Three sources, resolved in a fixed order, each carrying the attribution its
 * licence asks for. Nothing here knows about images, models or meals: a food
 * comes in as a barcode or a label and goes out resolved or, honestly,
 * unresolved.
 */

/** Where a resolved food came from. Also the order the resolver tries them in. */
export type FoodSource = 'off' | 'ciqual' | 'sportly'

export const FOOD_SOURCES: readonly FoodSource[] = ['off', 'ciqual', 'sportly']

/**
 * Per 100 g, as the source states it. `null` means the source has no value —
 * never 0 as a stand-in, so a missing fibre figure cannot masquerade as "no
 * fibre". Below-limit-of-quantification and "traces" values from Ciqual are 0.
 */
export interface Per100g {
  kcal: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  fibreG: number | null
}

/**
 * What the UI has to show next to a food. Every resolved food carries one,
 * built from the source it came from; `required` says whether the licence
 * demands it (Licence Ouverte and ODbL do; our own data does not).
 */
export interface Attribution {
  source: FoodSource
  /** Who publishes the data: "ANSES", "Open Food Facts", "Sportly". */
  provider: string
  licence: string
  licenceUrl: string | null
  /** The credit line to display, worded the way the provider asks. */
  text: string
  /** The food's page at the provider, when it has one. */
  url: string | null
  required: boolean
}

export interface TypicalPortion {
  grams: number
  /** A unit from the food journal's vocabulary, when the portion is countable. */
  unit: 'g' | 'ml' | 'piece' | 'serving' | 'cup' | 'tbsp' | 'slice' | null
  label: string | null
}

export interface ResolvedFood {
  source: FoodSource
  /** The source's own key: barcode, Ciqual alim_code, Sportly food_id. */
  sourceId: string
  /** 'dish' is the composed-dish placeholder; components come with the scan session. */
  kind: 'product' | 'ingredient' | 'dish'
  name: string
  nameFr: string | null
  brand: string | null
  barcode: string | null
  per100g: Per100g
  typicalPortion: TypicalPortion | null
  attribution: Attribution
}

export interface FoodQuery {
  barcode?: string
  label?: string
  /** Lets a subject's own confirmed corrections in `sportly_foods` match. */
  subjectId?: string
}

/**
 * How a resolved food was found. `label` is an exact match on the normal
 * form; `synonym` an exact hit in `sportly_food_synonyms` (a seed row or the
 * subject's own correction); `similarity` the one candidate above the high
 * band of the trigram policy (server/nutrition/matching.ts).
 */
export type MatchedBy = 'barcode' | 'label' | 'synonym' | 'similarity'

export type UnresolvedReason =
  /** Neither a barcode nor a label was given. */
  | 'empty_query'
  /** Every source in order was tried and none matched. */
  | 'no_match'
  /** A label matched more than one food exactly, or similar foods with no one clear winner; the caller must choose from `candidates`. */
  | 'ambiguous'
  /** A source could not be reached and nothing else matched: a retry may succeed, so do not record this as "unknown food". */
  | 'source_unavailable'

export interface UnresolvedCandidate {
  source: FoodSource
  sourceId: string
  name: string
  /** Whole-label trigram similarity to the query, 0–1; 1 for an exact match. Candidates come ranked, best first. */
  score: number
}

export type Resolution =
  | {
      status: 'resolved'
      matchedBy: MatchedBy
      food: ResolvedFood
      tried: FoodSource[]
      /** The similarity score when `matchedBy` is 'similarity'; null for a barcode, exact-label or synonym match, which carry no score. */
      score: number | null
    }
  | { status: 'unresolved'; reason: UnresolvedReason; query: { barcode: string | null; label: string | null }; tried: FoodSource[]; candidates: UnresolvedCandidate[] }

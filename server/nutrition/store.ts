import type { StorageEngine } from '../store/port.js'
import type { SimilarityThresholds } from './matching.js'

/**
 * The nutrition storage port: the reads and writes the resolver and the
 * barcode lookup need, named after what they do. Postgres sits behind it
 * (./postgres.ts); tests use a stub. Feature code never sees SQL.
 *
 * Exact label matching is on `sportly_label_norm`, a function that lives in
 * the database (migrations/0003_nutrition_data.sql) and is applied to stored
 * names and to the query alike. Similarity is pg_trgm's, on the same normal
 * form (migrations/0004_food_matching.sql), with the thresholds passed in
 * from server/nutrition/matching.ts. No adapter re-implements either.
 */

/** Open Food Facts figures per 100 g, lifted from `nutriments`. `null` = OFF has no value. */
export interface OffPer100g {
  kcal: number | null
  kj: number | null
  proteinG: number | null
  carbsG: number | null
  sugarsG: number | null
  fatG: number | null
  saturatedFatG: number | null
  fibreG: number | null
  saltG: number | null
}

export interface OffProductRow {
  barcode: string
  status: 'found' | 'not_found'
  productName: string | null
  productNameFr: string | null
  brands: string | null
  quantity: string | null
  servingSize: string | null
  servingQuantityG: number | null
  per100g: OffPer100g
  /** The `nutriments` object as OFF returned it; null for a not-found row. */
  nutriments: Record<string, unknown> | null
  lastModifiedT: number | null
  productUrl: string | null
  /** ISO-8601 UTC. */
  fetchedAt: string
  httpStatus: number
}

export interface CiqualFoodRow {
  alimCode: number
  nameFr: string
  nameEn: string | null
  groupCode: string | null
  subgroupCode: string | null
  subsubgroupCode: string | null
  energyKcal: number | null
  energyKj: number | null
  proteinG: number | null
  carbsG: number | null
  sugarsG: number | null
  fatG: number | null
  saturatedFatG: number | null
  fibreG: number | null
  saltG: number | null
  waterG: number | null
  ciqualVersion: string
}

export interface SportlyFoodRow {
  foodId: string
  kind: 'ingredient' | 'dish'
  nameEn: string
  nameFr: string | null
  origin: 'sportly' | 'user_correction'
  /** Set only on a user-confirmed correction; null rows are shared. */
  subjectId: string | null
  ciqualAlimCode: number | null
  energyKcal100g: number | null
  proteinG100g: number | null
  carbsG100g: number | null
  fatG100g: number | null
  fibreG100g: number | null
  typicalPortionG: number | null
  portionUnit: 'g' | 'ml' | 'piece' | 'serving' | 'cup' | 'tbsp' | 'slice' | null
  portionLabel: string | null
  notes: string | null
}

export interface SportlyFoodInput extends SportlyFoodRow {
  /** Labels the food answers to, any language. Stored one per row. */
  aliases: string[]
}

/** A Ciqual food with the three pg_trgm numbers the matching policy reads. */
export interface CiqualSimilarRow extends CiqualFoodRow {
  /** similarity(query, whole label): the confidence the bands are decided on. */
  score: number
  /** word_similarity(query, label): how well the query appears inside the label; the gate. */
  containment: number
  /** similarity(query, food name before the first comma): the ranking key inside the ambiguous band. */
  nameScore: number
}

export type FoodSynonymTarget = { source: 'ciqual'; alimCode: number } | { source: 'sportly'; foodId: string }

export interface FoodSynonymRow {
  term: string
  target: FoodSynonymTarget
  origin: 'sportly' | 'user_correction'
  /** Set only on a subject's own correction; null rows are shared. */
  subjectId: string | null
}

export interface NutritionStore {
  readonly engine: StorageEngine

  /** The cached OFF row for a barcode, found or not-found, whatever its age. */
  getOffProduct(barcode: string): Promise<OffProductRow | null>

  /** Insert or replace the cached OFF row. */
  putOffProduct(row: OffProductRow): Promise<void>

  /** Ciqual foods whose French or English name equals the label exactly (normalised). Ordered by alim_code. */
  findCiqualByLabel(label: string): Promise<CiqualFoodRow[]>

  /**
   * Sportly foods whose name or an alias equals the label exactly (normalised):
   * shared rows, plus the subject's own corrections when a subject is given.
   * A subject's own rows come first.
   */
  findSportlyByLabel(label: string, subjectId?: string): Promise<SportlyFoodRow[]>

  /** Insert or replace a Sportly food and its aliases. `atIso` is the write time. */
  putSportlyFood(food: SportlyFoodInput, atIso: string): Promise<void>

  /** One Ciqual food by its code, or null. */
  getCiqualFood(alimCode: number): Promise<CiqualFoodRow | null>

  /** One Sportly food by id: a shared row, or the subject's own row when a subject is given. Null otherwise. */
  getSportlyFood(foodId: string, subjectId?: string): Promise<SportlyFoodRow | null>

  /**
   * Synonym rows whose term equals the label exactly (normalised): the
   * subject's own correction first when a subject is given, then the shared
   * row. At most one of each, by the table's key.
   */
  findFoodSynonyms(label: string, subjectId?: string): Promise<FoodSynonymRow[]>

  /** Insert or replace a synonym for its (term, subject) key. `atIso` is the write time. */
  putFoodSynonym(synonym: FoodSynonymRow, atIso: string): Promise<void>

  /**
   * Ciqual foods similar to the label under the policy in
   * server/nutrition/matching.ts: gated on containment ≥ `low`, ranked with
   * any candidate at or above `high` first, then by name match, then by
   * score, at most `limit` rows. French labels only.
   */
  findCiqualSimilar(label: string, thresholds: SimilarityThresholds): Promise<CiqualSimilarRow[]>
}

/**
 * The label-matching policy: two measures, two thresholds, three bands.
 *
 * Both measures are pg_trgm's, computed in the database on the same normal
 * form exact matching uses (`sportly_label_norm`), with the query on one side
 * and a Ciqual French label on the other:
 *
 *   score        similarity(query, label) — trigram Jaccard over the whole
 *                label. 1.0 when the query *is* the label; it falls as the
 *                label carries words the query did not say. This is the
 *                confidence, and the only number the bands are decided on.
 *
 *   containment  word_similarity(query, label) — how well the query appears
 *                somewhere inside the label. 1.0 when "pomme" is in "Pomme,
 *                chair et peau, crue" whatever else the label says. This is
 *                the candidate gate.
 *
 * Bands, on the candidates that pass the gate:
 *
 *   exactly one candidate with score ≥ SIMILARITY_HIGH  → resolved, to it
 *   any candidate at all                                 → ambiguous, ranked
 *   none                                                 → no_match
 *
 * Two at or above the high band is ambiguity, not a coin toss.
 *
 * The values come from data/food-matching/terms.fr.json — 50 terms a vision
 * model emits, none of them a Ciqual label — measured in
 * server/__tests__/postgresFoodMatching.test.ts:
 *
 *   SIMILARITY_HIGH = 0.75. The highest score a *wrong* food reaches at the
 *   top of a ranking is 0.700 ("haricots verts" → "Haricots verts, purée";
 *   "raisin" → "Raisin sec" 0.636; "riz blanc cuit" → "Riz blanc, cru" 0.611
 *   sit under it). The lowest score a *right* food reaches while carrying a
 *   qualifier is 0.810 ("lait demi-écrémé" → "Lait demi-écrémé, UHT"). 0.75
 *   sits in that gap with 0.05 to spare on either side. Read as a rule: a
 *   query may leave one three-letter word of the label unexplained ("UHT");
 *   a five-letter one ("purée", "sèche", "cru") is enough to change the food,
 *   and the data shows it does.
 *
 *   SIMILARITY_LOW = 0.6. Between 0.5 and 0.6 the test set moves by one term
 *   either way: at 0.5 "lentilles cuites" gains its right food, while "yaourt
 *   nature" and "thon en boîte" turn from an honest no_match into a list of
 *   wrong foods. 0.6 is also pg_trgm's shipped `word_similarity_threshold`,
 *   so the `<%` operator in the query — the one the GIN index serves — and
 *   this policy agree without a session setting, which the single-statement
 *   Neon HTTP driver could not carry anyway. The Postgres suite asserts the
 *   database default still equals this constant.
 *
 * Ranking inside the ambiguous band is by how well the query matches the
 * food's *name* (`sportly_label_head`: the label before its first comma,
 * parenthetical dropped), then by score. A ranking choice only — it moves
 * "Banane, chair sans peau, crue" above "Nectar de banane" for "banane" —
 * and never a band decision.
 */

export const SIMILARITY_HIGH = 0.75
export const SIMILARITY_LOW = 0.6

/** How many ranked candidates an ambiguous resolution carries. */
export const SIMILARITY_CANDIDATES = 10

export interface SimilarityThresholds {
  high: number
  low: number
  limit: number
}

export const DEFAULT_SIMILARITY: SimilarityThresholds = { high: SIMILARITY_HIGH, low: SIMILARITY_LOW, limit: SIMILARITY_CANDIDATES }

export type SimilarityBand = 'resolved' | 'ambiguous' | 'no_match'

/**
 * Decide the band for a gated, ranked candidate list. Pure: the store has
 * already applied the gate and the ordering; this only reads the scores.
 */
export function similarityBand<T extends { score: number }>(candidates: readonly T[], high: number = SIMILARITY_HIGH): { band: 'resolved'; pick: T } | { band: 'ambiguous' | 'no_match' } {
  if (candidates.length === 0) return { band: 'no_match' }
  const confident = candidates.filter((c) => c.score >= high)
  if (confident.length === 1) return { band: 'resolved', pick: confident[0] }
  return { band: 'ambiguous' }
}

import type { Per100g } from './types.js'

/**
 * The macro calculator. A pure function: a resolved food's per-100 g figures
 * and a portion in grams in, the portion's kcal, protein, carbs, fat and fibre
 * out. No I/O, no model, no clock. This is the only place nutritional numbers
 * are produced, so that a wrong number has exactly one place to be wrong in.
 */
export interface Macros {
  kcal: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  fibreG: number | null
  /**
   * True when the source gave no energy value and kcal was computed from the
   * macros with the Regulation (EU) 1169/2011 conversion factors. False when
   * kcal is the source's own figure, or null.
   */
  kcalDerived: boolean
}

/**
 * Regulation (EU) 1169/2011, Annex XIV: the factors every EU label — and Ciqual's
 * own energy column — is computed with. Carbohydrate here excludes fibre, as it
 * does on the label and in Ciqual's "Glucides".
 */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9, fibre: 2 } as const

const round1 = (n: number): number => Math.round(n * 10) / 10

function scale(per100: number | null, portionG: number): number | null {
  return per100 === null ? null : round1((per100 * portionG) / 100)
}

/**
 * Macros for `portionG` grams of a food. Grams are rounded to 0.1, kcal to the
 * nearest whole number. A nutrient the source does not give stays `null`: the
 * calculator never fills a gap with 0.
 *
 * Energy: the source's kcal when it has one. Otherwise, when protein, carbs and
 * fat are all known, the label formula (fibre counted at 2 kcal/g when known),
 * flagged `kcalDerived`. Otherwise `null`.
 */
export function macrosForPortion(per100g: Per100g, portionG: number): Macros {
  if (!Number.isFinite(portionG) || portionG < 0) {
    throw new RangeError(`portion must be a finite number of grams >= 0; got ${String(portionG)}`)
  }
  const proteinG = scale(per100g.proteinG, portionG)
  const carbsG = scale(per100g.carbsG, portionG)
  const fatG = scale(per100g.fatG, portionG)
  const fibreG = scale(per100g.fibreG, portionG)

  if (per100g.kcal !== null) {
    return { kcal: Math.round((per100g.kcal * portionG) / 100), proteinG, carbsG, fatG, fibreG, kcalDerived: false }
  }
  if (per100g.proteinG !== null && per100g.carbsG !== null && per100g.fatG !== null) {
    const per100 =
      per100g.proteinG * KCAL_PER_G.protein +
      per100g.carbsG * KCAL_PER_G.carbs +
      per100g.fatG * KCAL_PER_G.fat +
      (per100g.fibreG ?? 0) * KCAL_PER_G.fibre
    return { kcal: Math.round((per100 * portionG) / 100), proteinG, carbsG, fatG, fibreG, kcalDerived: true }
  }
  return { kcal: null, proteinG, carbsG, fatG, fibreG, kcalDerived: false }
}

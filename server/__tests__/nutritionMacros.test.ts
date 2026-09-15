import { describe, expect, it } from 'vitest'
import { KCAL_PER_G, macrosForPortion } from '../nutrition/macros.js'

/**
 * The macro calculator against values worked out by hand. Every expected
 * number below was computed on paper from the per-100 g figures, not by
 * running the function.
 */
describe('macrosForPortion', () => {
  it('scales a Ciqual-style food: apple, 180 g', () => {
    // Ciqual "Pomme, pulpe et peau, crue" style figures: 53.9 kcal, 0.3 g protein,
    // 11.6 g carbs, fat "< 0,5" (stored 0), 1.4 g fibre per 100 g.
    // 180 g → 97.02 kcal, 0.54 g, 20.88 g, 0 g, 2.52 g.
    expect(macrosForPortion({ kcal: 53.9, proteinG: 0.3, carbsG: 11.6, fatG: 0, fibreG: 1.4 }, 180)).toEqual({
      kcal: 97, proteinG: 0.5, carbsG: 20.9, fatG: 0, fibreG: 2.5, kcalDerived: false,
    })
  })

  it('scales an OFF-style product and keeps a missing fibre null: hazelnut spread, 15 g', () => {
    // 539 kcal, 6.3 g protein, 57.5 g carbs, 30.9 g fat per 100 g, no fibre value.
    // 15 g → 80.85 kcal, 0.945 g, 8.625 g, 4.635 g.
    expect(macrosForPortion({ kcal: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9, fibreG: null }, 15)).toEqual({
      kcal: 81, proteinG: 0.9, carbsG: 8.6, fatG: 4.6, fibreG: null, kcalDerived: false,
    })
  })

  it('scales a Sportly-style food: chicken breast, 150 g', () => {
    // 165 kcal, 31 g, 0 g, 3.6 g per 100 g. 150 g → 247.5 kcal, 46.5 g, 0 g, 5.4 g.
    const m = macrosForPortion({ kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6, fibreG: null }, 150)
    expect(m.kcal).toBe(248)
    expect(m.proteinG).toBe(46.5)
    expect(m.carbsG).toBe(0)
    expect(m.fatG).toBe(5.4)
    expect(m.fibreG).toBeNull()
  })

  it('derives kcal with the EU label factors only when the source has none, and says so', () => {
    // 10 g protein × 4 + 20 g carbs × 4 + 5 g fat × 9 + 3 g fibre × 2 = 40 + 80 + 45 + 6 = 171 kcal per 100 g.
    expect(KCAL_PER_G).toEqual({ protein: 4, carbs: 4, fat: 9, fibre: 2 })
    expect(macrosForPortion({ kcal: null, proteinG: 10, carbsG: 20, fatG: 5, fibreG: 3 }, 100)).toEqual({
      kcal: 171, proteinG: 10, carbsG: 20, fatG: 5, fibreG: 3, kcalDerived: true,
    })
    // 50 g → 85.5 kcal, rounded to 86. Without a fibre figure it contributes nothing: 165 → 82.5 → 83.
    expect(macrosForPortion({ kcal: null, proteinG: 10, carbsG: 20, fatG: 5, fibreG: 3 }, 50).kcal).toBe(86)
    expect(macrosForPortion({ kcal: null, proteinG: 10, carbsG: 20, fatG: 5, fibreG: null }, 50)).toMatchObject({ kcal: 83, kcalDerived: true })
  })

  it('never invents energy when a macro is missing', () => {
    expect(macrosForPortion({ kcal: null, proteinG: 10, carbsG: null, fatG: 5, fibreG: null }, 100)).toEqual({
      kcal: null, proteinG: 10, carbsG: null, fatG: 5, fibreG: null, kcalDerived: false,
    })
  })

  it('prefers the source kcal over a derived one even when they disagree', () => {
    // Source says 100 kcal; the factors would give 171. The source wins, unflagged.
    expect(macrosForPortion({ kcal: 100, proteinG: 10, carbsG: 20, fatG: 5, fibreG: 3 }, 100)).toMatchObject({ kcal: 100, kcalDerived: false })
  })

  it('a zero-gram portion is zero, not null', () => {
    expect(macrosForPortion({ kcal: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9, fibreG: null }, 0)).toEqual({
      kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: null, kcalDerived: false,
    })
  })

  it('refuses a portion that is not a non-negative number of grams', () => {
    const food = { kcal: 100, proteinG: 1, carbsG: 1, fatG: 1, fibreG: 1 }
    expect(() => macrosForPortion(food, -1)).toThrow(RangeError)
    expect(() => macrosForPortion(food, Number.NaN)).toThrow(RangeError)
    expect(() => macrosForPortion(food, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('is pure: the same input gives the same output and the input is not touched', () => {
    const food = Object.freeze({ kcal: 53.9, proteinG: 0.3, carbsG: 11.6, fatG: 0, fibreG: 1.4 })
    expect(macrosForPortion(food, 180)).toEqual(macrosForPortion(food, 180))
    expect(food).toEqual({ kcal: 53.9, proteinG: 0.3, carbsG: 11.6, fatG: 0, fibreG: 1.4 })
  })
})

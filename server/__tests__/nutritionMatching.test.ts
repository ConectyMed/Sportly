import { describe, expect, it } from 'vitest'
import { DEFAULT_SIMILARITY, SIMILARITY_HIGH, SIMILARITY_LOW, similarityBand } from '../nutrition/matching.js'
import { resolveFood } from '../nutrition/resolve.js'
import type { CiqualFoodRow, FoodSynonymRow } from '../nutrition/store.js'
import { SUBJECT_A, SUBJECT_B } from './helpers.js'
import { ciqualApple, fakeOffFetch, similar, sportlyEgg, stubStore } from './nutritionHelpers.js'

/**
 * The matching policy's logic, against canned scores: which band a candidate
 * list lands in, that synonyms win over everything, and that the numbers in
 * matching.ts are the ones the resolver actually applies. The scores here are
 * invented on purpose — the real ones, and the thresholds' justification, are
 * in postgresFoodMatching.test.ts against the Ciqual table.
 */
const driedApple: CiqualFoodRow = { ...ciqualApple, alimCode: 13111, nameFr: 'Pomme, sèche', nameEn: 'Apple, dried' }
const potato: CiqualFoodRow = { ...ciqualApple, alimCode: 4008, nameFr: 'Pomme de terre, sans peau, crue', nameEn: 'Potato, peeled, raw' }
const juice: CiqualFoodRow = { ...ciqualApple, alimCode: 2074, nameFr: 'Jus de pomme, pur jus', nameEn: 'Apple juice' }

const shared = (term: string, alimCode: number): FoodSynonymRow => ({ term, target: { source: 'ciqual', alimCode }, origin: 'sportly', subjectId: null })

describe('similarityBand', () => {
  it('is no_match on an empty list, resolved on exactly one confident candidate, ambiguous otherwise', () => {
    expect(similarityBand([])).toEqual({ band: 'no_match' })
    expect(similarityBand([similar(ciqualApple, 0.81), similar(driedApple, 0.5)])).toEqual({ band: 'resolved', pick: similar(ciqualApple, 0.81) })
    expect(similarityBand([similar(ciqualApple, 0.5), similar(driedApple, 0.4)])).toEqual({ band: 'ambiguous' })
  })

  it('treats two confident candidates as ambiguity, not a coin toss', () => {
    expect(similarityBand([similar(ciqualApple, 0.9), similar(driedApple, 0.8)])).toEqual({ band: 'ambiguous' })
  })

  it('reads the high band as at-or-above', () => {
    expect(similarityBand([similar(ciqualApple, SIMILARITY_HIGH)])).toMatchObject({ band: 'resolved' })
    expect(similarityBand([similar(ciqualApple, SIMILARITY_HIGH - 0.001)])).toEqual({ band: 'ambiguous' })
  })
})

describe('resolveFood — similarity bands', () => {
  it('resolves on one confident candidate, saying so and carrying the score', async () => {
    const store = stubStore({ similar: { pomme: [similar(ciqualApple, 0.81), similar(driedApple, 0.5, { nameScore: 1 })] } })
    const r = await resolveFood({ label: 'pomme' }, { store })
    expect(r).toMatchObject({ status: 'resolved', matchedBy: 'similarity', score: 0.81, tried: ['ciqual', 'sportly'], food: { source: 'ciqual', sourceId: '13050' } })
    // Exact matching was tried first and found nothing; similarity was the last resort.
    expect(store.calls).toEqual(['findFoodSynonyms:pomme:', 'findCiqualByLabel:pomme', 'findSportlyByLabel:pomme:', 'findCiqualSimilar:pomme'])
  })

  it('returns the ranked, scored candidates as ambiguous when nothing is confident', async () => {
    const store = stubStore({ similar: { pomme: [similar(juice, 0.375, { nameScore: 0.375 }), similar(driedApple, 0.5, { nameScore: 1 }), similar(ciqualApple, 0.24, { nameScore: 1 }), similar(potato, 0.21, { nameScore: 0.5 })] } })
    const r = await resolveFood({ label: 'pomme' }, { store })
    expect(r).toMatchObject({ status: 'unresolved', reason: 'ambiguous', tried: ['ciqual', 'sportly'] })
    // Name match first, then score: the two "Pomme, …" rows before the potato before the juice.
    expect(r.status === 'unresolved' && r.candidates).toEqual([
      { source: 'ciqual', sourceId: '13111', name: 'Pomme, sèche', score: 0.5 },
      { source: 'ciqual', sourceId: '13050', name: 'Pomme, pulpe et peau, crue', score: 0.24 },
      { source: 'ciqual', sourceId: '4008', name: 'Pomme de terre, sans peau, crue', score: 0.21 },
      { source: 'ciqual', sourceId: '2074', name: 'Jus de pomme, pur jus', score: 0.375 },
    ])
  })

  it('is no_match when nothing passes the gate, even if a low-scoring row exists', async () => {
    const store = stubStore({ similar: { granola: [similar(ciqualApple, 0.31, { containment: SIMILARITY_LOW - 0.1 })] } })
    expect(await resolveFood({ label: 'granola' }, { store })).toMatchObject({ status: 'unresolved', reason: 'no_match', candidates: [] })
  })

  it('applies the thresholds it is given, so the measured numbers are the ones in force', async () => {
    const store = stubStore({ similar: { pomme: [similar(ciqualApple, 0.81)] } })
    expect(await resolveFood({ label: 'pomme' }, { store })).toMatchObject({ status: 'resolved', matchedBy: 'similarity' })
    expect(await resolveFood({ label: 'pomme' }, { store, similarity: { ...DEFAULT_SIMILARITY, high: 0.9 } })).toMatchObject({ status: 'unresolved', reason: 'ambiguous' })
    expect(await resolveFood({ label: 'pomme' }, { store, similarity: { ...DEFAULT_SIMILARITY, low: 1.1 } })).toMatchObject({ status: 'unresolved', reason: 'no_match' })
    expect(DEFAULT_SIMILARITY).toEqual({ high: SIMILARITY_HIGH, low: SIMILARITY_LOW, limit: 10 })
  })

  it('an unreachable OFF still outranks no_match when similarity finds nothing', async () => {
    const store = stubStore()
    const r = await resolveFood({ barcode: '3017624010701', label: 'nothing' }, { store, fetch: fakeOffFetch({ '3017624010701': new Error('ECONNRESET') }) })
    expect(r).toMatchObject({ status: 'unresolved', reason: 'source_unavailable', tried: ['off', 'ciqual', 'sportly'] })
  })
})

describe('resolveFood — synonyms take precedence', () => {
  it('a synonym hit wins over a confident similarity candidate, which is never consulted', async () => {
    const store = stubStore({ ciqual: [ciqualApple, driedApple], synonyms: [shared('pomme', 13050)], similar: { pomme: [similar(driedApple, 0.95)] } })
    const r = await resolveFood({ label: 'Pomme' }, { store })
    expect(r).toMatchObject({ status: 'resolved', matchedBy: 'synonym', score: null, tried: ['ciqual'], food: { source: 'ciqual', sourceId: '13050', nameFr: 'Pomme, pulpe et peau, crue' } })
    expect(store.calls.some((c) => c.startsWith('findCiqualSimilar'))).toBe(false)
    expect(store.calls.some((c) => c.startsWith('findCiqualByLabel'))).toBe(false)
  })

  it('a synonym hit wins over an exact label match too: it is an explicit statement', async () => {
    const store = stubStore({ ciqual: [ciqualApple], sportly: [sportlyEgg], synonyms: [{ term: 'Pomme, pulpe et peau, crue', target: { source: 'sportly', foodId: 'egg' }, origin: 'sportly', subjectId: null }] })
    const r = await resolveFood({ label: 'pomme, pulpe et peau, crue' }, { store })
    expect(r).toMatchObject({ status: 'resolved', matchedBy: 'synonym', tried: ['sportly'], food: { source: 'sportly', sourceId: 'egg' } })
  })

  it("a subject's own correction beats the shared synonym, and only for that subject", async () => {
    const own: FoodSynonymRow = { term: 'pomme', target: { source: 'ciqual', alimCode: 13111 }, origin: 'user_correction', subjectId: SUBJECT_A }
    const store = stubStore({ ciqual: [ciqualApple, driedApple], synonyms: [shared('pomme', 13050), own] })
    expect(await resolveFood({ label: 'pomme', subjectId: SUBJECT_A }, { store })).toMatchObject({ status: 'resolved', matchedBy: 'synonym', food: { sourceId: '13111' } })
    expect(await resolveFood({ label: 'pomme', subjectId: SUBJECT_B }, { store })).toMatchObject({ status: 'resolved', matchedBy: 'synonym', food: { sourceId: '13050' } })
    expect(await resolveFood({ label: 'pomme' }, { store })).toMatchObject({ status: 'resolved', matchedBy: 'synonym', food: { sourceId: '13050' } })
  })

  it('a correction pointing at another subject\'s Sportly row does not leak it', async () => {
    const correction = { ...sportlyEgg, foodId: 'egg_a', origin: 'user_correction' as const, subjectId: SUBJECT_A }
    const store = stubStore({ sportly: [correction], synonyms: [{ term: 'oeuf', target: { source: 'sportly', foodId: 'egg_a' }, origin: 'sportly', subjectId: null }] })
    expect(await resolveFood({ label: 'oeuf', subjectId: SUBJECT_A }, { store })).toMatchObject({ status: 'resolved', matchedBy: 'synonym', food: { sourceId: 'egg_a' } })
    expect(await resolveFood({ label: 'oeuf', subjectId: SUBJECT_B }, { store })).toMatchObject({ status: 'unresolved', reason: 'no_match' })
  })

  it('a synonym whose target is gone falls through to the other strategies', async () => {
    const store = stubStore({ synonyms: [shared('pomme', 99999)], similar: { pomme: [similar(ciqualApple, 0.81)] } })
    expect(await resolveFood({ label: 'pomme' }, { store })).toMatchObject({ status: 'resolved', matchedBy: 'similarity', food: { sourceId: '13050' } })
  })

  it('a stored correction is reused on the next query, which is the point of the table', async () => {
    const store = stubStore({ ciqual: [ciqualApple, driedApple], similar: { pomme: [similar(driedApple, 0.5, { nameScore: 1 }), similar(ciqualApple, 0.24, { nameScore: 1 })] } })
    expect(await resolveFood({ label: 'pomme', subjectId: SUBJECT_A }, { store })).toMatchObject({ status: 'unresolved', reason: 'ambiguous' })
    await store.putFoodSynonym({ term: 'pomme', target: { source: 'ciqual', alimCode: 13050 }, origin: 'user_correction', subjectId: SUBJECT_A }, '2026-01-01T00:00:00.000Z')
    expect(await resolveFood({ label: 'pomme', subjectId: SUBJECT_A }, { store })).toMatchObject({ status: 'resolved', matchedBy: 'synonym', food: { sourceId: '13050' } })
  })
})

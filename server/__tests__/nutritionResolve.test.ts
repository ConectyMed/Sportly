import { describe, expect, it } from 'vitest'
import { resolveFood } from '../nutrition/resolve.js'
import { ciqualApple, fakeOffFetch, OFF_V2_NOT_FOUND, OFF_V2_SPREAD, OFF_V2_WATER, offSpread, sportlyEgg, stubStore } from './nutritionHelpers.js'
import { SUBJECT_A, SUBJECT_B } from './helpers.js'

/**
 * The resolution order — barcode → OFF | label → Ciqual → Sportly → unresolved —
 * against a stub store. What matters here is which sources are consulted, in
 * what order, and that nothing is ever guessed.
 */
describe('resolveFood — order', () => {
  it('a barcode resolves through OFF first and consults nothing else', async () => {
    const store = stubStore({ off: [offSpread], ciqual: [ciqualApple] })
    const r = await resolveFood({ barcode: '3017624010701', label: 'Pomme, pulpe et peau, crue' }, { store, fetch: fakeOffFetch({}), now: () => new Date(offSpread.fetchedAt) })
    expect(r).toMatchObject({ status: 'resolved', matchedBy: 'barcode', tried: ['off'], food: { source: 'off', sourceId: '3017624010701', kind: 'product', name: 'Nutella', brand: 'Ferrero', barcode: '3017624010701' } })
    expect(store.calls.some((c) => c.startsWith('findCiqual') || c.startsWith('findSportly'))).toBe(false)
  })

  it('a barcode OFF does not know falls through to the label', async () => {
    const store = stubStore({ ciqual: [ciqualApple] })
    const fetch = fakeOffFetch({ '0000000000000': { status: 200, body: OFF_V2_NOT_FOUND } })
    const r = await resolveFood({ barcode: '0000000000000', label: 'pomme, pulpe et peau, crue' }, { store, fetch })
    expect(r).toMatchObject({ status: 'resolved', matchedBy: 'label', tried: ['off', 'ciqual'], food: { source: 'ciqual', sourceId: '13050' } })
  })

  it('a label goes to Ciqual before Sportly, even when Sportly knows it too', async () => {
    const store = stubStore({ ciqual: [ciqualApple], sportly: [{ ...sportlyEgg, foodId: 'apple', nameEn: 'Apple', aliases: ['Apple, pulp and peel, raw'] }] })
    const r = await resolveFood({ label: 'Apple, pulp and peel, raw' }, { store })
    expect(r).toMatchObject({ status: 'resolved', tried: ['ciqual'], food: { source: 'ciqual' } })
    expect(store.calls.some((c) => c.startsWith('findSportly'))).toBe(false)
  })

  it('a label Ciqual does not have goes to Sportly, matching an alias exactly', async () => {
    const store = stubStore({ ciqual: [ciqualApple], sportly: [sportlyEgg] })
    const r = await resolveFood({ label: 'Œufs' }, { store })
    expect(r).toMatchObject({ status: 'resolved', matchedBy: 'label', tried: ['ciqual', 'sportly'], food: { source: 'sportly', sourceId: 'egg', name: 'Egg', typicalPortion: { grams: 50, unit: 'piece', label: '1 egg' } } })
  })

  it('a label nobody has, exactly or by similarity, is unresolved with every source tried', async () => {
    const store = stubStore({ ciqual: [ciqualApple], sportly: [sportlyEgg] }) // no canned similarity: the database found nothing above the gate
    const r = await resolveFood({ label: 'pomme' }, { store }) // a prefix of a Ciqual name, an alias of nothing
    expect(r).toEqual({ status: 'unresolved', reason: 'no_match', query: { barcode: null, label: 'pomme' }, tried: ['ciqual', 'sportly'], candidates: [] })
    expect(store.calls).toContain('findCiqualSimilar:pomme')
  })

  it('a barcode alone that OFF does not know is unresolved after OFF only', async () => {
    const store = stubStore()
    const r = await resolveFood({ barcode: '0000000000000' }, { store, fetch: fakeOffFetch({ '0000000000000': { status: 404 } }) })
    expect(r).toEqual({ status: 'unresolved', reason: 'no_match', query: { barcode: '0000000000000', label: null }, tried: ['off'], candidates: [] })
  })

  it('an empty query is unresolved without touching any source', async () => {
    const store = stubStore()
    expect(await resolveFood({ label: '   ' }, { store })).toEqual({ status: 'unresolved', reason: 'empty_query', query: { barcode: null, label: null }, tried: [], candidates: [] })
    expect(store.calls).toEqual([])
  })

  it('OFF being unreachable is reported as such when nothing else matched, so the caller does not record "unknown"', async () => {
    const store = stubStore()
    const r = await resolveFood({ barcode: '3017624010701', label: 'nothing' }, { store, fetch: fakeOffFetch({ '3017624010701': new Error('ECONNRESET') }) })
    expect(r).toMatchObject({ status: 'unresolved', reason: 'source_unavailable', tried: ['off', 'ciqual', 'sportly'] })
  })
})

describe('resolveFood — never guesses', () => {
  it('two Ciqual foods with the same name are ambiguous, with the candidates listed', async () => {
    const twin = { ...ciqualApple, alimCode: 13051, nameEn: null }
    const store = stubStore({ ciqual: [twin, ciqualApple] })
    const r = await resolveFood({ label: 'Pomme, pulpe et peau, crue' }, { store })
    expect(r).toMatchObject({ status: 'unresolved', reason: 'ambiguous', tried: ['ciqual'] })
    expect(r.status === 'unresolved' && r.candidates).toEqual([
      { source: 'ciqual', sourceId: '13050', name: 'Pomme, pulpe et peau, crue', score: 1 },
      { source: 'ciqual', sourceId: '13051', name: 'Pomme, pulpe et peau, crue', score: 1 },
    ])
  })

  it('two shared Sportly foods answering to the same alias are ambiguous', async () => {
    const store = stubStore({ sportly: [sportlyEgg, { ...sportlyEgg, foodId: 'egg_large', nameEn: 'Large egg' }] })
    const r = await resolveFood({ label: 'oeuf' }, { store })
    expect(r).toMatchObject({ status: 'unresolved', reason: 'ambiguous', candidates: [{ source: 'sportly', sourceId: 'egg' }, { source: 'sportly', sourceId: 'egg_large' }] })
  })

  it("a subject's own confirmed correction wins over the shared row, and only for that subject", async () => {
    const correction = { ...sportlyEgg, foodId: 'egg_corrected_a', origin: 'user_correction' as const, subjectId: SUBJECT_A, typicalPortionG: 60 }
    const store = stubStore({ sportly: [sportlyEgg, correction] })
    expect(await resolveFood({ label: 'egg', subjectId: SUBJECT_A }, { store })).toMatchObject({ status: 'resolved', food: { sourceId: 'egg_corrected_a', typicalPortion: { grams: 60 } } })
    expect(await resolveFood({ label: 'egg', subjectId: SUBJECT_B }, { store })).toMatchObject({ status: 'resolved', food: { sourceId: 'egg' } })
    expect(await resolveFood({ label: 'egg' }, { store })).toMatchObject({ status: 'resolved', food: { sourceId: 'egg' } })
  })
})

describe('resolveFood — attribution', () => {
  it('an OFF product carries the ODbL credit and a link to its page', async () => {
    const store = stubStore()
    const r = await resolveFood({ barcode: '3017624010701' }, { store, fetch: fakeOffFetch({ '3017624010701': { status: 200, body: OFF_V2_SPREAD } }) })
    expect(r.status === 'resolved' && r.food.attribution).toEqual({
      source: 'off', provider: 'Open Food Facts', licence: 'Open Database License (ODbL) 1.0', licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
      text: 'Data from Open Food Facts (world.openfoodfacts.org), © Open Food Facts contributors, made available under the Open Database License.',
      url: 'https://world.openfoodfacts.org/product/3017624010701', required: true,
    })
    expect(r.status === 'resolved' && r.food.per100g).toEqual({ kcal: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9, fibreG: null })
    // No serving on this product: no typical portion, rather than an invented one.
    expect(r.status === 'resolved' && r.food.typicalPortion).toBeNull()

    const water = await resolveFood({ barcode: '3274080005003' }, { store, fetch: fakeOffFetch({ '3274080005003': { status: 200, body: OFF_V2_WATER } }) })
    expect(water.status === 'resolved' && water.food).toMatchObject({ name: 'isabelle', brand: 'Cristaline', per100g: { kcal: null, proteinG: null, carbsG: null, fatG: null, fibreG: null }, typicalPortion: { grams: 1500, unit: 'serving', label: '1,5L' } })
  })

  it('a Ciqual food carries the ANSES credit naming the table version, under Licence Ouverte', async () => {
    const r = await resolveFood({ label: 'Apple, pulp and peel, raw' }, { store: stubStore({ ciqual: [ciqualApple] }) })
    expect(r.status === 'resolved' && r.food.attribution).toEqual({
      source: 'ciqual', provider: 'ANSES', licence: 'Licence Ouverte / Open Licence 2.0 (Etalab)', licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence',
      text: 'Source : Anses. Table de composition nutritionnelle des aliments Ciqual 2025 (ciqual.anses.fr).',
      url: 'https://ciqual.anses.fr/#/aliments/13050', required: true,
    })
    expect(r.status === 'resolved' && r.food).toMatchObject({ name: 'Apple, pulp and peel, raw', nameFr: 'Pomme, pulpe et peau, crue', kind: 'ingredient', typicalPortion: null, per100g: { kcal: 53.9, proteinG: 0.3, carbsG: 11.6, fatG: 0, fibreG: 1.4 } })
  })

  it('a Sportly food carries an attribution too, marked not required', async () => {
    const r = await resolveFood({ label: 'egg' }, { store: stubStore({ sportly: [sportlyEgg] }) })
    expect(r.status === 'resolved' && r.food.attribution).toMatchObject({ source: 'sportly', provider: 'Sportly', required: false, url: null })
  })
})

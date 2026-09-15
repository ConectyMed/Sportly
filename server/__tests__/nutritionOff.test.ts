import { describe, expect, it } from 'vitest'
import { lookupBarcode, mapOffResponse, normalizeBarcode, OFF_API_FIELDS, OFF_CACHE_TTL_MS, OFF_NOT_FOUND_TTL_MS, OFF_USER_AGENT } from '../nutrition/off.js'
import { fakeOffFetch, OFF_V2_NOT_FOUND, OFF_V2_SPREAD, offSpread, stubStore } from './nutritionHelpers.js'

const T0 = Date.parse('2026-01-01T00:00:00.000Z')
const at = (ms: number) => () => new Date(ms)

describe('normalizeBarcode', () => {
  it('keeps 8 to 14 digits, dropping spaces and dashes, and rejects anything else', () => {
    expect(normalizeBarcode('3017624010701')).toBe('3017624010701')
    expect(normalizeBarcode(' 3017 6240 1070 1 ')).toBe('3017624010701')
    expect(normalizeBarcode('30176-24010-701')).toBe('3017624010701')
    expect(normalizeBarcode('12345678')).toBe('12345678')
    expect(normalizeBarcode('1234567')).toBeNull()
    expect(normalizeBarcode('123456789012345')).toBeNull()
    expect(normalizeBarcode('3017624O10701')).toBeNull()
    expect(normalizeBarcode('')).toBeNull()
  })
})

describe('mapOffResponse', () => {
  it('maps a v2 product to a cache row, lifting the per-100 g figures and keeping the raw nutriments', () => {
    const row = mapOffResponse('3017624010701', 200, OFF_V2_SPREAD, '2026-01-01T00:00:00.000Z')
    expect(row).toMatchObject({
      barcode: '3017624010701', status: 'found', productName: 'Nutella', brands: 'Ferrero', quantity: '400 g', servingSize: '15 g', servingQuantityG: 15,
      per100g: { kcal: 539, kj: 2252, proteinG: 6.3, carbsG: 57.5, sugarsG: 56.3, fatG: 30.9, saturatedFatG: 10.6, fibreG: null, saltG: 0.107 },
      lastModifiedT: 1700000000, productUrl: 'https://world.openfoodfacts.org/product/3017624010701', httpStatus: 200,
    })
    expect(row.nutriments).toEqual(OFF_V2_SPREAD.product.nutriments)
  })

  it('converts kJ to kcal when OFF has only kJ — a unit conversion, not a guess', () => {
    const body = { status: 1, product: { product_name: 'x', nutriments: { energy_100g: 2252, proteins_100g: '6,3' } } }
    const row = mapOffResponse('3017624010701', 200, body, '2026-01-01T00:00:00.000Z')
    expect(row.per100g.kcal).toBe(538.2) // 2252 / 4.184 = 538.24…
    expect(row.per100g.kj).toBe(2252)
    expect(row.per100g.proteinG).toBe(6.3) // a decimal comma is still a number
    expect(row.per100g.carbsG).toBeNull()
  })

  it('only takes a serving in grams or millilitres as a portion in grams', () => {
    const base = { status: 1, product: { product_name: 'x', nutriments: {} } }
    expect(mapOffResponse('1', 200, { ...base, product: { ...base.product, serving_quantity: 30, serving_quantity_unit: 'g' } }, '').servingQuantityG).toBe(30)
    expect(mapOffResponse('1', 200, { ...base, product: { ...base.product, serving_quantity: 330, serving_quantity_unit: 'ml' } }, '').servingQuantityG).toBe(330)
    expect(mapOffResponse('1', 200, { ...base, product: { ...base.product, serving_quantity: 2, serving_quantity_unit: 'piece' } }, '').servingQuantityG).toBeNull()
    expect(mapOffResponse('1', 200, base, '').servingQuantityG).toBeNull()
  })

  it('records a definite not-found (404, or status 0) as an empty not_found row', () => {
    expect(mapOffResponse('0000000000000', 404, null, '2026-01-01T00:00:00.000Z')).toMatchObject({ status: 'not_found', productName: null, nutriments: null, httpStatus: 404 })
    expect(mapOffResponse('0000000000000', 200, OFF_V2_NOT_FOUND, '2026-01-01T00:00:00.000Z')).toMatchObject({ status: 'not_found', nutriments: null, httpStatus: 200 })
  })

  it('refuses to cache anything else: a 5xx, a rate limit or a non-object body throws', () => {
    expect(() => mapOffResponse('1', 500, null, '')).toThrow(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }))
    expect(() => mapOffResponse('1', 429, null, '')).toThrow(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }))
    expect(() => mapOffResponse('1', 200, 'not json object', '')).toThrow(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }))
  })
})

describe('lookupBarcode', () => {
  it('fetches on a miss with an identifying User-Agent and only the fields it stores, then caches', async () => {
    const store = stubStore()
    const fetch = fakeOffFetch({ '3017624010701': { status: 200, body: OFF_V2_SPREAD } })
    const first = await lookupBarcode('3017624010701', { store, fetch, now: at(T0) })
    expect(first).toMatchObject({ status: 'found', fromCache: false, stale: false, product: { productName: 'Nutella' } })
    expect(fetch.calls).toEqual([`https://world.openfoodfacts.org/api/v2/product/3017624010701?fields=${OFF_API_FIELDS}`])
    expect(OFF_USER_AGENT).toMatch(/^Sportly\//)
    expect(store.calls).toContain('putOffProduct:3017624010701:found')

    const second = await lookupBarcode('3017624010701', { store, fetch, now: at(T0 + 1000) })
    expect(second).toMatchObject({ status: 'found', fromCache: true, stale: false })
    expect(fetch.calls).toHaveLength(1)
  })

  it('refreshes a row older than the TTL and serves the fresh one', async () => {
    const store = stubStore({ off: [offSpread] })
    const fetch = fakeOffFetch({ '3017624010701': { status: 200, body: { ...OFF_V2_SPREAD, product: { ...OFF_V2_SPREAD.product, product_name: 'Nutella (renamed)' } } } })
    const r = await lookupBarcode('3017624010701', { store, fetch, now: at(T0 + OFF_CACHE_TTL_MS + 1) })
    expect(r).toMatchObject({ status: 'found', fromCache: false, product: { productName: 'Nutella (renamed)' } })
    expect(fetch.calls).toHaveLength(1)
  })

  it('serves the stale row, marked stale, when OFF cannot be reached', async () => {
    const store = stubStore({ off: [offSpread] })
    const fetch = fakeOffFetch({ '3017624010701': new Error('ECONNRESET') })
    const r = await lookupBarcode('3017624010701', { store, fetch, now: at(T0 + OFF_CACHE_TTL_MS + 1) })
    expect(r).toMatchObject({ status: 'found', fromCache: true, stale: true, product: { productName: 'Nutella' } })
  })

  it('reports OFF as unavailable — and writes nothing — when there is no cached row', async () => {
    const store = stubStore()
    for (const answer of [new Error('ECONNRESET'), { status: 503 }, { status: 429 }]) {
      const fetch = fakeOffFetch({ '3017624010701': answer })
      const r = await lookupBarcode('3017624010701', { store, fetch, now: at(T0) })
      expect(r.status).toBe('unavailable')
    }
    expect(store.calls.filter((c) => c.startsWith('putOffProduct'))).toEqual([])
    expect(store.off.size).toBe(0)
  })

  it('caches a not-found answer for a shorter time', async () => {
    const store = stubStore()
    const fetch = fakeOffFetch({ '0000000000000': { status: 404 } })
    expect(await lookupBarcode('0000000000000', { store, fetch, now: at(T0) })).toEqual({ status: 'not_found', barcode: '0000000000000', fromCache: false })
    expect(await lookupBarcode('0000000000000', { store, fetch, now: at(T0 + OFF_NOT_FOUND_TTL_MS - 1) })).toEqual({ status: 'not_found', barcode: '0000000000000', fromCache: true })
    expect(fetch.calls).toHaveLength(1)
    await lookupBarcode('0000000000000', { store, fetch, now: at(T0 + OFF_NOT_FOUND_TTL_MS + 1) })
    expect(fetch.calls).toHaveLength(2)
    expect(OFF_NOT_FOUND_TTL_MS).toBeLessThan(OFF_CACHE_TTL_MS)
  })

  it('rejects a string that is not a barcode without touching the store or the network', async () => {
    const store = stubStore()
    const fetch = fakeOffFetch({})
    expect(await lookupBarcode('not-a-barcode', { store, fetch })).toEqual({ status: 'invalid_barcode', input: 'not-a-barcode' })
    expect(store.calls).toEqual([])
    expect(fetch.calls).toEqual([])
  })

  it('times out a hanging request and reports OFF as unavailable', async () => {
    const store = stubStore()
    const hanging = (async (_url: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))) as never
    const r = await lookupBarcode('3017624010701', { store, fetch: hanging, timeoutMs: 20 })
    expect(r).toEqual({ status: 'unavailable', barcode: '3017624010701', reason: 'PROVIDER_TIMEOUT' })
  })
})

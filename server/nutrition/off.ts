import { BoundaryError } from '../errors.js'
import { offProductUrl } from './attribution.js'
import type { NutritionStore, OffPer100g, OffProductRow } from './store.js'

export { offProductUrl }

/**
 * Open Food Facts, by barcode, through the public API — never the dump.
 *
 * One product per request, cached in `off.products` (its own schema; see the
 * migration for why). A lookup is served from the cache while the row is
 * fresh, refreshed when it is stale, and served stale — marked as such — when
 * OFF cannot be reached. A barcode OFF does not know is cached as not-found
 * for a shorter time, so a scan of an unknown product is not a request per
 * scan.
 *
 * The network call is injected (`deps.fetch`) so the whole path runs in tests
 * without a socket. Nothing here is a model call.
 */

export const OFF_API_BASE = 'https://world.openfoodfacts.org/api/v2/product/'

/** Only what we store. Asking for less is what OFF's API guidelines ask of a reuser. */
export const OFF_API_FIELDS = 'code,product_name,product_name_fr,brands,quantity,serving_size,serving_quantity,serving_quantity_unit,nutriments,last_modified_t'

/** OFF requires an identifying User-Agent; anonymous ones are throttled. */
export const OFF_USER_AGENT = 'Sportly/1.0 (https://github.com/ConectyMed/Sportly)'

export const OFF_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const OFF_NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000
export const OFF_TIMEOUT_MS = 8_000

export interface OffFetchResponse {
  status: number
  text(): Promise<string>
}

/** The shape of global `fetch` that this module uses; global `fetch` satisfies it. */
export type OffFetch = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal }) => Promise<OffFetchResponse>

export interface BarcodeLookupDeps {
  store: NutritionStore
  fetch?: OffFetch
  now?: () => Date
  cacheTtlMs?: number
  notFoundTtlMs?: number
  timeoutMs?: number
}

export type BarcodeLookup =
  | { status: 'found'; product: OffProductRow; fromCache: boolean; stale: boolean }
  | { status: 'not_found'; barcode: string; fromCache: boolean }
  | { status: 'invalid_barcode'; input: string }
  /** OFF could not be reached and there was nothing cached. Nothing was written. */
  | { status: 'unavailable'; barcode: string; reason: string }

/**
 * Digits only, 8 to 14 of them (EAN-8, UPC-A, EAN-13, GTIN-14). Spaces and
 * dashes from a typed code are dropped; anything else is not a barcode.
 * The digits are passed to OFF as given — no padding, no check-digit repair.
 */
export function normalizeBarcode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '')
  return /^\d{8,14}$/.test(digits) ? digits : null
}

const number = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

const string = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** kJ → kcal is a unit conversion, not an estimate. */
const KJ_PER_KCAL = 4.184

function per100g(nutriments: Record<string, unknown>): OffPer100g {
  const kj = number(nutriments['energy-kj_100g']) ?? number(nutriments.energy_100g)
  const kcal = number(nutriments['energy-kcal_100g']) ?? (kj === null ? null : Math.round((kj / KJ_PER_KCAL) * 10) / 10)
  return {
    kcal,
    kj,
    proteinG: number(nutriments.proteins_100g),
    carbsG: number(nutriments.carbohydrates_100g),
    sugarsG: number(nutriments.sugars_100g),
    fatG: number(nutriments.fat_100g),
    saturatedFatG: number(nutriments['saturated-fat_100g']),
    fibreG: number(nutriments.fiber_100g),
    saltG: number(nutriments.salt_100g),
  }
}

const EMPTY_PER100G: OffPer100g = { kcal: null, kj: null, proteinG: null, carbsG: null, sugarsG: null, fatG: null, saturatedFatG: null, fibreG: null, saltG: null }

export function notFoundRow(barcode: string, httpStatus: number, fetchedAtIso: string): OffProductRow {
  return {
    barcode, status: 'not_found', productName: null, productNameFr: null, brands: null, quantity: null, servingSize: null,
    servingQuantityG: null, per100g: EMPTY_PER100G, nutriments: null, lastModifiedT: null, productUrl: null, fetchedAt: fetchedAtIso, httpStatus,
  }
}

/**
 * Map one API response to a cache row. Pure. Throws PROVIDER_UNAVAILABLE for a
 * status that is neither a product nor a definite not-found, so that a 5xx
 * or a rate limit is never cached as "OFF does not know this barcode".
 */
export function mapOffResponse(barcode: string, httpStatus: number, body: unknown, fetchedAtIso: string): OffProductRow {
  if (httpStatus === 404) return notFoundRow(barcode, httpStatus, fetchedAtIso)
  if (httpStatus !== 200) {
    throw new BoundaryError('PROVIDER_UNAVAILABLE', `Open Food Facts answered ${httpStatus} for a barcode lookup.`, { status: httpStatus }, false)
  }
  if (!isRecord(body)) throw new BoundaryError('PROVIDER_UNAVAILABLE', 'Open Food Facts answered with a body that is not an object.', undefined, false)
  // v2: `status` 1 with a product, 0 when the barcode is unknown (also as a 200 on some routes).
  const product = isRecord(body.product) ? body.product : null
  if (body.status === 0 || product === null) return notFoundRow(barcode, httpStatus, fetchedAtIso)

  const nutriments = isRecord(product.nutriments) ? product.nutriments : {}
  const servingUnit = string(product.serving_quantity_unit)
  const servingQuantity = number(product.serving_quantity)
  return {
    barcode,
    status: 'found',
    productName: string(product.product_name),
    productNameFr: string(product.product_name_fr),
    brands: string(product.brands),
    quantity: string(product.quantity),
    servingSize: string(product.serving_size),
    // Only a serving stated in grams (or millilitres, which the journal treats alike) is a portion in grams.
    servingQuantityG: servingQuantity !== null && (servingUnit === null || servingUnit === 'g' || servingUnit === 'ml') ? servingQuantity : null,
    per100g: per100g(nutriments),
    nutriments,
    lastModifiedT: number(product.last_modified_t),
    productUrl: offProductUrl(barcode),
    fetchedAt: fetchedAtIso,
    httpStatus,
  }
}

const defaultFetch: OffFetch = async (url, init) => {
  const res = await fetch(url, init)
  return { status: res.status, text: () => res.text() }
}

async function fetchProduct(barcode: string, deps: Required<Pick<BarcodeLookupDeps, 'fetch' | 'timeoutMs'>>, fetchedAtIso: string): Promise<OffProductRow> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs)
  try {
    const res = await deps.fetch(`${OFF_API_BASE}${encodeURIComponent(barcode)}?fields=${OFF_API_FIELDS}`, {
      method: 'GET',
      headers: { 'user-agent': OFF_USER_AGENT, accept: 'application/json' },
      signal: controller.signal,
    })
    let body: unknown = null
    if (res.status === 200) {
      const text = await res.text()
      try {
        body = JSON.parse(text)
      } catch {
        throw new BoundaryError('PROVIDER_UNAVAILABLE', 'Open Food Facts answered with a body that is not JSON.', undefined, false)
      }
    }
    return mapOffResponse(barcode, res.status, body, fetchedAtIso)
  } catch (err) {
    if (err instanceof BoundaryError) throw err
    if (controller.signal.aborted) throw new BoundaryError('PROVIDER_TIMEOUT', 'Open Food Facts timed out.', undefined, false)
    // A fetch failure can name a host or a proxy; keep it for the server log only.
    throw new BoundaryError('PROVIDER_UNAVAILABLE', err instanceof Error ? err.message : 'Network error.', undefined, false)
  } finally {
    clearTimeout(timer)
  }
}

/** Look a barcode up: cache first, then the API, then the stale cache. */
export async function lookupBarcode(input: string, deps: BarcodeLookupDeps): Promise<BarcodeLookup> {
  const barcode = normalizeBarcode(input)
  if (barcode === null) return { status: 'invalid_barcode', input }

  const now = (deps.now ?? (() => new Date))()
  const cacheTtlMs = deps.cacheTtlMs ?? OFF_CACHE_TTL_MS
  const notFoundTtlMs = deps.notFoundTtlMs ?? OFF_NOT_FOUND_TTL_MS

  const cached = await deps.store.getOffProduct(barcode)
  if (cached) {
    const age = now.getTime() - Date.parse(cached.fetchedAt)
    const ttl = cached.status === 'found' ? cacheTtlMs : notFoundTtlMs
    if (age >= 0 && age < ttl) {
      return cached.status === 'found' ? { status: 'found', product: cached, fromCache: true, stale: false } : { status: 'not_found', barcode, fromCache: true }
    }
  }

  let fresh: OffProductRow
  try {
    fresh = await fetchProduct(barcode, { fetch: deps.fetch ?? defaultFetch, timeoutMs: deps.timeoutMs ?? OFF_TIMEOUT_MS }, now.toISOString())
  } catch (err) {
    const reason = err instanceof BoundaryError ? err.code : 'PROVIDER_UNAVAILABLE'
    if (cached?.status === 'found') return { status: 'found', product: cached, fromCache: true, stale: true }
    return { status: 'unavailable', barcode, reason }
  }
  await deps.store.putOffProduct(fresh)
  return fresh.status === 'found' ? { status: 'found', product: fresh, fromCache: false, stale: false } : { status: 'not_found', barcode, fromCache: false }
}

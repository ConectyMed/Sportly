/**
 * The nutrition data layer. Three sources, one resolution order, one macro
 * calculator, attribution on every result. No model call anywhere below this
 * line; the scan session that will use it is a later step.
 */
export * from './types.js'
export * from './attribution.js'
export { macrosForPortion, KCAL_PER_G, type Macros } from './macros.js'
export type { NutritionStore, OffProductRow, OffPer100g, CiqualFoodRow, SportlyFoodRow, SportlyFoodInput } from './store.js'
export { createPostgresNutritionStore } from './postgres.js'
export { lookupBarcode, normalizeBarcode, mapOffResponse, OFF_API_BASE, OFF_API_FIELDS, OFF_USER_AGENT, OFF_CACHE_TTL_MS, OFF_NOT_FOUND_TTL_MS, type BarcodeLookup, type BarcodeLookupDeps, type OffFetch } from './off.js'
export { resolveFood, offProductToFood, ciqualToFood, sportlyToFood, type ResolveDeps } from './resolve.js'

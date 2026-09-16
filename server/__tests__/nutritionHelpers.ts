import type { CiqualFoodRow, NutritionStore, OffProductRow, SportlyFoodInput, SportlyFoodRow } from '../nutrition/store.js'
import type { OffFetch } from '../nutrition/off.js'

/**
 * A stub nutrition store for logic tests: a Map per table, exact matching on a
 * crude fold of the label. It proves nothing about the SQL — that is what
 * postgresNutrition.test.ts is for — only that the resolver and the lookup
 * do the right thing with what a store gives them.
 */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/gi, 'oe')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')

export interface StubStore extends NutritionStore {
  off: Map<string, OffProductRow>
  ciqual: CiqualFoodRow[]
  sportly: Array<SportlyFoodRow & { aliases: string[] }>
  calls: string[]
}

export function stubStore(seed: { ciqual?: CiqualFoodRow[]; sportly?: SportlyFoodInput[]; off?: OffProductRow[] } = {}): StubStore {
  const store: StubStore = {
    engine: 'memory',
    off: new Map((seed.off ?? []).map((r) => [r.barcode, r])),
    ciqual: [...(seed.ciqual ?? [])],
    sportly: [...(seed.sportly ?? [])],
    calls: [],
    async getOffProduct(barcode) {
      store.calls.push(`getOffProduct:${barcode}`)
      return store.off.get(barcode) ?? null
    },
    async putOffProduct(row) {
      store.calls.push(`putOffProduct:${row.barcode}:${row.status}`)
      store.off.set(row.barcode, row)
    },
    async findCiqualByLabel(label) {
      store.calls.push(`findCiqualByLabel:${label}`)
      const key = fold(label)
      return store.ciqual.filter((r) => fold(r.nameFr) === key || (r.nameEn !== null && fold(r.nameEn) === key)).sort((a, b) => a.alimCode - b.alimCode)
    },
    async findSportlyByLabel(label, subjectId) {
      store.calls.push(`findSportlyByLabel:${label}:${subjectId ?? ''}`)
      const key = fold(label)
      return store.sportly
        .filter((r) => r.subjectId === null || r.subjectId === subjectId)
        .filter((r) => fold(r.nameEn) === key || (r.nameFr !== null && fold(r.nameFr) === key) || r.aliases.some((a) => fold(a) === key))
        .sort((a, b) => Number(b.subjectId !== null) - Number(a.subjectId !== null) || a.foodId.localeCompare(b.foodId))
    },
    async putSportlyFood(food) {
      store.sportly = store.sportly.filter((r) => r.foodId !== food.foodId)
      store.sportly.push({ ...food })
    },
  }
  return store
}

export const ciqualApple: CiqualFoodRow = {
  alimCode: 13050, nameFr: 'Pomme, pulpe et peau, crue', nameEn: 'Apple, pulp and peel, raw', groupCode: '02', subgroupCode: '0201', subsubgroupCode: '020100',
  energyKcal: 53.9, energyKj: 227, proteinG: 0.3, carbsG: 11.6, sugarsG: 11.3, fatG: 0, saturatedFatG: 0, fibreG: 1.4, saltG: null, waterG: 85.9, ciqualVersion: 'Ciqual 2025',
}

export const sportlyEgg: SportlyFoodInput = {
  foodId: 'egg', kind: 'ingredient', nameEn: 'Egg', nameFr: 'Œuf', origin: 'sportly', subjectId: null, ciqualAlimCode: null,
  energyKcal100g: 155, proteinG100g: 13, carbsG100g: 1.1, fatG100g: 11, fibreG100g: 0, typicalPortionG: 50, portionUnit: 'piece', portionLabel: '1 egg', notes: null,
  aliases: ['eggs', 'oeuf', 'œufs', 'boiled egg'],
}

/** A found product row as `mapOffResponse` produces it for OFF_V2_SPREAD below. */
export const offSpread: OffProductRow = {
  barcode: '3017624010701', status: 'found', productName: 'Nutella', productNameFr: null, brands: 'Ferrero', quantity: '400.0 g',
  servingSize: null, servingQuantityG: null,
  per100g: { kcal: 539, kj: 2227.9, proteinG: 6.3, carbsG: 57.5, sugarsG: 56.3, fatG: 30.9, saturatedFatG: 10.6, fibreG: null, saltG: 0.1075 },
  nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3 }, lastModifiedT: 1785948506, productUrl: 'https://world.openfoodfacts.org/product/3017624010701',
  fetchedAt: '2026-01-01T00:00:00.000Z', httpStatus: 200,
}

/** A fetch stub that answers from a table of {status, body} by barcode and counts calls. */
export function fakeOffFetch(answers: Record<string, { status: number; body?: unknown } | Error>): OffFetch & { calls: string[] } {
  const calls: string[] = []
  const f: OffFetch = async (url) => {
    calls.push(url)
    const barcode = /product\/(\d+)/.exec(url)?.[1] ?? ''
    const answer = answers[barcode]
    if (!answer) throw new Error(`no fake answer for ${barcode}`)
    if (answer instanceof Error) throw answer
    return { status: answer.status, text: async () => (answer.body === undefined ? '' : JSON.stringify(answer.body)) }
  }
  return Object.assign(f, { calls })
}

/**
 * Real Open Food Facts v2 answers, as returned to scripts/off-lookup.mjs on
 * 2026-09-15 for the fields we request (nutriments trimmed to the keys that
 * matter). A hazelnut spread with full macros and no serving; a mineral water
 * with a serving and no macros at all; an invalid code.
 */
export const OFF_V2_SPREAD = {
  code: '3017624010701',
  product: {
    brands: 'Ferrero',
    code: '3017624010701',
    last_modified_t: 1785948506,
    nutriments: {
      carbohydrates_100g: 57.5, energy: 2227.9, 'energy-kcal': 539, 'energy-kcal_100g': 539, 'energy-kcal_unit': 'kcal', 'energy-kj_100g': 2227.9, energy_100g: 2227.9, energy_unit: 'kJ',
      fat_100g: 30.9, proteins_100g: 6.3, salt_100g: 0.1075, 'saturated-fat_100g': 10.6, sodium_100g: 0.043, sugars_100g: 56.3,
    },
    nutrition_data_per: '100g',
    product_name: 'Nutella',
    product_quantity: 400,
    product_quantity_unit: 'g',
    quantity: '400.0 g',
  },
  status: 1,
  status_verbose: 'product found',
}

export const OFF_V2_WATER = {
  code: '3274080005003',
  product: {
    brands: 'Cristaline',
    code: '3274080005003',
    last_modified_t: 1789228158,
    nutriments: { bicarbonate_100g: 0.435, calcium_100g: 0.113, magnesium_100g: 0.028, salt_100g: 0.00275, sodium_100g: 0.0063, ph_100g: 7.3 },
    nutrition_data_per: '100g',
    product_name: 'isabelle',
    product_name_fr: 'isabelle',
    product_quantity: 1500,
    product_quantity_unit: 'ml',
    quantity: '1500 ml',
    serving_quantity: 1500,
    serving_quantity_unit: 'ml',
    serving_size: '1,5L',
  },
  status: 1,
  status_verbose: 'product found',
}

export const OFF_V2_NOT_FOUND = { code: '00000000', status: 0, status_verbose: 'no code or invalid code' }

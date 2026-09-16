import { beforeEach, expect, it } from 'vitest'
import { lookupBarcode } from '../nutrition/off.js'
import { createPostgresNutritionStore } from '../nutrition/postgres.js'
import { resolveFood } from '../nutrition/resolve.js'
import { macrosForPortion } from '../nutrition/macros.js'
import { describePostgres } from './pg.js'
import { SUBJECT_A } from './helpers.js'
import { fakeOffFetch, OFF_V2_SPREAD, sportlyEgg } from './nutritionHelpers.js'

/**
 * The nutrition layer against a real Postgres with migrations/0003 applied and
 * the Ciqual snapshot loaded (CI: `node scripts/ingest-ciqual.mjs apply`).
 *
 * What only the database can prove: that `off.products` really is in its own
 * schema with no reference either way; that label matching is exact on
 * `sportly_label_norm` on both sides; that the check constraints hold; and that
 * the Ciqual table ANSES publishes is in there, row for row.
 */
describePostgres('postgres nutrition', ({ pool, sql }) => {
  const store = createPostgresNutritionStore(sql)
  const T0 = new Date('2026-01-01T00:00:00.000Z')

  beforeEach(async () => {
    await pool.query('truncate off.products, sportly_foods, sportly_food_aliases, sportly_food_synonyms')
  })

  it('keeps Open Food Facts in its own schema, with no reference in either direction', async () => {
    const schema = await pool.query(`select table_schema from information_schema.tables where table_name = 'products'`)
    expect(schema.rows).toEqual([{ table_schema: 'off' }])

    // No foreign key crosses the schema boundary.
    const crossing = await pool.query(`
      select conrelid::regclass::text as from_table, confrelid::regclass::text as to_table
        from pg_constraint
       where contype = 'f'
         and ((conrelid::regclass::text like 'off.%') <> (confrelid::regclass::text like 'off.%'))`)
    expect(crossing.rows).toEqual([])

    // And no column in a public table is named after an OFF product.
    const columns = await pool.query(`select table_name, column_name from information_schema.columns where table_schema = 'public' and (column_name like '%barcode%' or column_name like '%off_%')`)
    expect(columns.rows).toEqual([])
  })

  it('has the ANSES Ciqual table loaded, with its provenance', async () => {
    const ingest = await pool.query<{ ciqual_version: string; food_count: number; dataset_doi: string; licence: string; attribution: string }>('select ciqual_version, food_count, dataset_doi, licence, attribution from ciqual_ingest')
    expect(ingest.rows).toHaveLength(1)
    expect(ingest.rows[0]).toMatchObject({ ciqual_version: 'Ciqual 2025', dataset_doi: 'doi:10.57745/RDMHWY' })
    expect(ingest.rows[0].licence).toMatch(/Licence Ouverte/)
    expect(ingest.rows[0].attribution).toMatch(/Anses/)

    const count = await pool.query<{ n: number; with_kcal: number }>(`select count(*)::int as n, count(energy_kcal)::int as with_kcal from ciqual_foods where ciqual_version = 'Ciqual 2025'`)
    expect(count.rows[0].n).toBe(ingest.rows[0].food_count)
    // ANSES announces 3,484 foods in the 2025 table.
    expect(count.rows[0].n).toBeGreaterThanOrEqual(3400)
    expect(count.rows[0].with_kcal).toBeGreaterThan(3000)
  })

  it('matches a Ciqual label exactly and case- and accent-insensitively, never by prefix', async () => {
    const [any] = (await pool.query<{ name_fr: string; alim_code: number }>(`select name_fr, alim_code from ciqual_foods where energy_kcal is not null order by alim_code limit 1`)).rows
    const shouted = any.name_fr.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const exact = await store.findCiqualByLabel(`  ${shouted}  `)
    expect(exact.map((r) => r.alimCode)).toEqual([any.alim_code])
    expect(await store.findCiqualByLabel(any.name_fr.slice(0, Math.max(3, any.name_fr.length - 2)))).toEqual([])

    const r = await resolveFood({ label: any.name_fr }, { store })
    expect(r).toMatchObject({ status: 'resolved', matchedBy: 'label', food: { source: 'ciqual', sourceId: String(any.alim_code), attribution: { provider: 'ANSES', required: true, url: `https://ciqual.anses.fr/#/aliments/${any.alim_code}` } } })
  })

  it('caches an OFF lookup: the second call is served from off.products with no request', async () => {
    const fetch = fakeOffFetch({ '3017624010701': { status: 200, body: OFF_V2_SPREAD } })
    const first = await lookupBarcode('3017624010701', { store, fetch, now: () => T0 })
    expect(first).toMatchObject({ status: 'found', fromCache: false })
    const second = await lookupBarcode('3017624010701', { store, fetch, now: () => new Date(T0.getTime() + 60_000) })
    expect(second).toMatchObject({ status: 'found', fromCache: true, stale: false })
    expect(fetch.calls).toHaveLength(1)

    const row = (await pool.query(`select status, product_name, brands, energy_kcal_100g, protein_g_100g, fibre_g_100g, salt_g_100g, serving_quantity_g, nutriments->>'sugars_100g' as sugars, fetched_at from off.products where barcode = $1`, ['3017624010701'])).rows[0]
    expect(row).toMatchObject({ status: 'found', product_name: 'Nutella', brands: 'Ferrero', energy_kcal_100g: '539.0000', protein_g_100g: '6.3000', fibre_g_100g: null, salt_g_100g: '0.1075', serving_quantity_g: null, sugars: '56.3' })
    expect(new Date(row.fetched_at as string).toISOString()).toBe(T0.toISOString())

    // The row comes back through the port as numbers, with null still null and OFF's four decimals intact.
    expect(second.status === 'found' && second.product.per100g).toEqual({ kcal: 539, kj: 2227.9, proteinG: 6.3, carbsG: 57.5, sugarsG: 56.3, fatG: 30.9, saturatedFatG: 10.6, fibreG: null, saltG: 0.1075 })
  })

  it('caches a not-found barcode as an empty row, which the constraint keeps empty', async () => {
    await lookupBarcode('0000000000000', { store, fetch: fakeOffFetch({ '0000000000000': { status: 404 } }), now: () => T0 })
    expect((await pool.query(`select status, product_name, nutriments, http_status from off.products where barcode = '0000000000000'`)).rows).toEqual([{ status: 'not_found', product_name: null, nutriments: null, http_status: 404 }])
    await expect(pool.query(`insert into off.products (barcode, status, product_name, fetched_at, http_status) values ('1', 'not_found', 'x', now(), 404)`)).rejects.toThrow(/off_products_not_found_is_empty/)
  })

  it('matches a Sportly food by name or alias on the same normal form, and a subject correction only for its subject', async () => {
    await store.putSportlyFood(sportlyEgg, T0.toISOString())
    for (const label of ['egg', 'EGG', 'Œuf', 'oeuf', 'ŒUFS', 'boiled  egg']) {
      const rows = await store.findSportlyByLabel(label)
      expect(rows.map((r) => r.foodId), label).toEqual(['egg'])
    }
    expect(await store.findSportlyByLabel('eg')).toEqual([])

    await store.putSportlyFood({ ...sportlyEgg, foodId: 'egg_a', origin: 'user_correction', subjectId: SUBJECT_A, typicalPortionG: 60, aliases: ['egg'] }, T0.toISOString())
    expect((await store.findSportlyByLabel('egg', SUBJECT_A)).map((r) => r.foodId)).toEqual(['egg_a', 'egg'])
    expect((await store.findSportlyByLabel('egg')).map((r) => r.foodId)).toEqual(['egg'])

    const r = await resolveFood({ label: 'oeuf', subjectId: SUBJECT_A }, { store })
    expect(r).toMatchObject({ status: 'resolved', tried: ['ciqual', 'sportly'], food: { source: 'sportly', sourceId: 'egg_a', typicalPortion: { grams: 60, unit: 'piece' } } })
    if (r.status !== 'resolved') throw new Error('unreachable')
    expect(macrosForPortion(r.food.per100g, r.food.typicalPortion!.grams)).toEqual({ kcal: 93, proteinG: 7.8, carbsG: 0.7, fatG: 6.6, fibreG: 0, kcalDerived: false })
  })

  it('refuses a correction without a subject, and a shared row with one', async () => {
    const at = T0.toISOString()
    await expect(store.putSportlyFood({ ...sportlyEgg, foodId: 'bad1', origin: 'user_correction', subjectId: null }, at)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILURE' })
    await expect(store.putSportlyFood({ ...sportlyEgg, foodId: 'bad2', origin: 'sportly', subjectId: SUBJECT_A }, at)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILURE' })
  })

  it('returns unresolved, with every source tried, for a label nothing resembles', async () => {
    expect(await resolveFood({ label: 'zzqx vwrk plmnt' }, { store })).toEqual({
      status: 'unresolved', reason: 'no_match', query: { barcode: null, label: 'zzqx vwrk plmnt' }, tried: ['ciqual', 'sportly'], candidates: [],
    })
  })
})

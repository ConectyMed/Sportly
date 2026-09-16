import { BoundaryError } from '../errors.js'
import type { SqlExecutor } from '../store/postgres.js'
import type { CiqualFoodRow, FoodSynonymRow, NutritionStore, OffProductRow, SportlyFoodRow } from './store.js'

/**
 * Postgres adapter for the nutrition port. Same shape as the boundary's
 * adapter: a one-method executor in, parameterised statements only, and a
 * driver error becomes PERSISTENCE_FAILURE with its message kept server-side.
 *
 * Reads from `off.products` and writes to it; reads `ciqual_foods` and
 * `sportly_foods`; reads and writes `sportly_food_synonyms`. There is no
 * statement here that moves a value from the `off` schema into a `public`
 * table — that is the ODbL containment, and it is a property of this file, so
 * keep it that way.
 *
 * Every operation is one statement, with no session state: the Neon HTTP
 * driver gives each statement its own transaction, so the similarity query
 * takes its thresholds as parameters rather than from a `SET`.
 */

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : typeof v === 'number' ? v : Number(v))

async function guard<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof BoundaryError) throw err
    throw new BoundaryError('PERSISTENCE_FAILURE', `${what} failed: ${err instanceof Error ? err.message : String(err)}`, undefined, false)
  }
}

interface OffRowShape {
  barcode: string
  status: string
  product_name: string | null
  product_name_fr: string | null
  brands: string | null
  quantity: string | null
  serving_size: string | null
  serving_quantity_g: string | number | null
  energy_kcal_100g: string | number | null
  energy_kj_100g: string | number | null
  protein_g_100g: string | number | null
  carbs_g_100g: string | number | null
  sugars_g_100g: string | number | null
  fat_g_100g: string | number | null
  saturated_fat_g_100g: string | number | null
  fibre_g_100g: string | number | null
  salt_g_100g: string | number | null
  nutriments: Record<string, unknown> | null
  last_modified_t: string | number | null
  product_url: string | null
  fetched_at: Date | string
  http_status: number
}

const OFF_COLUMNS =
  'barcode, status, product_name, product_name_fr, brands, quantity, serving_size, serving_quantity_g, energy_kcal_100g, energy_kj_100g, protein_g_100g, carbs_g_100g, sugars_g_100g, fat_g_100g, saturated_fat_g_100g, fibre_g_100g, salt_g_100g, nutriments, last_modified_t, product_url, fetched_at, http_status'

function toOffRow(r: OffRowShape): OffProductRow {
  return {
    barcode: r.barcode,
    status: r.status as OffProductRow['status'],
    productName: r.product_name,
    productNameFr: r.product_name_fr,
    brands: r.brands,
    quantity: r.quantity,
    servingSize: r.serving_size,
    servingQuantityG: num(r.serving_quantity_g),
    per100g: {
      kcal: num(r.energy_kcal_100g),
      kj: num(r.energy_kj_100g),
      proteinG: num(r.protein_g_100g),
      carbsG: num(r.carbs_g_100g),
      sugarsG: num(r.sugars_g_100g),
      fatG: num(r.fat_g_100g),
      saturatedFatG: num(r.saturated_fat_g_100g),
      fibreG: num(r.fibre_g_100g),
      saltG: num(r.salt_g_100g),
    },
    nutriments: r.nutriments,
    lastModifiedT: num(r.last_modified_t),
    productUrl: r.product_url,
    fetchedAt: typeof r.fetched_at === 'string' ? new Date(r.fetched_at).toISOString() : r.fetched_at.toISOString(),
    httpStatus: r.http_status,
  }
}

interface CiqualRowShape {
  alim_code: number
  name_fr: string
  name_en: string | null
  group_code: string | null
  subgroup_code: string | null
  subsubgroup_code: string | null
  energy_kcal: string | number | null
  energy_kj: string | number | null
  protein_g: string | number | null
  carbs_g: string | number | null
  sugars_g: string | number | null
  fat_g: string | number | null
  saturated_fat_g: string | number | null
  fibre_g: string | number | null
  salt_g: string | number | null
  water_g: string | number | null
  ciqual_version: string
}

const CIQUAL_COLUMNS =
  'alim_code, name_fr, name_en, group_code, subgroup_code, subsubgroup_code, energy_kcal, energy_kj, protein_g, carbs_g, sugars_g, fat_g, saturated_fat_g, fibre_g, salt_g, water_g, ciqual_version'

function toCiqualRow(r: CiqualRowShape): CiqualFoodRow {
  return {
    alimCode: r.alim_code,
    nameFr: r.name_fr,
    nameEn: r.name_en,
    groupCode: r.group_code,
    subgroupCode: r.subgroup_code,
    subsubgroupCode: r.subsubgroup_code,
    energyKcal: num(r.energy_kcal),
    energyKj: num(r.energy_kj),
    proteinG: num(r.protein_g),
    carbsG: num(r.carbs_g),
    sugarsG: num(r.sugars_g),
    fatG: num(r.fat_g),
    saturatedFatG: num(r.saturated_fat_g),
    fibreG: num(r.fibre_g),
    saltG: num(r.salt_g),
    waterG: num(r.water_g),
    ciqualVersion: r.ciqual_version,
  }
}

interface SportlyRowShape {
  food_id: string
  kind: string
  name_en: string
  name_fr: string | null
  origin: string
  subject_id: string | null
  ciqual_alim_code: number | null
  energy_kcal_100g: string | number | null
  protein_g_100g: string | number | null
  carbs_g_100g: string | number | null
  fat_g_100g: string | number | null
  fibre_g_100g: string | number | null
  typical_portion_g: string | number | null
  portion_unit: string | null
  portion_label: string | null
  notes: string | null
}

const SPORTLY_COLUMNS =
  'food_id, kind, name_en, name_fr, origin, subject_id, ciqual_alim_code, energy_kcal_100g, protein_g_100g, carbs_g_100g, fat_g_100g, fibre_g_100g, typical_portion_g, portion_unit, portion_label, notes'

function toSportlyRow(r: SportlyRowShape): SportlyFoodRow {
  return {
    foodId: r.food_id,
    kind: r.kind as SportlyFoodRow['kind'],
    nameEn: r.name_en,
    nameFr: r.name_fr,
    origin: r.origin as SportlyFoodRow['origin'],
    subjectId: r.subject_id,
    ciqualAlimCode: r.ciqual_alim_code,
    energyKcal100g: num(r.energy_kcal_100g),
    proteinG100g: num(r.protein_g_100g),
    carbsG100g: num(r.carbs_g_100g),
    fatG100g: num(r.fat_g_100g),
    fibreG100g: num(r.fibre_g_100g),
    typicalPortionG: num(r.typical_portion_g),
    portionUnit: r.portion_unit as SportlyFoodRow['portionUnit'],
    portionLabel: r.portion_label,
    notes: r.notes,
  }
}

interface SynonymRowShape {
  term: string
  ciqual_alim_code: number | null
  sportly_food_id: string | null
  origin: string
  subject_id: string | null
}

function toSynonymRow(r: SynonymRowShape): FoodSynonymRow {
  return {
    term: r.term,
    target: r.ciqual_alim_code !== null ? { source: 'ciqual', alimCode: r.ciqual_alim_code } : { source: 'sportly', foodId: r.sportly_food_id as string },
    origin: r.origin as FoodSynonymRow['origin'],
    subjectId: r.subject_id,
  }
}

interface CiqualSimilarRowShape extends CiqualRowShape {
  score: number | string
  containment: number | string
  name_score: number | string
}

export function createPostgresNutritionStore(sql: SqlExecutor): NutritionStore {
  return {
    engine: 'postgres',

    async getOffProduct(barcode) {
      const res = await guard('getOffProduct', () => sql<OffRowShape>(`select ${OFF_COLUMNS} from off.products where barcode = $1`, [barcode]))
      return res.rows.length ? toOffRow(res.rows[0]) : null
    },

    async putOffProduct(row) {
      const p = row.per100g
      await guard('putOffProduct', () =>
        sql(
          `insert into off.products (${OFF_COLUMNS})
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22)
           on conflict (barcode) do update set
             status = excluded.status, product_name = excluded.product_name, product_name_fr = excluded.product_name_fr,
             brands = excluded.brands, quantity = excluded.quantity, serving_size = excluded.serving_size,
             serving_quantity_g = excluded.serving_quantity_g, energy_kcal_100g = excluded.energy_kcal_100g,
             energy_kj_100g = excluded.energy_kj_100g, protein_g_100g = excluded.protein_g_100g, carbs_g_100g = excluded.carbs_g_100g,
             sugars_g_100g = excluded.sugars_g_100g, fat_g_100g = excluded.fat_g_100g, saturated_fat_g_100g = excluded.saturated_fat_g_100g,
             fibre_g_100g = excluded.fibre_g_100g, salt_g_100g = excluded.salt_g_100g, nutriments = excluded.nutriments,
             last_modified_t = excluded.last_modified_t, product_url = excluded.product_url, fetched_at = excluded.fetched_at,
             http_status = excluded.http_status`,
          [
            row.barcode, row.status, row.productName, row.productNameFr, row.brands, row.quantity, row.servingSize, row.servingQuantityG,
            p.kcal, p.kj, p.proteinG, p.carbsG, p.sugarsG, p.fatG, p.saturatedFatG, p.fibreG, p.saltG,
            row.nutriments === null ? null : JSON.stringify(row.nutriments), row.lastModifiedT, row.productUrl, row.fetchedAt, row.httpStatus,
          ],
        ),
      )
    },

    async findCiqualByLabel(label) {
      const res = await guard('findCiqualByLabel', () =>
        sql<CiqualRowShape>(
          `select ${CIQUAL_COLUMNS} from ciqual_foods
            where name_fr_norm = sportly_label_norm($1) or name_en_norm = sportly_label_norm($1)
            order by alim_code`,
          [label],
        ),
      )
      return res.rows.map(toCiqualRow)
    },

    async getCiqualFood(alimCode) {
      const res = await guard('getCiqualFood', () => sql<CiqualRowShape>(`select ${CIQUAL_COLUMNS} from ciqual_foods where alim_code = $1`, [alimCode]))
      return res.rows.length ? toCiqualRow(res.rows[0]) : null
    },

    async getSportlyFood(foodId, subjectId) {
      const res = await guard('getSportlyFood', () =>
        sql<SportlyRowShape>(`select ${SPORTLY_COLUMNS} from sportly_foods where food_id = $1 and (subject_id is null or subject_id = $2::uuid)`, [foodId, subjectId ?? null]),
      )
      return res.rows.length ? toSportlyRow(res.rows[0]) : null
    },

    async findFoodSynonyms(label, subjectId) {
      const res = await guard('findFoodSynonyms', () =>
        sql<SynonymRowShape>(
          `select term, ciqual_alim_code, sportly_food_id, origin, subject_id from sportly_food_synonyms
            where term_norm = sportly_label_norm($1) and (subject_id is null or subject_id = $2::uuid)
            order by (subject_id is not null) desc`,
          [label, subjectId ?? null],
        ),
      )
      return res.rows.map(toSynonymRow)
    },

    async putFoodSynonym(synonym, atIso) {
      const t = synonym.target
      await guard('putFoodSynonym', () =>
        sql(
          `insert into sportly_food_synonyms (term, ciqual_alim_code, sportly_food_id, origin, subject_id, created_at, updated_at)
           values ($1, $2, $3, $4, $5::uuid, $6, $6)
           on conflict (term_norm, scope) do update set
             term = excluded.term, ciqual_alim_code = excluded.ciqual_alim_code, sportly_food_id = excluded.sportly_food_id,
             origin = excluded.origin, updated_at = excluded.updated_at`,
          [synonym.term, t.source === 'ciqual' ? t.alimCode : null, t.source === 'sportly' ? t.foodId : null, synonym.origin, synonym.subjectId, atIso],
        ),
      )
    },

    async findCiqualSimilar(label, thresholds) {
      // `<%` is word_similarity at the database's threshold and is what the GIN
      // trigram index serves; the explicit predicate after it is the policy's
      // own gate. The two agree by construction (see matching.ts) and the
      // Postgres suite checks that they still do.
      const res = await guard('findCiqualSimilar', () =>
        sql<CiqualSimilarRowShape>(
          `select ${CIQUAL_COLUMNS},
                  similarity(sportly_label_norm($1), name_fr_norm) as score,
                  word_similarity(sportly_label_norm($1), name_fr_norm) as containment,
                  similarity(sportly_label_norm($1), sportly_label_head(name_fr_norm)) as name_score
             from ciqual_foods
            where sportly_label_norm($1) <% name_fr_norm
              and word_similarity(sportly_label_norm($1), name_fr_norm) >= $2::float8
            order by (similarity(sportly_label_norm($1), name_fr_norm) >= $3::float8) desc, name_score desc, score desc, alim_code
            limit $4::int`,
          [label, thresholds.low, thresholds.high, thresholds.limit],
        ),
      )
      return res.rows.map((r) => ({ ...toCiqualRow(r), score: Number(r.score), containment: Number(r.containment), nameScore: Number(r.name_score) }))
    },

    async findSportlyByLabel(label, subjectId) {
      const res = await guard('findSportlyByLabel', () =>
        sql<SportlyRowShape>(
          `select ${SPORTLY_COLUMNS} from sportly_foods f
            where (f.subject_id is null or f.subject_id = $2::uuid)
              and (f.name_en_norm = sportly_label_norm($1)
                or f.name_fr_norm = sportly_label_norm($1)
                or exists (select 1 from sportly_food_aliases a where a.food_id = f.food_id and a.alias_norm = sportly_label_norm($1)))
            order by (f.subject_id is not null) desc, f.food_id`,
          [label, subjectId ?? null],
        ),
      )
      return res.rows.map(toSportlyRow)
    },

    async putSportlyFood(food, atIso) {
      await guard('putSportlyFood', () =>
        sql(
          `insert into sportly_foods (${SPORTLY_COLUMNS}, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
           on conflict (food_id) do update set
             kind = excluded.kind, name_en = excluded.name_en, name_fr = excluded.name_fr, origin = excluded.origin,
             subject_id = excluded.subject_id, ciqual_alim_code = excluded.ciqual_alim_code,
             energy_kcal_100g = excluded.energy_kcal_100g, protein_g_100g = excluded.protein_g_100g, carbs_g_100g = excluded.carbs_g_100g,
             fat_g_100g = excluded.fat_g_100g, fibre_g_100g = excluded.fibre_g_100g, typical_portion_g = excluded.typical_portion_g,
             portion_unit = excluded.portion_unit, portion_label = excluded.portion_label, notes = excluded.notes, updated_at = excluded.updated_at`,
          [
            food.foodId, food.kind, food.nameEn, food.nameFr, food.origin, food.subjectId, food.ciqualAlimCode,
            food.energyKcal100g, food.proteinG100g, food.carbsG100g, food.fatG100g, food.fibreG100g,
            food.typicalPortionG, food.portionUnit, food.portionLabel, food.notes, atIso,
          ],
        ),
      )
      await guard('putSportlyFood.aliases', () => sql('delete from sportly_food_aliases where food_id = $1', [food.foodId]))
      for (const alias of food.aliases) {
        await guard('putSportlyFood.aliases', () =>
          sql('insert into sportly_food_aliases (food_id, alias) values ($1, $2) on conflict (food_id, alias_norm) do nothing', [food.foodId, alias]),
        )
      }
    },
  }
}

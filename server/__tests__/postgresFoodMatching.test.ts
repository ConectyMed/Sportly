import { readFileSync } from 'node:fs'
import { beforeEach, expect, it } from 'vitest'
import { DEFAULT_SIMILARITY, SIMILARITY_HIGH, SIMILARITY_LOW } from '../nutrition/matching.js'
import { createPostgresNutritionStore } from '../nutrition/postgres.js'
import { resolveFood } from '../nutrition/resolve.js'
import type { Resolution } from '../nutrition/types.js'
import { describePostgres } from './pg.js'
import { SUBJECT_A, SUBJECT_B } from './helpers.js'
import { sportlyEgg } from './nutritionHelpers.js'

/**
 * Label matching against the real Ciqual table, with migrations/0004 applied.
 *
 * The test set (data/food-matching/terms.fr.json) is the point: 50 terms in
 * the vocabulary a vision model emits, none of them a Ciqual label. Every term
 * is resolved twice — with the synonym table empty, then with the seed loaded
 * — and each outcome is judged against the codes the term accepts. The
 * assertions are the policy's promises, not a fixed table:
 *
 *   - no term ever resolves to a food outside its accept list, seed or not;
 *   - the terms similarity alone cannot serve are exactly the seed's terms;
 *   - with the seed, every term Ciqual covers has its food resolved or listed;
 *   - the measured gap the thresholds sit in is still there.
 *
 * scripts/food-matching-report.mjs prints the full per-term table.
 */
interface Term {
  term: string
  accept: number[]
  note?: string
}
interface Seed {
  term: string
  ciqualAlimCode: number
  why: string
}
const TERMS: Term[] = JSON.parse(readFileSync(new URL('../../data/food-matching/terms.fr.json', import.meta.url), 'utf8')).terms
const SEED: Seed[] = JSON.parse(readFileSync(new URL('../../data/food-matching/synonyms.fr.json', import.meta.url), 'utf8')).synonyms

interface Outcome {
  term: string
  accept: number[]
  resolution: Resolution
  /** 1-based rank of the first accepted food among candidates or the resolved food; 0 when absent. */
  rightRank: number
  /** Score of the top candidate or of the resolved food. */
  topScore: number | null
  topName: string | null
  topRight: boolean
}

const judge = (t: Term, resolution: Resolution): Outcome => {
  if (resolution.status === 'resolved') {
    const code = Number(resolution.food.sourceId)
    const right = resolution.food.source === 'ciqual' && t.accept.includes(code)
    return { term: t.term, accept: t.accept, resolution, rightRank: right ? 1 : 0, topScore: resolution.score, topName: resolution.food.nameFr, topRight: right }
  }
  const idx = resolution.candidates.findIndex((c) => c.source === 'ciqual' && t.accept.includes(Number(c.sourceId)))
  const top = resolution.candidates[0]
  return { term: t.term, accept: t.accept, resolution, rightRank: idx + 1, topScore: top?.score ?? null, topName: top?.name ?? null, topRight: top ? t.accept.includes(Number(top.sourceId)) : false }
}

describePostgres('postgres food matching', ({ pool, sql }) => {
  const store = createPostgresNutritionStore(sql)
  const T0 = '2026-01-01T00:00:00.000Z'
  const runAll = async () => {
    const out: Outcome[] = []
    for (const t of TERMS) out.push(judge(t, await resolveFood({ label: t.term }, { store })))
    return out
  }
  const loadSeed = async () => {
    for (const s of SEED) await store.putFoodSynonym({ term: s.term, target: { source: 'ciqual', alimCode: s.ciqualAlimCode }, origin: 'sportly', subjectId: null }, T0)
  }

  beforeEach(async () => {
    await pool.query('truncate off.products, sportly_foods, sportly_food_aliases, sportly_food_synonyms')
  })

  it('has pg_trgm, the trigram index on the French label, and a word_similarity default equal to the low band', async () => {
    expect((await pool.query(`select extname from pg_extension where extname = 'pg_trgm'`)).rows).toEqual([{ extname: 'pg_trgm' }])
    const index = (await pool.query<{ indexdef: string }>(`select indexdef from pg_indexes where tablename = 'ciqual_foods' and indexname = 'ciqual_foods_name_fr_trgm'`)).rows
    expect(index).toHaveLength(1)
    expect(index[0].indexdef).toMatch(/USING gin \(name_fr_norm gin_trgm_ops\)/)
    // The `<%` operator in the query gates at this setting; the policy's own gate is SIMILARITY_LOW. They must agree.
    // pg_trgm registers its settings when its library loads into the session, so touch it first on the same connection.
    const client = await pool.connect()
    try {
      await client.query(`select word_similarity('a', 'a')`)
      expect(Number((await client.query<{ v: string }>(`select current_setting('pg_trgm.word_similarity_threshold') as v`)).rows[0].v)).toBe(SIMILARITY_LOW)
    } finally {
      client.release()
    }
  })

  it('writes the candidate query so the trigram index can serve it', async () => {
    // At 3,484 rows the planner may prefer a sequential scan; what matters is
    // that the predicate is index-able, which forcing the choice shows.
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query('set local enable_seqscan = off')
      const plan = await client.query<{ 'QUERY PLAN': string }>(
        `explain select alim_code from ciqual_foods where sportly_label_norm($1) <% name_fr_norm and word_similarity(sportly_label_norm($1), name_fr_norm) >= $2::float8`,
        ['poulet grillé', SIMILARITY_LOW],
      )
      expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/Bitmap Index Scan on ciqual_foods_name_fr_trgm/)
      await client.query('rollback')
    } finally {
      client.release()
    }
  })

  it('the test set, without synonyms: similarity never resolves a wrong food, the one exact-label homograph is named, and the misses are exactly the seed', async () => {
    const outcomes = await runAll()

    // The promise that matters: similarity never resolves to a food outside the accept list.
    const wrong = outcomes.filter((o) => o.resolution.status === 'resolved' && !o.topRight)
    expect(wrong.filter((o) => o.resolution.status === 'resolved' && o.resolution.matchedBy === 'similarity')).toEqual([])
    // The one confident wrong answer in the set, by name: not similarity but V8b's exact match on
    // either language — Ciqual's English label for "Raisin sec" is "Raisin", the French word for
    // grape. A homograph across languages; the seed's synonym for "raisin" outranks it.
    expect(wrong.map((o) => `${o.term} → ${o.topName}`)).toEqual(['raisin → Raisin sec'])
    expect(wrong[0].resolution).toMatchObject({ matchedBy: 'label', food: { name: 'Raisin' } })
    // A term Ciqual does not have is not resolved.
    for (const o of outcomes.filter((o) => o.accept.length === 0)) expect(o.resolution.status, o.term).toBe('unresolved')

    // The gap the high band sits in, measured: every wrong top by similarity stays under 0.75, and the
    // confident right ones are the exact labels plus one with a three-letter qualifier.
    const wrongTops = outcomes.filter((o) => !o.topRight && o.topScore !== null).map((o) => o.topScore as number)
    expect(Math.max(...wrongTops)).toBeLessThan(SIMILARITY_HIGH)
    expect(Math.max(...wrongTops)).toBeCloseTo(0.7, 2) // "haricots verts" → "Haricots verts, purée"
    const confident = outcomes.filter((o) => o.resolution.status === 'resolved' && o.topRight)
    expect(confident.map((o) => o.term).sort()).toEqual(['comté', "flocons d'avoine", 'lait demi-écrémé', 'miel', 'oeuf dur', 'saumon fumé'])
    expect(confident.find((o) => o.term === 'lait demi-écrémé')?.resolution).toMatchObject({ matchedBy: 'similarity' })
    expect(confident.find((o) => o.term === 'lait demi-écrémé')?.topScore).toBeCloseTo(0.81, 2)
    // "oeuf dur" is the exact-match control: it resolves by label, not by score.
    expect(confident.find((o) => o.term === 'oeuf dur')?.resolution).toMatchObject({ matchedBy: 'label', score: null })

    // The failures this layer knows about, by name. Ambiguous with the right food listed is a success.
    const listed = outcomes.filter((o) => o.resolution.status === 'unresolved' && o.resolution.reason === 'ambiguous' && o.rightRank > 0)
    expect(listed.length).toBeGreaterThanOrEqual(35)
    expect(listed.filter((o) => o.rightRank === 1).length).toBeGreaterThanOrEqual(21)
    // The nearest misses, so a regression in ranking is visible: the right food is second behind a one-word-different label.
    for (const [term, wrongTop] of [['riz blanc cuit', 'Riz blanc, cru'], ['haricots verts', 'Haricots verts, purée'], ['pomme', 'Pomme, sèche'], ['quinoa cuit', 'Quinoa, cru']]) {
      const o = outcomes.find((o) => o.term === term)!
      expect(o.resolution, term).toMatchObject({ status: 'unresolved', reason: 'ambiguous' })
      expect(o.topName, term).toBe(wrongTop)
      expect(o.rightRank, term).toBe(2)
    }

    // What the resolver alone cannot serve — no_match, ambiguous without the right food, or the
    // homograph above — is exactly what the seed holds, and nothing more.
    const misses = outcomes.filter((o) => o.accept.length > 0 && o.rightRank === 0).map((o) => o.term).sort()
    expect(misses).toEqual(SEED.map((s) => s.term).sort())
    for (const s of SEED) expect(TERMS.find((t) => t.term === s.term)?.accept, s.term).toContain(s.ciqualAlimCode)
  })

  it('the test set, with the seed: every term Ciqual covers is resolved or listed, still never wrongly', async () => {
    await loadSeed()
    const outcomes = await runAll()
    expect(outcomes.filter((o) => o.resolution.status === 'resolved' && !o.topRight).map((o) => o.term)).toEqual([])
    expect(outcomes.filter((o) => o.accept.length > 0 && o.rightRank === 0).map((o) => o.term)).toEqual([])
    expect(outcomes.find((o) => o.term === 'granola')?.resolution).toMatchObject({ status: 'unresolved', reason: 'no_match' })
    // Each seed row resolves by synonym to its target, before any score is computed.
    for (const s of SEED) {
      const o = outcomes.find((o) => o.term === s.term)!
      expect(o.resolution, s.term).toMatchObject({ status: 'resolved', matchedBy: 'synonym', score: null, food: { source: 'ciqual', sourceId: String(s.ciqualAlimCode) } })
    }
    // And a term the seed does not touch still goes through similarity.
    const banane = outcomes.find((o) => o.term === 'banane')?.resolution
    expect(banane).toMatchObject({ status: 'unresolved', reason: 'ambiguous' })
    expect(banane?.status === 'unresolved' && banane.candidates[0]).toMatchObject({ sourceId: '13005', name: 'Banane, chair sans peau, crue' })
  })

  it('returns real scores on real rows: gated on containment, confident first, then name match, then score', async () => {
    const rows = await store.findCiqualSimilar('banane', DEFAULT_SIMILARITY)
    expect(rows.length).toBeLessThanOrEqual(DEFAULT_SIMILARITY.limit)
    for (const r of rows) {
      expect(r.containment).toBeGreaterThanOrEqual(SIMILARITY_LOW)
      expect(r.score).toBeGreaterThan(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
    expect(rows[0]).toMatchObject({ alimCode: 13005, nameFr: 'Banane, chair sans peau, crue', nameScore: 1 })
    expect(rows.map((r) => r.nameFr)).toContain('Nectar de banane') // shorter label, lower name match: listed, not first
    // A whole-label exact hit scores 1 and an unrelated string nothing.
    expect((await store.findCiqualSimilar('Oeuf dur', DEFAULT_SIMILARITY))[0]).toMatchObject({ alimCode: 22010, score: 1, containment: 1 })
    expect(await store.findCiqualSimilar('zzqx vwrk plmnt', DEFAULT_SIMILARITY)).toEqual([])
  })

  it("a subject's correction lands in the synonym table, is reused, and outranks similarity for that subject only", async () => {
    const before = await resolveFood({ label: 'Pomme', subjectId: SUBJECT_A }, { store })
    expect(before).toMatchObject({ status: 'unresolved', reason: 'ambiguous' })
    expect(before.status === 'unresolved' && before.candidates[0]).toMatchObject({ sourceId: '13111', name: 'Pomme, sèche' })

    await store.putFoodSynonym({ term: 'pomme', target: { source: 'ciqual', alimCode: 13039 }, origin: 'user_correction', subjectId: SUBJECT_A }, T0)
    expect(await resolveFood({ label: '  POMME ', subjectId: SUBJECT_A }, { store })).toMatchObject({ status: 'resolved', matchedBy: 'synonym', score: null, tried: ['ciqual'], food: { sourceId: '13039', nameFr: 'Pomme, chair et peau, crue', attribution: { provider: 'ANSES' } } })
    expect(await resolveFood({ label: 'pomme', subjectId: SUBJECT_B }, { store })).toMatchObject({ status: 'unresolved', reason: 'ambiguous' })
    expect(await resolveFood({ label: 'pomme' }, { store })).toMatchObject({ status: 'unresolved', reason: 'ambiguous' })

    // Correcting again replaces the row for the same (term, subject) key; a shared row for the same term lives beside it.
    await store.putFoodSynonym({ term: 'Pomme', target: { source: 'ciqual', alimCode: 13396 }, origin: 'user_correction', subjectId: SUBJECT_A }, T0)
    await store.putFoodSynonym({ term: 'pomme', target: { source: 'ciqual', alimCode: 13039 }, origin: 'sportly', subjectId: null }, T0)
    expect((await pool.query(`select term_norm, scope, ciqual_alim_code from sportly_food_synonyms order by scope`)).rows).toEqual([
      { term_norm: 'pomme', scope: SUBJECT_A, ciqual_alim_code: 13396 },
      { term_norm: 'pomme', scope: 'shared', ciqual_alim_code: 13039 },
    ])
    expect((await store.findFoodSynonyms('pomme', SUBJECT_A)).map((s) => s.target)).toEqual([{ source: 'ciqual', alimCode: 13396 }, { source: 'ciqual', alimCode: 13039 }])
    expect((await store.findFoodSynonyms('pomme')).map((s) => s.target)).toEqual([{ source: 'ciqual', alimCode: 13039 }])
  })

  it('a synonym can point at a Sportly food, wins over the exact Ciqual label, and goes with the food it points at', async () => {
    await store.putSportlyFood({ ...sportlyEgg, foodId: 'egg_a', origin: 'user_correction', subjectId: SUBJECT_A, typicalPortionG: 60 }, T0)
    await store.putFoodSynonym({ term: 'oeuf dur', target: { source: 'sportly', foodId: 'egg_a' }, origin: 'user_correction', subjectId: SUBJECT_A }, T0)
    expect(await resolveFood({ label: 'oeuf dur', subjectId: SUBJECT_A }, { store })).toMatchObject({ status: 'resolved', matchedBy: 'synonym', tried: ['sportly'], food: { source: 'sportly', sourceId: 'egg_a', typicalPortion: { grams: 60 } } })
    expect(await resolveFood({ label: 'oeuf dur', subjectId: SUBJECT_B }, { store })).toMatchObject({ status: 'resolved', matchedBy: 'label', food: { source: 'ciqual', sourceId: '22010' } })

    await pool.query(`delete from sportly_foods where food_id = 'egg_a'`)
    expect(await store.findFoodSynonyms('oeuf dur', SUBJECT_A)).toEqual([])
  })

  it('refuses a synonym with no target, two targets, or a correction without a subject', async () => {
    const insert = (cols: string, vals: string) => pool.query(`insert into sportly_food_synonyms (term, origin, subject_id, created_at, updated_at, ${cols}) values ('x', 'sportly', null, now(), now(), ${vals})`)
    await expect(insert('ciqual_alim_code', 'null')).rejects.toThrow(/sportly_food_synonyms_one_target/)
    await store.putSportlyFood(sportlyEgg, T0)
    await expect(insert('ciqual_alim_code, sportly_food_id', `13039, 'egg'`)).rejects.toThrow(/sportly_food_synonyms_one_target/)
    await expect(store.putFoodSynonym({ term: 'x', target: { source: 'ciqual', alimCode: 13039 }, origin: 'user_correction', subjectId: null }, T0)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILURE' })
    await expect(store.putFoodSynonym({ term: 'x', target: { source: 'ciqual', alimCode: 1 }, origin: 'sportly', subjectId: null }, T0)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILURE' })
  })
})

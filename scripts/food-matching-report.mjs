#!/usr/bin/env node
// The label-matching results table, through the real code path.
//
//   SPORTLY_TEST_DATABASE_URL=… node scripts/food-matching-report.mjs [--terms data/food-matching/terms.fr.json]
//
// Emits server/ the way scripts/off-lookup.mjs does, then resolves every term
// of the test set twice against the configured database: once with the
// synonym table hidden (similarity alone) and once as it is. Prints a
// Markdown table and the numbers the thresholds in
// server/nutrition/matching.ts rest on. Reads only; nothing is written.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'

const args = process.argv.slice(2)
const termsFile = resolve(args[args.indexOf('--terms') + 1] && args.includes('--terms') ? args[args.indexOf('--terms') + 1] : 'data/food-matching/terms.fr.json')
const databaseUrl = process.env.SPORTLY_DATABASE_URL ?? process.env.SPORTLY_TEST_DATABASE_URL
if (!databaseUrl) {
  process.stderr.write('food-matching-report: set SPORTLY_DATABASE_URL or SPORTLY_TEST_DATABASE_URL\n')
  process.exit(2)
}

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'node_modules', '.tmp', 'food-matching-report')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
execFileSync(join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.server.json', '--noEmit', 'false', '--outDir', out, '--sourceMap', 'false', '--declaration', 'false'], { cwd: root, stdio: 'inherit' })
cpSync(join(root, 'package.json'), join(out, 'package.json'))
if (!existsSync(join(out, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'), 'dir')

const { resolveFood } = await import(pathToFileURL(join(out, 'server', 'nutrition', 'resolve.js')).href)
const { createPostgresNutritionStore } = await import(pathToFileURL(join(out, 'server', 'nutrition', 'postgres.js')).href)
const { SIMILARITY_HIGH, SIMILARITY_LOW, SIMILARITY_CANDIDATES } = await import(pathToFileURL(join(out, 'server', 'nutrition', 'matching.js')).href)

const terms = JSON.parse(readFileSync(termsFile, 'utf8')).terms
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
const sql = async (text, params) => ({ rows: (await pool.query(text, params)).rows })
const store = createPostgresNutritionStore(sql)
const noSynonyms = { ...store, findFoodSynonyms: async () => [] }

const judge = (t, r) => {
  if (r.status === 'resolved') {
    const code = Number(r.food.sourceId)
    const right = r.food.source === 'ciqual' && t.accept.includes(code)
    return { band: `resolved (${r.matchedBy})`, top: `${code} ${r.food.nameFr}`, score: r.score, rightRank: right ? 1 : 0, right }
  }
  if (r.reason !== 'ambiguous') return { band: r.reason, top: '', score: null, rightRank: 0, right: false }
  const idx = r.candidates.findIndex((c) => t.accept.includes(Number(c.sourceId)))
  const top = r.candidates[0]
  return { band: 'ambiguous', top: `${top.sourceId} ${top.name}`, score: top.score, rightRank: idx + 1, right: t.accept.includes(Number(top.sourceId)) }
}
const fmt = (s) => (s === null || s === undefined ? '' : s.toFixed(2))
const rank = (o, t) => (t.accept.length === 0 ? (o.band === 'no_match' ? '✓ none' : '✗ listed') : o.rightRank === 0 ? '✗ absent' : o.rightRank === 1 ? '✓ 1' : `✓ ${o.rightRank}`)

try {
  const seeded = (await pool.query(`select count(*)::int as n from sportly_food_synonyms where origin = 'sportly'`)).rows[0].n
  const rows = []
  for (const t of terms) {
    const a = judge(t, await resolveFood({ label: t.term }, { store: noSynonyms }))
    const b = judge(t, await resolveFood({ label: t.term }, { store }))
    rows.push({ t, a, b })
  }
  console.log(`Label matching over ${terms.length} terms · high ${SIMILARITY_HIGH} · low ${SIMILARITY_LOW} · ${SIMILARITY_CANDIDATES} candidates · ${seeded} shared synonym rows in the database\n`)
  console.log('| term | similarity alone: band | top candidate | score | right food | with synonyms: band | top | right food |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const { t, a, b } of rows) console.log(`| ${t.term} | ${a.band} | ${a.top} | ${fmt(a.score)} | ${rank(a, t)} | ${b.band} | ${b.top} | ${rank(b, t)} |`)

  const count = (pred) => rows.filter(pred).length
  const wrongTops = rows.filter(({ a }) => !a.right && a.score !== null).map(({ a }) => a.score)
  const rightResolved = rows.filter(({ a }) => a.band.startsWith('resolved') && a.right && a.score !== null).map(({ a }) => a.score)
  console.log(`
Similarity alone: resolved right ${count(({ a }) => a.band.startsWith('resolved') && a.right)}, resolved WRONG ${count(({ a }) => a.band.startsWith('resolved') && !a.right)}, ambiguous with the right food listed ${count(({ a }) => a.band === 'ambiguous' && a.rightRank > 0)} (first in ${count(({ a }) => a.band === 'ambiguous' && a.rightRank === 1)}), ambiguous without it ${count(({ t, a }) => a.band === 'ambiguous' && t.accept.length > 0 && a.rightRank === 0)}, no_match ${count(({ a }) => a.band === 'no_match')} (of which correct ${count(({ t, a }) => a.band === 'no_match' && t.accept.length === 0)}).
With synonyms:    resolved right ${count(({ b }) => b.band.startsWith('resolved') && b.right)}, resolved WRONG ${count(({ b }) => b.band.startsWith('resolved') && !b.right)}, ambiguous with the right food listed ${count(({ b }) => b.band === 'ambiguous' && b.rightRank > 0)} (first in ${count(({ b }) => b.band === 'ambiguous' && b.rightRank === 1)}), ambiguous without it ${count(({ t, b }) => b.band === 'ambiguous' && t.accept.length > 0 && b.rightRank === 0)}, no_match ${count(({ b }) => b.band === 'no_match')}.
Threshold evidence: highest score of a wrong food at the top of a ranking ${Math.max(...wrongTops).toFixed(3)} (${rows.find(({ a }) => a.score === Math.max(...wrongTops)).t.term}); lowest score of a right food resolved by similarity ${Math.min(...rightResolved.filter((s) => s < 1)).toFixed(3)}; high band ${SIMILARITY_HIGH}.`)
} finally {
  await pool.end()
}

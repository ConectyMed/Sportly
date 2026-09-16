#!/usr/bin/env node
// Load the shared food-synonym seed into sportly_food_synonyms.
//
//   node scripts/seed-food-synonyms.mjs apply [--in data/food-matching/synonyms.fr.json] [--database-url …]
//
// Runs after scripts/ingest-ciqual.mjs apply: every seed row points at a
// Ciqual food and the foreign key wants the row to exist. Idempotent — the
// primary key is (term_norm, scope) and a re-run updates the target in place.
// Only shared rows (origin = sportly) are ever written here; a subject's own
// corrections go through the store, never through a file.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const args = process.argv.slice(2)
const command = args[0]
const flags = {}
for (let i = 1; i < args.length; i += 1) {
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[i + 1]?.startsWith('--') ? true : (args[++i] ?? true)
}
const usage = (message) => {
  process.stderr.write(`seed-food-synonyms: ${message}\nusage: node scripts/seed-food-synonyms.mjs apply [--in <file>] [--database-url <url>]\n`)
  process.exit(2)
}
if (command !== 'apply') usage('the only command is apply')
const url = flags['database-url'] ?? process.env.SPORTLY_DATABASE_URL ?? process.env.SPORTLY_TEST_DATABASE_URL
if (!url) usage('apply needs --database-url, SPORTLY_DATABASE_URL or SPORTLY_TEST_DATABASE_URL')
const file = resolve(flags.in ?? 'data/food-matching/synonyms.fr.json')

const seed = JSON.parse(readFileSync(file, 'utf8'))
if (!Array.isArray(seed.synonyms)) usage(`${file} has no "synonyms" array`)
for (const s of seed.synonyms) {
  if (typeof s.term !== 'string' || !s.term.trim() || !Number.isInteger(s.ciqualAlimCode)) usage(`bad seed row: ${JSON.stringify(s)}`)
}

const pool = new pg.Pool({ connectionString: url, max: 2 })
const now = new Date().toISOString()
try {
  const missing = await pool.query('select code from unnest($1::int[]) as code where not exists (select 1 from ciqual_foods where alim_code = code)', [seed.synonyms.map((s) => s.ciqualAlimCode)])
  if (missing.rows.length) {
    process.stderr.write(`seed-food-synonyms: Ciqual rows missing for alim_code ${missing.rows.map((r) => r.code).join(', ')} — run scripts/ingest-ciqual.mjs apply first\n`)
    process.exit(1)
  }
  let written = 0
  for (const s of seed.synonyms) {
    await pool.query(
      `insert into sportly_food_synonyms (term, ciqual_alim_code, sportly_food_id, origin, subject_id, created_at, updated_at)
       values ($1, $2, null, 'sportly', null, $3, $3)
       on conflict (term_norm, scope) do update set term = excluded.term, ciqual_alim_code = excluded.ciqual_alim_code, sportly_food_id = null, origin = excluded.origin, updated_at = excluded.updated_at`,
      [s.term, s.ciqualAlimCode, now],
    )
    written += 1
  }
  const count = await pool.query(`select count(*)::int as n from sportly_food_synonyms where origin = 'sportly'`)
  console.log(`sportly_food_synonyms: ${written} seed rows applied from ${file}; ${count.rows[0].n} shared rows in the table`)
} finally {
  await pool.end()
}

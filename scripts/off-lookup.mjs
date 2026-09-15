#!/usr/bin/env node
// Live Open Food Facts lookup, through the real code path.
//
//   SPORTLY_DATABASE_URL=… node scripts/off-lookup.mjs <barcode> [<barcode>…] [--raw]
//
// Emits server/ the way scripts/check-api-esm-load.mjs does, then runs
// `lookupBarcode` from server/nutrition/off.ts against the live API and the
// configured database, twice per barcode, so the output shows the first call
// hitting the network and the second being served from `off.products`.
// `--raw` also prints the API's JSON as returned, for keeping as a fixture.
//
// This is a smoke check for a person or a workflow to run; it is not a test,
// and nothing in the test suite touches the network.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'

const args = process.argv.slice(2)
const raw = args.includes('--raw')
const barcodes = args.filter((a) => !a.startsWith('--'))
if (!barcodes.length) {
  process.stderr.write('usage: node scripts/off-lookup.mjs <barcode> [<barcode>…] [--raw]\n')
  process.exit(2)
}
const databaseUrl = process.env.SPORTLY_DATABASE_URL ?? process.env.SPORTLY_TEST_DATABASE_URL
if (!databaseUrl) {
  process.stderr.write('off-lookup: set SPORTLY_DATABASE_URL or SPORTLY_TEST_DATABASE_URL\n')
  process.exit(2)
}

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'node_modules', '.tmp', 'off-lookup')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
execFileSync(join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.server.json', '--noEmit', 'false', '--outDir', out, '--sourceMap', 'false', '--declaration', 'false'], { cwd: root, stdio: 'inherit' })
cpSync(join(root, 'package.json'), join(out, 'package.json'))
if (!existsSync(join(out, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'), 'dir')

const { lookupBarcode, offProductUrl, OFF_API_FIELDS, OFF_USER_AGENT } = await import(pathToFileURL(join(out, 'server', 'nutrition', 'off.js')).href)
const { createPostgresNutritionStore } = await import(pathToFileURL(join(out, 'server', 'nutrition', 'postgres.js')).href)

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
const sql = async (text, params) => ({ rows: (await pool.query(text, params)).rows })
const store = createPostgresNutritionStore(sql)

let failed = 0
try {
  for (const barcode of barcodes) {
    console.log(`\n== ${barcode}`)
    if (raw) {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}?fields=${OFF_API_FIELDS}`, { headers: { 'user-agent': OFF_USER_AGENT, accept: 'application/json' } })
      console.log(`raw: HTTP ${res.status}`)
      console.log(await res.text())
    }
    for (const attempt of ['first (network)', 'second (cache)']) {
      const result = await lookupBarcode(barcode, { store, fetch, now: () => new Date() })
      console.log(`${attempt}: ${JSON.stringify(result)}`)
      if (result.status === 'unavailable') failed += 1
    }
    const row = await pool.query('select barcode, status, product_name, brands, energy_kcal_100g, protein_g_100g, carbs_g_100g, fat_g_100g, fibre_g_100g, serving_quantity_g, fetched_at, http_status from off.products where barcode = $1', [barcode])
    console.log(`off.products: ${JSON.stringify(row.rows[0] ?? null)}`)
    console.log(`product page: ${offProductUrl(barcode)}`)
  }
} finally {
  await pool.end()
}
if (failed) {
  process.stderr.write(`off-lookup: ${failed} lookup(s) could not reach Open Food Facts\n`)
  process.exit(1)
}

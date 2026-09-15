#!/usr/bin/env node
// Ciqual ingestion: the official ANSES table, into `ciqual_foods`.
//
//   node scripts/ingest-ciqual.mjs fetch [--out data/ciqual]
//   node scripts/ingest-ciqual.mjs apply [--in data/ciqual] [--database-url URL]
//   node scripts/ingest-ciqual.mjs parse <dir-with-xml-or-zip> [--out data/ciqual]
//
// Two steps, on purpose.
//
// `fetch` talks to the official source — the "Table de composition
// nutritionnelle des aliments Ciqual 2025" dataset ANSES publishes on Recherche
// Data Gouv (DOI 10.57745/RDMHWY), under Licence Ouverte 2.0 — downloads the XML
// distribution, and writes a compact snapshot: one CSV row per food with the
// constituents the macro calculator needs, values kept exactly as Ciqual
// prints them ("12,5", "< 0,5", "traces", "-"), plus a metadata file with the
// DOI, file names, checksums, licence and attribution line. The snapshot is
// committed, so `apply` — and CI, and a production load — never depend on the
// source being reachable, and every environment loads the same bytes.
//
// `apply` reads the snapshot and upserts it into `ciqual_foods`, records the
// version in `ciqual_ingest`, and prints the row count.
//
// `parse` is `fetch` without the network: point it at a directory holding the
// XML files (or the zip) already downloaded.
//
// No dependency beyond node-postgres (already in package.json): the XML files
// are flat records, read with a small scanner; the zip is read with node:zlib.
//
// Exit status: 0 on success, 1 on any failure, 2 on bad usage.

import { inflateRawSync } from 'node:zlib'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import pg from 'pg'

// ---- the source ---------------------------------------------------------------

export const CIQUAL_VERSION = 'Ciqual 2025'
export const CIQUAL_DOI = 'doi:10.57745/RDMHWY'
export const CIQUAL_DATAVERSE = 'https://entrepot.recherche.data.gouv.fr'
export const CIQUAL_DATASET_URL = `${CIQUAL_DATAVERSE}/dataset.xhtml?persistentId=${CIQUAL_DOI}`
export const CIQUAL_LICENCE = 'Licence Ouverte / Open Licence 2.0 (Etalab)'
export const CIQUAL_LICENCE_URL = 'https://www.etalab.gouv.fr/licence-ouverte-open-licence'
export const CIQUAL_ATTRIBUTION = 'Source : Anses. Table de composition nutritionnelle des aliments Ciqual 2025 (ciqual.anses.fr).'

// The constituents lifted into columns, found by *name* in the constituent
// table and checked against the code Ciqual has used for them since 2020. A
// rename or renumbering fails the run rather than filling a column with the
// wrong nutrient. `required` ones are what the macro calculator reads.
const CONSTITUENTS = [
  { column: 'energy_kcal', expectCode: 328, required: true, match: /^energie, reglement ue n. ?1169\/2011 \(kcal\/100 ?g\)/ },
  { column: 'energy_kj', expectCode: 327, required: false, match: /^energie, reglement ue n. ?1169\/2011 \(kj\/100 ?g\)/ },
  // Protein as N × 6.25 is the definition Regulation 1169/2011 (and every
  // product label, hence Open Food Facts) uses; Ciqual also publishes the
  // Jones-factor figure, which is not comparable across sources.
  { column: 'protein_g', expectCode: 25003, required: true, match: /^proteines, n x 6\.25 \(g\/100 ?g\)/ },
  { column: 'carbs_g', expectCode: 31000, required: true, match: /^glucides \(g\/100 ?g\)/ },
  { column: 'sugars_g', expectCode: 32000, required: false, match: /^sucres \(g\/100 ?g\)/ },
  { column: 'fat_g', expectCode: 40000, required: true, match: /^lipides \(g\/100 ?g\)/ },
  { column: 'saturated_fat_g', expectCode: 40302, required: false, match: /^ag satures \(g\/100 ?g\)/ },
  { column: 'fibre_g', expectCode: 34100, required: true, match: /^fibres alimentaires \(g\/100 ?g\)/ },
  { column: 'salt_g', expectCode: 10004, required: false, match: /^sel chlorure de sodium \(g\/100 ?g\)/ },
  { column: 'water_g', expectCode: 400, required: false, match: /^eau \(g\/100 ?g\)/ },
]

const SNAPSHOT_COLUMNS = [
  'alim_code', 'name_fr', 'name_en', 'group_code', 'subgroup_code', 'subsubgroup_code',
  ...CONSTITUENTS.map((c) => c.column),
]

const SNAPSHOT_CSV = 'ciqual-2025.csv'
const SNAPSHOT_META = 'ciqual-2025.meta.json'

// ---- cli ---------------------------------------------------------------------------

const usage = (msg) => {
  process.stderr.write(`ingest-ciqual: ${msg}\nusage: node scripts/ingest-ciqual.mjs fetch|apply|parse [args] [--out DIR] [--in DIR] [--database-url URL]\n`)
  process.exit(2)
}
const fail = (msg) => {
  process.stderr.write(`ingest-ciqual: ${msg}\n`)
  process.exit(1)
}
const log = (msg) => process.stdout.write(`${msg}\n`)

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) usage(`--${key} needs a value`)
      flags[key] = value
      i += 1
    } else positional.push(a)
  }
  return { positional, flags }
}

// ---- text helpers ----------------------------------------------------------------

/** Accent-insensitive, lower-case: for matching constituent names, not for storage. */
const fold = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .trim()

const unescapeXml = (s) =>
  s.replace(/&(amp|lt|gt|apos|quot|#(\d+)|#x([0-9a-fA-F]+));/g, (_, name, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec))
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    return { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' }[name]
  })

/**
 * Read the flat records of a Ciqual XML file: `<TABLE><REC><field>v</field>…</REC>…`.
 * Values are trimmed — Ciqual pads them with newlines and spaces — and a
 * self-closing or empty element is an empty string.
 */
function readRecords(bytes, recordTag) {
  const head = bytes.subarray(0, 200).toString('latin1')
  const encoding = /encoding="([^"]+)"/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8'
  const text = new TextDecoder(encoding === 'iso-8859-1' ? 'windows-1252' : encoding).decode(bytes)
  const records = []
  const recordRe = new RegExp(`<${recordTag}>([\\s\\S]*?)</${recordTag}>`, 'g')
  const fieldRe = /<([A-Za-z_][\w.-]*)(?:\s*\/>|>([\s\S]*?)<\/\1>)/g
  for (const m of text.matchAll(recordRe)) {
    const rec = {}
    for (const f of m[1].matchAll(fieldRe)) rec[f[1].toLowerCase()] = unescapeXml((f[2] ?? '').trim())
    records.push(rec)
  }
  return records
}

/** Ciqual prints "12,5", "< 0,5", "traces", "-". Numeric or null; below-LOQ and traces are 0. */
export function ciqualValueToNumber(raw) {
  const s = (raw ?? '').trim()
  if (s === '' || s === '-') return null
  if (/^traces?$/i.test(s)) return 0
  if (/^<\s*/.test(s)) return 0
  const n = Number(s.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(n)) throw new Error(`unreadable Ciqual value ${JSON.stringify(raw)}`)
  return n
}

// ---- zip (stored / deflate, no zip64) ---------------------------------------------

function readZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)')
  const entries = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files = new Map()
  for (let i = 0; i < entries; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory')
    const method = buf.readUInt16LE(p + 10)
    const compressed = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`corrupt zip local header for ${name}`)
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(dataStart, dataStart + compressed)
    if (method === 0) files.set(name, data)
    else if (method === 8) files.set(name, inflateRawSync(data))
    else throw new Error(`unsupported zip compression method ${method} for ${name}`)
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

// ---- the three tables → one snapshot ---------------------------------------------

const FILE_KINDS = [
  { key: 'alim', tag: 'ALIM', match: /^alim(?!_grp)[^/]*\.xml$/i },
  { key: 'compo', tag: 'COMPO', match: /^compo[^/]*\.xml$/i },
  { key: 'const', tag: 'CONST', match: /^const[^/]*\.xml$/i },
]

/** From a name→bytes map of loose files and zips, find the three Ciqual XML files. */
function collectXml(inputs) {
  const found = {}
  const seen = []
  const consider = (name, bytes) => {
    const base = basename(name)
    seen.push(base)
    if (/\.zip$/i.test(base)) {
      for (const [inner, data] of readZip(bytes)) consider(inner, data)
      return
    }
    for (const kind of FILE_KINDS) if (kind.match.test(base) && !found[kind.key]) found[kind.key] = { name: base, bytes }
  }
  for (const [name, bytes] of inputs) consider(name, bytes)
  const missing = FILE_KINDS.filter((k) => !found[k.key]).map((k) => k.key)
  if (missing.length) fail(`could not find the Ciqual ${missing.join(', ')} XML file(s). Files seen: ${seen.join(', ')}`)
  return found
}

function buildSnapshot(xml) {
  const alim = readRecords(xml.alim.bytes, 'ALIM')
  const compo = readRecords(xml.compo.bytes, 'COMPO')
  const consts = readRecords(xml.const.bytes, 'CONST')
  if (!alim.length || !compo.length || !consts.length) fail(`empty table: alim=${alim.length} compo=${compo.length} const=${consts.length}`)
  log(`parsed ${alim.length} foods, ${compo.length} composition rows, ${consts.length} constituents`)
  log(`alim fields: ${Object.keys(alim[0]).join(', ')}`)
  log(`compo fields: ${Object.keys(compo[0]).join(', ')}`)
  log(`const fields: ${Object.keys(consts[0]).join(', ')}`)

  const field = (rec, ...names) => {
    for (const n of names) if (n in rec) return rec[n]
    return undefined
  }

  // Constituent codes, resolved by name and cross-checked against the code.
  // Every problem is collected before failing, so one run shows the whole
  // mapping against the whole table.
  const codes = {}
  const problems = []
  for (const c of CONSTITUENTS) {
    const hits = consts.filter((r) => c.match.test(fold(field(r, 'const_nom_fr', 'const_nom') ?? '')))
    if (hits.length !== 1) {
      const msg = `constituent for ${c.column} matched ${hits.length} rows (${hits.map((h) => `${field(h, 'const_code')}: ${field(h, 'const_nom_fr')}`).join(' | ')})`
      if (c.required) problems.push(msg)
      else log(`warning: ${msg}; column left empty`)
      continue
    }
    const code = Number(field(hits[0], 'const_code'))
    if (code !== c.expectCode) {
      problems.push(`constituent ${c.column} is code ${code} in this table, expected ${c.expectCode} ("${field(hits[0], 'const_nom_fr')}")`)
      continue
    }
    codes[c.column] = code
  }
  if (problems.length) {
    fail(`${problems.join('\n')}\nCheck the mapping before loading. Constituent table:\n${consts.map((r) => `  ${field(r, 'const_code')}\t${field(r, 'const_nom_fr')}`).join('\n')}`)
  }
  log(`constituent codes: ${JSON.stringify(codes)}`)

  const byCode = new Map(Object.entries(codes).map(([column, code]) => [code, column]))
  const values = new Map() // alim_code -> { column: raw }
  for (const r of compo) {
    const column = byCode.get(Number(field(r, 'const_code')))
    if (!column) continue
    const code = Number(field(r, 'alim_code'))
    let row = values.get(code)
    if (!row) values.set(code, (row = {}))
    row[column] = field(r, 'teneur') ?? ''
  }

  const rows = alim
    .map((r) => {
      const code = Number(field(r, 'alim_code'))
      if (!Number.isInteger(code)) fail(`food without an integer alim_code: ${JSON.stringify(r)}`)
      const v = values.get(code) ?? {}
      const row = {
        alim_code: code,
        name_fr: field(r, 'alim_nom_fr') ?? '',
        name_en: field(r, 'alim_nom_eng', 'alim_nom_en') ?? '',
        group_code: field(r, 'alim_grp_code') ?? '',
        subgroup_code: field(r, 'alim_ssgrp_code') ?? '',
        subsubgroup_code: field(r, 'alim_ssssgrp_code') ?? '',
      }
      for (const c of CONSTITUENTS) row[c.column] = v[c.column] ?? ''
      if (!row.name_fr) fail(`food ${code} has no French name`)
      for (const c of CONSTITUENTS) ciqualValueToNumber(row[c.column]) // validates every value now, not at apply time
      return row
    })
    .sort((a, b) => a.alim_code - b.alim_code)

  const withEnergy = rows.filter((r) => ciqualValueToNumber(r.energy_kcal) !== null).length
  log(`${rows.length} foods, ${withEnergy} with an energy value`)
  return { rows, codes }
}

const csvCell = (s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

function writeSnapshot(outDir, snapshot, meta) {
  mkdirSync(outDir, { recursive: true })
  const lines = [SNAPSHOT_COLUMNS.join(',')]
  for (const r of snapshot.rows) lines.push(SNAPSHOT_COLUMNS.map((c) => csvCell(String(r[c]))).join(','))
  writeFileSync(join(outDir, SNAPSHOT_CSV), `${lines.join('\n')}\n`, 'utf8')
  writeFileSync(join(outDir, SNAPSHOT_META), `${JSON.stringify({ ...meta, constituentCodes: snapshot.codes, foodCount: snapshot.rows.length, columns: SNAPSHOT_COLUMNS }, null, 2)}\n`, 'utf8')
  log(`wrote ${join(outDir, SNAPSHOT_CSV)} (${snapshot.rows.length} rows) and ${join(outDir, SNAPSHOT_META)}`)
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  const [header, ...body] = rows
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

export function readSnapshot(inDir) {
  const csvPath = join(inDir, SNAPSHOT_CSV)
  const metaPath = join(inDir, SNAPSHOT_META)
  if (!existsSync(csvPath) || !existsSync(metaPath)) fail(`no snapshot in ${inDir}: expected ${SNAPSHOT_CSV} and ${SNAPSHOT_META}. Run \`fetch\` first.`)
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  const rows = parseCsv(readFileSync(csvPath, 'utf8'))
  if (rows.length !== meta.foodCount) fail(`snapshot has ${rows.length} rows but its metadata says ${meta.foodCount}`)
  return { rows, meta }
}

// ---- fetch: the official dataset on Recherche Data Gouv ----------------------------

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) fail(`GET ${url} -> HTTP ${res.status}`)
  return res.json()
}

/**
 * One file, on its own connection, with a few retries: the Dataverse closes a
 * kept-alive socket after serving a large file, and the next request on it
 * fails with "other side closed" rather than being re-sent.
 */
async function download(url, attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(url, { headers: { connection: 'close' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      lastErr = err
      log(`  attempt ${i} failed: ${err instanceof Error ? err.message : String(err)}${i < attempts ? ', retrying' : ''}`)
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)))
    }
  }
  return fail(`GET ${url}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

async function fetchOfficial() {
  log(`dataset: ${CIQUAL_DATASET_URL}`)
  const ds = await getJson(`${CIQUAL_DATAVERSE}/api/datasets/:persistentId/?persistentId=${CIQUAL_DOI}`)
  const version = ds.data?.latestVersion
  if (!version) fail('dataset response has no latestVersion')
  const files = (version.files ?? []).map((f) => ({
    id: f.dataFile.id,
    filename: f.dataFile.filename,
    contentType: f.dataFile.contentType,
    filesize: f.dataFile.filesize,
    checksum: f.dataFile.checksum ? `${f.dataFile.checksum.type}:${f.dataFile.checksum.value}` : f.dataFile.md5 ? `MD5:${f.dataFile.md5}` : null,
  }))
  log(`version ${version.versionNumber ?? '?'}.${version.versionMinorNumber ?? '?'}, released ${version.releaseTime ?? '?'}, licence ${JSON.stringify(version.license ?? version.termsOfUse ?? null)}`)
  for (const f of files) log(`  file ${f.id}  ${f.filename}  ${f.contentType}  ${f.filesize} bytes  ${f.checksum ?? ''}`)

  // Only the three XML tables the snapshot is built from (alim, compo, const),
  // as loose files when the dataset lists them, else any zip that may hold them.
  const loose = files.filter((f) => FILE_KINDS.some((k) => k.match.test(f.filename)))
  const wanted = loose.length ? loose : files.filter((f) => /\.zip$/i.test(f.filename))
  if (!wanted.length) fail('no alim/compo/const XML file and no zip in the dataset; see the listing above')
  const inputs = new Map()
  const used = []
  for (const f of wanted) {
    log(`downloading ${f.filename} …`)
    const bytes = await download(`${CIQUAL_DATAVERSE}/api/access/datafile/${f.id}?format=original`)
    log(`  ${bytes.length} bytes`)
    inputs.set(f.filename, bytes)
    used.push(f)
  }
  return { inputs, files: used, versionLabel: `${version.versionNumber ?? '?'}.${version.versionMinorNumber ?? '?'}`, releaseTime: version.releaseTime ?? null }
}

function baseMeta(extra) {
  return {
    version: CIQUAL_VERSION,
    doi: CIQUAL_DOI,
    datasetUrl: CIQUAL_DATASET_URL,
    licence: CIQUAL_LICENCE,
    licenceUrl: CIQUAL_LICENCE_URL,
    attribution: CIQUAL_ATTRIBUTION,
    ...extra,
  }
}

// ---- apply: snapshot → ciqual_foods -------------------------------------------------

const NUMERIC_COLUMNS = CONSTITUENTS.map((c) => c.column)

async function apply(inDir, databaseUrl) {
  const { rows, meta } = readSnapshot(inDir)
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
  const ingestedAt = new Date().toISOString()
  try {
    const client = await pool.connect()
    try {
      await client.query('begin')
      const batch = 500
      const cols = ['alim_code', 'name_fr', 'name_en', 'group_code', 'subgroup_code', 'subsubgroup_code', ...NUMERIC_COLUMNS, 'ciqual_version', 'ingested_at']
      for (let i = 0; i < rows.length; i += batch) {
        const slice = rows.slice(i, i + batch)
        const params = []
        const tuples = slice.map((r) => {
          const vals = [
            Number(r.alim_code), r.name_fr, r.name_en || null, r.group_code || null, r.subgroup_code || null, r.subsubgroup_code || null,
            ...NUMERIC_COLUMNS.map((c) => ciqualValueToNumber(r[c])),
            meta.version, ingestedAt,
          ]
          const start = params.length
          params.push(...vals)
          return `(${vals.map((_, j) => `$${start + j + 1}`).join(', ')})`
        })
        const updates = cols.filter((c) => c !== 'alim_code').map((c) => `${c} = excluded.${c}`).join(', ')
        await client.query(`insert into ciqual_foods (${cols.join(', ')}) values ${tuples.join(', ')} on conflict (alim_code) do update set ${updates}`, params)
      }
      await client.query(
        `insert into ciqual_ingest (ciqual_version, dataset_doi, dataset_url, source_files, licence, attribution, fetched_at, ingested_at, food_count)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (ciqual_version) do update set dataset_doi = excluded.dataset_doi, dataset_url = excluded.dataset_url, source_files = excluded.source_files,
           licence = excluded.licence, attribution = excluded.attribution, fetched_at = excluded.fetched_at, ingested_at = excluded.ingested_at, food_count = excluded.food_count`,
        [meta.version, meta.doi, meta.datasetUrl, JSON.stringify(meta.sourceFiles ?? []), meta.licence, meta.attribution, meta.fetchedAt, ingestedAt, rows.length],
      )
      await client.query('commit')
    } catch (err) {
      await client.query('rollback').catch(() => {})
      throw err
    } finally {
      client.release()
    }
    const count = await pool.query('select count(*)::int as n, count(energy_kcal)::int as with_kcal from ciqual_foods where ciqual_version = $1', [meta.version])
    log(`ciqual_foods: ${count.rows[0].n} rows for ${meta.version} (${count.rows[0].with_kcal} with an energy value); snapshot fetched ${meta.fetchedAt}`)
  } finally {
    await pool.end()
  }
}

// ---- main --------------------------------------------------------------------------

const { positional, flags } = parseArgs(process.argv.slice(2))
const [command, arg] = positional
const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, flags.out ?? 'data/ciqual')

if (command === 'fetch') {
  const fetched = await fetchOfficial()
  const snapshot = buildSnapshot(collectXml(fetched.inputs))
  writeSnapshot(outDir, snapshot, baseMeta({ datasetVersion: fetched.versionLabel, datasetReleased: fetched.releaseTime, sourceFiles: fetched.files, fetchedAt: new Date().toISOString() }))
} else if (command === 'parse') {
  if (!arg) usage('parse needs a directory')
  const dir = resolve(arg)
  const inputs = new Map(readdirSync(dir).filter((n) => /\.(xml|zip)$/i.test(n)).map((n) => [n, readFileSync(join(dir, n))]))
  const snapshot = buildSnapshot(collectXml(inputs))
  writeSnapshot(outDir, snapshot, baseMeta({ datasetVersion: null, datasetReleased: null, sourceFiles: [...inputs.keys()].map((filename) => ({ filename })), fetchedAt: new Date().toISOString(), note: 'parsed from local files, not fetched' }))
} else if (command === 'apply') {
  const url = flags['database-url'] ?? process.env.SPORTLY_DATABASE_URL ?? process.env.SPORTLY_TEST_DATABASE_URL
  if (!url) usage('apply needs --database-url, SPORTLY_DATABASE_URL or SPORTLY_TEST_DATABASE_URL')
  await apply(resolve(root, flags.in ?? 'data/ciqual'), url).catch((err) => fail(err instanceof Error ? err.message : String(err)))
} else usage('first argument must be fetch, apply or parse')

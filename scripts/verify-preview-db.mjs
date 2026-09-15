#!/usr/bin/env node
// Database half of scripts/verify-preview.sh, without psql.
//
//   node scripts/verify-preview-db.mjs state    <subject-uuid> <route> <cap-usd>
//   node scripts/verify-preview-db.mjs set-cap  <subject-uuid> <route> <cap-usd>
//   node scripts/verify-preview-db.mjs sql      <subject-uuid> <route> <cap-usd>
//
// `state` prints one line, log_rows|error_rows|pu_rows|ni_rows|holds|held_usd|committed_usd,
// exactly what `psql -At` used to print. `set-cap` sets the subject's committed
// spend for the route, today (UTC), to the cap. Both read the connection string
// from SPORTLY_DATABASE_URL and never print it: on an error only the driver's
// message is shown, with the URL, its password, user, host and database name blanked out first,
// because a driver error routinely names them (see server/store/postgres.ts).
//
// `sql` needs no database. It prints the same statements with the three values
// already substituted, so they can be pasted as they are into Neon's SQL editor
// (which does not know psql's \set and :'var').
//
// The driver is chosen exactly as the deployed server chooses it in
// server/store/pgDriver.ts: a Neon host goes through @neondatabase/serverless
// over HTTPS, anything else through node-postgres. Both are already in
// package.json; nothing new is needed.
//
// Exit status: 0 on success, 1 when the database call fails, 2 on bad usage.

import { neon } from '@neondatabase/serverless'
import pg from 'pg'

const ROUTES = ['food_scan', 'coaching', 'program']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONEY = /^\d+(\.\d+)?$/

const usage = (msg) => {
  process.stderr.write(`verify-preview-db: ${msg}\nusage: node scripts/verify-preview-db.mjs state|set-cap|sql <subject-uuid> <route> <cap-usd>\n`)
  process.exit(2)
}

const [command, subject, route, cap] = process.argv.slice(2)
if (!['state', 'set-cap', 'sql'].includes(command ?? '')) usage('first argument must be state, set-cap or sql')
if (!UUID.test(subject ?? '')) usage('subject must be a UUID')
if (!ROUTES.includes(route ?? '')) usage(`route must be one of ${ROUTES.join(', ')}`)
if (!MONEY.test(cap ?? '')) usage('cap must be a plain decimal number, e.g. 1.00')

// ---- the SQL ----------------------------------------------------------------
//
// One source for both uses. Executed, the three values are bound parameters;
// printed, they are literals. The inputs above are validated strictly enough
// that a literal needs no further quoting.

const BOUND = { subject: '$1::uuid', route: '$2', cap: '$3::numeric' }
const LITERAL = { subject: `'${subject.toLowerCase()}'::uuid`, route: `'${route}'`, cap: `${cap}::numeric` }

const stateSql = (v) => `
select
  (select count(*) from sportly_model_call_log where subject_id = ${v.subject}) as log_rows,
  (select count(*) from sportly_model_call_log where subject_id = ${v.subject} and outcome = 'error') as error_rows,
  (select count(*) from sportly_model_call_log where subject_id = ${v.subject} and error_category = 'PROVIDER_UNAVAILABLE') as pu_rows,
  (select count(*) from sportly_model_call_log where subject_id = ${v.subject} and provider = 'not_implemented') as ni_rows,
  (select count(*) from sportly_spend_hold where subject_id = ${v.subject}) as holds,
  (select coalesce(sum(held_usd), 0) from sportly_spend_bucket where subject_id = ${v.subject}) as held_usd,
  (select coalesce(sum(committed_usd), 0) from sportly_spend_bucket where subject_id = ${v.subject} and route = ${v.route} and day = (now() at time zone 'utc')::date) as committed_usd;
`.trim()

const setCapSql = (v) => `
-- Set committed spend for this subject/route/today (UTC) to exactly the cap.
-- The gate admits while held_usd + committed_usd < cap, so this blocks the next call.
insert into sportly_spend_bucket (subject_id, route, day, held_usd, committed_usd)
values (${v.subject}, ${v.route}, (now() at time zone 'utc')::date, 0, ${v.cap})
on conflict (subject_id, route, day) do update
  set committed_usd = excluded.committed_usd;
`.trim()

const inspectSql = (v) => `
-- Inspect this subject's rows:
select route, day, held_usd, committed_usd
  from sportly_spend_bucket where subject_id = ${v.subject};
select hold_id, route, day, hold_usd, taken_at
  from sportly_spend_hold where subject_id = ${v.subject};
select id, ts, route, provider, model, outcome, error_category, retry_count, cost_usd, request_id
  from sportly_model_call_log where subject_id = ${v.subject} order by id;
`.trim()

const manualSql = (v) => `
-- subject: ${subject.toLowerCase()}   route: ${route}   cap: ${cap}
-- Plain SQL, values already substituted: paste into Neon's SQL editor as is.

${inspectSql(v)}

-- The combined state line verify-preview.sh checks
-- (log_rows|error_rows|pu_rows|ni_rows|holds|held_usd|committed_usd):
${stateSql(v)}

${setCapSql(v)}

-- After the 402, re-run the inspect queries: the log row count must not
-- have grown and sportly_spend_hold must still have no row for the subject.

-- Optional cleanup of the test subject:
-- delete from sportly_model_call_log where subject_id = ${v.subject};
-- delete from sportly_spend_hold      where subject_id = ${v.subject};
-- delete from sportly_spend_bucket    where subject_id = ${v.subject};
-- delete from sportly_subject         where subject_id = ${v.subject};
`.trim()

if (command === 'sql') {
  process.stdout.write(manualSql(LITERAL) + '\n')
  process.exit(0)
}

// ---- the connection -----------------------------------------------------------

const url = process.env.SPORTLY_DATABASE_URL?.trim()
if (!url) usage('SPORTLY_DATABASE_URL is not set')

let parsed
try {
  parsed = new URL(url)
} catch {
  usage('SPORTLY_DATABASE_URL is not a valid URL (not shown)')
}

/** Blank out anything that identifies the database before a message is printed. */
function redact(text) {
  let out = String(text).replaceAll(url, '[url]')
  for (const secret of [parsed.password, safeDecode(parsed.password), parsed.username, safeDecode(parsed.username)]) {
    if (secret) out = out.replaceAll(secret, '[redacted]')
  }
  if (parsed.hostname) out = out.replaceAll(parsed.hostname, '[host]')
  const database = parsed.pathname.replace(/^\//, '')
  if (database) out = out.replaceAll(database, '[database]')
  return out
}
function safeDecode(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// Same rule as createPgExecutor in server/store/pgDriver.ts.
const isNeonHttpUrl = /(^|[@.])neon\.tech[:/]?/i.test(url) || /\.neon\.build[:/]?/i.test(url)

/** run(text, params) -> rows, with whichever driver the URL calls for. */
async function withDriver(fn) {
  if (isNeonHttpUrl) {
    const sql = neon(url)
    return fn((text, params) => sql.query(text, params))
  }
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 })
  await client.connect()
  try {
    return await fn(async (text, params) => (await client.query(text, params)).rows)
  } finally {
    await client.end()
  }
}

try {
  await withDriver(async (run) => {
    if (command === 'state') {
      const [row] = await run(stateSql(BOUND), [subject.toLowerCase(), route])
      const cols = ['log_rows', 'error_rows', 'pu_rows', 'ni_rows', 'holds', 'held_usd', 'committed_usd']
      process.stdout.write(cols.map((c) => String(row[c])).join('|') + '\n')
    } else {
      await run(setCapSql(BOUND), [subject.toLowerCase(), route, cap])
    }
  })
} catch (err) {
  const code = err?.code ? ` [${err.code}]` : ''
  process.stderr.write(`verify-preview-db: ${command} failed${code}: ${redact(err?.message ?? err)}\n`)
  process.exit(1)
}

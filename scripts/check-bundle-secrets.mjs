// Fails the build if the client bundle carries anything server-only.
//
// Two checks, because the failure has two shapes:
//   1. a server env var name reaching the bundle (something read SPORTLY_*
//      from client code, or a build inlined it), and
//   2. a key-shaped literal being hardcoded somewhere in src/.
//
// The SPORTLY_ prefix is the contract: server/env.ts declares every server-only
// name with it, and a test asserts that it does, so scanning for the prefix
// provably covers all of them.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIST = process.argv[2] ?? 'dist'
const SERVER_ENV_PREFIX = /SPORTLY_[A-Z0-9_]+/g
// Provider key shapes: Anthropic (sk-ant-…) and OpenAI (sk-proj-… and the
// plain sk-… form). This repo ships an OpenAI-compatible client adapter, so the
// plain form has to be covered too.
const KEY_LITERAL = /\bsk-(?:ant|proj)-[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9]{24,}/g
// Text assets legitimately mention env var names (docs shipped into the bundle).
const SCANNED = /\.(js|mjs|cjs|css|html|json|webmanifest)$/

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    throw new Error(`Cannot read ${dir}. Run \`pnpm build\` first.`)
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

const findings = []
let scanned = 0

for await (const file of walk(DIST)) {
  if (!SCANNED.test(file)) continue
  scanned += 1
  const text = await readFile(file, 'utf8')
  for (const match of text.match(SERVER_ENV_PREFIX) ?? []) findings.push({ file, kind: 'server env var', match })
  for (const match of text.match(KEY_LITERAL) ?? []) findings.push({ file, kind: 'provider key literal', match: `${match.slice(0, 12)}…` })
}

if (findings.length) {
  console.error(`\ncheck-bundle-secrets: FAILED — ${findings.length} finding(s) in ${DIST}\n`)
  for (const f of findings) console.error(`  ${f.file}: ${f.kind} ${f.match}`)
  console.error('\nServer-only configuration must never reach the client bundle.\n')
  process.exit(1)
}

console.log(`check-bundle-secrets: OK — scanned ${scanned} file(s) in ${DIST}, no server env vars or provider key literals found.`)

// Load every api/ entrypoint the way Vercel's Node runtime will.
//
// Vercel compiles api/ and server/ file by file with TypeScript, keeps the
// directory layout, and hands the result to Node's ESM loader. That loader
// does not resolve extensionless relative specifiers, and neither tsc nor
// vitest catches a bad one: tsc under nodenext rejects it, but a typecheck
// is not a load, and vitest resolves what Node would not. So this check does
// what the runtime does — emit, then `import()` each handler with plain node,
// no bundler, no test runner, no loader hooks — and then invokes it once.
//
// Fails (exit 1) if any entrypoint does not import, does not export a
// function, or does not answer a request.

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'node_modules', '.tmp', 'api-esm-load')

const listTs = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listTs(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  )
const entrypoints = listTs(join(root, 'api')).map((f) => relative(root, f))
if (entrypoints.length === 0) {
  console.error('no api/ entrypoints found')
  process.exit(1)
}

// 1. Emit as Vercel does: per-file TypeScript output, layout preserved.
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
execFileSync(
  join(root, 'node_modules', '.bin', 'tsc'),
  ['-p', 'tsconfig.server.json', '--noEmit', 'false', '--outDir', out, '--sourceMap', 'false', '--declaration', 'false'],
  { cwd: root, stdio: 'inherit' },
)
cpSync(join(root, 'package.json'), join(out, 'package.json')) // "type": "module", as deployed
if (!existsSync(join(out, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'), 'dir')

// 2. Import each entrypoint in its own plain node process, then invoke it once.
const probe = `
  const [file] = process.argv.slice(1)
  const m = await import(file)
  if (typeof m.default !== 'function') throw new Error('default export is not a function')
  const { createServer } = await import('node:http')
  const server = createServer((req, res) => m.default(req, res))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = 'http://127.0.0.1:' + server.address().port + '/'
  const res = await fetch(url, { method: 'GET' })
  const body = await res.text()
  server.close()
  console.log('  invoked: GET -> HTTP ' + res.status + ' ' + body.slice(0, 80))
  if (res.status >= 500) throw new Error('handler answered ' + res.status)
`
const env = {
  ...process.env,
  // Only so the handler can construct the app; nothing leaves this process.
  SPORTLY_TOKEN_SECRET: 'esm-load-check-not-a-real-secret-0123456789abcdef',
  SPORTLY_ANTHROPIC_API_KEY: 'esm-load-check-not-a-real-key',
  SPORTLY_ALLOW_EPHEMERAL_STORE: '1',
}
let failed = 0
for (const entry of entrypoints) {
  const compiled = join(out, entry.replace(/\.ts$/, '.js'))
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe, '--', pathToFileURL(compiled).href], {
    cwd: out,
    env,
    encoding: 'utf8',
  })
  if (r.status === 0) {
    console.log(`LOADED  ${entry} -> ${relative(root, compiled)}`)
    process.stdout.write(r.stdout)
  } else {
    failed += 1
    console.log(`FAILED  ${entry}`)
    process.stdout.write(r.stdout)
    process.stderr.write(r.stderr.split('\n').filter((l) => /Error|imported from|at .*\.js/.test(l)).slice(0, 4).join('\n') + '\n')
  }
}
if (failed) {
  console.error(`${failed} of ${entrypoints.length} api/ entrypoints failed to load under plain node ESM`)
  process.exit(1)
}
console.log(`${entrypoints.length} api/ entrypoints load and answer under plain node ESM`)

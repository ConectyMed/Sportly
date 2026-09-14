import { describe, expect, it } from 'vitest'

/**
 * Source scan: user-facing copy must go through the dictionaries. This test
 * walks the screens, components and coach engine and fails on English prose
 * left in JSX text, attributes or coach reply strings.
 *
 * Deliberately English (and excluded): the model contract (prompt, tool
 * definitions, schema and resolution errors are read by a model, not by the
 * user), the knowledge base, tests and the dictionaries themselves.
 */

const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const SKIP = [/__tests__/, /\/i18n\//, /\/knowledge\//, /coach\/model\/(prompt|toolDefinitions|schema|resolve|providers|adapters)/, /\.d\.ts$/, /vite-env/]
const files = Object.keys(SOURCES).filter((f) => !SKIP.some((re) => re.test(f)))
const readFileSync = (f: string) => SOURCES[f]
const relative = (f: string) => f.replace(/^\/src\//, '')

describe('no hardcoded user-facing English outside the dictionaries', () => {
  it('JSX text nodes and user-facing attributes are translated', () => {
    const hits: string[] = []
    for (const f of files.filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(f)
      // Text between tags: two or more words, starting with a letter, not an expression.
      for (const m of src.matchAll(/>\s*([A-Za-z][A-Za-z’',.!?-]*(?:\s+[A-Za-z][A-Za-z’',.!?-]*)+)\s*</g)) {
        const text = m[1].trim()
        if (/^(Sportly|Claude|OpenAI|Ollama|LM Studio|kcal|kg|cm)$/.test(text)) continue
        hits.push(`${relative(f)}: <${text}>`)
      }
      for (const m of src.matchAll(/\b(placeholder|aria-label|title|alt)="([^"{}]*[A-Za-z]{3,}[^"{}]*)"/g)) {
        hits.push(`${relative(f)}: ${m[1]}="${m[2]}"`)
      }
    }
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('the coach engine builds no English sentences outside the dictionaries', () => {
    const hits: string[] = []
    // A sentence-like English string: several lowercase words including a very common English function word.
    const english = /['`]([^'`\n]*\b(?:the|your|you|with|and|for|that|this|will|should|have)\b[^'`\n]*\s[^'`\n]*)['`]/g
    // personality.ts holds the per-language phrase banks (English side included by design); memory.ts holds stop-word lists.
    const engine = files.filter((x) => /\/coach\//.test(x) && !/food\/foodDatabase|exercises|intents|personality\.ts|memory\.ts/.test(x))
    for (const f of engine) {
      const src = readFileSync(f)
      for (const line of src.split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue // comments
        if (/console\.|throw new Error|new ProviderError|refuse\(|fail\('|ProviderError\(|failure\(|apiKey|You are a nutrition estimator|Estimate this meal/.test(line)) continue // developer- or model-facing
        if (/\.test\(|\.match\(|RegExp|replace\(/.test(line)) continue // regular expressions
        for (const m of line.matchAll(english)) {
          const s = m[1]
          if (/[{}$]/.test(s) && /\bt\(|tr\.t\(|tn\(/.test(line)) continue
          if (/^(\w+\s?){1,2}$/.test(s)) continue
          hits.push(`${relative(f)}: ${s.slice(0, 80)}`)
        }
      }
    }
    expect(hits, hits.join('\n')).toEqual([])
  })
})

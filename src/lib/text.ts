/**
 * Text normalisation for MATCHING only. Stored and displayed content keeps its
 * accents; these helpers exist so "séance", "seance" and "SÉANCE" all mean the
 * same thing to the parsers.
 */

/** Straighten smart punctuation typed by phone keyboards. */
export function straightenQuotes(s: string): string {
  return s.replace(/[’‘`´]/g, "'").replace(/[“”«»]/g, '"')
}

/**
 * Length-preserving accent fold: é → e, ç → c, œ → o, so that indexes found in
 * the folded text still point at the same characters in the original.
 */
export function foldText(s: string): string {
  let out = ''
  for (const ch of s) {
    if (ch === 'œ' || ch === 'Œ') {
      out += ch === 'œ' ? 'o' : 'O'
      continue
    }
    if (ch === 'æ' || ch === 'Æ') {
      out += ch === 'æ' ? 'a' : 'A'
      continue
    }
    const nfd = ch.normalize('NFD')
    const base = nfd.replace(/[̀-ͯ]/g, '')
    out += base.length === 1 ? base : ch
  }
  return out
}

/** Lower-case, straight apostrophes, accents folded: the canonical shape every intent regex runs on. */
export function normalizeForMatching(s: string): string {
  return foldText(straightenQuotes(s).toLowerCase())
}

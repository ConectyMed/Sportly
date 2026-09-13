import type { KnowledgeChunk, KnowledgeDocument, KnowledgeHit, KnowledgeRetriever, KnowledgeSearchOptions, KnowledgeSource } from './types'

const STOP = new Set('a an the of to in on at for from with and or but is are be as by it its this that these those what how why when should can do does my your i you we'.split(' '))

export function keywordsOf(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9% ]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP.has(w))
        .map((w) => w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '')),
    ),
  ]
}

/** Split a document into paragraph-sized chunks, keeping topics and provenance. */
export function chunkDocument(doc: KnowledgeDocument, maxChars = 480): KnowledgeChunk[] {
  const paragraphs = doc.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const chunks: KnowledgeChunk[] = []
  let buffer = ''
  const flush = () => {
    if (!buffer) return
    chunks.push({ id: `${doc.id}#${chunks.length}`, documentId: doc.id, index: chunks.length, text: buffer, topics: doc.topics, keywords: keywordsOf(buffer) })
    buffer = ''
  }
  for (const p of paragraphs) {
    if (buffer && buffer.length + p.length > maxChars) flush()
    buffer = buffer ? `${buffer}\n\n${p}` : p
  }
  flush()
  return chunks
}

/** Small in-memory keyword index. Deterministic, dependency-free, good enough for a few hundred chunks. */
export class LocalKnowledgeIndex implements KnowledgeRetriever {
  private docs: Map<string, KnowledgeDocument> = new Map()
  private srcs: Map<string, KnowledgeSource> = new Map()
  private chunks: KnowledgeChunk[] = []

  constructor(sources: KnowledgeSource[] = [], documents: KnowledgeDocument[] = []) {
    for (const s of sources) this.srcs.set(s.id, s)
    for (const d of documents) this.add(d)
  }

  add(doc: KnowledgeDocument): void {
    if (!this.srcs.has(doc.sourceId)) throw new Error(`Unknown knowledge source ${doc.sourceId}`)
    this.docs.set(doc.id, doc)
    this.chunks = this.chunks.filter((c) => c.documentId !== doc.id).concat(chunkDocument(doc))
  }

  search(query: string, options: KnowledgeSearchOptions = {}): KnowledgeHit[] {
    const q = keywordsOf(query)
    if (!q.length) return []
    const limit = options.limit ?? 3
    const hits: KnowledgeHit[] = []
    for (const chunk of this.chunks) {
      if (options.topics?.length && !chunk.topics.some((t) => options.topics!.includes(t))) continue
      const kw = new Set(chunk.keywords)
      let score = 0
      for (const term of q) {
        if (kw.has(term)) score += 2
        else if (chunk.keywords.some((k) => k.startsWith(term) || term.startsWith(k))) score += 0.5
      }
      if (chunk.topics.some((t) => q.includes(t.replace('_', '')))) score += 1
      if (score <= 0) continue
      const document = this.docs.get(chunk.documentId)!
      hits.push({ chunk, document, source: this.srcs.get(document.sourceId)!, score: score / Math.sqrt(q.length) })
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  documents(): KnowledgeDocument[] {
    return [...this.docs.values()]
  }

  sources(): KnowledgeSource[] {
    return [...this.srcs.values()]
  }
}

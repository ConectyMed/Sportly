import { LocalKnowledgeIndex } from './retrieval'
import { SEED_DOCUMENTS, SPORTLY_NOTES } from './seed'
import type { KnowledgeRetriever } from './types'

let instance: KnowledgeRetriever | undefined

/** The app-wide knowledge retriever. Built lazily; swap the implementation here when a richer index exists. */
export function getKnowledge(): KnowledgeRetriever {
  instance ??= new LocalKnowledgeIndex([SPORTLY_NOTES], SEED_DOCUMENTS)
  return instance
}

export type { KnowledgeChunk, KnowledgeDocument, KnowledgeHit, KnowledgeMetadata, KnowledgeRetriever, KnowledgeSource, KnowledgeTopic } from './types'

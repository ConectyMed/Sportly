/**
 * Knowledge is documentation the coach can consult; it is not the coach's
 * behaviour and it is not the user's state. Documents keep their provenance so
 * an answer can always say where a principle comes from.
 */

export type KnowledgeTopic =
  | 'training'
  | 'hypertrophy'
  | 'strength'
  | 'progression'
  | 'rpe'
  | 'one_rep_max'
  | 'periodization'
  | 'recovery'
  | 'nutrition'
  | 'protein'
  | 'micronutrition'
  | 'fat_loss'
  | 'conditioning'
  | 'mobility'
  | 'safety'

export interface KnowledgeSource {
  id: string
  title: string
  /** Where the material comes from. A future package import keeps its own id here. */
  kind: 'package' | 'note' | 'reference'
  provenance: string
  addedAt: string
}

export interface KnowledgeMetadata {
  author?: string
  year?: number
  /** How settled the underlying evidence is. */
  evidence?: 'consensus' | 'strong' | 'moderate' | 'emerging'
  audience?: 'beginner' | 'intermediate' | 'advanced' | 'all'
  language?: string
}

export interface KnowledgeDocument {
  id: string
  sourceId: string
  title: string
  topics: KnowledgeTopic[]
  text: string
  metadata: KnowledgeMetadata
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  index: number
  text: string
  topics: KnowledgeTopic[]
  keywords: string[]
}

export interface KnowledgeHit {
  chunk: KnowledgeChunk
  document: KnowledgeDocument
  source: KnowledgeSource
  score: number
}

export interface KnowledgeSearchOptions {
  limit?: number
  topics?: KnowledgeTopic[]
}

/** Retrieval interface. Today a local keyword index; later an embedding store, same contract. */
export interface KnowledgeRetriever {
  search(query: string, options?: KnowledgeSearchOptions): KnowledgeHit[]
  documents(): KnowledgeDocument[]
  sources(): KnowledgeSource[]
}

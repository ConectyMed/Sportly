import { randomUUID } from 'node:crypto'
import type { BindSubjectResult, BoundaryStore, ModelCallLogRow, Route, SpendAdmission, SpendAdmissionRequest } from './port'

export interface MemoryStoreOptions {
  /** Mint attempts allowed per key per window. */
  mintLimit?: number
  mintWindowMs?: number
}

interface Hold {
  subjectId: string
  route: Route
  day: string
  usd: number
  takenAtMs: number
}

/**
 * In-memory adapter. This is what the V8a tests run against — no database in
 * CI — and it is also the reference for what the Postgres adapter must do.
 *
 * Single-process only, so it is never the silent production default; see
 * `resolveStore` in server/app.ts.
 */
export function createMemoryStore(options: MemoryStoreOptions = {}): BoundaryStore & { rows: ModelCallLogRow[] } {
  const mintLimit = options.mintLimit ?? 5
  const mintWindowMs = options.mintWindowMs ?? 60 * 60 * 1000
  const subjects = new Map<string, string>()
  const mintAttempts = new Map<string, number[]>()
  const holds = new Map<string, Hold>()
  const rows: ModelCallLogRow[] = []

  const committed = (subjectId: string, route: Route, day: string): number =>
    rows.filter((r) => r.subjectId === subjectId && r.route === route && r.ts.slice(0, 10) === day).reduce((sum, r) => sum + (r.costUsd ?? 0), 0)

  return {
    rows,

    async bindSubjectOnce(subjectId: string, atIso: string): Promise<BindSubjectResult> {
      if (subjects.has(subjectId)) return 'already_bound'
      subjects.set(subjectId, atIso)
      return 'bound'
    },

    async admitMintAttempt(key: string, nowMs: number): Promise<boolean> {
      const recent = (mintAttempts.get(key) ?? []).filter((at) => nowMs - at < mintWindowMs)
      if (recent.length >= mintLimit) {
        mintAttempts.set(key, recent)
        return false
      }
      recent.push(nowMs)
      mintAttempts.set(key, recent)
      return true
    },

    async admitSpend(request: SpendAdmissionRequest): Promise<SpendAdmission> {
      // Abandoned holds (a crashed request that never settled) stop counting.
      for (const [id, hold] of holds) {
        if (request.nowMs - hold.takenAtMs > request.holdTtlMs) holds.delete(id)
      }
      const held = [...holds.values()]
        .filter((h) => h.subjectId === request.subjectId && h.route === request.route && h.day === request.day)
        .reduce((sum, h) => sum + h.usd, 0)
      const spentUsd = committed(request.subjectId, request.route, request.day) + held
      if (spentUsd >= request.capUsd) return { admitted: false, spentUsd, holdId: null }
      const holdId = randomUUID()
      holds.set(holdId, { subjectId: request.subjectId, route: request.route, day: request.day, usd: request.holdUsd, takenAtMs: request.nowMs })
      return { admitted: true, spentUsd, holdId }
    },

    async settleSpend(holdId: string | null, row: ModelCallLogRow): Promise<void> {
      rows.push({ ...row })
      if (holdId) holds.delete(holdId)
    },

    async readCallLog(subjectId: string, day?: string): Promise<ModelCallLogRow[]> {
      return rows
        .filter((r) => r.subjectId === subjectId && (day === undefined || r.ts.slice(0, 10) === day))
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .map((r) => ({ ...r }))
    },

    async spendTodayUsd(subjectId: string, route: Route, day: string): Promise<number> {
      return committed(subjectId, route, day)
    },
  }
}

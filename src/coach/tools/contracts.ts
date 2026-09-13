import type { DomainChange, EntityRef } from '@/domain/types'

/**
 * Contracts shared by every coach tool.
 *
 * A tool is the only way the coach (local engine today, an LLM tomorrow) touches
 * the application. Tools validate their input, execute against the single store,
 * and return a typed result that says exactly what changed. The caller never
 * mutates state directly and never has to guess whether something happened.
 */

export type ToolErrorCode =
  /** The referenced entity does not exist (or no longer exists). */
  | 'not_found'
  /** The input failed validation. */
  | 'invalid_input'
  /** Several entities could match; the caller should ask the user. */
  | 'ambiguous'
  /** The action contradicts current state (e.g. completing a skipped workout). */
  | 'conflict'
  /** The action is not allowed in the current state. */
  | 'not_allowed'
  /** Unexpected failure while executing. */
  | 'failed'

export interface ToolError {
  code: ToolErrorCode
  message: string
  /** Candidates when the reference was ambiguous. */
  candidates?: EntityRef[]
}

export type ToolResult<T = unknown> =
  | {
      ok: true
      data: T
      changes: DomainChange[]
      /** True when the call repeated an earlier one and no new change was made. */
      idempotent?: boolean
      /** Entities the caller may want to keep in conversational context. */
      references?: EntityRef[]
    }
  | { ok: false; error: ToolError; changes: [] }

export function ok<T>(data: T, changes: DomainChange[] = [], extra: { idempotent?: boolean; references?: EntityRef[] } = {}): ToolResult<T> {
  return { ok: true, data, changes, ...extra }
}

export function fail<T = never>(code: ToolErrorCode, message: string, candidates?: EntityRef[]): ToolResult<T> {
  return { ok: false, error: { code, message, candidates }, changes: [] }
}

/** Description of a tool as a future model would see it. Plain data, no code. */
export interface ToolDescriptor {
  name: string
  kind: 'read' | 'action'
  description: string
  /** JSON-Schema-like shape of the input, kept deliberately small. */
  input: Record<string, unknown>
}

export function change(type: DomainChange['type'], entity: EntityRef, summary: string): DomainChange {
  return { type, entity, summary }
}

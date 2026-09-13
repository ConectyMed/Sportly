/**
 * A deliberately small JSON-Schema subset: enough to describe every Sportly
 * tool to a model and to validate what a model sends back. No dependency, no
 * code generation, no surprises. Model arguments are untrusted input: they are
 * parsed here before any domain code sees them.
 */

export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  enum?: Array<string | number>
  items?: JsonSchema
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
}

export interface ParsedArguments {
  ok: boolean
  /** Coerced, unknown-key-stripped value (only meaningful when ok). */
  value: Record<string, unknown>
  errors: string[]
}

const MAX_STRING = 2_000
const MAX_ITEMS = 100

/**
 * Validate and normalise model-provided arguments against a schema.
 *  - numeric strings become numbers ("3" → 3), "true"/"false" become booleans;
 *  - unknown keys are dropped (never forwarded to a tool);
 *  - anything else that does not fit is an error with a path.
 */
export function parseArguments(schema: JsonSchema, input: unknown): ParsedArguments {
  const errors: string[] = []
  const value = coerce(schema, input, '$', errors)
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return { ok: errors.length === 0, value: obj, errors }
}

function coerce(schema: JsonSchema, v: unknown, path: string, errors: string[]): unknown {
  const t = schema.type ?? (schema.properties ? 'object' : schema.items ? 'array' : schema.enum ? 'string' : undefined)
  if (v === undefined || v === null) {
    if (t === 'object') return coerceObject(schema, {}, path, errors)
    return undefined
  }
  switch (t) {
    case 'object':
      if (typeof v !== 'object' || Array.isArray(v)) {
        errors.push(`${path}: expected an object`)
        return {}
      }
      return coerceObject(schema, v as Record<string, unknown>, path, errors)
    case 'array': {
      const arr = Array.isArray(v) ? v : typeof v === 'string' && v.includes(',') ? v.split(',').map((x) => x.trim()) : [v]
      if (arr.length > (schema.maxItems ?? MAX_ITEMS)) errors.push(`${path}: at most ${schema.maxItems ?? MAX_ITEMS} items`)
      if (schema.minItems !== undefined && arr.length < schema.minItems) errors.push(`${path}: at least ${schema.minItems} items`)
      return arr.slice(0, schema.maxItems ?? MAX_ITEMS).map((x, i) => (schema.items ? coerce(schema.items, x, `${path}[${i}]`, errors) : x))
    }
    case 'number':
    case 'integer': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
      if (!Number.isFinite(n)) {
        errors.push(`${path}: expected a number`)
        return undefined
      }
      if (t === 'integer' && !Number.isInteger(n)) {
        errors.push(`${path}: expected an integer`)
        return undefined
      }
      if (schema.minimum !== undefined && n < schema.minimum) errors.push(`${path}: must be ≥ ${schema.minimum}`)
      if (schema.maximum !== undefined && n > schema.maximum) errors.push(`${path}: must be ≤ ${schema.maximum}`)
      if (schema.enum && !schema.enum.includes(n)) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`)
      return n
    }
    case 'boolean': {
      if (typeof v === 'boolean') return v
      if (v === 'true' || v === 1 || v === '1') return true
      if (v === 'false' || v === 0 || v === '0') return false
      errors.push(`${path}: expected true or false`)
      return undefined
    }
    case 'string': {
      const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined
      if (s === undefined) {
        errors.push(`${path}: expected text`)
        return undefined
      }
      if (s.length > (schema.maxLength ?? MAX_STRING)) errors.push(`${path}: too long`)
      if (schema.minLength !== undefined && s.length < schema.minLength) errors.push(`${path}: too short`)
      if (schema.enum && !schema.enum.includes(s)) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`)
      return s.slice(0, schema.maxLength ?? MAX_STRING)
    }
    default:
      return v
  }
}

function coerceObject(schema: JsonSchema, v: Record<string, unknown>, path: string, errors: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const props = schema.properties ?? {}
  for (const [key, sub] of Object.entries(props)) {
    if (v[key] === undefined || v[key] === null) continue
    const c = coerce(sub, v[key], `${path}.${key}`, errors)
    if (c !== undefined) out[key] = c
  }
  for (const key of schema.required ?? []) if (out[key] === undefined) errors.push(`${path}.${key}: required`)
  // Unknown keys are dropped, never forwarded.
  return out
}

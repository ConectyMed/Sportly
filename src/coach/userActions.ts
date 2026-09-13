import type { ActionRecord } from '@/domain/types'
import type { CoachAction } from './provider'
import { executeAction } from './tools/registry'

/**
 * Screens change domain entities through the same tools the coach uses, so
 * validation, idempotency and the audit trail apply whoever pressed the button.
 * The result is returned so a screen can show a toast when something is refused.
 */
export function userAction(action: CoachAction): ActionRecord {
  return executeAction(action, { source: 'user' })
}

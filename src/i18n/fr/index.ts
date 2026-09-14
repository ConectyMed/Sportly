import type { en } from '../en'
import { calendar } from './calendar'
import { coach } from './coach'
import { coachScreen } from './coachScreen'
import { common } from './common'
import { demo } from './demo'
import { domain } from './domain'
import { home } from './home'
import { insights } from './insights'
import { nutrition } from './nutrition'
import { onboarding } from './onboarding'
import { profile } from './profile'
import { progress } from './progress'
import { service } from './service'
import { tools } from './tools'
import { workout } from './workout'

/** The French dictionary. Every key of the English dictionary must exist here (checked by TypeScript and by a test). */
export const fr: Record<keyof typeof en, string> = {
  ...common,
  ...domain,
  ...home,
  ...coachScreen,
  ...workout,
  ...nutrition,
  ...progress,
  ...profile,
  ...onboarding,
  ...calendar,
  ...coach,
  ...tools,
  ...service,
  ...insights,
  ...demo,
}

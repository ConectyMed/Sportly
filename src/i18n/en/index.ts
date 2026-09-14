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

/** The English dictionary: the single source of truth for translation keys. */
export const en = {
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

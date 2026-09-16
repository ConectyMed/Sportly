import type { Attribution } from './types.js'

/**
 * What each source requires us to display. One function per source, so the
 * wording lives here and nowhere else.
 */

export const CIQUAL_LICENCE = 'Licence Ouverte / Open Licence 2.0 (Etalab)'
export const CIQUAL_LICENCE_URL = 'https://www.etalab.gouv.fr/licence-ouverte-open-licence'
export const CIQUAL_SITE = 'https://ciqual.anses.fr'

export const OFF_LICENCE = 'Open Database License (ODbL) 1.0'
export const OFF_LICENCE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/'
export const OFF_SITE = 'https://world.openfoodfacts.org'

/** ANSES asks for the source and the table version to be named. */
export function ciqualAttribution(alimCode: number, ciqualVersion: string): Attribution {
  return {
    source: 'ciqual',
    provider: 'ANSES',
    licence: CIQUAL_LICENCE,
    licenceUrl: CIQUAL_LICENCE_URL,
    text: `Source : Anses. Table de composition nutritionnelle des aliments ${ciqualVersion} (ciqual.anses.fr).`,
    url: `${CIQUAL_SITE}/#/aliments/${alimCode}`,
    required: true,
  }
}

/** ODbL: name the database, its licence, and link back; OFF also asks that contributors be credited. */
export function offAttribution(barcode: string): Attribution {
  return {
    source: 'off',
    provider: 'Open Food Facts',
    licence: OFF_LICENCE,
    licenceUrl: OFF_LICENCE_URL,
    text: 'Data from Open Food Facts (world.openfoodfacts.org), © Open Food Facts contributors, made available under the Open Database License.',
    url: offProductUrl(barcode),
    required: true,
  }
}

export function offProductUrl(barcode: string): string {
  return `${OFF_SITE}/product/${encodeURIComponent(barcode)}`
}

/** Our own rows carry an attribution too, so the UI never special-cases a source. */
export function sportlyAttribution(): Attribution {
  return {
    source: 'sportly',
    provider: 'Sportly',
    licence: 'Sportly food data',
    licenceUrl: null,
    text: 'Sportly food data.',
    url: null,
    required: false,
  }
}

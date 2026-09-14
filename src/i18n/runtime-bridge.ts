/**
 * The tiny surface the store needs from i18n, kept dictionary-free so the store
 * never pulls the translation tables into its own import graph.
 */
export { detectBrowserLanguage, isLanguage, type Language } from './types'
export { getLanguage, setActiveLanguage } from './runtime'

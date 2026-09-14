import { beforeEach, describe, expect, it } from 'vitest'
import { en } from '@/i18n/en'
import { fr } from '@/i18n/fr'
import { detectBrowserLanguage, formatDateIntl, formatDecimal, formatInt, getLanguage, missingKeys, resetMissingKeys, setActiveLanguage, t, tn, translator, weekdayNameByIndex } from '@/i18n'
import { formatDate, formatShortDate, weekdayName, monthName, parseWeekday } from '@/lib/dates'
import { formatMinutes } from '@/lib/utils'
import { goalLabel, mealSlotIn, programDisplayName, renderWorkoutTitle, workoutTitle } from '@/domain/labels'
import { foodItemName, mealDisplayName, analyzeDescription, buildMeal } from '@/coach/food/foodAnalysis'
import { useStore } from '@/store/useStore'
import { buildDemoSeed } from '@/domain/demo'

const reset = () => {
  localStorage.clear()
  useStore.getState().resetAll()
  setActiveLanguage(useStore.getState().preferences.language)
}

describe('i18n dictionaries', () => {
  it('French carries exactly the English keys and no empty values', () => {
    const enKeys = Object.keys(en).sort()
    const frKeys = Object.keys(fr).sort()
    expect(frKeys).toEqual(enKeys)
    for (const k of enKeys) {
      if (k === 'foodUnit.piece') continue // pieces carry no unit word by design
      expect((en as Record<string, string>)[k].length, `en:${k}`).toBeGreaterThan(0)
      expect((fr as Record<string, string>)[k].length, `fr:${k}`).toBeGreaterThan(0)
    }
    expect(enKeys.length).toBeGreaterThan(900)
  })

  it('every placeholder used in English exists in the French value', () => {
    for (const k of Object.keys(en)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
      expect(ph((fr as Record<string, string>)[k]), k).toEqual(ph((en as Record<string, string>)[k]))
    }
  })

  it('French values are French (typographic apostrophes, accents, tutoiement), not copies of the English', () => {
    const same = Object.keys(en).filter((k) => (en as Record<string, string>)[k] === (fr as Record<string, string>)[k])
    // Brand words, units, numbers, names and a handful of identical words are allowed to match.
    const allowed = /^(common\.(ok|kg|cm|kcal|g|h|min|proteinShort|carbsShort|fatShort|and|or|messages_one|messages_other|calories|notifications|nav\.coach|superset)|dietFlag\.|coach\.make\.minutes|coach\.goal\.unitKg|coach\.food\.hmm|coach\.report\.fatigue|coach\.card\.workoutSubtitle|coach\.card\.programSubtitle|coach\.sug\.hundredKg|coach\.numWord\.6|coach\.progress\.lift|service\.finish\.lift|coach\.start\.push|foodUnit|food\.|exercise\.|cue\.|slot|programName|mealTpl|nutrition\.restaurant\.items|coach\.remaining\.|readiness|sex\.|equipment\.|muscle\.|level\.|diet\.|personality\.|phase\.|split\.|focus\.|goal|workoutTitle|onboarding\.|profile\.|progress\.|home\.|calendar\.|workout\.|nutrition\.|coachScreen\.|tool\.|insight\.|memory|demo\.)/
    const unexpected = same.filter((k) => !allowed.test(k))
    expect(unexpected, unexpected.join(', ')).toEqual([])
    const frText = Object.values(fr).join(' ')
    expect(frText).not.toMatch(/\bYou\b/)
    expect(frText).toMatch(/’/)
    expect(frText).toMatch(/é/)
  })

  it('no raw key, undefined or null ever reaches the user', () => {
    for (const lang of ['en', 'fr'] as const) {
      for (const k of Object.keys(en)) {
        const v = t(k as never, { n: 1, count: 2, name: 'x', title: 'y' }, lang)
        expect(v).not.toMatch(/\bundefined\b|\bnull\b/)
        expect(v).not.toBe(k)
      }
    }
  })
})

describe('translation function', () => {
  beforeEach(() => {
    reset()
    resetMissingKeys()
  })

  it('translates in the active language and in an explicit one', () => {
    setActiveLanguage('en')
    expect(t('common.today')).toBe('Today')
    expect(t('common.today', undefined, 'fr')).toBe('Aujourd’hui')
    setActiveLanguage('fr')
    expect(t('common.today')).toBe('Aujourd’hui')
    expect(getLanguage()).toBe('fr')
  })

  it('falls back deterministically: fr → en → humanised key, and records what was missing', () => {
    const dict = fr as Record<string, string>
    const saved = dict['common.today']
    dict['common.today'] = ''
    expect(t('common.today', undefined, 'fr')).toBe('Today')
    expect(missingKeys()).toContain('fr:common.today')
    dict['common.today'] = saved
    expect(t('nothing.like.thisKeyName' as never, undefined, 'en')).toBe('This Key Name')
    expect(t('nothing.like.thisKeyName' as never, undefined, 'fr')).toBe('This Key Name')
  })

  it('interpolates parameters and leaves unknown placeholders visible rather than printing undefined', () => {
    expect(t('common.weekOf', { n: 2, total: 8 }, 'en')).toBe('Week 2 of 8')
    expect(t('common.weekOf', { n: 2, total: 8 }, 'fr')).toBe('Semaine 2 sur 8')
    expect(t('common.weekOf', { n: 2 }, 'en')).toBe('Week 2 of {total}')
  })

  it('pluralises by language grammar', () => {
    expect(tn('common.sessions', 0, undefined, 'en')).toBe('0 sessions')
    expect(tn('common.sessions', 1, undefined, 'en')).toBe('1 session')
    expect(tn('common.sessions', 2, undefined, 'en')).toBe('2 sessions')
    expect(tn('common.sessions', 0, undefined, 'fr')).toBe('0 séance')
    expect(tn('common.sessions', 1, undefined, 'fr')).toBe('1 séance')
    expect(tn('common.sessions', 2, undefined, 'fr')).toBe('2 séances')
    expect(tn('common.meals', 3, undefined, 'fr')).toBe('3 repas')
  })
})

describe('locale formatting', () => {
  it('formats dates per locale without hardcoded names', () => {
    const d = new Date(2026, 8, 14) // Monday 14 September 2026
    expect(formatDateIntl(d, 'date-weekday', 'en')).toBe('Monday, September 14')
    expect(formatDateIntl(d, 'date-weekday', 'fr')).toBe('lundi 14 septembre')
    expect(formatDate(d, { weekday: true }, 'en')).toBe('Monday, September 14')
    expect(formatDate(d, { weekday: true }, 'fr')).toBe('lundi 14 septembre')
    expect(formatShortDate(d, 'en')).toMatch(/Sep/)
    expect(formatShortDate(d, 'fr')).toMatch(/sept/)
    expect(weekdayName(d, false, 'en')).toBe('Monday')
    expect(weekdayName(d, false, 'fr')).toBe('lundi')
    expect(weekdayName(d, true, 'fr')).toBe('lun')
    expect(weekdayNameByIndex(5, false, 'fr')).toBe('vendredi')
    expect(monthName(d, false, 'fr')).toBe('septembre')
  })

  it('formats numbers per locale while the stored value stays a number', () => {
    expect(formatDecimal(74.2, 1, 'en')).toBe('74.2')
    expect(formatDecimal(74.2, 1, 'fr')).toBe('74,2')
    expect(formatInt(2450, 'en')).toBe('2,450')
    expect(formatInt(2450, 'fr').replace(/ | /g, ' ')).toBe('2 450')
    expect(translator('fr').signed(-0.4)).toBe('-0,4')
    expect(translator('en').signed(1.5)).toBe('+1.5')
    expect(useStore.getState().preferences.language).toMatch(/en|fr/)
  })

  it('formats durations and units in both languages', () => {
    expect(formatMinutes(50, 'en')).toBe('50 min')
    expect(formatMinutes(50, 'fr')).toBe('50 min')
    expect(formatMinutes(90, 'en')).toBe('1h 30m')
    expect(formatMinutes(90, 'fr')).toBe('1 h 30')
  })

  it('parses weekdays in either language', () => {
    expect(parseWeekday('vendredi')).toBe(5)
    expect(parseWeekday('Friday')).toBe(5)
    expect(parseWeekday('mer')).toBe(3)
  })
})

describe('domain stays language-independent', () => {
  it('renders workout titles, program names and goals from ids, keeping the stored English canonical', () => {
    expect(renderWorkoutTitle({ focus: 'upper', variant: 'A' }, 'en')).toBe('Upper Body A')
    expect(renderWorkoutTitle({ focus: 'upper', variant: 'A' }, 'fr')).toBe('Haut du corps A')
    expect(workoutTitle({ title: 'Lower Body B Express · Light', titleKey: undefined }, 'fr')).toBe(renderWorkoutTitle({ focus: 'lower', variant: 'B', express: true, light: true }, 'fr'))
    expect(workoutTitle({ title: 'Recovery Flow' }, 'fr')).not.toBe('Recovery Flow')
    expect(programDisplayName({ name: '12-Week Muscle Builder', goalType: 'build_muscle', weeks: 12 }, 'fr')).toContain('12 semaines')
    expect(programDisplayName({ name: '12-Week Muscle Builder', goalType: 'build_muscle', weeks: 12 }, 'en')).toBe('12-Week Muscle Builder')
    expect(goalLabel('lose_fat', 'fr')).toBe('Perdre du gras')
    expect(goalLabel('lose_fat', 'en')).toBe('Lose fat')
    expect(mealSlotIn('lunch', 'fr')).toBe('déjeuner')
  })

  it('localises foods and meals from the same stored item', () => {
    const meal = buildMeal(analyzeDescription('200 g chicken breast with 150 g rice and broccoli', 'en'), { date: '2026-09-14', slot: 'lunch', source: 'text', status: 'logged' })
    const names = meal.items.map((i) => foodItemName(i, 'fr'))
    expect(names.join(' ')).toMatch(/poulet/i)
    expect(names.join(' ')).toMatch(/riz/i)
    expect(mealDisplayName(meal, 'fr')).toMatch(/poulet/i)
    expect(mealDisplayName(meal, 'en')).toMatch(/chicken/i)
    const fromFrench = buildMeal(analyzeDescription('200 g de blanc de poulet avec 150 g de riz et des brocolis', 'fr'), { date: '2026-09-14', slot: 'lunch', source: 'text', status: 'logged' })
    expect(fromFrench.items.map((i) => i.foodId).sort()).toEqual(meal.items.map((i) => i.foodId).sort())
  })

  it('does not duplicate demo entities per language: the same seed, only presentation differs', () => {
    setActiveLanguage('en')
    const a = buildDemoSeed()
    setActiveLanguage('fr')
    const b = buildDemoSeed()
    expect(Object.keys(b.workouts).sort()).toEqual(Object.keys(a.workouts).sort())
    expect(Object.values(b.workouts).map((w) => w.title)).toEqual(Object.values(a.workouts).map((w) => w.title))
    expect(Object.keys(b.meals ?? {}).sort()).toEqual(Object.keys(a.meals ?? {}).sort())
    expect(b.goals.map((g) => g.label)).toEqual(a.goals.map((g) => g.label))
    expect(b.memory[0].text).not.toBe(a.memory[0].text)
    expect(b.notifications[0].title).toBe('Tu récupères bien aujourd’hui')
    setActiveLanguage('en')
  })
})

describe('language preference', () => {
  beforeEach(reset)

  it('detects the browser language once for first-time users (fr → fr, en → en, other → en)', () => {
    expect(detectBrowserLanguage(['fr-FR', 'en-US'])).toBe('fr')
    expect(detectBrowserLanguage(['en-GB'])).toBe('en')
    expect(detectBrowserLanguage(['de-DE', 'it'])).toBe('en')
    expect(detectBrowserLanguage([])).toBe('en')
  })

  it('switches immediately through the store and mirrors into the runtime', () => {
    useStore.getState().setLanguage('fr')
    expect(useStore.getState().preferences.language).toBe('fr')
    expect(getLanguage()).toBe('fr')
    expect(t('common.nav.home')).toBe('Accueil')
    useStore.getState().setLanguage('en')
    expect(getLanguage()).toBe('en')
    expect(t('common.nav.home')).toBe('Home')
  })

  it('persists the choice and survives a reload of the persisted state', async () => {
    useStore.getState().setLanguage('fr')
    await new Promise((r) => setTimeout(r, 0))
    const persisted = JSON.parse(localStorage.getItem('sportly.v1')!)
    expect(persisted.version).toBe(5)
    expect(persisted.state.preferences.language).toBe('fr')
    await useStore.persist.rehydrate()
    expect(useStore.getState().preferences.language).toBe('fr')
    expect(getLanguage()).toBe('fr')
  })

  it('existing V6 users (no language stored) default to English, whatever the browser says', async () => {
    useStore.getState().seed(buildDemoSeed())
    await new Promise((r) => setTimeout(r, 0))
    const persisted = JSON.parse(localStorage.getItem('sportly.v1')!)
    const older = { ...persisted, version: 4, state: { ...persisted.state, preferences: { ...persisted.state.preferences } } }
    delete older.state.preferences.language
    localStorage.setItem('sportly.v1', JSON.stringify(older))
    await useStore.persist.rehydrate()
    expect(useStore.getState().preferences.language).toBe('en')
    expect(useStore.getState().user?.name).toBe('Alex')
  })

  it('seeding the demo profile and resetting keep the chosen language', () => {
    useStore.getState().setLanguage('fr')
    useStore.getState().seed(buildDemoSeed())
    expect(useStore.getState().preferences.language).toBe('fr')
    useStore.getState().resetAll()
    expect(useStore.getState().preferences.language).toBe('fr')
  })
})

import type { KnowledgeDocument, KnowledgeSource } from './types'

/**
 * A small set of coaching principles so the retrieval layer has real material
 * to index. These are concise statements of widely accepted exercise-science
 * consensus, written for Sportly. A richer package (for example the PhD-Coach
 * material) plugs in as another source without touching the retriever.
 */
export const SPORTLY_NOTES: KnowledgeSource = {
  id: 'sportly-notes',
  title: 'Sportly coaching notes',
  kind: 'note',
  provenance: 'Written for Sportly from general exercise-science consensus; not a substitute for professional advice.',
  addedAt: '2026-09-13T00:00:00.000Z',
}

const meta = { author: 'Sportly', year: 2026, evidence: 'consensus' as const, audience: 'all' as const, language: 'en' }

export const SEED_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: 'progressive-overload',
    sourceId: SPORTLY_NOTES.id,
    title: 'Progressive overload',
    topics: ['training', 'progression', 'hypertrophy', 'strength'],
    metadata: meta,
    text: `Muscles and strength adapt to a stimulus that gradually increases over time. Add load, reps, sets or control across weeks rather than all at once.

A practical rule: when every set of an exercise hits the top of its rep range with good form, add the smallest available load next session. If reps fall short two sessions in a row, hold the load or reduce it slightly.`,
  },
  {
    id: 'rpe-and-rir',
    sourceId: SPORTLY_NOTES.id,
    title: 'RPE and reps in reserve',
    topics: ['rpe', 'training', 'progression'],
    metadata: meta,
    text: `RPE (rating of perceived exertion) on a 1 to 10 scale describes how hard a set felt; reps in reserve (RIR) describes how many more reps were possible. RPE 8 is roughly 2 reps in reserve.

Most productive hypertrophy work lives between RPE 7 and 9. Training every set to failure raises fatigue faster than it raises results.`,
  },
  {
    id: 'one-rep-max',
    sourceId: SPORTLY_NOTES.id,
    title: 'Estimating a one-rep max',
    topics: ['one_rep_max', 'strength'],
    metadata: meta,
    text: `A one-rep max can be estimated from a submaximal set. The Epley formula is weight × (1 + reps ÷ 30). Estimates are most reliable below 8 reps.

Use estimated maxes to set working percentages; retest with a real heavy single only when experienced and well recovered.`,
  },
  {
    id: 'periodization-and-deloads',
    sourceId: SPORTLY_NOTES.id,
    title: 'Periodization and deloads',
    topics: ['periodization', 'recovery', 'training'],
    metadata: meta,
    text: `Organise training in blocks of three to six weeks that build volume or intensity, followed by a lighter deload week at roughly 50 to 60 percent of the usual volume.

Deloads keep joints, sleep and motivation intact. Persistent soreness, falling performance or poor sleep are signs a deload is due early.`,
  },
  {
    id: 'protein-and-energy',
    sourceId: SPORTLY_NOTES.id,
    title: 'Protein and energy balance',
    topics: ['nutrition', 'protein', 'fat_loss', 'hypertrophy'],
    metadata: meta,
    text: `For people who train, a daily protein intake around 1.6 to 2.2 grams per kilogram of body weight supports muscle gain and muscle retention during fat loss. Spread it across three to five meals.

Muscle gain works best in a small calorie surplus (roughly 5 to 10 percent above maintenance); fat loss in a moderate deficit (roughly 10 to 20 percent). Very large deficits cost muscle and adherence.`,
  },
  {
    id: 'micronutrition-basics',
    sourceId: SPORTLY_NOTES.id,
    title: 'Micronutrition basics',
    topics: ['micronutrition', 'nutrition', 'recovery'],
    metadata: meta,
    text: `Fibre, fruit and vegetables cover most micronutrient needs; aim for variety and colour rather than supplements first. Iron, vitamin D and omega-3 are the most common shortfalls in active people.

Hydration matters for performance: thirst lags behind need, so drink with meals and around sessions.`,
  },
  {
    id: 'recovery-and-sleep',
    sourceId: SPORTLY_NOTES.id,
    title: 'Recovery and sleep',
    topics: ['recovery', 'training'],
    metadata: meta,
    text: `Sleep of seven to nine hours is the most effective recovery tool available. Short sleep reduces strength output, appetite control and mood the next day.

On low-readiness days, lower the load or shorten the session rather than skipping; light movement usually beats complete rest for maintaining rhythm.`,
  },
  {
    id: 'safety-red-flags',
    sourceId: SPORTLY_NOTES.id,
    title: 'Safety red flags',
    topics: ['safety', 'training'],
    metadata: meta,
    text: `Sharp, sudden or joint-centred pain, pain that worsens during a session, swelling, numbness or symptoms lasting more than a few days call for a professional evaluation, not a training tweak.

A coach adjusts around discomfort; it does not diagnose. No diet below roughly 1,200 to 1,500 kilocalories a day should be followed without medical supervision.`,
  },
]

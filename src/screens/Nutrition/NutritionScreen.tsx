import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { ensureTodayNutrition, selectTodayNutrition, selectTodayWorkout } from '@/coach/coachService'
import { generateNutritionPlan, goalNutritionSummary, macroSplit } from '@/coach/nutritionGenerator'
import { primaryGoal } from '@/coach/workoutGenerator'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Chip, Tag } from '@/components/ui/Chip'
import { CoachMark } from '@/components/ui/Primitives'
import { GOAL_LABELS, MEAL_SLOT_LABELS } from '@/domain/labels'
import { todayKey } from '@/lib/dates'
import { useStore } from '@/store/useStore'

export function NutritionScreen() {
  const navigate = useNavigate()
  const plan = useStore((s) => selectTodayNutrition(s))
  const todayWorkout = useStore((s) => selectTodayWorkout(s))
  const user = useStore((s) => s.user)!
  const goals = useStore((s) => s.goals)
  const coachName = useStore((s) => s.coach.name)
  const upsert = useStore((s) => s.upsertNutritionPlan)

  useEffect(() => {
    if (!plan) ensureTodayNutrition()
  }, [plan])

  const split = useMemo(() => (plan ? macroSplit(plan) : { p: 0.3, c: 0.45, f: 0.25 }), [plan])
  const ask = (prompt: string) => navigate(`/coach?prompt=${encodeURIComponent(prompt)}`)
  const goal = primaryGoal(goals)

  const regenerate = () => {
    const fresh = generateNutritionPlan({ user, goals, isTrainingDay: Boolean(todayWorkout && todayWorkout.status !== 'skipped'), restaurantDinner: plan?.meals.some((m) => m.isRestaurant), seed: `${todayKey()}-${Date.now()}` })
    upsert(fresh)
  }

  if (!plan) return <Page title="Nutrition" back="/">{null}</Page>

  return (
    <Page back="/" title="Nutrition" eyebrow="Today" right={<Button size="icon-sm" variant="ghost" aria-label="Different meals" onClick={regenerate}><RefreshCw size={17} /></Button>}>
      <Card padding="lg" tone="elevated" className="mt-2">
        <div className="flex items-center gap-2 mb-2">
          <Tag tone={plan.isTrainingDay ? 'accent' : 'default'}>{plan.isTrainingDay ? 'Training day' : 'Rest day'}</Tag>
          <span className="text-[12px] text-text-3">{GOAL_LABELS[goal]} · {goalNutritionSummary(goal)}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="display text-[40px] tabular">{plan.calories.toLocaleString()}</span>
          <span className="text-[14px] text-text-2">kcal</span>
        </div>
        <div className="mt-4 flex h-2 rounded-full overflow-hidden">
          <div className="bg-accent" style={{ width: `${split.p * 100}%` }} />
          <div className="bg-text-2" style={{ width: `${split.c * 100}%` }} />
          <div className="bg-text-4" style={{ width: `${split.f * 100}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <MacroStat label="Protein" grams={plan.proteinG} pct={split.p} swatch="bg-accent" />
          <MacroStat label="Carbs" grams={plan.carbsG} pct={split.c} swatch="bg-text-2" />
          <MacroStat label="Fat" grams={plan.fatG} pct={split.f} swatch="bg-text-4" />
        </div>
      </Card>

      <div className="flex gap-3 rounded-[18px] bg-surface border border-border p-4 mt-3">
        <CoachMark size={20} className="mt-0.5" />
        <div className="text-[14px] text-text-2 leading-relaxed">
          <p>{plan.rationale}</p>
          {plan.adjustments?.map((a) => (
            <p key={a} className="mt-1.5 text-accent-text">
              {a}
            </p>
          ))}
        </div>
      </div>

      <SectionLabel className="mt-6">Meals</SectionLabel>
      <div className="space-y-2.5">
        {plan.meals.map((m) => (
          <Card key={m.id} padding="sm" tone={m.isRestaurant ? 'accent' : 'default'}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-text-3">{MEAL_SLOT_LABELS[m.slot]}</div>
                <div className="text-[16px] font-semibold mt-0.5">{m.name}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[15px] font-semibold tabular">{m.calories}</div>
                <div className="text-[11px] text-text-3">kcal</div>
              </div>
            </div>
            <ul className="mt-2 space-y-0.5">
              {m.items.map((i) => (
                <li key={i} className="text-[14px] text-text-2 flex gap-2">
                  <span className="text-text-4">·</span>
                  {i}
                </li>
              ))}
            </ul>
            <div className="flex gap-3 mt-2.5 text-[12px] text-text-3 tabular">
              <span>P {m.proteinG} g</span>
              <span>C {m.carbsG} g</span>
              <span>F {m.fatG} g</span>
            </div>
            {m.note && <div className="text-[12.5px] text-text-3 italic mt-2">{m.note}</div>}
          </Card>
        ))}
      </div>

      <SectionLabel className="mt-6">Adjust with {coachName}</SectionLabel>
      <div className="flex flex-wrap gap-2 pb-4">
        <Chip onClick={() => ask("I'm eating at a restaurant tonight")}>Eating out tonight</Chip>
        <Chip onClick={() => ask('Make it lower carb')}>Lower carb</Chip>
        <Chip onClick={() => ask('What should I eat for dinner?')}>Dinner ideas</Chip>
        <Chip onClick={() => ask('I struggle to hit protein, help')}>More protein</Chip>
      </div>
    </Page>
  )
}

function MacroStat({ label, grams, pct, swatch }: { label: string; grams: number; pct: number; swatch: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11.5px] text-text-3">
        <span className={`h-2 w-2 rounded-full ${swatch}`} />
        {label}
      </div>
      <div className="text-[18px] font-semibold tabular title">{grams} g</div>
      <div className="text-[11px] text-text-3">{Math.round(pct * 100)}%</div>
    </div>
  )
}

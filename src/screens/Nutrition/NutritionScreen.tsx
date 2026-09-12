import { Camera, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ensureTodayNutrition, selectTodayNutrition, selectTodayWorkout } from '@/coach/coachService'
import { confidenceLabel } from '@/coach/food/foodAnalysis'
import { generateNutritionPlan, goalNutritionSummary, macroSplit } from '@/coach/nutritionGenerator'
import { primaryGoal } from '@/coach/workoutGenerator'
import { Page } from '@/components/layout/Page'
import { MealEditSheet } from '@/components/nutrition/MealEditSheet'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Chip, Tag } from '@/components/ui/Chip'
import { CoachMark, ProgressBar } from '@/components/ui/Primitives'
import { GOAL_LABELS, MEAL_SLOT_LABELS } from '@/domain/labels'
import { formatTime, todayKey } from '@/lib/dates'
import { selectDailyNutrition } from '@/store/selectors'
import { useStore } from '@/store/useStore'

export function NutritionScreen() {
  const navigate = useNavigate()
  const plan = useStore((s) => selectTodayNutrition(s))
  const todayWorkout = useStore((s) => selectTodayWorkout(s))
  const user = useStore((s) => s.user)!
  const goals = useStore((s) => s.goals)
  const coachName = useStore((s) => s.coach.name)
  const upsert = useStore((s) => s.upsertNutritionPlan)
  const meals = useStore((s) => s.meals)
  const nutritionPlans = useStore((s) => s.nutritionPlans)
  const workouts = useStore((s) => s.workouts)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    if (!plan) ensureTodayNutrition()
  }, [plan])

  const daily = useMemo(() => selectDailyNutrition({ meals, nutritionPlans, workouts, user, goals }), [meals, nutritionPlans, workouts, user, goals])
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

      <SectionLabel className="mt-6" right={<span className="text-[12px] text-text-3 tabular">{daily.consumed.calories.toLocaleString()} / {daily.targets.calories.toLocaleString()} kcal</span>}>
        Eaten today
      </SectionLabel>
      <Card padding="md" data-testid="eaten-today">
        <div className="space-y-2.5">
          <IntakeRow label="Calories" value={daily.consumed.calories} target={daily.targets.calories} unit="kcal" />
          <IntakeRow label="Protein" value={daily.consumed.proteinG} target={daily.targets.proteinG} unit="g" />
          <IntakeRow label="Carbs" value={daily.consumed.carbsG} target={daily.targets.carbsG} unit="g" tone="text" />
          <IntakeRow label="Fat" value={daily.consumed.fatG} target={daily.targets.fatG} unit="g" tone="text" />
        </div>
        {daily.meals.length ? (
          <ul className="mt-4 divide-y divide-border">
            {daily.meals.map((m) => (
              <li key={m.id}>
                <button onClick={() => setEditing(m.id)} className="w-full flex items-center gap-3 py-2.5 text-left" data-testid="logged-meal">
                  {m.previewDataUrl ? <img src={m.previewDataUrl} alt="" className="h-10 w-10 rounded-[10px] object-cover border border-border shrink-0" /> : <span className="h-10 w-10 rounded-[10px] bg-surface-2 text-text-3 flex items-center justify-center shrink-0 text-[11px] font-semibold uppercase">{MEAL_SLOT_LABELS[m.slot].slice(0, 2)}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-[14.5px] font-medium truncate">{m.name}</div>
                    <div className="text-[12px] text-text-3">
                      {MEAL_SLOT_LABELS[m.slot]} · {formatTime(m.createdAt)}
                      {confidenceLabel(m.confidence) === 'low' ? ' · rough estimate' : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular">
                    <div className="text-[14px] font-semibold">{m.calories}</div>
                    <div className="text-[11px] text-text-3">{m.proteinG} g P</div>
                  </div>
                  <ChevronRight size={15} className="text-text-4 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-text-3 mt-3">Nothing logged yet. Tell {coachName} what you ate or send a photo.</p>
        )}
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="secondary" full icon={<Plus size={14} />} onClick={() => navigate('/coach?prefill=I%20ate%20')}>
            Log a meal
          </Button>
          <Button size="sm" variant="secondary" full icon={<Camera size={14} />} onClick={() => navigate('/coach?prefill=I%20ate%20this')}>
            Photo
          </Button>
        </div>
      </Card>
      <MealEditSheet mealId={editing} onClose={() => setEditing(null)} />

      <SectionLabel className="mt-6">Planned meals</SectionLabel>
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
        <Chip onClick={() => ask('How much protein do I have left?')}>What’s left today?</Chip>
        <Chip onClick={() => ask('I struggle to hit protein, help')}>More protein</Chip>
      </div>
    </Page>
  )
}

function IntakeRow({ label, value, target, unit, tone = 'accent' }: { label: string; value: number; target: number; unit: string; tone?: 'accent' | 'text' }) {
  const left = target - value
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-text-2">{label}</span>
        <span className="tabular">
          <span className="font-semibold">{value.toLocaleString()}</span>
          <span className="text-text-3"> / {target.toLocaleString()} {unit}</span>
          <span className={left >= 0 ? 'text-text-3' : 'text-warn'}> · {left >= 0 ? `${left.toLocaleString()} left` : `${Math.abs(left).toLocaleString()} over`}</span>
        </span>
      </div>
      <ProgressBar value={target ? Math.min(1, value / target) : 0} className="mt-1.5" height={4} tone={left < 0 ? 'warn' : tone} />
    </div>
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

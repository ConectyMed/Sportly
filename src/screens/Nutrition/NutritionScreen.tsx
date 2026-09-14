import { Camera, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ensureTodayNutrition, selectTodayNutrition, selectTodayWorkout } from '@/coach/coachService'
import { confidenceLabel, mealDisplayName } from '@/coach/food/foodAnalysis'
import { generateNutritionPlan, macroSplit } from '@/coach/nutritionGenerator'
import { primaryGoal } from '@/coach/workoutGenerator'
import { Page } from '@/components/layout/Page'
import { MealEditSheet } from '@/components/nutrition/MealEditSheet'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Chip, Tag } from '@/components/ui/Chip'
import { CoachMark, ProgressBar } from '@/components/ui/Primitives'
import { goalLabel, goalNutritionSummary, mealNote, mealSlotLabel, mealTemplateItems, mealTemplateName, nutritionAdjustments, nutritionRationale } from '@/domain/labels'
import { useT } from '@/i18n/react'
import { formatTime, todayKey } from '@/lib/dates'
import { selectDailyNutrition } from '@/store/selectors'
import { useStore } from '@/store/useStore'

export function NutritionScreen() {
  const navigate = useNavigate()
  const tr = useT()
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
  const kcal = tr.t('common.kcal')
  const g = tr.t('common.g')

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

  if (!plan) return <Page title={tr.t('nutrition.title')} back="/">{null}</Page>

  return (
    <Page back="/" title={tr.t('nutrition.title')} eyebrow={tr.t('common.today')} right={<Button size="icon-sm" variant="ghost" aria-label={tr.t('nutrition.differentMeals')} onClick={regenerate}><RefreshCw size={17} /></Button>}>
      <Card padding="lg" tone="elevated" className="mt-2">
        <div className="flex items-center gap-2 mb-2">
          <Tag tone={plan.isTrainingDay ? 'accent' : 'default'}>{plan.isTrainingDay ? tr.t('nutrition.trainingDay') : tr.t('nutrition.restDay')}</Tag>
          <span className="text-[12px] text-text-3">{goalLabel(goal)} · {goalNutritionSummary(goal)}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="display text-[40px] tabular">{tr.int(plan.calories)}</span>
          <span className="text-[14px] text-text-2">{kcal}</span>
        </div>
        <div className="mt-4 flex h-2 rounded-full overflow-hidden">
          <div className="bg-accent" style={{ width: `${split.p * 100}%` }} />
          <div className="bg-text-2" style={{ width: `${split.c * 100}%` }} />
          <div className="bg-text-4" style={{ width: `${split.f * 100}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <MacroStat label={tr.t('common.protein')} grams={plan.proteinG} pct={split.p} swatch="bg-accent" />
          <MacroStat label={tr.t('common.carbs')} grams={plan.carbsG} pct={split.c} swatch="bg-text-2" />
          <MacroStat label={tr.t('common.fat')} grams={plan.fatG} pct={split.f} swatch="bg-text-4" />
        </div>
      </Card>

      <div className="flex gap-3 rounded-[18px] bg-surface border border-border p-4 mt-3">
        <CoachMark size={20} className="mt-0.5" />
        <div className="text-[14px] text-text-2 leading-relaxed">
          <p>{nutritionRationale(plan)}</p>
          {nutritionAdjustments(plan).map((a) => (
            <p key={a} className="mt-1.5 text-accent-text">
              {a}
            </p>
          ))}
        </div>
      </div>

      <SectionLabel className="mt-6" right={<span className="text-[12px] text-text-3 tabular">{tr.int(daily.consumed.calories)} / {tr.int(daily.targets.calories)} {kcal}</span>}>
        {tr.t('nutrition.eatenToday')}
      </SectionLabel>
      <Card padding="md" data-testid="eaten-today">
        <div className="space-y-2.5">
          <IntakeRow label={tr.t('common.calories')} value={daily.consumed.calories} target={daily.targets.calories} unit={kcal} />
          <IntakeRow label={tr.t('common.protein')} value={daily.consumed.proteinG} target={daily.targets.proteinG} unit={g} />
          <IntakeRow label={tr.t('common.carbs')} value={daily.consumed.carbsG} target={daily.targets.carbsG} unit={g} tone="text" />
          <IntakeRow label={tr.t('common.fat')} value={daily.consumed.fatG} target={daily.targets.fatG} unit={g} tone="text" />
        </div>
        {daily.meals.length ? (
          <ul className="mt-4 divide-y divide-border">
            {daily.meals.map((m) => (
              <li key={m.id}>
                <button onClick={() => setEditing(m.id)} className="w-full flex items-center gap-3 py-2.5 text-left" data-testid="logged-meal">
                  {m.previewDataUrl ? <img src={m.previewDataUrl} alt="" className="h-10 w-10 rounded-[10px] object-cover border border-border shrink-0" /> : <span className="h-10 w-10 rounded-[10px] bg-surface-2 text-text-3 flex items-center justify-center shrink-0 text-[11px] font-semibold uppercase">{mealSlotLabel(m.slot).slice(0, 2)}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-[14.5px] font-medium truncate">{mealDisplayName(m, tr.lang)}</div>
                    <div className="text-[12px] text-text-3">
                      {mealSlotLabel(m.slot)} · {formatTime(m.createdAt)}
                      {confidenceLabel(m.confidence) === 'low' ? ` · ${tr.t('common.roughEstimate')}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular">
                    <div className="text-[14px] font-semibold">{tr.int(m.calories)}</div>
                    <div className="text-[11px] text-text-3">{m.proteinG} {g} {tr.t('common.proteinShort')}</div>
                  </div>
                  <ChevronRight size={15} className="text-text-4 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-text-3 mt-3">{tr.t('nutrition.nothingLogged', { name: coachName })}</p>
        )}
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="secondary" full icon={<Plus size={14} />} onClick={() => navigate('/coach?prefill=' + encodeURIComponent(tr.t('nutrition.prefillAte')))}>
            {tr.t('nutrition.logMeal')}
          </Button>
          <Button size="sm" variant="secondary" full icon={<Camera size={14} />} onClick={() => navigate('/coach?prefill=' + encodeURIComponent(tr.t('nutrition.prefillAteThis')))}>
            {tr.t('nutrition.photo')}
          </Button>
        </div>
      </Card>
      <MealEditSheet mealId={editing} onClose={() => setEditing(null)} />

      <SectionLabel className="mt-6">{tr.t('nutrition.plannedMeals')}</SectionLabel>
      <div className="space-y-2.5">
        {plan.meals.map((m) => {
          const note = mealNote(m)
          return (
            <Card key={m.id} padding="sm" tone={m.isRestaurant ? 'accent' : 'default'}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-text-3">{mealSlotLabel(m.slot)}</div>
                  <div className="text-[16px] font-semibold mt-0.5">{mealTemplateName(m.templateId, m.name)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[15px] font-semibold tabular">{tr.int(m.calories)}</div>
                  <div className="text-[11px] text-text-3">{kcal}</div>
                </div>
              </div>
              <ul className="mt-2 space-y-0.5">
                {mealTemplateItems(m.templateId, m.items).map((i) => (
                  <li key={i} className="text-[14px] text-text-2 flex gap-2">
                    <span className="text-text-4">·</span>
                    {i}
                  </li>
                ))}
              </ul>
              <div className="flex gap-3 mt-2.5 text-[12px] text-text-3 tabular">
                <span>{tr.t('common.proteinShort')} {m.proteinG} {g}</span>
                <span>{tr.t('common.carbsShort')} {m.carbsG} {g}</span>
                <span>{tr.t('common.fatShort')} {m.fatG} {g}</span>
              </div>
              {note && <div className="text-[12.5px] text-text-3 italic mt-2">{note}</div>}
            </Card>
          )
        })}
      </div>

      <SectionLabel className="mt-6">{tr.t('nutrition.adjustWith', { name: coachName })}</SectionLabel>
      <div className="flex flex-wrap gap-2 pb-4">
        <Chip onClick={() => ask(tr.t('nutrition.promptEatingOut'))}>{tr.t('nutrition.chipEatingOut')}</Chip>
        <Chip onClick={() => ask(tr.t('nutrition.promptLowerCarb'))}>{tr.t('nutrition.chipLowerCarb')}</Chip>
        <Chip onClick={() => ask(tr.t('nutrition.promptDinner'))}>{tr.t('nutrition.chipDinner')}</Chip>
        <Chip onClick={() => ask(tr.t('nutrition.promptWhatsLeft'))}>{tr.t('nutrition.chipWhatsLeft')}</Chip>
        <Chip onClick={() => ask(tr.t('nutrition.promptMoreProtein'))}>{tr.t('nutrition.chipMoreProtein')}</Chip>
      </div>
    </Page>
  )
}

function IntakeRow({ label, value, target, unit, tone = 'accent' }: { label: string; value: number; target: number; unit: string; tone?: 'accent' | 'text' }) {
  const tr = useT()
  const left = target - value
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-text-2">{label}</span>
        <span className="tabular">
          <span className="font-semibold">{tr.int(value)}</span>
          <span className="text-text-3"> / {tr.int(target)} {unit}</span>
          <span className={left >= 0 ? 'text-text-3' : 'text-warn'}> · {left >= 0 ? tr.t('common.left', { n: tr.int(left) }) : tr.t('common.over', { n: tr.int(Math.abs(left)) })}</span>
        </span>
      </div>
      <ProgressBar value={target ? Math.min(1, value / target) : 0} className="mt-1.5" height={4} tone={left < 0 ? 'warn' : tone} />
    </div>
  )
}

function MacroStat({ label, grams, pct, swatch }: { label: string; grams: number; pct: number; swatch: string }) {
  const tr = useT()
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11.5px] text-text-3">
        <span className={`h-2 w-2 rounded-full ${swatch}`} />
        {label}
      </div>
      <div className="text-[18px] font-semibold tabular title">{grams} {tr.t('common.g')}</div>
      <div className="text-[11px] text-text-3">{Math.round(pct * 100)}%</div>
    </div>
  )
}

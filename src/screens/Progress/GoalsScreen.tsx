import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { goalProgress } from '@/coach/insights'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Chip, Tag } from '@/components/ui/Chip'
import { EmptyState, ProgressBar, Stepper } from '@/components/ui/Primitives'
import { Sheet } from '@/components/ui/Sheet'
import { GOAL_TYPES, goalDescription, goalLabel, goalMetricLabel } from '@/domain/labels'
import type { Goal, GoalType } from '@/domain/types'
import type { MessageKey } from '@/i18n'
import { useT } from '@/i18n/react'
import { uid } from '@/lib/utils'
import { userAction } from '@/coach/userActions'
import { useStore } from '@/store/useStore'

/** `unit` is the stored canonical unit; `unitKey` is how it is shown. */
const METRICS: Array<{ v: NonNullable<Goal['metric']>; unit: string; unitKey: MessageKey; step: number; min: number; max: number }> = [
  { v: 'body_weight', unit: 'kg', unitKey: 'common.kg', step: 0.5, min: 35, max: 250 },
  { v: 'bench_press', unit: 'kg', unitKey: 'common.kg', step: 2.5, min: 20, max: 300 },
  { v: 'squat', unit: 'kg', unitKey: 'common.kg', step: 2.5, min: 20, max: 400 },
  { v: 'deadlift', unit: 'kg', unitKey: 'common.kg', step: 2.5, min: 20, max: 400 },
  { v: 'workouts_per_week', unit: '/week', unitKey: 'common.perWeek', step: 1, min: 1, max: 7 },
  { v: 'steps_per_day', unit: 'steps', unitKey: 'common.steps', step: 500, min: 2000, max: 30000 },
]

export function GoalsScreen() {
  const navigate = useNavigate()
  const tr = useT()
  const goals = useStore((s) => s.goals)
  const user = useStore((s) => s.user)!
  const measurements = useStore((s) => s.measurements)
  const workoutsMap = useStore((s) => s.workouts)
  const upsertGoal = (goal: Goal) => userAction({ type: 'set_goal', goal })
  const removeGoal = (goalId: string) => userAction({ type: 'delete_goal', goalId })
  const addMemory = (item: { category: 'goal'; text: string; source: 'user' }) => userAction({ type: 'remember', item })
  const coachName = useStore((s) => s.coach.name)
  const workouts = useMemo(() => Object.values(workoutsMap), [workoutsMap])
  const [editing, setEditing] = useState<Goal | null>(null)
  const [draft, setDraft] = useState<{ type: GoalType; rank: Goal['rank']; metric?: Goal['metric']; target: number }>({ type: 'build_muscle', rank: 'primary', target: user.weightKg })

  const open = (g?: Goal) => {
    if (g) {
      setEditing(g)
      setDraft({ type: g.type, rank: g.rank, metric: g.metric, target: g.targetValue ?? user.weightKg })
    } else {
      setEditing({ id: '', type: 'build_muscle', rank: goals.some((x) => x.rank === 'primary') ? 'secondary' : 'primary', label: '', createdAt: '' })
      setDraft({ type: 'build_muscle', rank: goals.some((x) => x.rank === 'primary') ? 'secondary' : 'primary', target: user.weightKg })
    }
  }

  const save = () => {
    if (!editing) return
    const metricDef = METRICS.find((m) => m.v === draft.metric)
    const goal: Goal = {
      id: editing.id || uid('goal'),
      type: draft.type,
      rank: draft.rank,
      // Stored English canonical label; screens render goalLabel(goal.type).
      label: goalLabel(draft.type, 'en'),
      metric: draft.metric,
      targetValue: draft.metric ? draft.target : undefined,
      targetUnit: metricDef?.unit,
      startValue: draft.metric === 'body_weight' ? (editing.startValue ?? user.weightKg) : editing.startValue,
      createdAt: editing.createdAt || new Date().toISOString(),
    }
    const saved = upsertGoal(goal)
    if (!saved.ok) {
      useStore.getState().toast(saved.summary, 'error')
      return
    }
    const goalText = `${goalLabel(goal.type, tr.lang)}${goal.targetValue && metricDef ? ` (${tr.num(goal.targetValue)} ${tr.t(metricDef.unitKey)})` : ''}`
    addMemory({ category: 'goal', text: tr.t(goal.rank === 'primary' ? 'progress.mem.primaryGoal' : 'progress.mem.secondaryGoal', { goal: goalText }), source: 'user' })
    setEditing(null)
    useStore.getState().toast(tr.t('progress.goalSaved'), 'success')
  }

  return (
    <Page back="/progress" title={tr.t('progress.goals')} right={<Button size="icon-sm" variant="ghost" aria-label={tr.t('progress.addGoal')} onClick={() => open()}><Plus size={20} /></Button>}>
      <p className="text-[13.5px] text-text-3 mt-2 mb-4">{tr.t('progress.goalsIntro', { name: coachName })}</p>
      {goals.length === 0 ? (
        <Card>
          <EmptyState title={tr.t('progress.noGoals')} body={tr.t('progress.noGoalsBodyPick')} action={<Button variant="primary" onClick={() => open()}>{tr.t('progress.addAGoal')}</Button>} />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {goals.map((g) => {
            const p = goalProgress(g, measurements, workouts, user.availability.daysPerWeek, tr.lang)
            return (
              <Card key={g.id} padding="sm">
                <button onClick={() => open(g)} className="w-full text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-semibold">{goalLabel(g.type)}</span>
                    <Tag tone={g.rank === 'primary' ? 'accent' : 'default'}>{tr.t(`common.${g.rank}`)}</Tag>
                  </div>
                  <div className="text-[13px] text-text-3 mt-0.5">{goalDescription(g.type)}</div>
                  {g.metric && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[12.5px] text-text-2 mb-1.5">
                        <span>{p.label}</span>
                        <span className="tabular">{Math.round(p.pct * 100)}%</span>
                      </div>
                      <ProgressBar value={p.pct} height={5} />
                    </div>
                  )}
                </button>
              </Card>
            )
          })}
        </div>
      )}
      <SectionLabel className="mt-6">{tr.t('progress.orJustTell', { name: coachName })}</SectionLabel>
      <div className="flex flex-wrap gap-2">
        <Chip onClick={() => navigate('/coach?prefill=' + encodeURIComponent(tr.t('progress.prefillMyGoal')))}>{tr.t('progress.chipMyGoal')}</Chip>
        <Chip onClick={() => navigate('/coach?prompt=' + encodeURIComponent(tr.t('progress.promptBench')))}>{tr.t('progress.chipBench')}</Chip>
        <Chip onClick={() => navigate('/coach?prompt=' + encodeURIComponent(tr.t('progress.prompt4Workouts')))}>{tr.t('progress.chip4Workouts')}</Chip>
      </div>

      <Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? tr.t('progress.editGoal') : tr.t('progress.newGoal')}>
        {editing && (
          <div className="space-y-5 pb-2">
            <div>
              <div className="label mb-2">{tr.t('progress.goal')}</div>
              <div className="flex flex-wrap gap-2">
                {GOAL_TYPES.map((t) => (
                  <Chip key={t} size="sm" selected={draft.type === t} onClick={() => setDraft({ ...draft, type: t })}>
                    {goalLabel(t)}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-2">{tr.t('progress.priority')}</div>
              <div className="flex gap-2">
                <Chip size="sm" selected={draft.rank === 'primary'} onClick={() => setDraft({ ...draft, rank: 'primary' })}>
                  {tr.t('progress.primaryChip')}
                </Chip>
                <Chip size="sm" selected={draft.rank === 'secondary'} onClick={() => setDraft({ ...draft, rank: 'secondary' })}>
                  {tr.t('progress.secondaryChip')}
                </Chip>
              </div>
            </div>
            <div>
              <div className="label mb-2">{tr.t('progress.measurableTarget')}</div>
              <div className="flex flex-wrap gap-2">
                <Chip size="sm" selected={!draft.metric} onClick={() => setDraft({ ...draft, metric: undefined })}>
                  {tr.t('common.none')}
                </Chip>
                {METRICS.map((m) => (
                  <Chip key={m.v} size="sm" selected={draft.metric === m.v} onClick={() => setDraft({ ...draft, metric: m.v, target: m.v === 'body_weight' ? user.weightKg : m.v === 'workouts_per_week' ? user.availability.daysPerWeek : m.v === 'steps_per_day' ? 8000 : 60 })}>
                    {goalMetricLabel(m.v)}
                  </Chip>
                ))}
              </div>
              {draft.metric && (
                <div className="flex justify-center mt-4">
                  {(() => {
                    const m = METRICS.find((x) => x.v === draft.metric)!
                    return <Stepper value={draft.target} min={m.min} max={m.max} step={m.step} unit={tr.t(m.unitKey)} format={(v) => (m.step < 1 ? tr.dec(v, 1) : tr.int(v))} onChange={(v) => setDraft({ ...draft, target: v })} />
                  })()}
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              {editing.id && (
                <Button
                  variant="danger"
                  size="icon"
                  aria-label={tr.t('progress.deleteGoal')}
                  onClick={() => {
                    removeGoal(editing.id)
                    setEditing(null)
                  }}
                >
                  <Trash2 size={18} />
                </Button>
              )}
              <Button variant="primary" full onClick={save}>
                {tr.t('progress.saveGoal')}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </Page>
  )
}

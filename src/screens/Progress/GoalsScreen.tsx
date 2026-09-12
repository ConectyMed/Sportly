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
import { GOAL_DESCRIPTIONS, GOAL_LABELS } from '@/domain/labels'
import type { Goal, GoalType } from '@/domain/types'
import { uid } from '@/lib/utils'
import { useStore } from '@/store/useStore'

const GOAL_TYPES = Object.keys(GOAL_LABELS) as GoalType[]
const METRICS: Array<{ v: NonNullable<Goal['metric']>; label: string; unit: string; step: number; min: number; max: number }> = [
  { v: 'body_weight', label: 'Body weight', unit: 'kg', step: 0.5, min: 35, max: 250 },
  { v: 'bench_press', label: 'Bench press', unit: 'kg', step: 2.5, min: 20, max: 300 },
  { v: 'squat', label: 'Squat', unit: 'kg', step: 2.5, min: 20, max: 400 },
  { v: 'deadlift', label: 'Deadlift', unit: 'kg', step: 2.5, min: 20, max: 400 },
  { v: 'workouts_per_week', label: 'Workouts / week', unit: '/week', step: 1, min: 1, max: 7 },
  { v: 'steps_per_day', label: 'Steps / day', unit: 'steps', step: 500, min: 2000, max: 30000 },
]

export function GoalsScreen() {
  const navigate = useNavigate()
  const goals = useStore((s) => s.goals)
  const user = useStore((s) => s.user)!
  const measurements = useStore((s) => s.measurements)
  const workoutsMap = useStore((s) => s.workouts)
  const upsertGoal = useStore((s) => s.upsertGoal)
  const removeGoal = useStore((s) => s.removeGoal)
  const addMemory = useStore((s) => s.addMemory)
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
      label: GOAL_LABELS[draft.type],
      metric: draft.metric,
      targetValue: draft.metric ? draft.target : undefined,
      targetUnit: metricDef?.unit,
      startValue: draft.metric === 'body_weight' ? (editing.startValue ?? user.weightKg) : editing.startValue,
      createdAt: editing.createdAt || new Date().toISOString(),
    }
    upsertGoal(goal)
    addMemory({ category: 'goal', text: `${goal.rank === 'primary' ? 'Primary' : 'Secondary'} goal: ${goal.label}${goal.targetValue ? ` (${goal.targetValue} ${goal.targetUnit})` : ''}`, source: 'user' })
    setEditing(null)
    useStore.getState().toast('Goal saved', 'success')
  }

  return (
    <Page back="/progress" title="Goals" right={<Button size="icon-sm" variant="ghost" aria-label="Add goal" onClick={() => open()}><Plus size={20} /></Button>}>
      <p className="text-[13.5px] text-text-3 mt-2 mb-4">Goals steer every workout and every meal {coachName} plans. Change them any time.</p>
      {goals.length === 0 ? (
        <Card>
          <EmptyState title="No goals yet" body="Pick what matters most. You can add a measurable target too." action={<Button variant="primary" onClick={() => open()}>Add a goal</Button>} />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {goals.map((g) => {
            const p = goalProgress(g, measurements, workouts, user.availability.daysPerWeek)
            return (
              <Card key={g.id} padding="sm">
                <button onClick={() => open(g)} className="w-full text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-semibold">{g.label}</span>
                    <Tag tone={g.rank === 'primary' ? 'accent' : 'default'}>{g.rank}</Tag>
                  </div>
                  <div className="text-[13px] text-text-3 mt-0.5">{GOAL_DESCRIPTIONS[g.type]}</div>
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
      <SectionLabel className="mt-6">Or just tell {coachName}</SectionLabel>
      <div className="flex flex-wrap gap-2">
        <Chip onClick={() => navigate('/coach?prefill=' + encodeURIComponent('My goal is to '))}>“My goal is to…”</Chip>
        <Chip onClick={() => navigate('/coach?prompt=' + encodeURIComponent('My goal is to bench 100 kg'))}>Bench 100 kg</Chip>
        <Chip onClick={() => navigate('/coach?prompt=' + encodeURIComponent('I want to train 4 times a week'))}>4 workouts a week</Chip>
      </div>

      <Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'Edit goal' : 'New goal'}>
        {editing && (
          <div className="space-y-5 pb-2">
            <div>
              <div className="label mb-2">Goal</div>
              <div className="flex flex-wrap gap-2">
                {GOAL_TYPES.map((t) => (
                  <Chip key={t} size="sm" selected={draft.type === t} onClick={() => setDraft({ ...draft, type: t })}>
                    {GOAL_LABELS[t]}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-2">Priority</div>
              <div className="flex gap-2">
                <Chip size="sm" selected={draft.rank === 'primary'} onClick={() => setDraft({ ...draft, rank: 'primary' })}>
                  Primary
                </Chip>
                <Chip size="sm" selected={draft.rank === 'secondary'} onClick={() => setDraft({ ...draft, rank: 'secondary' })}>
                  Secondary
                </Chip>
              </div>
            </div>
            <div>
              <div className="label mb-2">Measurable target (optional)</div>
              <div className="flex flex-wrap gap-2">
                <Chip size="sm" selected={!draft.metric} onClick={() => setDraft({ ...draft, metric: undefined })}>
                  None
                </Chip>
                {METRICS.map((m) => (
                  <Chip key={m.v} size="sm" selected={draft.metric === m.v} onClick={() => setDraft({ ...draft, metric: m.v, target: m.v === 'body_weight' ? user.weightKg : m.v === 'workouts_per_week' ? user.availability.daysPerWeek : m.v === 'steps_per_day' ? 8000 : 60 })}>
                    {m.label}
                  </Chip>
                ))}
              </div>
              {draft.metric && (
                <div className="flex justify-center mt-4">
                  {(() => {
                    const m = METRICS.find((x) => x.v === draft.metric)!
                    return <Stepper value={draft.target} min={m.min} max={m.max} step={m.step} unit={m.unit} format={(v) => (m.step < 1 ? v.toFixed(1) : String(v))} onChange={(v) => setDraft({ ...draft, target: v })} />
                  })()}
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              {editing.id && (
                <Button
                  variant="danger"
                  size="icon"
                  aria-label="Delete goal"
                  onClick={() => {
                    removeGoal(editing.id)
                    setEditing(null)
                  }}
                >
                  <Trash2 size={18} />
                </Button>
              )}
              <Button variant="primary" full onClick={save}>
                Save goal
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </Page>
  )
}

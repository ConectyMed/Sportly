import { ArrowDown, ChevronRight, Flame, Plus, Sparkles, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { consistencyStreak, generateInsights, goalProgress, personalRecords, weeklyStats, weightSeries, weightTrend } from '@/coach/insights'
import { BarChart, LineChart } from '@/components/charts/Charts'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Tag } from '@/components/ui/Chip'
import { CoachMark, EmptyState, ProgressBar, Ring, Stepper } from '@/components/ui/Primitives'
import { Sheet } from '@/components/ui/Sheet'
import { Segmented } from '@/components/ui/Segmented'
import { exerciseName, goalLabel } from '@/domain/labels'
import { useT } from '@/i18n/react'
import { formatShortDate, fromDayKey, todayKey } from '@/lib/dates'
import { cn, round } from '@/lib/utils'
import { useStore } from '@/store/useStore'

export function ProgressScreen() {
  const navigate = useNavigate()
  const tr = useT()
  const user = useStore((s) => s.user)!
  const goals = useStore((s) => s.goals)
  const workoutsMap = useStore((s) => s.workouts)
  const measurements = useStore((s) => s.measurements)
  const checkIns = useStore((s) => s.checkIns)
  const coachName = useStore((s) => s.coach.name)
  const addMeasurement = useStore((s) => s.addMeasurement)
  const [range, setRange] = useState<'4w' | '12w' | 'all'>('12w')
  const [logOpen, setLogOpen] = useState(false)
  const [logValue, setLogValue] = useState(user.weightKg)
  const kg = tr.t('common.kg')

  const workouts = useMemo(() => Object.values(workoutsMap), [workoutsMap])
  const done = useMemo(() => workouts.filter((w) => w.status === 'completed'), [workouts])
  const series = useMemo(() => {
    const all = weightSeries(measurements)
    const cutoff = range === '4w' ? 28 : range === '12w' ? 84 : 9999
    const min = new Date(Date.now() - cutoff * 86_400_000).toISOString().slice(0, 10)
    return all.filter((p) => p.date >= min)
  }, [measurements, range])
  const trend = useMemo(() => weightTrend(measurements), [measurements])
  const weeks = useMemo(() => weeklyStats(workouts, 8), [workouts])
  const streak = useMemo(() => consistencyStreak(workouts, user.availability.daysPerWeek), [workouts, user.availability.daysPerWeek])
  const prs = useMemo(() => personalRecords(workouts).slice(0, 5), [workouts])
  const insights = useMemo(() => generateInsights({ workouts, measurements, checkIns, goals, targetPerWeek: user.availability.daysPerWeek }, tr.lang), [workouts, measurements, checkIns, goals, user.availability.daysPerWeek, tr.lang])
  const primary = goals.find((g) => g.rank === 'primary')
  const weightGoal = goals.find((g) => g.metric === 'body_weight')

  const hasData = done.length > 0 || series.length > 1

  return (
    <Page large title={tr.t('common.nav.progress')} eyebrow={tr.t('progress.sessionsWith', { sessions: tr.tn('common.sessions', done.length), name: coachName })}>
      {!hasData ? (
        <Card>
          <EmptyState
            title={tr.t('progress.emptyTitle')}
            body={tr.t('progress.emptyBody')}
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => navigate('/')}>
                  {tr.t('progress.todaysWorkout')}
                </Button>
                <Button variant="secondary" onClick={() => setLogOpen(true)}>
                  {tr.t('progress.logWeight')}
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          {/* Journey */}
          <Card padding="lg" tone="elevated">
            <div className="space-y-4">
              <Journey label={tr.t('progress.whereStarted')} value={trend.start !== undefined ? `${tr.num(trend.start)} ${kg}` : `${done.length ? formatShortDate(done[0].completedAt!) : '—'}`} sub={series[0] ? formatShortDate(fromDayKey(series[0].date)) : tr.t('progress.firstSession')} />
              <ArrowDown size={16} className="text-text-4 ml-1" />
              <Journey label={tr.t('progress.whereAm')} value={trend.current !== undefined ? `${tr.num(trend.current)} ${kg}` : tr.tn('common.sessions', done.length)} sub={trend.change30 !== undefined ? tr.t('progress.kgIn30Days', { delta: tr.signed(trend.change30) }) : tr.t('progress.weekStreak', { n: streak.current })} accent />
              <ArrowDown size={16} className="text-text-4 ml-1" />
              <Journey label={tr.t('progress.whereGoing')} value={weightGoal?.targetValue ? `${tr.num(weightGoal.targetValue)} ${kg}` : primary ? goalLabel(primary.type) : tr.t('progress.setGoal')} sub={weightGoal?.targetValue && trend.current !== undefined ? tr.t('progress.kgToGo', { n: tr.num(round(Math.abs(weightGoal.targetValue - trend.current), 1)) }) : primary ? tr.t('progress.primaryGoal') : undefined} onClick={() => navigate('/goals')} />
            </div>
          </Card>

          {/* Weight */}
          <section className="mt-6">
            <SectionLabel right={<Segmented id="range" size="sm" value={range} onChange={setRange} options={[{ value: '4w', label: tr.t('progress.range4w') }, { value: '12w', label: tr.t('progress.range12w') }, { value: 'all', label: tr.t('progress.rangeAll') }]} className="w-[150px]" />}>{tr.t('goalMetric.body_weight')}</SectionLabel>
            <Card>
              {series.length > 1 ? (
                <LineChart data={series.map((p) => ({ label: formatShortDate(fromDayKey(p.date)), value: p.value }))} formatValue={(v) => `${tr.dec(v, 1)} ${kg}`} target={weightGoal?.targetValue} className="pt-6" />
              ) : (
                <p className="text-[13px] text-text-3 py-4 text-center">{tr.t('progress.logWeightHint')}</p>
              )}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-hairline">
                <div className="text-[12.5px] text-text-3">
                  {trend.weeklyRate !== undefined ? tr.t('progress.kgPerWeek', { rate: tr.signed(trend.weeklyRate, 2) }) : tr.t('progress.noTrend')}
                  {trend.stalled ? tr.t('progress.plateauSuffix') : ''}
                </div>
                <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setLogOpen(true)}>
                  {tr.t('progress.logWeight')}
                </Button>
              </div>
            </Card>
          </section>

          {/* Training */}
          <section className="mt-6">
            <SectionLabel>{tr.t('progress.training')}</SectionLabel>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Card>
                <div className="text-[12px] text-text-3 mb-1">{tr.t('progress.weeklyVolume')}</div>
                <BarChart data={weeks.map((w) => ({ label: formatShortDate(fromDayKey(w.weekStart)), value: w.volume }))} height={96} formatValue={(v) => `${tr.int(v)} ${kg}`} />
              </Card>
              <Card className="flex flex-col items-center justify-center w-[128px]">
                <Ring value={Math.min(1, weeks[weeks.length - 1].sessions / Math.max(1, user.availability.daysPerWeek))} size={72} stroke={6}>
                  <Flame size={20} className={cn(streak.current > 0 ? 'text-accent-text' : 'text-text-3')} />
                </Ring>
                <div className="text-[18px] font-semibold title mt-2 tabular">{tr.t('progress.wk', { n: streak.current })}</div>
                <div className="text-[11px] text-text-3">{tr.t('progress.streakBest', { n: streak.longest })}</div>
              </Card>
            </div>
            <Card className="mt-3">
              <div className="text-[12px] text-text-3 mb-1">{tr.t('progress.sessionsPerWeek')}</div>
              <BarChart data={weeks.map((w) => ({ label: formatShortDate(fromDayKey(w.weekStart)), value: w.sessions }))} height={64} target={user.availability.daysPerWeek} formatValue={(v) => tr.tn('common.sessions', v)} />
            </Card>
          </section>

          {/* Goals */}
          <section className="mt-6">
            <SectionLabel right={<button onClick={() => navigate('/goals')} className="text-[12px] text-text-3 hover:text-text flex items-center gap-0.5">{tr.t('progress.manage')} <ChevronRight size={12} /></button>}>{tr.t('progress.goals')}</SectionLabel>
            <div className="space-y-2.5">
              {goals.length === 0 && (
                <Card>
                  <EmptyState title={tr.t('progress.noGoals')} body={tr.t('progress.noGoalsBody')} action={<Button variant="primary" size="sm" onClick={() => navigate('/goals')}>{tr.t('progress.addAGoal')}</Button>} />
                </Card>
              )}
              {goals.map((g) => {
                const p = goalProgress(g, measurements, workouts, user.availability.daysPerWeek, tr.lang)
                return (
                  <Card key={g.id} padding="sm" interactive onClick={() => navigate('/goals')}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[15px] font-semibold truncate">{goalLabel(g.type)}</span>
                          <Tag tone={g.rank === 'primary' ? 'accent' : 'default'}>{tr.t(`common.${g.rank}`)}</Tag>
                        </div>
                        <div className="text-[12.5px] text-text-3 mt-0.5">{p.label}</div>
                      </div>
                      {g.targetValue !== undefined && <span className="text-[14px] font-semibold tabular">{Math.round(p.pct * 100)}%</span>}
                    </div>
                    {g.targetValue !== undefined && <ProgressBar value={p.pct} className="mt-2.5" height={5} />}
                  </Card>
                )
              })}
            </div>
          </section>

          {/* PRs */}
          {prs.length > 0 && (
            <section className="mt-6">
              <SectionLabel>{tr.t('progress.personalBests')}</SectionLabel>
              <Card padding="none">
                <ul className="divide-y divide-[var(--hairline)]">
                  {prs.map((p) => (
                    <li key={p.exerciseId} className="flex items-center gap-3 px-4 py-3">
                      <Trophy size={15} className="text-accent-text shrink-0" />
                      <span className="flex-1 text-[14.5px] font-medium truncate">{exerciseName(p.exerciseId, p.name)}</span>
                      <span className="text-[13.5px] tabular text-text-2">
                        {tr.num(p.weightKg)} {kg} × {p.reps}
                      </span>
                      <span className="text-[11px] text-text-4 tabular w-12 text-right">~{tr.int(p.e1rm)} {kg}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {/* Insights */}
          <section className="mt-6 pb-2">
            <SectionLabel>{tr.t('progress.insightsOf', { name: coachName })}</SectionLabel>
            <div className="space-y-2.5">
              {insights.length === 0 && <p className="text-[13.5px] text-text-3">{tr.t('progress.insightsEmpty')}</p>}
              {insights.map((i) => (
                <div key={i.id} className={cn('rounded-[18px] border p-4 flex gap-3', i.kind === 'positive' ? 'bg-accent-soft/50 border-transparent' : i.kind === 'watch' ? 'bg-warn-soft/40 border-transparent' : 'bg-surface border-border')}>
                  {i.kind === 'positive' ? <Sparkles size={16} className="text-accent-text mt-0.5 shrink-0" /> : <CoachMark size={18} className="mt-0.5" />}
                  <div>
                    <div className="text-[14.5px] font-medium leading-snug">{i.text}</div>
                    {i.detail && <div className="text-[13px] text-text-2 mt-1">{i.detail}</div>}
                  </div>
                </div>
              ))}
              <Button variant="secondary" full onClick={() => navigate('/coach?prompt=' + encodeURIComponent(tr.t('progress.analyzePrompt')))}>
                {tr.t('progress.askToAnalyze', { name: coachName })}
              </Button>
            </div>
          </section>
        </>
      )}

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title={tr.t('progress.logTodaysWeight')}>
        <div className="flex flex-col items-center gap-5 py-2">
          <Stepper value={logValue} min={30} max={300} step={0.1} unit={kg} format={(v) => tr.dec(v, 1)} onChange={setLogValue} />
          <p className="text-[12.5px] text-text-3 text-center">{tr.t('progress.logWeightTip')}</p>
          <Button
            variant="primary"
            full
            onClick={() => {
              addMeasurement({ type: 'body_weight', value: round(logValue, 1), unit: 'kg', date: todayKey(), source: 'user' })
              setLogOpen(false)
              useStore.getState().toast(tr.t('progress.loggedKg', { kg: tr.num(round(logValue, 1)) }), 'success')
            }}
          >
            {tr.t('common.save')}
          </Button>
        </div>
      </Sheet>
    </Page>
  )
}

function Journey({ label, value, sub, accent, onClick }: { label: string; value: string; sub?: string; accent?: boolean; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp onClick={onClick} className={cn('flex items-center justify-between w-full text-left', onClick && 'hover:opacity-90')}>
      <div>
        <div className="label">{label}</div>
        <div className={cn('text-[24px] font-semibold title tabular mt-0.5', accent && 'text-accent-text')}>{value}</div>
        {sub && <div className="text-[12.5px] text-text-3">{sub}</div>}
      </div>
      {onClick && <ChevronRight size={16} className="text-text-4" />}
    </Comp>
  )
}

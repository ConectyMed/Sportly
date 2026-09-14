import { Check, ChevronRight, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { selectActiveProgram } from '@/coach/coachService'
import { programWeekFor } from '@/coach/programGenerator'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Chip, Tag } from '@/components/ui/Chip'
import { CoachMark, EmptyState, ProgressBar } from '@/components/ui/Primitives'
import { Sheet } from '@/components/ui/Sheet'
import { goalLabel, phaseLabel, phaseNote, programDescription, programDisplayName, programStatusLabel, splitLabel, workoutTitle } from '@/domain/labels'
import { useT } from '@/i18n/react'
import { formatShortDate, fromDayKey, todayKey, weekdayName } from '@/lib/dates'
import { cn, formatMinutes } from '@/lib/utils'
import { useStore } from '@/store/useStore'

export function ProgramScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const tr = useT()
  const program = useStore((s) => (id ? s.programs[id] : selectActiveProgram(s)))
  const workoutsMap = useStore((s) => s.workouts)
  const coachName = useStore((s) => s.coach.name)
  const [cancelOpen, setCancelOpen] = useState(false)
  const today = todayKey()
  const currentWeek = program ? Math.max(1, Math.min(program.weeks, programWeekFor(program))) : 1
  const [openWeek, setOpenWeek] = useState<number>(currentWeek)

  const byWeek = useMemo(() => {
    const map = new Map<number, typeof workoutsMap[string][]>()
    if (!program) return map
    for (const w of Object.values(workoutsMap)) {
      if (w.programId !== program.id || !w.programWeek) continue
      const list = map.get(w.programWeek) ?? []
      list.push(w)
      map.set(w.programWeek, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
    return map
  }, [program, workoutsMap])

  const ask = (prompt: string) => navigate(`/coach?prompt=${encodeURIComponent(prompt)}`)

  if (!program) {
    return (
      <Page back="/" title={tr.t('common.program')}>
        <Card className="mt-2">
          <EmptyState
            icon={<CoachMark size={40} active />}
            title={tr.t('program.noProgram')}
            body={tr.t('program.noProgramBody', { name: coachName })}
            action={
              <div className="flex flex-wrap gap-2 justify-center">
                <Chip tone="accent" onClick={() => ask(tr.t('program.create8'))}>{tr.tn('common.weeks', 8)}</Chip>
                <Chip tone="accent" onClick={() => ask(tr.t('program.create12'))}>{tr.tn('common.weeks', 12)}</Chip>
                <Chip tone="accent" onClick={() => ask(tr.t('program.create16'))}>{tr.tn('common.weeks', 16)}</Chip>
              </div>
            }
          />
        </Card>
      </Page>
    )
  }

  const completed = Object.values(workoutsMap).filter((w) => w.programId === program.id && w.status === 'completed').length
  const total = program.weeks * program.daysPerWeek
  const active = program.status === 'active'

  return (
    <Page back="/" title={tr.t('common.program')} eyebrow={active ? tr.t('common.weekOf', { n: currentWeek, total: program.weeks }) : programStatusLabel(program.status)}>
      <div className="pt-2">
        <div className="flex items-center gap-2 mb-1.5">
          <Tag tone={active ? 'accent' : 'default'}>{programStatusLabel(program.status)}</Tag>
          <span className="text-[12px] text-text-3">{tr.t('program.goalSplit', { goal: goalLabel(program.goalType), split: splitLabel(program.split) })}</span>
        </div>
        <h1 className="display text-[30px]">{programDisplayName(program)}</h1>
        <p className="text-[14px] text-text-2 mt-2 text-pretty">{programDescription(program)}</p>
        <div className="mt-4">
          <div className="flex justify-between text-[12.5px] text-text-3 mb-1.5 tabular">
            <span>{tr.t('program.sessionsOf', { done: completed, total })}</span>
            <span>{tr.t(program.startDate > today ? 'program.starts' : 'program.started', { date: formatShortDate(fromDayKey(program.startDate)) })}</span>
          </div>
          <ProgressBar value={completed / Math.max(1, total)} height={5} />
        </div>
        <div className="flex gap-1 mt-4">
          {program.weeksPlan.map((w) => (
            <button key={w.week} onClick={() => setOpenWeek(w.week)} aria-label={tr.t('common.week', { n: w.week })} className={cn('h-2 flex-1 rounded-full transition-colors', w.phase === 'deload' ? 'bg-info' : w.phase === 'peak' ? 'bg-accent' : w.week === openWeek ? 'bg-accent' : w.week < currentWeek ? 'bg-accent-soft-2' : 'bg-surface-3')} />
          ))}
        </div>
        <div className="flex gap-3 text-[11px] text-text-3 mt-1.5">
          <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-accent-soft-2" /> {phaseLabel('build')}</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-info" /> {phaseLabel('deload')}</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-accent" /> {phaseLabel('peak')}</span>
        </div>
      </div>

      <SectionLabel className="mt-6">{tr.t('program.weeks')}</SectionLabel>
      <div className="space-y-2">
        {program.weeksPlan.map((w) => {
          const list = byWeek.get(w.week) ?? []
          const done = list.filter((x) => x.status === 'completed').length
          const isOpen = openWeek === w.week
          return (
            <Card key={w.week} padding="none" className={cn(w.week === currentWeek && active && 'border-accent/50')}>
              <button onClick={() => setOpenWeek(isOpen ? 0 : w.week)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
                <span className={cn('h-8 w-8 rounded-full flex items-center justify-center text-[12px] font-semibold tabular shrink-0', done === list.length && list.length > 0 ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-text-2')}>{done === list.length && list.length > 0 ? <Check size={14} strokeWidth={3} /> : w.week}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold">
                    {tr.t('common.week', { n: w.week })} <span className="text-text-3 font-medium capitalize">· {phaseLabel(w.phase)}</span>
                    {w.week === currentWeek && active && <span className="ml-2 text-[11px] text-accent-text">{tr.t('common.now')}</span>}
                  </span>
                  <span className="block text-[12.5px] text-text-3 truncate">{phaseNote(w.phase)}</span>
                </span>
                <span className="text-[12px] text-text-3 tabular">
                  {done}/{list.length}
                </span>
                <ChevronRight size={16} className={cn('text-text-4 transition-transform', isOpen && 'rotate-90')} />
              </button>
              {isOpen && (
                <ul className="border-t border-hairline divide-y divide-[var(--hairline)]">
                  {list.length === 0 && <li className="px-4 py-3 text-[13px] text-text-3">{tr.t('program.weekEmpty')}</li>}
                  {list.map((x) => (
                    <li key={x.id}>
                      <button onClick={() => navigate(`/workout/${x.id}`)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60">
                        <span className={cn('w-10 text-[12px] tabular', x.scheduledFor === today ? 'text-accent-text font-semibold' : 'text-text-3')}>{weekdayName(fromDayKey(x.scheduledFor), true)}</span>
                        <span className="flex-1 min-w-0">
                          <span className={cn('block text-[14.5px] font-medium', x.status === 'skipped' && 'line-through text-text-3')}>{workoutTitle(x)}</span>
                          <span className="block text-[12px] text-text-3">{tr.t('common.minutesExercises', { minutes: formatMinutes(x.estimatedMinutes), exercises: tr.tn('common.exercises', x.exercises.length) })}</span>
                        </span>
                        {x.status === 'completed' ? <Check size={16} className="text-accent-text" /> : <ChevronRight size={14} className="text-text-4" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )
        })}
      </div>

      {active && (
        <div className="mt-6 space-y-2 pb-4">
          <SectionLabel>{tr.t('program.adjustWith', { name: coachName })}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <Chip icon={<Sparkles size={14} />} onClick={() => ask(tr.t('program.prompt3Days'))}>{tr.t('program.chip3Days')}</Chip>
            <Chip icon={<Sparkles size={14} />} onClick={() => ask(tr.t('program.promptSwitchGoal'))}>{tr.t('program.chipSwitchGoal')}</Chip>
            <Chip icon={<Sparkles size={14} />} onClick={() => ask(tr.t('program.promptRegenerate'))}>{tr.t('program.chipRegenerate')}</Chip>
          </div>
          <Button variant="ghost" full className="mt-2 text-danger" onClick={() => setCancelOpen(true)}>
            {tr.t('program.cancel')}
          </Button>
        </div>
      )}

      <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title={tr.t('program.cancelTitle')}>
        <p className="text-[14px] text-text-2 mb-4">{tr.t('program.cancelBody', { name: coachName })}</p>
        <div className="space-y-2 pb-2">
          <Button
            variant="danger"
            full
            onClick={() => {
              setCancelOpen(false)
              ask(tr.t('program.cancelPrompt'))
            }}
          >
            {tr.t('program.cancel')}
          </Button>
          <Button variant="ghost" full onClick={() => setCancelOpen(false)}>
            {tr.t('program.keep')}
          </Button>
        </div>
      </Sheet>
    </Page>
  )
}

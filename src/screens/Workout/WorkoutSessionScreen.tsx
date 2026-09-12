import { Check, ChevronLeft, ChevronRight, List, Minus, Plus, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { finishWorkout } from '@/coach/coachService'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { getExercise } from '@/domain/exercises'
import type { WorkoutSet } from '@/domain/types'
import { useElapsed } from '@/lib/hooks'
import { cn, formatDuration, haptic } from '@/lib/utils'
import { useStore } from '@/store/useStore'

export function WorkoutSessionScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const workout = useStore((s) => (id ? s.workouts[id] : undefined))
  const updateSet = useStore((s) => s.updateSet)
  const startWorkout = useStore((s) => s.startWorkout)
  const prefs = useStore((s) => s.preferences)
  const [idx, setIdx] = useState<number>(() => {
    const w = id ? useStore.getState().workouts[id] : undefined
    const first = w?.exercises.findIndex((e) => e.sets.some((s) => !s.completed)) ?? 0
    return first < 0 ? 0 : first
  })
  const [rest, setRest] = useState<{ total: number; endsAt: number; label: string } | null>(null)
  const [restLeft, setRestLeft] = useState(0)
  const [exitOpen, setExitOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const elapsed = useElapsed(workout?.startedAt, workout?.status === 'in_progress')
  const audioRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (workout && workout.status === 'planned') startWorkout(workout.id)
  }, [workout, startWorkout])

  // Rest countdown.
  useEffect(() => {
    if (!rest) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((rest.endsAt - Date.now()) / 1000))
      setRestLeft(left)
      if (left === 0) {
        setRest(null)
        haptic([30, 40, 30])
        if (prefs.restTimerSound) beep(audioRef)
      }
    }
    tick()
    const t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [rest, prefs.restTimerSound])

  const totals = useMemo(() => {
    if (!workout) return { done: 0, total: 0 }
    const total = workout.exercises.reduce((a, e) => a + e.sets.length, 0)
    const done = workout.exercises.reduce((a, e) => a + e.sets.filter((s) => s.completed).length, 0)
    return { done, total }
  }, [workout])

  if (!workout) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-text-2">This workout isn’t available.</p>
          <Button className="mt-4" onClick={() => navigate('/')}>
            Back home
          </Button>
        </div>
      </div>
    )
  }

  const exercise = workout.exercises[Math.min(idx, workout.exercises.length - 1)]
  const def = getExercise(exercise.exerciseId)
  const next = workout.exercises[idx + 1]
  const allDone = totals.done === totals.total
  const exerciseDone = exercise.sets.every((s) => s.completed)

  const completeSet = (set: WorkoutSet, setIndex: number) => {
    const willComplete = !set.completed
    updateSet(workout.id, exercise.id, set.id, {
      completed: willComplete,
      actualReps: set.actualReps ?? set.targetReps,
      actualWeightKg: set.actualWeightKg ?? set.targetWeightKg,
      actualSeconds: set.actualSeconds ?? set.targetSeconds,
    })
    if (!willComplete) return
    haptic(12)
    const isLastSetOfExercise = setIndex === exercise.sets.length - 1
    const isLastOverall = totals.done + 1 === totals.total
    if (isLastOverall) return
    if (prefs.restTimerAutoStart) {
      const label = isLastSetOfExercise && next ? `Next: ${next.name}` : `Set ${setIndex + 2} of ${exercise.sets.length}`
      setRest({ total: exercise.restSeconds, endsAt: Date.now() + exercise.restSeconds * 1000, label })
    }
    if (isLastSetOfExercise && next) setTimeout(() => setIdx((i) => Math.min(i + 1, workout.exercises.length - 1)), 350)
  }

  const adjust = (set: WorkoutSet, field: 'actualReps' | 'actualWeightKg' | 'actualSeconds', delta: number) => {
    const base = field === 'actualReps' ? (set.actualReps ?? set.targetReps) : field === 'actualSeconds' ? (set.actualSeconds ?? set.targetSeconds ?? 0) : (set.actualWeightKg ?? set.targetWeightKg ?? 0)
    const step = field === 'actualWeightKg' ? (def.equipment.includes('dumbbell') || def.equipment.includes('kettlebell') ? 1 : 2.5) : field === 'actualSeconds' ? 5 : 1
    updateSet(workout.id, exercise.id, set.id, { [field]: Math.max(0, Math.round((base + delta * step) * 10) / 10) })
  }

  const finish = () => {
    finishWorkout(workout.id)
    navigate(`/workout/${workout.id}/summary`, { replace: true })
  }

  return (
    <div className="min-h-dvh flex flex-col bg-bg max-w-[560px] mx-auto">
      {/* Header */}
      <div className="pt-safe px-4">
        <div className="flex items-center gap-2 h-14">
          <button aria-label="Exit workout" onClick={() => setExitOpen(true)} className="h-10 w-10 -ml-2 rounded-full flex items-center justify-center text-text-2 hover:text-text">
            <X size={22} />
          </button>
          <div className="flex-1 min-w-0 text-center">
            <div className="title text-[15px] truncate">{workout.title}</div>
            <div className="text-[12px] text-text-3 tabular">{formatDuration(elapsed)}</div>
          </div>
          <button aria-label="All exercises" onClick={() => setListOpen(true)} className="h-10 w-10 -mr-2 rounded-full flex items-center justify-center text-text-2 hover:text-text">
            <List size={20} />
          </button>
        </div>
        <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
          <motion.div className="h-full bg-accent" animate={{ width: `${(totals.done / Math.max(1, totals.total)) * 100}%` }} transition={{ type: 'spring', stiffness: 200, damping: 30 }} />
        </div>
        <div className="flex justify-between text-[11px] text-text-3 mt-1.5 tabular">
          <span>
            Exercise {idx + 1} of {workout.exercises.length}
          </span>
          <span>
            {totals.done}/{totals.total} sets
          </span>
        </div>
      </div>

      {/* Current exercise */}
      <div className="flex-1 px-4 pt-6 pb-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={exercise.id} initial={reduce ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? undefined : { opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="display text-[30px] leading-tight text-balance">{exercise.name}</h1>
                <p className="text-[14px] text-text-3 mt-2">{exercise.note ?? def.cue}</p>
              </div>
              {exerciseDone && (
                <span className="h-9 w-9 rounded-full bg-accent text-accent-ink flex items-center justify-center shrink-0 mt-1">
                  <Check size={18} strokeWidth={3} />
                </span>
              )}
            </div>

            <div className="mt-6 rounded-[22px] border border-border bg-surface overflow-hidden">
              <div className="grid grid-cols-[44px_1fr_1fr_56px] items-center px-3 py-2 text-[11px] uppercase tracking-wider text-text-3 border-b border-hairline">
                <span>Set</span>
                <span className="text-center">{exercise.sets[0]?.targetSeconds ? 'Seconds' : 'Weight'}</span>
                <span className="text-center">{exercise.sets[0]?.targetSeconds ? '' : 'Reps'}</span>
                <span />
              </div>
              {exercise.sets.map((s, si) => {
                const timed = Boolean(s.targetSeconds)
                const weight = s.actualWeightKg ?? s.targetWeightKg
                const reps = s.actualReps ?? s.targetReps
                const seconds = s.actualSeconds ?? s.targetSeconds
                return (
                  <div key={s.id} className={cn('grid grid-cols-[44px_1fr_1fr_56px] items-center px-3 py-2.5 border-b border-hairline last:border-b-0 transition-colors', s.completed && 'bg-accent-soft/40')}>
                    <span className="text-[14px] font-semibold tabular text-text-2">{si + 1}</span>
                    {timed ? (
                      <>
                        <Counter value={`${seconds}s`} onMinus={() => adjust(s, 'actualSeconds', -1)} onPlus={() => adjust(s, 'actualSeconds', 1)} disabled={s.completed} />
                        <span />
                      </>
                    ) : (
                      <>
                        <Counter value={weight !== undefined ? `${weight}` : '—'} unit={weight !== undefined ? 'kg' : ''} onMinus={() => adjust(s, 'actualWeightKg', -1)} onPlus={() => adjust(s, 'actualWeightKg', 1)} disabled={s.completed || weight === undefined} />
                        <Counter value={`${reps}`} onMinus={() => adjust(s, 'actualReps', -1)} onPlus={() => adjust(s, 'actualReps', 1)} disabled={s.completed} />
                      </>
                    )}
                    <div className="flex justify-end">
                      <button
                        aria-label={s.completed ? 'Undo set' : 'Complete set'}
                        onClick={() => completeSet(s, si)}
                        className={cn('h-10 w-10 rounded-full flex items-center justify-center transition-colors active:scale-95', s.completed ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-text-3 hover:text-text')}
                      >
                        <Check size={18} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {next ? (
              <button onClick={() => setIdx(idx + 1)} className="mt-4 w-full flex items-center justify-between rounded-[16px] px-4 py-3 bg-surface border border-border text-left hover:border-border-strong">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-text-3">Up next</div>
                  <div className="text-[14.5px] font-medium">{next.name}</div>
                </div>
                <ChevronRight size={16} className="text-text-3" />
              </button>
            ) : (
              <div className="mt-4 text-center text-[13px] text-text-3">Last exercise. Finish when you are done.</div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer controls */}
      <div className="px-4 pb-[max(16px,env(safe-area-inset-bottom))] flex items-center gap-2">
        <button aria-label="Previous exercise" disabled={idx === 0} onClick={() => setIdx(idx - 1)} className="h-12 w-12 rounded-full bg-surface border border-border flex items-center justify-center text-text-2 disabled:opacity-30">
          <ChevronLeft size={20} />
        </button>
        <Button variant={allDone ? 'primary' : 'secondary'} size="lg" full onClick={finish}>
          {allDone ? 'Finish workout' : 'Finish early'}
        </Button>
        <button aria-label="Next exercise" disabled={!next} onClick={() => setIdx(idx + 1)} className="h-12 w-12 rounded-full bg-surface border border-border flex items-center justify-center text-text-2 disabled:opacity-30">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Rest overlay */}
      <AnimatePresence>
        {rest && (
          <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className="fixed left-0 right-0 bottom-0 z-40 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <div className="max-w-[560px] mx-auto rounded-[26px] bg-bg-elev border border-border-strong shadow-lg p-5 flex items-center gap-5">
              <RestRing total={rest.total} left={restLeft} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-text-3">Rest</div>
                <div className="text-[15px] font-medium truncate">{rest.label}</div>
                <div className="flex gap-2 mt-2.5">
                  <Button size="sm" variant="secondary" onClick={() => setRest((r) => (r ? { ...r, total: r.total + 30, endsAt: r.endsAt + 30_000 } : r))}>
                    +30s
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRest(null)}>
                    Skip
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Sheet open={exitOpen} onClose={() => setExitOpen(false)} title="Leave workout?">
        <p className="text-[14px] text-text-2 mb-4">Your completed sets are saved. You can come back and continue.</p>
        <div className="space-y-2 pb-2">
          <Button variant="primary" full onClick={finish}>
            Finish and save
          </Button>
          <Button variant="secondary" full onClick={() => navigate('/')}>
            Continue later
          </Button>
          <Button variant="ghost" full onClick={() => setExitOpen(false)}>
            Keep going
          </Button>
        </div>
      </Sheet>

      <Sheet open={listOpen} onClose={() => setListOpen(false)} title="Exercises" size="tall">
        <ul className="divide-y divide-[var(--hairline)]">
          {workout.exercises.map((e, i) => {
            const done = e.sets.filter((s) => s.completed).length
            return (
              <li key={e.id}>
                <button
                  onClick={() => {
                    setIdx(i)
                    setListOpen(false)
                  }}
                  className={cn('w-full flex items-center gap-3 py-3.5 text-left', i === idx && 'text-accent-text')}
                >
                  <span className={cn('h-7 w-7 rounded-full text-[12px] font-semibold flex items-center justify-center tabular', done === e.sets.length ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-text-2')}>{done === e.sets.length ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
                  <span className="flex-1 text-[15px] font-medium">{e.name}</span>
                  <span className="text-[12px] text-text-3 tabular">
                    {done}/{e.sets.length}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Sheet>
    </div>
  )
}

function Counter({ value, unit, onMinus, onPlus, disabled }: { value: string; unit?: string; onMinus: () => void; onPlus: () => void; disabled?: boolean }) {
  return (
    <div className={cn('flex items-center justify-center gap-1', disabled && 'opacity-60')}>
      <button aria-label="Decrease" onClick={onMinus} disabled={disabled} className="h-8 w-8 rounded-full flex items-center justify-center text-text-3 hover:bg-surface-2 disabled:pointer-events-none">
        <Minus size={14} />
      </button>
      <span className="min-w-[52px] text-center text-[17px] font-semibold tabular">
        {value}
        {unit && <span className="text-[11px] text-text-3 font-medium ml-0.5">{unit}</span>}
      </span>
      <button aria-label="Increase" onClick={onPlus} disabled={disabled} className="h-8 w-8 rounded-full flex items-center justify-center text-text-3 hover:bg-surface-2 disabled:pointer-events-none">
        <Plus size={14} />
      </button>
    </div>
  )
}

function RestRing({ total, left }: { total: number; left: number }) {
  const size = 76
  const stroke = 6
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = total ? left / total : 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-3)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset 0.25s linear' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[20px] font-semibold tabular title">{formatDuration(left)}</div>
    </div>
  )
}

function beep(ref: React.MutableRefObject<AudioContext | null>) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    ref.current = ref.current ?? new Ctx()
    const ctx = ref.current
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.value = 0.0001
    o.connect(g).connect(ctx.destination)
    const t = ctx.currentTime
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    o.start(t)
    o.stop(t + 0.4)
  } catch {
    /* audio unavailable */
  }
}

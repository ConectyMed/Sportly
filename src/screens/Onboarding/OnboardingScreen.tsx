import { ArrowRight, ChevronLeft } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { startFirstConversation } from '@/coach/coachService'
import { buildVoice } from '@/coach/personality'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { CoachMark, Stepper, TextInput } from '@/components/ui/Primitives'
import { Slider } from '@/components/ui/Slider'
import { buildDemoSeed } from '@/domain/demo'
import { DIETARY_FLAGS, DIETS, LEVELS, dietLabel, dietaryFlagLabel, equipmentLabel, goalDescription, goalLabel, levelDescription, levelLabel } from '@/domain/labels'
import type { CoachPersonality, DietPreference, DietaryFlag, EquipmentId, FitnessLevel, Goal, GoalType, MemoryItem, UserProfile } from '@/domain/types'
import { weekdayInitials } from '@/i18n'
import { useT } from '@/i18n/react'
import { cn, formatMinutes, uid } from '@/lib/utils'
import { DEFAULT_PERSONALITY, useStore } from '@/store/useStore'

type Step = 'welcome' | 'name' | 'basics' | 'level' | 'goal' | 'secondary' | 'availability' | 'equipment' | 'nutrition' | 'coachName' | 'personality' | 'ready'
const STEPS: Step[] = ['welcome', 'name', 'basics', 'level', 'goal', 'secondary', 'availability', 'equipment', 'nutrition', 'coachName', 'personality', 'ready']

const GOAL_OPTIONS: GoalType[] = ['build_muscle', 'lose_fat', 'recomposition', 'strength', 'conditioning', 'consistency', 'general_fitness', 'mobility', 'endurance']
const EQUIPMENT_OPTIONS: EquipmentId[] = ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bench', 'pullup_bar', 'band', 'cardio_machine']
const COACH_NAMES = ['Nova', 'Alex', 'Sam', 'Kai', 'Max', 'Ren']

interface Draft {
  name: string
  age: number
  heightCm: number
  weightKg: number
  sex: UserProfile['sex']
  level: FitnessLevel
  primary?: GoalType
  secondary?: GoalType
  daysPerWeek: number
  preferredDays: number[]
  sessionMinutes: number
  equipment: EquipmentId[]
  trainsAt: 'gym' | 'home' | 'both'
  diet: DietPreference
  flags: DietaryFlag[]
  coachName: string
  personality: CoachPersonality
}

export function OnboardingScreen() {
  const navigate = useNavigate()
  const tr = useT()
  const onboarded = useStore((s) => s.onboarded)
  const completeOnboarding = useStore((s) => s.completeOnboarding)
  const seed = useStore((s) => s.seed)
  const reduce = useReducedMotion()
  const [stepIdx, setStepIdx] = useState(0)
  const [dir, setDir] = useState(1)
  const step = STEPS[stepIdx]
  const [d, setD] = useState<Draft>({
    name: '',
    age: 30,
    heightCm: 175,
    weightKg: 72,
    sex: 'unspecified',
    level: 'intermediate',
    daysPerWeek: 3,
    preferredDays: [1, 3, 5],
    sessionMinutes: 45,
    equipment: ['dumbbell', 'bench'],
    trainsAt: 'gym',
    diet: 'omnivore',
    flags: [],
    coachName: '',
    personality: DEFAULT_PERSONALITY,
  })
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))

  const finishing = useRef(false)
  useEffect(() => {
    // Already onboarded and arrived here by URL: go home. (Not while we are completing onboarding ourselves.)
    if (onboarded && !finishing.current) navigate('/', { replace: true })
  }, [onboarded, navigate])

  const go = (delta: number) => {
    setDir(delta)
    setStepIdx((i) => Math.max(0, Math.min(STEPS.length - 1, i + delta)))
  }

  const canContinue = useMemo(() => {
    switch (step) {
      case 'name':
        return d.name.trim().length >= 1
      case 'goal':
        return Boolean(d.primary)
      case 'availability':
        return d.preferredDays.length >= 1
      case 'coachName':
        return d.coachName.trim().length >= 1
      default:
        return true
    }
  }, [step, d])

  const finish = () => {
    finishing.current = true
    const now = new Date().toISOString()
    const user: UserProfile = {
      id: uid('usr'),
      name: d.name.trim(),
      age: d.age,
      sex: d.sex,
      heightCm: d.heightCm,
      weightKg: d.weightKg,
      level: d.level,
      yearsTraining: d.level === 'beginner' ? 0 : d.level === 'intermediate' ? 2 : d.level === 'advanced' ? 5 : 1,
      sports: [],
      equipment: d.trainsAt === 'gym' ? [...new Set([...d.equipment, 'bodyweight' as EquipmentId])] : [...new Set([...d.equipment, 'bodyweight' as EquipmentId])],
      trainsAt: d.trainsAt,
      availability: { daysPerWeek: d.preferredDays.length, preferredDays: d.preferredDays, sessionMinutes: d.sessionMinutes, preferredTime: 'flexible' },
      diet: d.diet,
      dietaryFlags: d.flags,
      dislikedFoods: [],
      lifestyle: 'moderate',
      sleepHoursTypical: 7,
      createdAt: now,
    }
    const goals: Goal[] = []
    // goal.label is the stored English canonical label; screens render goalLabel(goal.type).
    if (d.primary) goals.push({ id: uid('goal'), type: d.primary, rank: 'primary', label: goalLabel(d.primary, 'en'), createdAt: now, ...(d.primary === 'build_muscle' || d.primary === 'lose_fat' ? { metric: 'body_weight', startValue: d.weightKg, targetValue: d.primary === 'build_muscle' ? d.weightKg + 3 : d.weightKg - 4, targetUnit: 'kg' } : {}) })
    if (d.secondary) goals.push({ id: uid('goal'), type: d.secondary, rank: 'secondary', label: goalLabel(d.secondary, 'en'), createdAt: now })
    const mem = (category: MemoryItem['category'], text: string): MemoryItem => ({ id: uid('mem'), category, text, source: 'onboarding', createdAt: now })
    const equipmentList = d.equipment.map((e) => equipmentLabel(e, tr.lang).toLowerCase()).join(', ') || tr.t('onboarding.mem.bodyweightOnly')
    const dietText = dietLabel(d.diet, tr.lang).toLowerCase()
    const memory: MemoryItem[] = [
      ...(d.primary ? [mem('goal', tr.t('onboarding.mem.primaryGoal', { goal: goalLabel(d.primary, tr.lang).toLowerCase() }))] : []),
      ...(d.secondary ? [mem('goal', tr.t('onboarding.mem.secondaryGoal', { goal: goalLabel(d.secondary, tr.lang).toLowerCase() }))] : []),
      mem('availability', tr.t('onboarding.mem.availability', { days: tr.tn('common.days', d.preferredDays.length), list: d.preferredDays.map((x) => tr.weekday(x, true)).join(', '), minutes: formatMinutes(d.sessionMinutes, tr.lang) })),
      mem('equipment', tr.t('onboarding.mem.equipment', { where: tr.t(`onboarding.mem.trainsAt.${d.trainsAt}`), equipment: equipmentList })),
      mem('nutrition', d.flags.length ? tr.t('onboarding.mem.dietFlags', { diet: dietText, flags: d.flags.map((f) => dietaryFlagLabel(f, tr.lang).toLowerCase()).join(', ') }) : tr.t('onboarding.mem.diet', { diet: dietText })),
      mem('history', tr.t('onboarding.mem.level', { level: levelLabel(d.level, tr.lang) })),
    ]
    completeOnboarding({ user, goals, coach: { name: d.coachName.trim(), personality: d.personality, provider: 'local', anthropicModel: 'claude-sonnet-5' }, memory })
    startFirstConversation()
    navigate('/coach', { replace: true })
  }

  const loadDemo = () => {
    finishing.current = true
    seed(buildDemoSeed())
    navigate('/', { replace: true })
  }

  const progress = stepIdx / (STEPS.length - 1)
  const voicePreview = useMemo(() => {
    const v = buildVoice(d.personality, tr.lang)
    return v.compose({
      core: tr.t('onboarding.preview.core', { minutes: formatMinutes(d.sessionMinutes, tr.lang) }),
      reason: tr.t('onboarding.preview.reason'),
      soft: tr.t('onboarding.preview.soft'),
      push: tr.t('onboarding.preview.push'),
      calm: tr.t('onboarding.preview.calm'),
      quip: tr.t('onboarding.preview.quip'),
      extra: tr.t('onboarding.preview.extra'),
    })
  }, [d.personality, d.sessionMinutes, tr])

  const variants = {
    enter: (dir: number) => ({ opacity: 0, x: reduce ? 0 : dir * 28 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: reduce ? 0 : dir * -28 }),
  }

  return (
    <div className="min-h-dvh flex flex-col max-w-[520px] mx-auto">
      {step !== 'welcome' && (
        <div className="pt-safe px-4">
          <div className="flex items-center gap-3 h-14">
            <button aria-label={tr.t('common.back')} onClick={() => go(-1)} className="h-10 w-10 -ml-2 rounded-full flex items-center justify-center text-text-2 hover:text-text">
              <ChevronLeft size={22} />
            </button>
            <div className="flex-1 h-1 rounded-full bg-surface-2 overflow-hidden">
              <motion.div className="h-full bg-accent rounded-full" animate={{ width: `${progress * 100}%` }} transition={{ type: 'spring', stiffness: 200, damping: 30 }} />
            </div>
            <span className="text-[12px] text-text-3 tabular w-10 text-right">
              {stepIdx}/{STEPS.length - 1}
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 px-5 pb-6 flex flex-col">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div key={step} custom={dir} variants={variants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="flex-1 flex flex-col">
            {step === 'welcome' && (
              <div className="flex-1 flex flex-col justify-between pt-safe">
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}>
                    <CoachMark size={72} active />
                  </motion.div>
                  <motion.h1 className="display text-[44px] mt-8" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
                    Sportly
                  </motion.h1>
                  <motion.p className="text-[17px] text-text-2 mt-2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
                    {tr.t('common.tagline')}
                  </motion.p>
                  <motion.p className="text-[15px] text-text-3 mt-8 max-w-[300px] text-pretty leading-relaxed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                    {tr.t('onboarding.welcomeBody')}
                  </motion.p>
                </div>
                <motion.div className="space-y-3 pb-safe" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
                  <Button variant="primary" size="lg" full onClick={() => go(1)} iconRight={<ArrowRight size={18} />}>
                    {tr.t('onboarding.meetYourCoach')}
                  </Button>
                  <Button variant="ghost" size="lg" full onClick={loadDemo}>
                    {tr.t('onboarding.exploreDemo')}
                  </Button>
                  <p className="text-center text-[12px] text-text-4 pt-1">{tr.t('onboarding.staysOnDevice')}</p>
                </motion.div>
              </div>
            )}

            {step === 'name' && (
              <StepFrame q={tr.t('onboarding.nameQ')} hint={tr.t('onboarding.nameHint')}>
                <TextInput autoFocus value={d.name} onChange={(e) => patch({ name: e.target.value })} placeholder={tr.t('onboarding.namePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && canContinue && go(1)} maxLength={32} autoComplete="given-name" />
              </StepFrame>
            )}

            {step === 'basics' && (
              <StepFrame q={tr.t('onboarding.basicsQ', { name: d.name.trim() || tr.t('onboarding.friend') })} hint={tr.t('onboarding.basicsHint')}>
                <div className="space-y-4">
                  <Row label={tr.t('profile.age')}>
                    <Stepper value={d.age} min={14} max={90} onChange={(v) => patch({ age: v })} />
                  </Row>
                  <Row label={tr.t('profile.height')}>
                    <Stepper value={d.heightCm} min={120} max={230} unit={tr.t('common.cm')} onChange={(v) => patch({ heightCm: v })} />
                  </Row>
                  <Row label={tr.t('profile.weight')}>
                    <Stepper value={d.weightKg} min={35} max={250} step={0.5} unit={tr.t('common.kg')} format={(v) => tr.dec(v, 1)} onChange={(v) => patch({ weightKg: v })} />
                  </Row>
                  <Row label={tr.t('onboarding.sex')}>
                    <div className="flex gap-2">
                      {(['male', 'female', 'unspecified'] as const).map((s) => (
                        <Chip key={s} size="sm" selected={d.sex === s} onClick={() => patch({ sex: s })}>
                          {tr.t(`sex.${s}`)}
                        </Chip>
                      ))}
                    </div>
                  </Row>
                  <p className="text-[12px] text-text-4">{tr.t('onboarding.sexNote')}</p>
                </div>
              </StepFrame>
            )}

            {step === 'level' && (
              <StepFrame q={tr.t('onboarding.levelQ')}>
                <div className="space-y-2">
                  {LEVELS.map((lvl) => (
                    <OptionCard key={lvl} selected={d.level === lvl} title={levelLabel(lvl)} body={levelDescription(lvl)} onClick={() => patch({ level: lvl })} />
                  ))}
                </div>
              </StepFrame>
            )}

            {step === 'goal' && (
              <StepFrame q={tr.t('onboarding.goalQ')} hint={tr.t('onboarding.goalHint')}>
                <div className="space-y-2">
                  {GOAL_OPTIONS.map((g) => (
                    <OptionCard key={g} selected={d.primary === g} title={goalLabel(g)} body={goalDescription(g)} onClick={() => patch({ primary: g, secondary: d.secondary === g ? undefined : d.secondary })} compact />
                  ))}
                </div>
              </StepFrame>
            )}

            {step === 'secondary' && (
              <StepFrame q={tr.t('onboarding.secondaryQ')} hint={tr.t('onboarding.secondaryHint')}>
                <div className="flex flex-wrap gap-2">
                  {GOAL_OPTIONS.filter((g) => g !== d.primary).map((g) => (
                    <Chip key={g} selected={d.secondary === g} onClick={() => patch({ secondary: d.secondary === g ? undefined : g })}>
                      {goalLabel(g)}
                    </Chip>
                  ))}
                </div>
              </StepFrame>
            )}

            {step === 'availability' && (
              <StepFrame q={tr.t('onboarding.availabilityQ')} hint={tr.t('onboarding.availabilityHint')}>
                <div className="space-y-6">
                  <div className="flex justify-between">
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                      const on = d.preferredDays.includes(day)
                      return (
                        <button
                          key={day}
                          aria-pressed={on}
                          onClick={() => patch({ preferredDays: on ? d.preferredDays.filter((x) => x !== day) : [...d.preferredDays, day].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) })}
                          className={cn('h-12 w-12 rounded-full text-[13px] font-semibold transition-colors', on ? 'bg-accent text-accent-ink' : 'bg-surface text-text-2 border border-border')}
                        >
                          {weekdayInitials(day, tr.lang)}
                        </button>
                      )
                    })}
                  </div>
                  <div className="text-center text-[14px] text-text-2">
                    <span className="text-text font-semibold">{d.preferredDays.length}</span> {tr.tn('onboarding.daysAWeek', d.preferredDays.length)}
                  </div>
                  <Slider label={tr.t('profile.sessionLength')} value={d.sessionMinutes} min={20} max={90} step={5} onChange={(v) => patch({ sessionMinutes: v })} format={(v) => formatMinutes(v)} leftLabel={`20 ${tr.t('common.min')}`} rightLabel={`90 ${tr.t('common.min')}`} />
                </div>
              </StepFrame>
            )}

            {step === 'equipment' && (
              <StepFrame q={tr.t('onboarding.equipmentQ')} hint={tr.t('onboarding.equipmentHint')}>
                <div className="space-y-5">
                  <div className="flex gap-2">
                    {(['gym', 'home', 'both'] as const).map((t) => (
                      <Chip key={t} selected={d.trainsAt === t} onClick={() => patch({ trainsAt: t, equipment: t === 'gym' ? ['barbell', 'dumbbell', 'cable', 'machine', 'bench', 'pullup_bar', 'cardio_machine'] : t === 'home' ? ['dumbbell', 'band'] : d.equipment })}>
                        {tr.t(`trainsAt.${t}`)}
                      </Chip>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {EQUIPMENT_OPTIONS.map((e) => {
                      const on = d.equipment.includes(e)
                      return (
                        <Chip key={e} selected={on} onClick={() => patch({ equipment: on ? d.equipment.filter((x) => x !== e) : [...d.equipment, e] })}>
                          {equipmentLabel(e)}
                        </Chip>
                      )
                    })}
                  </div>
                </div>
              </StepFrame>
            )}

            {step === 'nutrition' && (
              <StepFrame q={tr.t('onboarding.nutritionQ')} hint={tr.t('onboarding.nutritionHint')}>
                <div className="space-y-5">
                  <div className="flex flex-wrap gap-2">
                    {DIETS.map((k) => (
                      <Chip key={k} selected={d.diet === k} onClick={() => patch({ diet: k })}>
                        {dietLabel(k)}
                      </Chip>
                    ))}
                  </div>
                  <div>
                    <div className="label mb-2">{tr.t('onboarding.also')}</div>
                    <div className="flex flex-wrap gap-2">
                      {DIETARY_FLAGS.map((f) => {
                        const on = d.flags.includes(f)
                        return (
                          <Chip key={f} size="sm" selected={on} onClick={() => patch({ flags: on ? d.flags.filter((x) => x !== f) : [...d.flags, f] })}>
                            {dietaryFlagLabel(f)}
                          </Chip>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </StepFrame>
            )}

            {step === 'coachName' && (
              <StepFrame q={tr.t('onboarding.coachNameQ')} hint={tr.t('onboarding.coachNameHint')}>
                <TextInput autoFocus value={d.coachName} onChange={(e) => patch({ coachName: e.target.value })} placeholder={tr.t('profile.coachName')} maxLength={20} onKeyDown={(e) => e.key === 'Enter' && canContinue && go(1)} />
                <div className="flex flex-wrap gap-2 mt-4">
                  {COACH_NAMES.map((n) => (
                    <Chip key={n} size="sm" selected={d.coachName === n} onClick={() => patch({ coachName: n })}>
                      {n}
                    </Chip>
                  ))}
                </div>
              </StepFrame>
            )}

            {step === 'personality' && (
              <StepFrame q={tr.t('onboarding.personalityQ', { name: d.coachName.trim() || tr.t('onboarding.yourCoach') })} hint={tr.t('onboarding.personalityHint')}>
                <div className="space-y-5">
                  <Slider label={tr.t('profile.motivation')} value={d.personality.motivation} onChange={(v) => patch({ personality: { ...d.personality, motivation: v } })} leftLabel={tr.t('profile.calm')} rightLabel={tr.t('profile.intense')} />
                  <Slider label={tr.t('profile.tone')} value={d.personality.tone} onChange={(v) => patch({ personality: { ...d.personality, tone: v } })} leftLabel={tr.t('profile.gentle')} rightLabel={tr.t('profile.direct')} />
                  <Slider label={tr.t('profile.humor')} value={d.personality.humor} onChange={(v) => patch({ personality: { ...d.personality, humor: v } })} leftLabel={tr.t('profile.serious')} rightLabel={tr.t('profile.playful')} />
                  <Slider label={tr.t('profile.communication')} value={d.personality.communication} onChange={(v) => patch({ personality: { ...d.personality, communication: v } })} leftLabel={tr.t('profile.concise')} rightLabel={tr.t('profile.detailed')} />
                  <div className="rounded-[18px] bg-surface border border-border p-4 flex gap-3">
                    <CoachMark size={22} className="mt-0.5" />
                    <p className="text-[14px] leading-relaxed text-text-2">
                      <span className="text-text-3 text-[12px] block mb-1">{tr.t('onboarding.wouldSay', { name: d.coachName.trim() || tr.t('profile.coach') })}</span>
                      {voicePreview}
                    </p>
                  </div>
                </div>
              </StepFrame>
            )}

            {step === 'ready' && (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <CoachMark size={64} active />
                <h2 className="display text-[32px] mt-8">{tr.t('onboarding.meet', { name: d.coachName.trim() })}</h2>
                <p className="text-[15px] text-text-2 mt-3 max-w-[300px] text-pretty leading-relaxed">{tr.t('onboarding.readyBody', { name: d.coachName.trim() })}</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {step !== 'welcome' && (
          <div className="pt-4 pb-safe">
            {step === 'ready' ? (
              <Button variant="primary" size="lg" full onClick={finish} iconRight={<ArrowRight size={18} />}>
                {tr.t('onboarding.startCoaching')}
              </Button>
            ) : (
              <Button variant="primary" size="lg" full disabled={!canContinue} onClick={() => go(1)} iconRight={<ArrowRight size={18} />}>
                {step === 'secondary' && !d.secondary ? tr.t('common.skip') : tr.t('common.continue')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StepFrame({ q, hint, children }: { q: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex gap-3 mt-4 mb-7">
        <CoachMark size={24} className="mt-1.5" />
        <div>
          <h2 className="title text-[24px] text-balance">{q}</h2>
          {hint && <p className="text-[14px] text-text-3 mt-2 text-pretty">{hint}</p>}
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[15px] font-medium">{label}</span>
      {children}
    </div>
  )
}

function OptionCard({ selected, title, body, onClick, compact }: { selected: boolean; title: string; body: string; onClick: () => void; compact?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={cn('w-full text-left rounded-[18px] border px-4 transition-colors active:scale-[0.99]', compact ? 'py-3' : 'py-3.5', selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:border-border-strong')}
    >
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className={cn('h-5 w-5 rounded-full border-2 flex items-center justify-center', selected ? 'border-accent bg-accent' : 'border-border-strong')}>{selected && <span className="h-2 w-2 rounded-full bg-accent-ink" />}</span>
      </div>
      <p className={cn('text-text-3 mt-0.5', compact ? 'text-[12.5px]' : 'text-[13px]')}>{body}</p>
    </button>
  )
}

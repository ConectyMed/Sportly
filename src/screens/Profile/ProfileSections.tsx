import { Pin, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { coachEngineStatus, requestPushPermission } from '@/coach/coachService'
import { DEFAULT_LOCAL_LLM_URL, type ProviderId } from '@/coach/model'
import { buildVoice, describePersonality } from '@/coach/personality'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/Card'
import { Chip, Tag } from '@/components/ui/Chip'
import { CoachMark, EmptyState, Group, ListRow, Stepper, TextInput, Toggle } from '@/components/ui/Primitives'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { Slider } from '@/components/ui/Slider'
import { buildDemoSeed } from '@/domain/demo'
import { DIETARY_FLAGS, DIETS, LEVELS, dietLabel, dietaryFlagLabel, equipmentLabel, levelLabel, memoryCategoryLabel } from '@/domain/labels'
import type { CoachConfig, EquipmentId, MemoryCategory } from '@/domain/types'
import { LANGUAGE_NAMES, weekdayInitials, type MessageKey } from '@/i18n'
import { useT } from '@/i18n/react'
import { relativeDay } from '@/lib/dates'
import { cn, formatMinutes } from '@/lib/utils'
import { userAction } from '@/coach/userActions'
import { STORAGE_KEY, useStore } from '@/store/useStore'

export function ProfileSection() {
  const { section } = useParams()
  switch (section) {
    case 'personal':
      return <PersonalSection />
    case 'training':
      return <TrainingSection />
    case 'nutrition':
      return <NutritionSection />
    case 'coach':
      return <CoachSection />
    case 'memory':
      return <MemorySection />
    case 'notifications':
      return <NotificationsSection />
    case 'appearance':
      return <AppearanceSection />
    case 'privacy':
      return <PrivacySection />
    case 'account':
      return <AccountSection />
    default:
      return <PersonalSection />
  }
}

function Row({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 min-h-[56px] py-2">
      <div>
        <div className="text-[15px] font-medium">{label}</div>
        {sub && <div className="text-[12.5px] text-text-3">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ Personal */
function PersonalSection() {
  const tr = useT()
  const user = useStore((s) => s.user)!
  const update = useStore((s) => s.updateUser)
  const addMeasurement = useStore((s) => s.addMeasurement)
  const navigate = useNavigate()
  return (
    <Page back="/profile" title={tr.t('profile.personal')}>
      <Group className="mt-2">
        <div className="px-4 py-3">
          <div className="text-[12.5px] text-text-3 mb-1.5">{tr.t('profile.name')}</div>
          <TextInput value={user.name} onChange={(e) => update({ name: e.target.value })} maxLength={32} />
        </div>
        <Row label={tr.t('profile.age')}>
          <Stepper value={user.age} min={14} max={90} onChange={(v) => update({ age: v })} />
        </Row>
        <Row label={tr.t('profile.height')}>
          <Stepper value={user.heightCm} min={120} max={230} unit={tr.t('common.cm')} onChange={(v) => update({ heightCm: v })} />
        </Row>
        <Row label={tr.t('profile.weight')} sub={tr.t('profile.weightSub')}>
          <Stepper
            value={user.weightKg}
            min={35}
            max={250}
            step={0.5}
            unit={tr.t('common.kg')}
            format={(v) => tr.dec(v, 1)}
            onChange={(v) => {
              update({ weightKg: v })
              addMeasurement({ type: 'body_weight', value: v, unit: 'kg', date: new Date().toISOString().slice(0, 10), source: 'user' })
            }}
          />
        </Row>
        <Row label={tr.t('profile.lifestyle')} sub={tr.t('profile.lifestyleSub')}>
          <div className="flex gap-1.5 flex-wrap justify-end">
            {(['sedentary', 'light', 'moderate', 'active'] as const).map((l) => (
              <Chip key={l} size="sm" selected={user.lifestyle === l} onClick={() => update({ lifestyle: l })}>
                {tr.t(`lifestyle.${l}`)}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label={tr.t('profile.typicalSleep')}>
          <Stepper value={user.sleepHoursTypical} min={4} max={10} step={0.5} unit={tr.t('common.h')} format={(v) => tr.dec(v, 1)} onChange={(v) => update({ sleepHoursTypical: v })} />
        </Row>
      </Group>
      <Group className="mt-4">
        <ListRow label={tr.t('profile.goals')} sub={tr.t('profile.goalsSub')} onClick={() => navigate('/goals')} />
      </Group>
    </Page>
  )
}

/* ------------------------------------------------------------------ Training */
function TrainingSection() {
  const tr = useT()
  const user = useStore((s) => s.user)!
  const update = useStore((s) => s.updateUser)
  const EQUIPMENT_OPTIONS: EquipmentId[] = ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bench', 'pullup_bar', 'band', 'cardio_machine']
  return (
    <Page back="/profile" title={tr.t('profile.training')}>
      <SectionLabel className="mt-3">{tr.t('profile.level')}</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {LEVELS.map((l) => (
          <Chip key={l} selected={user.level === l} onClick={() => update({ level: l })}>
            {levelLabel(l)}
          </Chip>
        ))}
      </div>
      <SectionLabel className="mt-6">{tr.t('profile.trainingDays')}</SectionLabel>
      <div className="flex justify-between">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const on = user.availability.preferredDays.includes(day)
          return (
            <button
              key={day}
              aria-pressed={on}
              onClick={() => {
                const preferredDays = on ? user.availability.preferredDays.filter((x) => x !== day) : [...user.availability.preferredDays, day].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
                update({ availability: { ...user.availability, preferredDays, daysPerWeek: Math.max(1, preferredDays.length) } })
              }}
              className={cn('h-11 w-11 rounded-full text-[13px] font-semibold', on ? 'bg-accent text-accent-ink' : 'bg-surface text-text-2 border border-border')}
            >
              {weekdayInitials(day, tr.lang)}
            </button>
          )
        })}
      </div>
      <div className="mt-5">
        <Slider label={tr.t('profile.sessionLength')} value={user.availability.sessionMinutes} min={20} max={90} step={5} onChange={(v) => update({ availability: { ...user.availability, sessionMinutes: v } })} format={(v) => formatMinutes(v)} leftLabel={`20 ${tr.t('common.min')}`} rightLabel={`90 ${tr.t('common.min')}`} />
      </div>
      <SectionLabel className="mt-6">{tr.t('profile.where')}</SectionLabel>
      <div className="flex gap-2">
        {(['gym', 'home', 'both'] as const).map((t) => (
          <Chip key={t} selected={user.trainsAt === t} onClick={() => update({ trainsAt: t })}>
            {tr.t(`trainsAt.${t}`)}
          </Chip>
        ))}
      </div>
      <SectionLabel className="mt-6">{tr.t('profile.equipment')}</SectionLabel>
      <div className="flex flex-wrap gap-2 pb-4">
        {EQUIPMENT_OPTIONS.map((e) => {
          const on = user.equipment.includes(e)
          return (
            <Chip key={e} selected={on} onClick={() => update({ equipment: on ? user.equipment.filter((x) => x !== e) : [...user.equipment, e] })}>
              {equipmentLabel(e)}
            </Chip>
          )
        })}
      </div>
      <p className="text-[12.5px] text-text-3">{tr.t('profile.equipmentNote')}</p>
    </Page>
  )
}

/* ------------------------------------------------------------------ Nutrition */
function NutritionSection() {
  const tr = useT()
  const user = useStore((s) => s.user)!
  const update = useStore((s) => s.updateUser)
  const [dislike, setDislike] = useState('')
  return (
    <Page back="/profile" title={tr.t('profile.nutrition')}>
      <SectionLabel className="mt-3">{tr.t('profile.diet')}</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {DIETS.map((k) => (
          <Chip key={k} selected={user.diet === k} onClick={() => update({ diet: k })}>
            {dietLabel(k)}
          </Chip>
        ))}
      </div>
      <SectionLabel className="mt-6">{tr.t('profile.dietaryPreferences')}</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {DIETARY_FLAGS.map((f) => {
          const on = user.dietaryFlags.includes(f)
          return (
            <Chip key={f} selected={on} onClick={() => update({ dietaryFlags: on ? user.dietaryFlags.filter((x) => x !== f) : [...user.dietaryFlags, f] })}>
              {dietaryFlagLabel(f)}
            </Chip>
          )
        })}
      </div>
      <SectionLabel className="mt-6">{tr.t('profile.foodsToAvoid')}</SectionLabel>
      <div className="flex gap-2">
        <TextInput
          value={dislike}
          onChange={(e) => setDislike(e.target.value)}
          placeholder={tr.t('profile.foodsToAvoidPlaceholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dislike.trim()) {
              update({ dislikedFoods: [...user.dislikedFoods, dislike.trim()] })
              setDislike('')
            }
          }}
        />
        <Button
          variant="secondary"
          size="icon"
          aria-label={tr.t('common.add')}
          onClick={() => {
            if (dislike.trim()) {
              update({ dislikedFoods: [...user.dislikedFoods, dislike.trim()] })
              setDislike('')
            }
          }}
        >
          <Plus size={18} />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {user.dislikedFoods.map((f) => (
          <Chip key={f} size="sm" onClick={() => update({ dislikedFoods: user.dislikedFoods.filter((x) => x !== f) })}>
            {f} ×
          </Chip>
        ))}
      </div>
      <p className="text-[12.5px] text-text-3 mt-6">{tr.t('profile.nutritionNote')}</p>
    </Page>
  )
}

/* ------------------------------------------------------------------ Coach */
function CoachSection() {
  const tr = useT()
  const coach = useStore((s) => s.coach)
  const updateCoach = useStore((s) => s.updateCoach)
  const updatePersonality = useStore((s) => s.updatePersonality)
  const user = useStore((s) => s.user)!
  const [sheet, setSheet] = useState<Exclude<ProviderId, 'local'> | null>(null)
  const status = coachEngineStatus({ coach })
  const providerLabel = (id: ProviderId) => tr.t(`profile.provider.${id}`)
  const preview = useMemo(() => {
    const v = buildVoice(coach.personality, tr.lang)
    return v.compose({
      core: tr.t('profile.preview.core', { name: user.name.split(' ')[0], minutes: formatMinutes(user.availability.sessionMinutes, tr.lang) }),
      reason: tr.t('profile.preview.reason'),
      soft: tr.t('profile.preview.soft'),
      push: tr.t('profile.preview.push'),
      calm: tr.t('profile.preview.calm'),
      quip: tr.t('profile.preview.quip'),
      extra: tr.t('profile.preview.extra'),
    })
  }, [coach.personality, user, tr])

  const inUse = (base: string, active: boolean) => (active ? tr.t('profile.inUse', { base }) : base)

  return (
    <Page back="/profile" title={tr.t('profile.coach')}>
      <div className="flex items-center gap-4 mt-3">
        <CoachMark size={44} active />
        <div className="flex-1">
          <div className="text-[12.5px] text-text-3 mb-1">{tr.t('profile.coachName')}</div>
          <TextInput value={coach.name} onChange={(e) => updateCoach({ name: e.target.value })} maxLength={20} />
        </div>
      </div>

      <SectionLabel className="mt-7">{tr.t('profile.personality')}</SectionLabel>
      <Card>
        <div className="space-y-5">
          <Slider label={tr.t('profile.motivation')} value={coach.personality.motivation} onChange={(v) => updatePersonality({ motivation: v })} leftLabel={tr.t('profile.calm')} rightLabel={tr.t('profile.intense')} />
          <Slider label={tr.t('profile.tone')} value={coach.personality.tone} onChange={(v) => updatePersonality({ tone: v })} leftLabel={tr.t('profile.gentle')} rightLabel={tr.t('profile.direct')} />
          <Slider label={tr.t('profile.humor')} value={coach.personality.humor} onChange={(v) => updatePersonality({ humor: v })} leftLabel={tr.t('profile.serious')} rightLabel={tr.t('profile.playful')} />
          <Slider label={tr.t('profile.communication')} value={coach.personality.communication} onChange={(v) => updatePersonality({ communication: v })} leftLabel={tr.t('profile.concise')} rightLabel={tr.t('profile.detailed')} />
        </div>
      </Card>
      <div className="mt-3 rounded-[18px] bg-surface border border-border p-4 flex gap-3">
        <CoachMark size={20} className="mt-0.5" />
        <div>
          <div className="text-[11.5px] text-text-3 mb-1">
            {coach.name} · {describePersonality(coach.personality, tr.lang)}
          </div>
          <p className="text-[14px] leading-relaxed text-text-2">{preview}</p>
        </div>
      </div>

      <SectionLabel className="mt-7">{tr.t('profile.intelligence')}</SectionLabel>
      <Group>
        <ListRow label={providerLabel('local')} sub={tr.t('profile.builtInSub')} right={<Toggle checked={coach.provider === 'local'} onChange={() => updateCoach({ provider: 'local' })} label={tr.t('profile.useBuiltIn')} />} />
        <ListRow label={tr.t('profile.claudeRow')} sub={coach.anthropicApiKey ? inUse(tr.t('profile.keySaved'), coach.provider === 'anthropic') : tr.t('profile.providerOptional')} onClick={() => setSheet('anthropic')} />
        <ListRow label={tr.t('profile.openaiRow')} sub={coach.openaiApiKey ? inUse(tr.t('profile.keySaved'), coach.provider === 'openai') : tr.t('profile.providerOptional')} onClick={() => setSheet('openai')} />
        <ListRow label={tr.t('profile.localModelRow')} sub={coach.localLlmModel ? inUse(tr.t('profile.localModelAt', { model: coach.localLlmModel, url: coach.localLlmUrl || DEFAULT_LOCAL_LLM_URL }), coach.provider === 'local_llm') : tr.t('profile.localModelOptional')} onClick={() => setSheet('local_llm')} />
      </Group>
      <p className="text-[12px] text-text-3 mt-2" data-testid="coach-engine-status">
        {tr.t('profile.answeringNow', { label: providerLabel(status.active) })}{status.reason ? ` ${status.reason}` : ''} {tr.t('profile.engineNote')}
      </p>

      <ProviderSheet which={sheet} coach={coach} onClose={() => setSheet(null)} onSave={(patch) => updateCoach(patch)} />
    </Page>
  )
}

const PROVIDER_FIELDS: Record<Exclude<ProviderId, 'local'>, { title: MessageKey; intro: MessageKey; secret?: keyof CoachConfig; model: keyof CoachConfig; url?: keyof CoachConfig; modelPlaceholder: string; secretPlaceholder?: string }> = {
  anthropic: { title: 'profile.connect.anthropic.title', intro: 'profile.connect.anthropic.intro', secret: 'anthropicApiKey', model: 'anthropicModel', modelPlaceholder: 'claude-sonnet-5', secretPlaceholder: 'sk-ant-…' },
  openai: { title: 'profile.connect.openai.title', intro: 'profile.connect.openai.intro', secret: 'openaiApiKey', model: 'openaiModel', modelPlaceholder: 'gpt-4.1-mini', secretPlaceholder: 'sk-…' },
  local_llm: { title: 'profile.connect.local_llm.title', intro: 'profile.connect.local_llm.intro', model: 'localLlmModel', url: 'localLlmUrl', modelPlaceholder: 'llama3.1' },
}

function ProviderSheet({ which, coach, onClose, onSave }: { which: Exclude<ProviderId, 'local'> | null; coach: CoachConfig; onClose: () => void; onSave: (patch: Partial<CoachConfig>) => void }) {
  const tr = useT()
  const f = which ? PROVIDER_FIELDS[which] : undefined
  const [secret, setSecret] = useState('')
  const [model, setModel] = useState('')
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState<ProviderId | null>(null)
  if (which && editing !== which) {
    // Fresh sheet: load the saved values for this provider.
    setEditing(which)
    setSecret(f?.secret ? ((coach[f.secret] as string | undefined) ?? '') : '')
    setModel(f ? ((coach[f.model] as string | undefined) ?? '') : '')
    setUrl(f?.url ? ((coach[f.url] as string | undefined) ?? '') : '')
  }
  const configured = which ? Boolean(f?.secret ? coach[f.secret] : coach[f!.model]) : false
  const canSave = f ? (f.secret ? secret.trim().length > 8 : model.trim().length > 0) : false
  const label = which ? tr.t(`profile.provider.${which}`) : ''
  return (
    <Sheet open={Boolean(which)} onClose={onClose} title={f ? tr.t(f.title) : ''}>
      {f && which && (
        <>
          <p className="text-[13.5px] text-text-2 mb-3">{tr.t(f.intro)}</p>
          <div className="space-y-2.5">
            {f.secret && <TextInput value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={f.secretPlaceholder} type="password" autoComplete="off" aria-label={tr.t('profile.apiKey')} />}
            {f.url && <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_LOCAL_LLM_URL} autoComplete="off" aria-label={tr.t('profile.endpointUrl')} />}
            <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder={tr.t('profile.modelPlaceholder', { example: f.modelPlaceholder })} autoComplete="off" aria-label={tr.t('profile.modelName')} />
          </div>
          <div className="flex gap-2 mt-4 pb-2">
            {configured && (
              <Button
                variant="danger"
                onClick={() => {
                  const patch: Partial<CoachConfig> = { provider: 'local' }
                  if (f.secret) patch[f.secret] = undefined as never
                  patch[f.model] = undefined as never
                  if (f.url) patch[f.url] = undefined as never
                  onSave(patch)
                  onClose()
                }}
              >
                {tr.t('common.remove')}
              </Button>
            )}
            <Button
              variant="primary"
              full
              disabled={!canSave}
              onClick={() => {
                const patch: Partial<CoachConfig> = { provider: which }
                if (f.secret) patch[f.secret] = secret.trim() as never
                patch[f.model] = (model.trim() || f.modelPlaceholder) as never
                if (f.url) patch[f.url] = (url.trim() || DEFAULT_LOCAL_LLM_URL) as never
                onSave(patch)
                onClose()
                useStore.getState().toast(tr.t('profile.connected', { label }), 'success')
              }}
            >
              {tr.t('profile.saveAndUse', { label })}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  )
}

/* ------------------------------------------------------------------ Memory */
function MemorySection() {
  const tr = useT()
  const memory = useStore((s) => s.memory)
  const coach = useStore((s) => s.coach)
  const addMemory = (item: { category: MemoryCategory; text: string; source: 'user' }) => {
    const r = userAction({ type: 'remember', item })
    if (!r.ok) useStore.getState().toast(r.summary, 'error')
  }
  const removeMemory = (memoryId: string) => userAction({ type: 'forget', memoryId })
  const updateMemory = useStore((s) => s.updateMemory)
  const [text, setText] = useState('')
  const grouped = useMemo(() => {
    const map = new Map<MemoryCategory, typeof memory>()
    for (const m of [...memory].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))) {
      const list = map.get(m.category) ?? []
      list.push(m)
      map.set(m.category, list)
    }
    return [...map.entries()]
  }, [memory])

  return (
    <Page back="/profile" title={tr.t('profile.memoryTitle', { name: coach.name })}>
      <p className="text-[13.5px] text-text-3 mt-2 mb-4">{tr.t('profile.memoryIntro', { name: coach.name })}</p>
      <div className="flex gap-2 mb-5">
        <TextInput
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tr.t('profile.memoryPlaceholder', { name: coach.name })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              addMemory({ category: 'note', text: text.trim(), source: 'user' })
              setText('')
            }
          }}
        />
        <Button
          variant="primary"
          size="icon"
          aria-label={tr.t('profile.addMemory')}
          onClick={() => {
            if (text.trim()) {
              addMemory({ category: 'note', text: text.trim(), source: 'user' })
              setText('')
            }
          }}
        >
          <Plus size={18} />
        </Button>
      </div>
      {memory.length === 0 ? (
        <Card>
          <EmptyState icon={<CoachMark size={36} />} title={tr.t('profile.memoryEmpty')} body={tr.t('profile.memoryEmptyBody', { name: coach.name })} />
        </Card>
      ) : (
        <div className="space-y-5 pb-4">
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <SectionLabel>{memoryCategoryLabel(cat)}</SectionLabel>
              <Group>
                {items.map((m) => (
                  <div key={m.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[14.5px] leading-snug">{m.text}</div>
                      <div className="text-[11.5px] text-text-4 mt-1 flex items-center gap-2">
                        <span>{tr.t(`memorySource.${m.source}`)}</span>
                        <span>·</span>
                        <span>{relativeDay(m.createdAt)}</span>
                        {m.pinned && <Tag tone="accent">{tr.t('profile.pinned')}</Tag>}
                      </div>
                    </div>
                    <button aria-label={m.pinned ? tr.t('profile.unpin') : tr.t('profile.pin')} onClick={() => updateMemory(m.id, { pinned: !m.pinned })} className={cn('h-8 w-8 rounded-full flex items-center justify-center', m.pinned ? 'text-accent-text' : 'text-text-4 hover:text-text-2')}>
                      <Pin size={15} />
                    </button>
                    <button aria-label={tr.t('profile.forget')} onClick={() => removeMemory(m.id)} className="h-8 w-8 rounded-full flex items-center justify-center text-text-4 hover:text-danger">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </Group>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}

/* ------------------------------------------------------------------ Notifications */
function NotificationsSection() {
  const tr = useT()
  const prefs = useStore((s) => s.preferences.notifications)
  const update = useStore((s) => s.updateNotificationPreferences)
  const coach = useStore((s) => s.coach)
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  return (
    <Page back="/profile" title={tr.t('common.notifications')}>
      <Group className="mt-3">
        <ListRow label={tr.t('common.notifications')} sub={tr.t('profile.notificationsSub', { name: coach.name })} right={<Toggle checked={prefs.enabled} onChange={(v) => update({ enabled: v })} label={tr.t('profile.enableNotifications')} />} />
      </Group>
      <Group className={cn('mt-4', !prefs.enabled && 'opacity-50 pointer-events-none')}>
        <ListRow label={tr.t('profile.morningPlan')} sub={tr.t('profile.morningPlanSub')} right={<Toggle checked={prefs.morningPlan} onChange={(v) => update({ morningPlan: v })} label={tr.t('profile.morningPlan')} />} />
        <ListRow label={tr.t('profile.workoutReminders')} sub={tr.t('profile.minutesBefore', { minutes: tr.tn('common.minutes', prefs.reminderMinutesBefore) })} right={<Toggle checked={prefs.workoutReminders} onChange={(v) => update({ workoutReminders: v })} label={tr.t('profile.workoutReminders')} />} />
        <Row label={tr.t('profile.remindMe')}>
          <div className="flex gap-1.5">
            {[15, 30, 60].map((m) => (
              <Chip key={m} size="sm" selected={prefs.reminderMinutesBefore === m} onClick={() => update({ reminderMinutesBefore: m })}>
                {m} {tr.t('common.min')}
              </Chip>
            ))}
          </div>
        </Row>
        <ListRow label={tr.t('profile.recoveryInsights')} sub={tr.t('profile.recoveryInsightsSub')} right={<Toggle checked={prefs.recoveryInsights} onChange={(v) => update({ recoveryInsights: v })} label={tr.t('profile.recoveryInsights')} />} />
        <ListRow label={tr.t('profile.missedWorkoutNudge')} sub={tr.t('profile.missedWorkoutNudgeSub')} right={<Toggle checked={prefs.missedWorkoutNudge} onChange={(v) => update({ missedWorkoutNudge: v })} label={tr.t('profile.missedWorkoutNudge')} />} />
        <ListRow label={tr.t('profile.nutrition')} sub={tr.t('profile.nutritionNudgeSub')} right={<Toggle checked={prefs.nutrition} onChange={(v) => update({ nutrition: v })} label={tr.t('profile.nutrition')} />} />
      </Group>
      <Group className="mt-4">
        <ListRow
          label={tr.t('profile.deviceNotifications')}
          sub={permission === 'granted' ? tr.t('profile.permGranted') : permission === 'denied' ? tr.t('profile.permDenied') : permission === 'unsupported' ? tr.t('profile.permUnsupported') : tr.t('profile.permDefault')}
          onClick={permission === 'default' ? () => requestPushPermission().then(() => useStore.getState().toast(tr.t('common.updated'), 'success')) : undefined}
        />
      </Group>
      <p className="text-[12px] text-text-3 mt-3">{tr.t('profile.quietHours', { start: prefs.quietHours.start, end: prefs.quietHours.end, name: coach.name })}</p>
    </Page>
  )
}

/* ------------------------------------------------------------------ Appearance */
function AppearanceSection() {
  const tr = useT()
  const prefs = useStore((s) => s.preferences)
  const update = useStore((s) => s.updatePreferences)
  const setTheme = useStore((s) => s.setTheme)
  const language = useStore((s) => s.preferences.language)
  const setLanguage = useStore((s) => s.setLanguage)
  return (
    <Page back="/profile" title={tr.t('profile.appearance')}>
      <SectionLabel className="mt-3">{tr.t('common.language')}</SectionLabel>
      <Segmented id="language" value={language} onChange={setLanguage} options={[{ value: 'fr', label: LANGUAGE_NAMES.fr }, { value: 'en', label: LANGUAGE_NAMES.en }]} />
      <SectionLabel className="mt-6">{tr.t('profile.theme')}</SectionLabel>
      <Segmented id="theme" value={prefs.theme} onChange={setTheme} options={[{ value: 'dark', label: tr.t('common.dark') }, { value: 'light', label: tr.t('common.light') }, { value: 'system', label: tr.t('common.system') }]} />
      <div className="grid grid-cols-3 gap-2 mt-3">
        {(['dark', 'light', 'system'] as const).map((t) => (
          <button key={t} onClick={() => setTheme(t)} className={cn('rounded-[16px] border p-2 transition-colors', prefs.theme === t ? 'border-accent' : 'border-border')} aria-label={tr.t('profile.themeAria', { theme: tr.t(`common.${t}`).toLowerCase() })}>
            <div className={cn('rounded-[10px] h-16 p-2 flex flex-col gap-1.5', t === 'light' ? 'bg-white' : t === 'dark' ? 'bg-[#0a0a0b]' : 'bg-gradient-to-r from-[#0a0a0b] to-white')}>
              <div className={cn('h-2 w-10 rounded', t === 'light' ? 'bg-black/80' : 'bg-white/80')} />
              <div className="h-2 w-14 rounded bg-[#c6ff3f]" />
              <div className={cn('h-2 w-8 rounded', t === 'light' ? 'bg-black/20' : 'bg-white/20')} />
            </div>
          </button>
        ))}
      </div>
      <Group className="mt-6">
        <Row label={tr.t('profile.reduceMotion')} sub={tr.t('profile.reduceMotionSub')}>
          <Segmented id="motion" size="sm" className="w-[190px]" value={prefs.reducedMotion} onChange={(v) => update({ reducedMotion: v })} options={[{ value: 'system', label: tr.t('common.system') }, { value: 'on', label: tr.t('common.on') }, { value: 'off', label: tr.t('common.off') }]} />
        </Row>
        <ListRow label={tr.t('profile.hapticFeedback')} right={<Toggle checked={prefs.hapticFeedback} onChange={(v) => update({ hapticFeedback: v })} label={tr.t('profile.haptics')} />} />
        <ListRow label={tr.t('profile.autoRestTimer')} right={<Toggle checked={prefs.restTimerAutoStart} onChange={(v) => update({ restTimerAutoStart: v })} label={tr.t('profile.autoRestTimerAria')} />} />
        <ListRow label={tr.t('profile.restTimerSound')} right={<Toggle checked={prefs.restTimerSound} onChange={(v) => update({ restTimerSound: v })} label={tr.t('profile.restTimerSound')} />} />
      </Group>
    </Page>
  )
}

/* ------------------------------------------------------------------ Privacy */
function PrivacySection() {
  const tr = useT()
  const prefs = useStore((s) => s.preferences)
  const update = useStore((s) => s.updatePreferences)
  return (
    <Page back="/profile" title={tr.t('profile.privacy')}>
      <Card className="mt-3">
        <div className="text-[15px] font-semibold">{tr.t('profile.privacyTitle')}</div>
        <p className="text-[13.5px] text-text-2 mt-1.5 leading-relaxed">{tr.t('profile.privacyBody')}</p>
      </Card>
      <Group className="mt-4">
        <ListRow label={tr.t('profile.personalization')} sub={tr.t('profile.personalizationSub')} right={<Toggle checked={prefs.privacy.personalization} onChange={(v) => update({ privacy: { ...prefs.privacy, personalization: v } })} label={tr.t('profile.personalization')} />} />
        <ListRow label={tr.t('profile.analytics')} sub={tr.t('profile.analyticsSub')} right={<Toggle checked={prefs.privacy.analytics} onChange={(v) => update({ privacy: { ...prefs.privacy, analytics: v } })} label={tr.t('profile.analyticsAria')} />} />
      </Group>
    </Page>
  )
}

/* ------------------------------------------------------------------ Account */
function AccountSection() {
  const tr = useT()
  const navigate = useNavigate()
  const user = useStore((s) => s.user)!
  const resetAll = useStore((s) => s.resetAll)
  const seed = useStore((s) => s.seed)
  const [confirm, setConfirm] = useState<'reset' | 'demo' | null>(null)

  const exportData = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? '{}'
      const blob = new Blob([raw], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `sportly-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      useStore.getState().toast(tr.t('profile.exportUnavailable'), 'error')
    }
  }

  return (
    <Page back="/profile" title={tr.t('profile.account')}>
      <Card className="mt-3">
        <div className="text-[15px] font-semibold">{user.name}</div>
        <div className="text-[13px] text-text-3 mt-0.5">{tr.t('profile.since', { profile: tr.t(user.isDemo ? 'profile.localProfileDemo' : 'profile.localProfile'), date: tr.date(user.createdAt, 'date-year') })}</div>
      </Card>
      <Group className="mt-4">
        <ListRow label={tr.t('profile.exportData')} sub={tr.t('profile.exportDataSub')} onClick={exportData} />
        <ListRow label={tr.t('profile.loadDemo')} sub={tr.t('profile.loadDemoSub')} onClick={() => setConfirm('demo')} />
        <ListRow label={tr.t('profile.reset')} sub={tr.t('profile.resetSub')} danger onClick={() => setConfirm('reset')} />
      </Group>
      <Sheet open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm === 'reset' ? tr.t('profile.eraseTitle') : tr.t('profile.loadDemoTitle')}>
        <p className="text-[14px] text-text-2 mb-4">{confirm === 'reset' ? tr.t('profile.eraseBody') : tr.t('profile.loadDemoBody')}</p>
        <div className="space-y-2 pb-2">
          <Button
            variant={confirm === 'reset' ? 'danger' : 'primary'}
            full
            onClick={() => {
              if (confirm === 'reset') {
                resetAll()
                navigate('/onboarding', { replace: true })
              } else {
                seed(buildDemoSeed())
                navigate('/', { replace: true })
              }
              setConfirm(null)
            }}
          >
            {confirm === 'reset' ? tr.t('profile.eraseConfirm') : tr.t('profile.loadDemoConfirm')}
          </Button>
          <Button variant="ghost" full onClick={() => setConfirm(null)}>
            {tr.t('common.cancel')}
          </Button>
        </div>
      </Sheet>
    </Page>
  )
}

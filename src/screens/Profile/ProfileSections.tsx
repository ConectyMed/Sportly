import { Pin, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { requestPushPermission } from '@/coach/coachService'
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
import { EQUIPMENT_LABELS } from '@/domain/exercises'
import { DIET_LABELS, DIETARY_FLAG_LABELS, LEVEL_LABELS } from '@/domain/labels'
import type { DietPreference, DietaryFlag, EquipmentId, FitnessLevel, MemoryCategory } from '@/domain/types'
import { WEEKDAY_SHORT, relativeDay } from '@/lib/dates'
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
  const user = useStore((s) => s.user)!
  const update = useStore((s) => s.updateUser)
  const addMeasurement = useStore((s) => s.addMeasurement)
  const navigate = useNavigate()
  return (
    <Page back="/profile" title="Personal">
      <Group className="mt-2">
        <div className="px-4 py-3">
          <div className="text-[12.5px] text-text-3 mb-1.5">Name</div>
          <TextInput value={user.name} onChange={(e) => update({ name: e.target.value })} maxLength={32} />
        </div>
        <Row label="Age">
          <Stepper value={user.age} min={14} max={90} onChange={(v) => update({ age: v })} />
        </Row>
        <Row label="Height">
          <Stepper value={user.heightCm} min={120} max={230} unit="cm" onChange={(v) => update({ heightCm: v })} />
        </Row>
        <Row label="Weight" sub="Logs today’s weight too">
          <Stepper
            value={user.weightKg}
            min={35}
            max={250}
            step={0.5}
            unit="kg"
            format={(v) => v.toFixed(1)}
            onChange={(v) => {
              update({ weightKg: v })
              addMeasurement({ type: 'body_weight', value: v, unit: 'kg', date: new Date().toISOString().slice(0, 10), source: 'user' })
            }}
          />
        </Row>
        <Row label="Lifestyle" sub="Outside of training">
          <div className="flex gap-1.5 flex-wrap justify-end">
            {(['sedentary', 'light', 'moderate', 'active'] as const).map((l) => (
              <Chip key={l} size="sm" selected={user.lifestyle === l} onClick={() => update({ lifestyle: l })}>
                {l}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="Typical sleep">
          <Stepper value={user.sleepHoursTypical} min={4} max={10} step={0.5} unit="h" format={(v) => v.toFixed(1)} onChange={(v) => update({ sleepHoursTypical: v })} />
        </Row>
      </Group>
      <Group className="mt-4">
        <ListRow label="Goals" sub="Primary and secondary goals, targets" onClick={() => navigate('/goals')} />
      </Group>
    </Page>
  )
}

/* ------------------------------------------------------------------ Training */
function TrainingSection() {
  const user = useStore((s) => s.user)!
  const update = useStore((s) => s.updateUser)
  const EQUIPMENT_OPTIONS: EquipmentId[] = ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bench', 'pullup_bar', 'band', 'cardio_machine']
  return (
    <Page back="/profile" title="Training">
      <SectionLabel className="mt-3">Level</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(LEVEL_LABELS) as FitnessLevel[]).map((l) => (
          <Chip key={l} selected={user.level === l} onClick={() => update({ level: l })}>
            {LEVEL_LABELS[l]}
          </Chip>
        ))}
      </div>
      <SectionLabel className="mt-6">Training days</SectionLabel>
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
              {WEEKDAY_SHORT[day].slice(0, 2)}
            </button>
          )
        })}
      </div>
      <div className="mt-5">
        <Slider label="Session length" value={user.availability.sessionMinutes} min={20} max={90} step={5} onChange={(v) => update({ availability: { ...user.availability, sessionMinutes: v } })} format={(v) => formatMinutes(v)} leftLabel="20 min" rightLabel="90 min" />
      </div>
      <SectionLabel className="mt-6">Where</SectionLabel>
      <div className="flex gap-2">
        {(['gym', 'home', 'both'] as const).map((t) => (
          <Chip key={t} selected={user.trainsAt === t} onClick={() => update({ trainsAt: t })}>
            {t === 'gym' ? 'Gym' : t === 'home' ? 'Home' : 'Both'}
          </Chip>
        ))}
      </div>
      <SectionLabel className="mt-6">Equipment</SectionLabel>
      <div className="flex flex-wrap gap-2 pb-4">
        {EQUIPMENT_OPTIONS.map((e) => {
          const on = user.equipment.includes(e)
          return (
            <Chip key={e} selected={on} onClick={() => update({ equipment: on ? user.equipment.filter((x) => x !== e) : [...user.equipment, e] })}>
              {EQUIPMENT_LABELS[e]}
            </Chip>
          )
        })}
      </div>
      <p className="text-[12.5px] text-text-3">Bodyweight is always available. Your coach uses this to build every session.</p>
    </Page>
  )
}

/* ------------------------------------------------------------------ Nutrition */
function NutritionSection() {
  const user = useStore((s) => s.user)!
  const update = useStore((s) => s.updateUser)
  const [dislike, setDislike] = useState('')
  return (
    <Page back="/profile" title="Nutrition">
      <SectionLabel className="mt-3">Diet</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(DIET_LABELS) as DietPreference[]).map((k) => (
          <Chip key={k} selected={user.diet === k} onClick={() => update({ diet: k })}>
            {DIET_LABELS[k]}
          </Chip>
        ))}
      </div>
      <SectionLabel className="mt-6">Dietary preferences</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(DIETARY_FLAG_LABELS) as DietaryFlag[]).map((f) => {
          const on = user.dietaryFlags.includes(f)
          return (
            <Chip key={f} selected={on} onClick={() => update({ dietaryFlags: on ? user.dietaryFlags.filter((x) => x !== f) : [...user.dietaryFlags, f] })}>
              {DIETARY_FLAG_LABELS[f]}
            </Chip>
          )
        })}
      </div>
      <SectionLabel className="mt-6">Foods to avoid</SectionLabel>
      <div className="flex gap-2">
        <TextInput
          value={dislike}
          onChange={(e) => setDislike(e.target.value)}
          placeholder="e.g. Mushrooms"
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
          aria-label="Add"
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
      <p className="text-[12.5px] text-text-3 mt-6">Targets are calculated from your goal, body and training day. Ask your coach to adjust them any time.</p>
    </Page>
  )
}

/* ------------------------------------------------------------------ Coach */
function CoachSection() {
  const coach = useStore((s) => s.coach)
  const updateCoach = useStore((s) => s.updateCoach)
  const updatePersonality = useStore((s) => s.updatePersonality)
  const user = useStore((s) => s.user)!
  const [keyOpen, setKeyOpen] = useState(false)
  const [key, setKey] = useState(coach.anthropicApiKey ?? '')
  const preview = useMemo(() => {
    const v = buildVoice(coach.personality)
    return v.compose({
      core: `${user.name.split(' ')[0]}, today is lower body, about ${formatMinutes(user.availability.sessionMinutes)}.`,
      reason: 'Your legs are fresh and it is next in your rotation.',
      soft: 'If you are up for it,',
      push: 'Let’s make it count.',
      calm: 'Take it at your pace.',
      quip: 'Your quads have entered the chat.',
      extra: 'Loads are up 2.5 kg from last time because you completed every set.',
    })
  }, [coach.personality, user])

  return (
    <Page back="/profile" title="Coach">
      <div className="flex items-center gap-4 mt-3">
        <CoachMark size={44} active />
        <div className="flex-1">
          <div className="text-[12.5px] text-text-3 mb-1">Coach name</div>
          <TextInput value={coach.name} onChange={(e) => updateCoach({ name: e.target.value })} maxLength={20} />
        </div>
      </div>

      <SectionLabel className="mt-7">Personality</SectionLabel>
      <Card>
        <div className="space-y-5">
          <Slider label="Motivation" value={coach.personality.motivation} onChange={(v) => updatePersonality({ motivation: v })} leftLabel="Calm" rightLabel="Intense" />
          <Slider label="Tone" value={coach.personality.tone} onChange={(v) => updatePersonality({ tone: v })} leftLabel="Gentle" rightLabel="Direct" />
          <Slider label="Humor" value={coach.personality.humor} onChange={(v) => updatePersonality({ humor: v })} leftLabel="Serious" rightLabel="Playful" />
          <Slider label="Communication" value={coach.personality.communication} onChange={(v) => updatePersonality({ communication: v })} leftLabel="Concise" rightLabel="Detailed" />
        </div>
      </Card>
      <div className="mt-3 rounded-[18px] bg-surface border border-border p-4 flex gap-3">
        <CoachMark size={20} className="mt-0.5" />
        <div>
          <div className="text-[11.5px] text-text-3 mb-1">
            {coach.name} · {describePersonality(coach.personality)}
          </div>
          <p className="text-[14px] leading-relaxed text-text-2">{preview}</p>
        </div>
      </div>

      <SectionLabel className="mt-7">Intelligence</SectionLabel>
      <Group>
        <ListRow label="Built-in coach" sub="Runs on this device. No account, no network." right={<Toggle checked={coach.provider === 'local'} onChange={() => updateCoach({ provider: 'local' })} label="Use built-in coach" />} />
        <ListRow label="Claude (bring your own key)" sub={coach.anthropicApiKey ? 'Key saved on this device' : 'Optional. Richer conversation, same actions.'} onClick={() => setKeyOpen(true)} />
      </Group>
      <p className="text-[12px] text-text-3 mt-2">The built-in coach handles everything in Sportly. A connected model adds free-form conversation on top and falls back to the built-in coach if it is unavailable.</p>

      <Sheet open={keyOpen} onClose={() => setKeyOpen(false)} title="Connect Claude">
        <p className="text-[13.5px] text-text-2 mb-3">Paste an Anthropic API key. It is stored only in this browser and sent only to Anthropic.</p>
        <TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" type="password" autoComplete="off" />
        <div className="flex gap-2 mt-4 pb-2">
          {coach.anthropicApiKey && (
            <Button
              variant="danger"
              onClick={() => {
                updateCoach({ anthropicApiKey: undefined, provider: 'local' })
                setKey('')
                setKeyOpen(false)
              }}
            >
              Remove
            </Button>
          )}
          <Button
            variant="primary"
            full
            disabled={!key.trim().startsWith('sk-ant')}
            onClick={() => {
              updateCoach({ anthropicApiKey: key.trim(), provider: 'anthropic' })
              setKeyOpen(false)
              useStore.getState().toast('Claude connected', 'success')
            }}
          >
            Save and use Claude
          </Button>
        </div>
      </Sheet>
    </Page>
  )
}

/* ------------------------------------------------------------------ Memory */
const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  goal: 'Goals',
  preference: 'Preferences',
  equipment: 'Equipment',
  availability: 'Availability',
  nutrition: 'Nutrition',
  habit: 'Habits',
  health: 'Health',
  history: 'History',
  reaction: 'How sessions felt',
  communication: 'Communication',
  note: 'Notes',
}

function MemorySection() {
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
    <Page back="/profile" title={`What ${coach.name} knows`}>
      <p className="text-[13.5px] text-text-3 mt-2 mb-4">Everything {coach.name} keeps in mind when coaching you. Add, pin or remove anything. It never leaves this device.</p>
      <div className="flex gap-2 mb-5">
        <TextInput
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Tell ${coach.name} something to remember`}
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
          aria-label="Add memory"
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
          <EmptyState icon={<CoachMark size={36} />} title="Nothing yet" body={`Talk to ${coach.name} and say “remember…” or add something above.`} />
        </Card>
      ) : (
        <div className="space-y-5 pb-4">
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <SectionLabel>{CATEGORY_LABELS[cat]}</SectionLabel>
              <Group>
                {items.map((m) => (
                  <div key={m.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[14.5px] leading-snug">{m.text}</div>
                      <div className="text-[11.5px] text-text-4 mt-1 flex items-center gap-2">
                        <span>{m.source === 'onboarding' ? 'From onboarding' : m.source === 'conversation' ? 'From a conversation' : m.source === 'inferred' ? 'Noticed' : 'Added by you'}</span>
                        <span>·</span>
                        <span>{relativeDay(m.createdAt)}</span>
                        {m.pinned && <Tag tone="accent">Pinned</Tag>}
                      </div>
                    </div>
                    <button aria-label={m.pinned ? 'Unpin' : 'Pin'} onClick={() => updateMemory(m.id, { pinned: !m.pinned })} className={cn('h-8 w-8 rounded-full flex items-center justify-center', m.pinned ? 'text-accent-text' : 'text-text-4 hover:text-text-2')}>
                      <Pin size={15} />
                    </button>
                    <button aria-label="Forget" onClick={() => removeMemory(m.id)} className="h-8 w-8 rounded-full flex items-center justify-center text-text-4 hover:text-danger">
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
  const prefs = useStore((s) => s.preferences.notifications)
  const update = useStore((s) => s.updateNotificationPreferences)
  const coach = useStore((s) => s.coach)
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  return (
    <Page back="/profile" title="Notifications">
      <Group className="mt-3">
        <ListRow label="Notifications" sub={`Contextual nudges from ${coach.name}. Never spam.`} right={<Toggle checked={prefs.enabled} onChange={(v) => update({ enabled: v })} label="Enable notifications" />} />
      </Group>
      <Group className={cn('mt-4', !prefs.enabled && 'opacity-50 pointer-events-none')}>
        <ListRow label="Morning plan" sub="“Good morning. Your plan is ready.”" right={<Toggle checked={prefs.morningPlan} onChange={(v) => update({ morningPlan: v })} label="Morning plan" />} />
        <ListRow label="Workout reminders" sub={`${prefs.reminderMinutesBefore} minutes before`} right={<Toggle checked={prefs.workoutReminders} onChange={(v) => update({ workoutReminders: v })} label="Workout reminders" />} />
        <Row label="Remind me">
          <div className="flex gap-1.5">
            {[15, 30, 60].map((m) => (
              <Chip key={m} size="sm" selected={prefs.reminderMinutesBefore === m} onClick={() => update({ reminderMinutesBefore: m })}>
                {m} min
              </Chip>
            ))}
          </div>
        </Row>
        <ListRow label="Recovery insights" sub="“You’re recovering well today.”" right={<Toggle checked={prefs.recoveryInsights} onChange={(v) => update({ recoveryInsights: v })} label="Recovery insights" />} />
        <ListRow label="Missed workout nudge" sub="“You haven’t trained today. Want me to adapt?”" right={<Toggle checked={prefs.missedWorkoutNudge} onChange={(v) => update({ missedWorkoutNudge: v })} label="Missed workout nudge" />} />
        <ListRow label="Nutrition" sub="Meal planning prompts" right={<Toggle checked={prefs.nutrition} onChange={(v) => update({ nutrition: v })} label="Nutrition" />} />
      </Group>
      <Group className="mt-4">
        <ListRow
          label="Device notifications"
          sub={permission === 'granted' ? 'Allowed on this device' : permission === 'denied' ? 'Blocked in browser settings' : permission === 'unsupported' ? 'Install Sportly to your home screen to enable' : 'Not yet allowed'}
          onClick={permission === 'default' ? () => requestPushPermission().then(() => useStore.getState().toast('Updated', 'success')) : undefined}
        />
      </Group>
      <p className="text-[12px] text-text-3 mt-3">Quiet hours {prefs.quietHours.start}–{prefs.quietHours.end}. Notifications respect {coach.name}’s personality settings.</p>
    </Page>
  )
}

/* ------------------------------------------------------------------ Appearance */
function AppearanceSection() {
  const prefs = useStore((s) => s.preferences)
  const update = useStore((s) => s.updatePreferences)
  const setTheme = useStore((s) => s.setTheme)
  return (
    <Page back="/profile" title="Appearance">
      <SectionLabel className="mt-3">Theme</SectionLabel>
      <Segmented id="theme" value={prefs.theme} onChange={setTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} />
      <div className="grid grid-cols-3 gap-2 mt-3">
        {(['dark', 'light', 'system'] as const).map((t) => (
          <button key={t} onClick={() => setTheme(t)} className={cn('rounded-[16px] border p-2 transition-colors', prefs.theme === t ? 'border-accent' : 'border-border')} aria-label={`${t} theme`}>
            <div className={cn('rounded-[10px] h-16 p-2 flex flex-col gap-1.5', t === 'light' ? 'bg-white' : t === 'dark' ? 'bg-[#0a0a0b]' : 'bg-gradient-to-r from-[#0a0a0b] to-white')}>
              <div className={cn('h-2 w-10 rounded', t === 'light' ? 'bg-black/80' : 'bg-white/80')} />
              <div className="h-2 w-14 rounded bg-[#c6ff3f]" />
              <div className={cn('h-2 w-8 rounded', t === 'light' ? 'bg-black/20' : 'bg-white/20')} />
            </div>
          </button>
        ))}
      </div>
      <Group className="mt-6">
        <Row label="Reduce motion" sub="Fewer animations">
          <Segmented id="motion" size="sm" className="w-[190px]" value={prefs.reducedMotion} onChange={(v) => update({ reducedMotion: v })} options={[{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        </Row>
        <ListRow label="Haptic feedback" right={<Toggle checked={prefs.hapticFeedback} onChange={(v) => update({ hapticFeedback: v })} label="Haptics" />} />
        <ListRow label="Auto-start rest timer" right={<Toggle checked={prefs.restTimerAutoStart} onChange={(v) => update({ restTimerAutoStart: v })} label="Auto rest timer" />} />
        <ListRow label="Rest timer sound" right={<Toggle checked={prefs.restTimerSound} onChange={(v) => update({ restTimerSound: v })} label="Rest timer sound" />} />
      </Group>
    </Page>
  )
}

/* ------------------------------------------------------------------ Privacy */
function PrivacySection() {
  const prefs = useStore((s) => s.preferences)
  const update = useStore((s) => s.updatePreferences)
  return (
    <Page back="/profile" title="Privacy">
      <Card className="mt-3">
        <div className="text-[15px] font-semibold">Your data stays with you</div>
        <p className="text-[13.5px] text-text-2 mt-1.5 leading-relaxed">Sportly stores your profile, conversations, workouts and attachments on this device only. There is no account and nothing is sent anywhere unless you connect an AI provider yourself.</p>
      </Card>
      <Group className="mt-4">
        <ListRow label="Personalization" sub="Let your coach learn from your sessions and conversations" right={<Toggle checked={prefs.privacy.personalization} onChange={(v) => update({ privacy: { ...prefs.privacy, personalization: v } })} label="Personalization" />} />
        <ListRow label="Usage analytics" sub="Off. Sportly does not collect analytics." right={<Toggle checked={prefs.privacy.analytics} onChange={(v) => update({ privacy: { ...prefs.privacy, analytics: v } })} label="Analytics" />} />
      </Group>
    </Page>
  )
}

/* ------------------------------------------------------------------ Account */
function AccountSection() {
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
      useStore.getState().toast('Export is not available here', 'error')
    }
  }

  return (
    <Page back="/profile" title="Account">
      <Card className="mt-3">
        <div className="text-[15px] font-semibold">{user.name}</div>
        <div className="text-[13px] text-text-3 mt-0.5">Local profile{user.isDemo ? ' · demo' : ''} · since {new Date(user.createdAt).toLocaleDateString()}</div>
      </Card>
      <Group className="mt-4">
        <ListRow label="Export my data" sub="Download everything as JSON" onClick={exportData} />
        <ListRow label="Load the demo profile" sub="Replace this profile with Alex’s sample data" onClick={() => setConfirm('demo')} />
        <ListRow label="Reset Sportly" sub="Erase everything on this device" danger onClick={() => setConfirm('reset')} />
      </Group>
      <Sheet open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm === 'reset' ? 'Erase everything?' : 'Load demo profile?'}>
        <p className="text-[14px] text-text-2 mb-4">{confirm === 'reset' ? 'This removes your profile, conversations, workouts and progress from this device. It cannot be undone.' : 'Your current profile will be replaced with the demo profile and its history.'}</p>
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
            {confirm === 'reset' ? 'Erase everything' : 'Load demo'}
          </Button>
          <Button variant="ghost" full onClick={() => setConfirm(null)}>
            Cancel
          </Button>
        </div>
      </Sheet>
    </Page>
  )
}

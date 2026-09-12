import { Bell, Brain, Dumbbell, Lock, Palette, Settings2, User, Utensils } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { describePersonality } from '@/coach/personality'
import { Page } from '@/components/layout/Page'
import { Card } from '@/components/ui/Card'
import { CoachMark, Group, ListRow } from '@/components/ui/Primitives'
import { DIET_LABELS, GOAL_LABELS, LEVEL_LABELS } from '@/domain/labels'
import { plural } from '@/lib/utils'
import { useStore } from '@/store/useStore'

export function ProfileScreen() {
  const navigate = useNavigate()
  const user = useStore((s) => s.user)!
  const coach = useStore((s) => s.coach)
  const goals = useStore((s) => s.goals)
  const memory = useStore((s) => s.memory)
  const prefs = useStore((s) => s.preferences)
  const workouts = useStore((s) => s.workouts)
  const done = useMemo(() => Object.values(workouts).filter((w) => w.status === 'completed').length, [workouts])
  const primary = goals.find((g) => g.rank === 'primary')

  return (
    <Page large title={user.name} eyebrow="Profile">
      <Card padding="md" className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-surface-2 flex items-center justify-center text-[20px] font-semibold title">{user.name.charAt(0).toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold">{primary ? GOAL_LABELS[primary.type] : 'No goal yet'}</div>
          <div className="text-[13px] text-text-3 truncate">
            {LEVEL_LABELS[user.level]} · {user.availability.daysPerWeek} days/week · {plural(done, 'session')}
          </div>
        </div>
      </Card>

      <div className="space-y-4 mt-4">
        <Group>
          <ListRow icon={<User size={18} />} label="Personal" sub={`${user.age} · ${user.heightCm} cm · ${user.weightKg} kg`} onClick={() => navigate('/profile/personal')} />
          <ListRow icon={<Dumbbell size={18} />} label="Training" sub={`${LEVEL_LABELS[user.level]} · ${user.equipment.length} equipment types`} onClick={() => navigate('/profile/training')} />
          <ListRow icon={<Utensils size={18} />} label="Nutrition" sub={DIET_LABELS[user.diet]} onClick={() => navigate('/profile/nutrition')} />
        </Group>

        <Group>
          <ListRow icon={<CoachMark size={18} />} label={`Coach · ${coach.name}`} sub={describePersonality(coach.personality)} onClick={() => navigate('/profile/coach')} />
          <ListRow icon={<Brain size={18} />} label="What your coach knows" sub={`${plural(memory.length, 'thing')} remembered`} onClick={() => navigate('/profile/memory')} />
        </Group>

        <Group>
          <ListRow icon={<Bell size={18} />} label="Notifications" value={prefs.notifications.enabled ? 'On' : 'Off'} onClick={() => navigate('/profile/notifications')} />
          <ListRow icon={<Palette size={18} />} label="Appearance" value={prefs.theme === 'system' ? 'System' : prefs.theme === 'dark' ? 'Dark' : 'Light'} onClick={() => navigate('/profile/appearance')} />
          <ListRow icon={<Lock size={18} />} label="Privacy" onClick={() => navigate('/profile/privacy')} />
          <ListRow icon={<Settings2 size={18} />} label="Account" onClick={() => navigate('/profile/account')} />
        </Group>

        <p className="text-center text-[11.5px] text-text-4 pt-2">Sportly 1.0 · Your Coach Daily</p>
      </div>
    </Page>
  )
}

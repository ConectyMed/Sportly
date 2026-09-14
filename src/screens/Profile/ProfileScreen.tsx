import { Bell, Brain, Dumbbell, Languages, Lock, Palette, Settings2, User, Utensils } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { describePersonality } from '@/coach/personality'
import { Page } from '@/components/layout/Page'
import { Card } from '@/components/ui/Card'
import { CoachMark, Group, ListRow } from '@/components/ui/Primitives'
import { dietLabel, goalLabel, levelLabel } from '@/domain/labels'
import { LANGUAGE_NAMES } from '@/i18n'
import { useT } from '@/i18n/react'
import { useStore } from '@/store/useStore'

export function ProfileScreen() {
  const navigate = useNavigate()
  const tr = useT()
  const user = useStore((s) => s.user)!
  const coach = useStore((s) => s.coach)
  const goals = useStore((s) => s.goals)
  const memory = useStore((s) => s.memory)
  const prefs = useStore((s) => s.preferences)
  const workouts = useStore((s) => s.workouts)
  const done = useMemo(() => Object.values(workouts).filter((w) => w.status === 'completed').length, [workouts])
  const primary = goals.find((g) => g.rank === 'primary')

  return (
    <Page large title={user.name} eyebrow={tr.t('common.nav.profile')}>
      <Card padding="md" className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-surface-2 flex items-center justify-center text-[20px] font-semibold title">{user.name.charAt(0).toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold">{primary ? goalLabel(primary.type) : tr.t('profile.noGoal')}</div>
          <div className="text-[13px] text-text-3 truncate">
            {levelLabel(user.level)} · {tr.t('common.daysPerWeekShort', { count: user.availability.daysPerWeek })} · {tr.tn('common.sessions', done)}
          </div>
        </div>
      </Card>

      <div className="space-y-4 mt-4">
        <Group>
          <ListRow icon={<User size={18} />} label={tr.t('profile.personal')} sub={`${user.age} · ${user.heightCm} ${tr.t('common.cm')} · ${tr.num(user.weightKg)} ${tr.t('common.kg')}`} onClick={() => navigate('/profile/personal')} />
          <ListRow icon={<Dumbbell size={18} />} label={tr.t('profile.training')} sub={`${levelLabel(user.level)} · ${tr.tn('profile.equipmentTypes', user.equipment.length)}`} onClick={() => navigate('/profile/training')} />
          <ListRow icon={<Utensils size={18} />} label={tr.t('profile.nutrition')} sub={dietLabel(user.diet)} onClick={() => navigate('/profile/nutrition')} />
        </Group>

        <Group>
          <ListRow icon={<CoachMark size={18} />} label={tr.t('profile.coachRow', { name: coach.name })} sub={describePersonality(coach.personality, tr.lang)} onClick={() => navigate('/profile/coach')} />
          <ListRow icon={<Brain size={18} />} label={tr.t('profile.memoryRow')} sub={tr.t('profile.remembered', { things: tr.tn('common.things', memory.length) })} onClick={() => navigate('/profile/memory')} />
        </Group>

        <Group>
          <ListRow icon={<Bell size={18} />} label={tr.t('common.notifications')} value={prefs.notifications.enabled ? tr.t('common.on') : tr.t('common.off')} onClick={() => navigate('/profile/notifications')} />
          <ListRow icon={<Languages size={18} />} label={tr.t('common.language')} value={LANGUAGE_NAMES[prefs.language]} onClick={() => navigate('/profile/appearance')} />
          <ListRow icon={<Palette size={18} />} label={tr.t('profile.appearance')} value={prefs.theme === 'system' ? tr.t('common.system') : prefs.theme === 'dark' ? tr.t('common.dark') : tr.t('common.light')} onClick={() => navigate('/profile/appearance')} />
          <ListRow icon={<Lock size={18} />} label={tr.t('profile.privacy')} onClick={() => navigate('/profile/privacy')} />
          <ListRow icon={<Settings2 size={18} />} label={tr.t('profile.account')} onClick={() => navigate('/profile/account')} />
        </Group>

        <p className="text-center text-[11.5px] text-text-4 pt-2">{tr.t('common.footerVersion')}</p>
      </div>
    </Page>
  )
}

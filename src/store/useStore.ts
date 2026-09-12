import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  AppNotification,
  CalendarEvent,
  CoachConfig,
  CoachPersonality,
  Conversation,
  DailyCheckIn,
  DayKey,
  Goal,
  LoggedMeal,
  Measurement,
  MemoryItem,
  Message,
  NutritionPlan,
  Preferences,
  Program,
  UserProfile,
  Workout,
  WorkoutSet,
} from '@/domain/types'
import { uid } from '@/lib/utils'
import { todayKey } from '@/lib/dates'

export const STORAGE_KEY = 'sportly.v1'

export const DEFAULT_PERSONALITY: CoachPersonality = {
  motivation: 45,
  tone: 50,
  humor: 35,
  communication: 40,
}

export const DEFAULT_COACH: CoachConfig = {
  name: 'Coach',
  personality: DEFAULT_PERSONALITY,
  provider: 'local',
  anthropicModel: 'claude-sonnet-5',
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  units: 'metric',
  reducedMotion: 'system',
  hapticFeedback: true,
  restTimerAutoStart: true,
  restTimerSound: true,
  weekStartsOn: 1,
  notifications: {
    enabled: true,
    morningPlan: true,
    workoutReminders: true,
    reminderMinutesBefore: 30,
    recoveryInsights: true,
    missedWorkoutNudge: true,
    nutrition: true,
    quietHours: { start: '22:00', end: '07:00' },
  },
  privacy: { analytics: false, personalization: true },
}

export interface OnboardingPayload {
  user: UserProfile
  goals: Goal[]
  coach: CoachConfig
  memory: MemoryItem[]
}

export interface SeedPayload extends OnboardingPayload {
  conversations: Conversation[]
  messages: Record<string, Message[]>
  workouts: Record<string, Workout>
  programs: Record<string, Program>
  nutritionPlans: Record<string, NutritionPlan>
  meals?: Record<string, LoggedMeal>
  measurements: Measurement[]
  checkIns: Record<DayKey, DailyCheckIn>
  events: CalendarEvent[]
  notifications: AppNotification[]
  preferences?: Partial<Preferences>
}

export interface AppState {
  onboarded: boolean
  user: UserProfile | null
  goals: Goal[]
  coach: CoachConfig
  memory: MemoryItem[]
  conversations: Conversation[]
  messages: Record<string, Message[]>
  activeConversationId: string | null
  workouts: Record<string, Workout>
  programs: Record<string, Program>
  nutritionPlans: Record<string, NutritionPlan>
  /** Food journal: scanned, described or manually logged meals (drafts included). */
  meals: Record<string, LoggedMeal>
  measurements: Measurement[]
  checkIns: Record<DayKey, DailyCheckIn>
  events: CalendarEvent[]
  notifications: AppNotification[]
  preferences: Preferences
  lastNotificationSweep?: string
  /** Ephemeral UI state (not persisted). */
  ui: {
    coachTyping: boolean
    coachStatus?: string
    toast?: { id: string; text: string; kind?: 'success' | 'info' | 'error' }
  }

  // ---- lifecycle
  completeOnboarding: (payload: OnboardingPayload) => void
  seed: (payload: SeedPayload) => void
  resetAll: () => void

  // ---- user & goals
  updateUser: (patch: Partial<UserProfile>) => void
  upsertGoal: (goal: Goal) => void
  removeGoal: (id: string) => void

  // ---- coach
  updateCoach: (patch: Partial<CoachConfig>) => void
  updatePersonality: (patch: Partial<CoachPersonality>) => void

  // ---- memory
  addMemory: (item: Omit<MemoryItem, 'id' | 'createdAt'> & { id?: string }) => MemoryItem
  updateMemory: (id: string, patch: Partial<MemoryItem>) => void
  removeMemory: (id: string) => void

  // ---- conversations
  createConversation: (title?: string) => Conversation
  setActiveConversation: (id: string | null) => void
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  updateConversationContext: (id: string, patch: Partial<Conversation['context']>) => void
  addMessage: (message: Message) => void
  updateMessage: (conversationId: string, id: string, patch: Partial<Message>) => void
  setCoachTyping: (typing: boolean, status?: string) => void

  // ---- workouts
  upsertWorkout: (workout: Workout) => void
  updateWorkout: (id: string, patch: Partial<Workout>) => void
  deleteWorkout: (id: string) => void
  startWorkout: (id: string) => void
  updateSet: (workoutId: string, exerciseId: string, setId: string, patch: Partial<WorkoutSet>) => void
  completeWorkout: (id: string, summary: Workout['summary']) => void
  skipWorkout: (id: string) => void

  // ---- programs
  upsertProgram: (program: Program) => void
  updateProgram: (id: string, patch: Partial<Program>) => void

  // ---- nutrition
  upsertNutritionPlan: (plan: NutritionPlan) => void

  // ---- food journal
  upsertMeal: (meal: LoggedMeal) => void
  updateMeal: (id: string, patch: Partial<LoggedMeal>) => void
  deleteMeal: (id: string) => void
  /** Drafts older than today are noise; drop them. */
  pruneMealDrafts: (keepDate: DayKey) => void

  // ---- measurements & check-ins
  addMeasurement: (m: Omit<Measurement, 'id' | 'createdAt'>) => void
  removeMeasurement: (id: string) => void
  setCheckIn: (date: DayKey, patch: Partial<DailyCheckIn>) => void

  // ---- calendar
  upsertEvent: (event: CalendarEvent) => void
  upsertEvents: (events: CalendarEvent[]) => void
  moveEvent: (id: string, toDate: DayKey) => void
  removeEvent: (id: string) => void
  removeEventsForProgram: (programId: string, fromDate?: DayKey) => void

  // ---- notifications
  addNotification: (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => void
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void
  clearNotifications: () => void
  setNotificationSweep: (key: string) => void

  // ---- preferences
  updatePreferences: (patch: Partial<Preferences>) => void
  updateNotificationPreferences: (patch: Partial<Preferences['notifications']>) => void
  setTheme: (theme: Preferences['theme']) => void
  toast: (text: string, kind?: 'success' | 'info' | 'error') => void
  dismissToast: () => void
}

const initialData = () => ({
  onboarded: false,
  user: null as UserProfile | null,
  goals: [] as Goal[],
  coach: DEFAULT_COACH,
  memory: [] as MemoryItem[],
  conversations: [] as Conversation[],
  messages: {} as Record<string, Message[]>,
  activeConversationId: null as string | null,
  workouts: {} as Record<string, Workout>,
  programs: {} as Record<string, Program>,
  nutritionPlans: {} as Record<string, NutritionPlan>,
  meals: {} as Record<string, LoggedMeal>,
  measurements: [] as Measurement[],
  checkIns: {} as Record<DayKey, DailyCheckIn>,
  events: [] as CalendarEvent[],
  notifications: [] as AppNotification[],
  preferences: DEFAULT_PREFERENCES,
  lastNotificationSweep: undefined as string | undefined,
  ui: { coachTyping: false },
})

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialData(),

      completeOnboarding: ({ user, goals, coach, memory }) =>
        set({
          onboarded: true,
          user: { ...user, onboardedAt: new Date().toISOString() },
          goals,
          coach,
          memory,
        }),

      seed: (payload) =>
        set({
          ...initialData(),
          onboarded: true,
          user: payload.user,
          goals: payload.goals,
          coach: payload.coach,
          memory: payload.memory,
          conversations: payload.conversations,
          messages: payload.messages,
          activeConversationId: payload.conversations[0]?.id ?? null,
          workouts: payload.workouts,
          programs: payload.programs,
          nutritionPlans: payload.nutritionPlans,
          meals: payload.meals ?? {},
          measurements: payload.measurements,
          checkIns: payload.checkIns,
          events: payload.events,
          notifications: payload.notifications,
          preferences: { ...DEFAULT_PREFERENCES, ...(payload.preferences ?? {}) },
        }),

      resetAll: () => set({ ...initialData(), preferences: { ...DEFAULT_PREFERENCES, theme: get().preferences.theme } }),

      updateUser: (patch) => set((s) => ({ user: s.user ? { ...s.user, ...patch } : s.user })),
      upsertGoal: (goal) =>
        set((s) => {
          const exists = s.goals.some((g) => g.id === goal.id)
          let goals = exists ? s.goals.map((g) => (g.id === goal.id ? goal : g)) : [...s.goals, goal]
          // Only one primary and one secondary.
          goals = goals.map((g) => (g.id !== goal.id && g.rank === goal.rank ? { ...g, rank: g.rank === 'primary' ? 'secondary' : 'secondary' } : g))
          if (goal.rank === 'primary') {
            const others = goals.filter((g) => g.id !== goal.id && g.rank === 'secondary')
            if (others.length > 1) goals = [goal, others[others.length - 1]]
          }
          return { goals }
        }),
      removeGoal: (id) => set((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),

      updateCoach: (patch) => set((s) => ({ coach: { ...s.coach, ...patch } })),
      updatePersonality: (patch) =>
        set((s) => ({ coach: { ...s.coach, personality: { ...s.coach.personality, ...patch } } })),

      addMemory: (item) => {
        const full: MemoryItem = { ...item, id: item.id ?? uid('mem'), createdAt: new Date().toISOString() }
        set((s) => {
          const dup = s.memory.find((m) => m.text.toLowerCase() === full.text.toLowerCase())
          if (dup) return {}
          return { memory: [full, ...s.memory] }
        })
        return full
      },
      updateMemory: (id, patch) => set((s) => ({ memory: s.memory.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      removeMemory: (id) => set((s) => ({ memory: s.memory.filter((m) => m.id !== id) })),

      createConversation: (title = 'New conversation') => {
        const c: Conversation = {
          id: uid('conv'),
          title,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          context: {},
        }
        set((s) => ({
          conversations: [c, ...s.conversations],
          messages: { ...s.messages, [c.id]: [] },
          activeConversationId: c.id,
        }))
        return c
      },
      setActiveConversation: (id) => set({ activeConversationId: id }),
      deleteConversation: (id) =>
        set((s) => {
          const rest = { ...s.messages }
          delete rest[id]
          const conversations = s.conversations.filter((c) => c.id !== id)
          return {
            conversations,
            messages: rest,
            activeConversationId: s.activeConversationId === id ? (conversations[0]?.id ?? null) : s.activeConversationId,
          }
        }),
      renameConversation: (id, title) =>
        set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)) })),
      updateConversationContext: (id, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, context: { ...c.context, ...patch }, updatedAt: new Date().toISOString() } : c,
          ),
        })),
      addMessage: (message) =>
        set((s) => {
          const list = s.messages[message.conversationId] ?? []
          const conversations = s.conversations.map((c) => {
            if (c.id !== message.conversationId) return c
            const title =
              c.title === 'New conversation' && message.role === 'user' && message.text.trim()
                ? message.text.trim().slice(0, 42)
                : c.title
            return { ...c, title, updatedAt: message.createdAt }
          })
          return { messages: { ...s.messages, [message.conversationId]: [...list, message] }, conversations }
        }),
      updateMessage: (conversationId, id, patch) =>
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: (s.messages[conversationId] ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
          },
        })),
      setCoachTyping: (typing, status) => set((s) => ({ ui: { ...s.ui, coachTyping: typing, coachStatus: status } })),

      upsertWorkout: (workout) => set((s) => ({ workouts: { ...s.workouts, [workout.id]: workout } })),
      updateWorkout: (id, patch) =>
        set((s) => (s.workouts[id] ? { workouts: { ...s.workouts, [id]: { ...s.workouts[id], ...patch } } } : {})),
      deleteWorkout: (id) =>
        set((s) => {
          const workouts = { ...s.workouts }
          delete workouts[id]
          return { workouts, events: s.events.filter((e) => e.workoutId !== id) }
        }),
      startWorkout: (id) =>
        set((s) => {
          const w = s.workouts[id]
          if (!w) return {}
          return {
            workouts: {
              ...s.workouts,
              [id]: { ...w, status: 'in_progress', startedAt: w.startedAt ?? new Date().toISOString() },
            },
          }
        }),
      updateSet: (workoutId, exerciseId, setId, patch) =>
        set((s) => {
          const w = s.workouts[workoutId]
          if (!w) return {}
          return {
            workouts: {
              ...s.workouts,
              [workoutId]: {
                ...w,
                exercises: w.exercises.map((e) =>
                  e.id !== exerciseId
                    ? e
                    : { ...e, sets: e.sets.map((st) => (st.id === setId ? { ...st, ...patch } : st)) },
                ),
              },
            },
          }
        }),
      completeWorkout: (id, summary) =>
        set((s) => {
          const w = s.workouts[id]
          if (!w) return {}
          const completedAt = new Date().toISOString()
          return {
            workouts: { ...s.workouts, [id]: { ...w, status: 'completed', completedAt, summary } },
            events: s.events.map((e) => (e.workoutId === id ? { ...e, status: 'completed' } : e)),
          }
        }),
      skipWorkout: (id) =>
        set((s) => {
          const w = s.workouts[id]
          if (!w) return {}
          return {
            workouts: { ...s.workouts, [id]: { ...w, status: 'skipped' } },
            events: s.events.map((e) => (e.workoutId === id ? { ...e, status: 'skipped' } : e)),
          }
        }),

      upsertProgram: (program) => set((s) => ({ programs: { ...s.programs, [program.id]: program } })),
      updateProgram: (id, patch) =>
        set((s) =>
          s.programs[id]
            ? { programs: { ...s.programs, [id]: { ...s.programs[id], ...patch, updatedAt: new Date().toISOString() } } }
            : {},
        ),

      upsertNutritionPlan: (plan) => set((s) => ({ nutritionPlans: { ...s.nutritionPlans, [plan.id]: plan } })),

      upsertMeal: (meal) => set((s) => ({ meals: { ...s.meals, [meal.id]: meal } })),
      updateMeal: (id, patch) =>
        set((s) => (s.meals[id] ? { meals: { ...s.meals, [id]: { ...s.meals[id], ...patch, updatedAt: new Date().toISOString() } } } : {})),
      deleteMeal: (id) =>
        set((s) => {
          const meals = { ...s.meals }
          delete meals[id]
          return { meals }
        }),
      pruneMealDrafts: (keepDate) =>
        set((s) => {
          const meals = Object.fromEntries(Object.entries(s.meals).filter(([, m]) => m.status === 'logged' || m.date === keepDate))
          return Object.keys(meals).length === Object.keys(s.meals).length ? {} : { meals }
        }),

      addMeasurement: (m) =>
        set((s) => ({
          measurements: [
            ...s.measurements.filter((x) => !(x.type === m.type && x.date === m.date)),
            { ...m, id: uid('meas'), createdAt: new Date().toISOString() },
          ].sort((a, b) => a.date.localeCompare(b.date)),
          user:
            m.type === 'body_weight' && s.user && m.date >= todayKey() ? { ...s.user, weightKg: m.value } : s.user,
        })),
      removeMeasurement: (id) => set((s) => ({ measurements: s.measurements.filter((m) => m.id !== id) })),
      setCheckIn: (date, patch) =>
        set((s) => ({
          checkIns: {
            ...s.checkIns,
            [date]: { ...(s.checkIns[date] ?? { date, createdAt: new Date().toISOString() }), ...patch },
          },
        })),

      upsertEvent: (event) =>
        set((s) => ({
          events: s.events.some((e) => e.id === event.id)
            ? s.events.map((e) => (e.id === event.id ? event : e))
            : [...s.events, event],
        })),
      upsertEvents: (events) =>
        set((s) => {
          const map = new Map(s.events.map((e) => [e.id, e]))
          for (const e of events) map.set(e.id, e)
          return { events: [...map.values()] }
        }),
      moveEvent: (id, toDate) =>
        set((s) => {
          const ev = s.events.find((e) => e.id === id)
          if (!ev) return {}
          const workouts = { ...s.workouts }
          if (ev.workoutId && workouts[ev.workoutId]) {
            workouts[ev.workoutId] = { ...workouts[ev.workoutId], scheduledFor: toDate }
          }
          return {
            events: s.events.map((e) => (e.id === id ? { ...e, movedFrom: e.date, date: toDate, status: 'planned' } : e)),
            workouts,
          }
        }),
      removeEvent: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
      removeEventsForProgram: (programId, fromDate) =>
        set((s) => {
          const keep = (e: CalendarEvent) =>
            e.programId !== programId || e.status === 'completed' || (fromDate ? e.date < fromDate : false)
          const removedWorkoutIds = s.events.filter((e) => !keep(e)).map((e) => e.workoutId).filter(Boolean) as string[]
          const workouts = { ...s.workouts }
          for (const id of removedWorkoutIds) if (workouts[id]?.status === 'planned') delete workouts[id]
          return { events: s.events.filter(keep), workouts }
        }),

      addNotification: (n) =>
        set((s) => ({
          notifications: [{ ...n, id: uid('ntf'), createdAt: new Date().toISOString(), read: false }, ...s.notifications].slice(
            0,
            60,
          ),
        })),
      markNotificationRead: (id) =>
        set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
      markAllNotificationsRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
      clearNotifications: () => set({ notifications: [] }),
      setNotificationSweep: (key) => set({ lastNotificationSweep: key }),

      updatePreferences: (patch) => set((s) => ({ preferences: { ...s.preferences, ...patch } })),
      updateNotificationPreferences: (patch) =>
        set((s) => ({ preferences: { ...s.preferences, notifications: { ...s.preferences.notifications, ...patch } } })),
      setTheme: (theme) => set((s) => ({ preferences: { ...s.preferences, theme } })),
      toast: (text, kind = 'info') => {
        const id = uid('toast')
        set((s) => ({ ui: { ...s.ui, toast: { id, text, kind } } }))
        setTimeout(() => {
          if (get().ui.toast?.id === id) set((s) => ({ ui: { ...s.ui, toast: undefined } }))
        }, 2800)
      },
      dismissToast: () => set((s) => ({ ui: { ...s.ui, toast: undefined } })),
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<AppState>
        return { ...p, meals: p.meals ?? {} } as AppState
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => {
        const { ui: _ui, ...rest } = s
        void _ui
        // Strip functions.
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function')) as unknown as AppState
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        return {
          ...current,
          ...p,
          meals: p.meals ?? {},
          coach: { ...DEFAULT_COACH, ...(p.coach ?? {}), personality: { ...DEFAULT_PERSONALITY, ...(p.coach?.personality ?? {}) } },
          preferences: {
            ...DEFAULT_PREFERENCES,
            ...(p.preferences ?? {}),
            notifications: { ...DEFAULT_PREFERENCES.notifications, ...(p.preferences?.notifications ?? {}) },
            privacy: { ...DEFAULT_PREFERENCES.privacy, ...(p.preferences?.privacy ?? {}) },
          },
          ui: current.ui,
        }
      },
    },
  ),
)

export type StoreApi = typeof useStore

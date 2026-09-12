import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Skeleton } from '@/components/ui/Primitives'
import { useReducedMotionPref, useThemeSync } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import { HomeScreen } from '@/screens/Home/HomeScreen'
import { CoachScreen } from '@/screens/Coach/CoachScreen'
import { OnboardingScreen } from '@/screens/Onboarding/OnboardingScreen'

const ProgressScreen = lazy(() => import('@/screens/Progress/ProgressScreen').then((m) => ({ default: m.ProgressScreen })))
const GoalsScreen = lazy(() => import('@/screens/Progress/GoalsScreen').then((m) => ({ default: m.GoalsScreen })))
const ProfileScreen = lazy(() => import('@/screens/Profile/ProfileScreen').then((m) => ({ default: m.ProfileScreen })))
const ProfileSection = lazy(() => import('@/screens/Profile/ProfileSections').then((m) => ({ default: m.ProfileSection })))
const WorkoutDetailScreen = lazy(() => import('@/screens/Workout/WorkoutDetailScreen').then((m) => ({ default: m.WorkoutDetailScreen })))
const WorkoutSessionScreen = lazy(() => import('@/screens/Workout/WorkoutSessionScreen').then((m) => ({ default: m.WorkoutSessionScreen })))
const WorkoutSummaryScreen = lazy(() => import('@/screens/Workout/WorkoutSummaryScreen').then((m) => ({ default: m.WorkoutSummaryScreen })))
const NutritionScreen = lazy(() => import('@/screens/Nutrition/NutritionScreen').then((m) => ({ default: m.NutritionScreen })))
const ProgramScreen = lazy(() => import('@/screens/Program/ProgramScreen').then((m) => ({ default: m.ProgramScreen })))
const CalendarScreen = lazy(() => import('@/screens/Calendar/CalendarScreen').then((m) => ({ default: m.CalendarScreen })))
const NotificationsScreen = lazy(() => import('@/screens/Notifications/NotificationsScreen').then((m) => ({ default: m.NotificationsScreen })))

function Fallback() {
  return (
    <div className="px-5 pt-16 space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full rounded-[22px]" />
      <Skeleton className="h-24 w-full rounded-[22px]" />
    </div>
  )
}

function RequireOnboarding({ children }: { children: ReactNode }) {
  const onboarded = useStore((s) => s.onboarded)
  const location = useLocation()
  if (!onboarded) return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function ThemeBridge() {
  useThemeSync()
  useReducedMotionPref()
  return null
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ThemeBridge />
      <ErrorBoundary>
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingScreen />} />
          <Route
            path="/workout/:id/session"
            element={
              <RequireOnboarding>
                <WorkoutSessionScreen />
              </RequireOnboarding>
            }
          />
          <Route
            path="/workout/:id/summary"
            element={
              <RequireOnboarding>
                <WorkoutSummaryScreen />
              </RequireOnboarding>
            }
          />
          <Route
            element={
              <RequireOnboarding>
                <AppShell />
              </RequireOnboarding>
            }
          >
            <Route index element={<HomeScreen />} />
            <Route path="/coach" element={<CoachScreen />} />
            <Route path="/progress" element={<ProgressScreen />} />
            <Route path="/goals" element={<GoalsScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/profile/:section" element={<ProfileSection />} />
            <Route path="/workout/:id" element={<WorkoutDetailScreen />} />
            <Route path="/nutrition" element={<NutritionScreen />} />
            <Route path="/program" element={<ProgramScreen />} />
            <Route path="/program/:id" element={<ProgramScreen />} />
            <Route path="/calendar" element={<CalendarScreen />} />
            <Route path="/notifications" element={<NotificationsScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

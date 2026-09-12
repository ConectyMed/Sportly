# Sportly — Your Coach Daily

A premium, mobile-first PWA where **the coach is the product**. Sportly is a personal AI coach for training, nutrition and everyday fitness: it learns about you, remembers what matters, plans around your recovery, and lets you do almost everything through conversation.

- **Home** — daily command center: today’s session, readiness, the coach’s focus for the day.
- **Coach** — the primary experience: a conversational interface with interactive cards (workouts, programs, nutrition, progress, goals, calendar), attachments, voice input and context-aware suggestions.
- **Progress** — where you started → where you are → where you’re going, with elegant charts, personal bests, goals and coach insights.
- **Profile** — personal, training and nutrition details, coach name and personality, what the coach remembers, notifications, appearance, privacy, account.

Everything is real application state: workouts the coach builds land on your calendar, sessions you complete update progress and streaks, goals steer nutrition targets, personality sliders change how the coach actually talks. Data stays on the device.

## Run it

```bash
pnpm install        # or npm install
pnpm dev            # http://localhost:5173
pnpm build && pnpm preview
```

Tests:

```bash
pnpm test:unit      # vitest — intents, generators, coach behaviour
pnpm test:e2e       # playwright — the ten product flows on iPhone + desktop
pnpm typecheck && pnpm lint
```

On first launch choose **Meet your coach** (onboarding) or **Explore with a demo profile** (Alex, 27, ten weeks of realistic history).

## Try saying

“What should I do today?” · “I’m tired” → “6” · “I slept badly” · “Make my workout” · “I only have 30 minutes” · “I only have dumbbells” · “Make it shorter” · “Replace squats” · “Create me a 12-week muscle-building program” · “What should I eat tonight?” · “I’m eating at a restaurant tonight” · “Analyze my progress” · “Why has my weight stopped moving?” · “Remember that I train at 7am” · “Move Monday to Wednesday” · “Plan my week” · “My goal is to bench 100 kg” · “Be more direct with me” · “Call you Max” · send a photo, a PDF or a voice note.

## Architecture

```
UI (React screens & components)
  → coachService (orchestration: builds context, applies actions to state)
    → CoachProvider (LocalCoachProvider | AnthropicCoachProvider)
      → generators (workout, program, nutrition), readiness, insights, personality voice
  → Zustand store (persisted to localStorage; attachment blobs in IndexedDB)
```

| Layer | Where | Notes |
| --- | --- | --- |
| Domain model | `src/domain/types.ts` | User, goals, coach config & memory, conversations, messages, attachments, workouts, exercises, sessions, programs, nutrition plans, meals, measurements, check-ins, calendar events, notifications, preferences. Framework-agnostic. |
| Exercise library | `src/domain/exercises.ts` | ~70 exercises tagged by muscle, movement pattern, equipment and level. |
| State | `src/store/useStore.ts` | Single persisted store with typed actions. `src/store/attachments.ts` keeps binaries in IndexedDB. |
| Coach engine | `src/coach/` | `intents.ts` (context-aware parsing incl. slot answers like “6”), `localProvider.ts` (responses + actions + cards), `workoutGenerator.ts`, `programGenerator.ts`, `nutritionGenerator.ts`, `readiness.ts`, `insights.ts`, `personality.ts` (the four dials shape every reply). |
| Orchestration | `src/coach/coachService.ts` | `sendMessage`, `applyActions`, first conversation, quick actions, workout completion, contextual notifications. |
| Remote AI | `src/coach/anthropicProvider.ts` | Optional bring-your-own-key provider. The model chooses tools; Sportly’s engine materialises the entities so state stays consistent. Falls back to the local coach on any failure. |
| UI kit | `src/components/ui`, `src/components/charts` | Buttons, cards, sheets, sliders, segmented controls, chips, toasts, rings, dependency-free SVG charts. |
| Screens | `src/screens/*` | Onboarding, Home, Coach, Workout (detail / live session / summary), Nutrition, Progress, Goals, Program, Calendar, Notifications, Profile sections. |

### Real vs mocked

Real: navigation, persistence, onboarding, coach settings, conversation history, contextual actions, workout generation and modification, live workout execution with rest timers, completion → progress/streak/PR updates, nutrition plans, programs → calendar, rescheduling, goals, memory, notifications, theme, PWA install/offline.

Mocked only where an external service is genuinely required: the LLM (a structured local engine stands in, and a real provider plugs into the same interface), image/PDF understanding (attachments are preserved and the coach asks for context, then acts on it), speech-to-text (uses the browser’s Speech Recognition when available, otherwise records a voice note), push delivery (in-app notification center with contextual triggers).

## Design language

Deep black surfaces, a single Higgsfield-inspired green used strategically as the accent, Inter with tight display tracking, generous spacing, restrained motion. Dark is the primary experience; light is a deliberate second palette, not an inversion. The coach has no face: it is represented by a calm point of light, typography and its voice.

## Future native migration

The domain, store and coach engine are plain TypeScript with no DOM dependencies (unit tests run in Node). Screens are thin React components over the store and service layer, which keeps a move to React Native / Expo straightforward.

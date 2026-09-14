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
pnpm test:e2e       # playwright — the product flows (incl. language switch) on iPhone + desktop
pnpm typecheck && pnpm lint
```

On first launch choose **Meet your coach** (onboarding) or **Explore with a demo profile** (Alex, 27, ten weeks of realistic history).

## Try saying

“What should I do today?” · “I’m tired” → “6” · “I slept badly” · “Make my workout” · “I only have 30 minutes” · “I only have dumbbells” · “Make it shorter” · “Replace squats” · “Create me a 12-week muscle-building program” · “What should I eat tonight?” · “I’m eating at a restaurant tonight” · “Analyze my progress” · “Why has my weight stopped moving?” · “Remember that I train at 7am” · “Move Monday to Wednesday” · “Plan my week” · “My goal is to bench 100 kg” · “Be more direct with me” · “Call you Max” · send a photo, a PDF or a voice note.

Food and living state: “I ate 200 g chicken, rice and broccoli” · “There was more rice” · “I only ate half” · “Remove the sauce” · “Add it to lunch” · “What have I eaten today?” · “How much protein do I have left?” · “What would you choose: salmon, pasta or a burger?” · “I want to gain 5 kg” · “How does that affect my plan?” · “I can train four days this week” → “Actually make it three” · “I just finished my workout” · “Never give me burpees”.

## Bilingual: French first, English preserved (V7)

Sportly speaks French and English. The language is a preference (`preferences.language`, persisted, migrated: existing users stay in English; new users follow the browser, French if it is French, English otherwise) and switching it changes every screen, the coach, its chips, cards, notifications and dates immediately, without a reload. Change it under **Profile → Appearance → Language**.

- **One source of truth.** `src/i18n/en/*` is the typed English dictionary; `src/i18n/fr/*` must carry exactly the same keys (TypeScript and a test enforce it). `t('home.today')`, `tn('common.sessions', n)` (Intl plural rules: “1 séance”, “2 séances”), `{name}` interpolation, deterministic fallback (fr → en → humanised key, never `undefined` or a raw key) and missing-key tracking for tests.
- **Domain stays language-independent.** Workouts, programs, meals, foods, goals and exercises are stored as ids plus an English canonical name; `src/domain/labels.ts` renders them in the selected language (`workoutTitle`, `programDisplayName`, `exerciseName`, `foodName`, `goalLabel`…). The demo profile is one dataset; only its presentation changes.
- **The coach is French, not translated.** `src/coach/localProvider.ts` speaks through a translator bound to the turn’s language, with its own French phrase banks for the personality dials (`src/coach/personality.ts`), locale-aware dates (`lundi 14 septembre`), numbers (`74,2 kg`) and plurals.
- **One intent system.** `src/coach/intents.fr.ts` maps natural French (accent-tolerant, curly apostrophes) to the same structured intents as the English parser; the selected language’s parser runs first, the other one is a fallback, and every tool, generator and screen behaves identically. “Raccourcis-la.”, “Déplace-la à vendredi.”, “Supprime celui de demain.”, “Ajoute-le au déjeuner.”, “En fait, fais-en trois.”, “Et demain ?” resolve through the same reference mechanics as English.
- **Provider-neutral.** `CoachContext.language` and `CoachModelInput.language` carry the selected language plus an explicit “respond in the user’s selected language, regardless of the language of their message” instruction for any future model; the built-in coach and a remote model get the same rule.
- **Tests.** `src/i18n/__tests__` (dictionary completeness, placeholders, fallback, plurals, dates, numbers, persistence and migration, browser detection, a source scan for untranslated copy) and `src/coach/__tests__/french.test.ts` (the brief’s sentences, references, a full French journey through the real pipeline, personality in French, cross-language state, food scan in French). Playwright Flow 14 switches the language on the phone and desktop projects.

Essayez : « Je veux prendre du muscle. » · « Fais-moi une séance. » · « Je n’ai que 30 minutes. » · « Raccourcis-la. » · « Je suis fatigué aujourd’hui. » → « 6 » · « J’ai mangé du poulet et du riz. » · « Il y avait plus de riz. » · « Il me reste combien de protéines ? » · « Déplace ma séance à vendredi. » · « Qu’est-ce qui est prévu cette semaine ? » · « Retiens que je n’aime pas les burpees. » · « Sois plus direct avec moi. »

Known limits: the PWA manifest (name, shortcuts) and the knowledge base stay English; memories are stored in the language they were written in; a remote model is only instructed, not verified, to answer in the selected language.

## Plugging in the brain (V6)

Sportly is an AI coach whose application is its body. The built-in engine is the brain today; a model plugs in tomorrow without touching the domain. **The model decides, Sportly executes.**

```
USER MESSAGE
  → ModelProvider.complete(CoachModelInput)          src/coach/model/contract.ts, prompt.ts
      (system rules, persona, CURRENT snapshot, RELEVANT memory + knowledge, RECENT conversation, tool schemas)
  → CoachModelOutput { message, toolCalls }          provider-neutral ToolCall { id, name, arguments }
  → runToolCall                                       src/coach/model/modelTools.ts
      allowlist → JSON-schema validation → reference resolution (ids, dates, “the one we are discussing”)
      → materialisation with Sportly's generators → registry (domain validation, idempotency, audit)
  → ToolCallResult { ok, data (the real state), error, affectedEntities, changes }
  → context rebuilt from the store → back to the model … (bounded loop)   src/coach/model/loop.ts
  → COACH RESPONSE with the actions that really happened
```

- **One tool source, three shapes.** `src/coach/model/toolDefinitions.ts` holds the 19 read tools and 25 model-level action tools with JSON schemas and constraints. `adapters/openaiCompatible.ts` and `adapters/anthropic.ts` convert that single list into each provider's native tool format; nothing is duplicated per provider.
- **Model-level tools, not domain objects.** A model asks for `plan_workout { date, minutes, equipment }` or `set_goal { goal, metric, target }`; Sportly builds the Workout, Program, NutritionPlan or LoggedMeal itself. The model never fabricates exercises, sets, loads or ids.
- **Untrusted input.** Every call passes allowlist → schema parsing (coercion, unknown keys dropped) → domain validation → execution. Invalid calls are structured errors; state never changes silently.
- **Ambiguity and failure are data.** “Delete my workout” with several candidates returns `ambiguous` with real entities so the model asks; “move to Friday” when Friday is taken returns `conflict` with the clash. A failed call halts the rest of its batch (`skipped`) and the model re-plans with the results.
- **Context refresh.** The `CoachContextSnapshot` is rebuilt from the store before every model round, so after `update_availability` the model already sees the new schedule. UI changes propagate the same way (APP → COACH), and every executed tool reaches every screen (COACH → APP).
- **Limits.** Six model rounds and twelve tool calls per turn, a timeout per model call, and repeat detection at model-tool and registry level. If a limit is hit the user gets an honest summary of what was done.
- **Adapters, isolated and lazy.** `OpenAICompatibleProvider` covers OpenAI and any local OpenAI-compatible endpoint (Ollama, LM Studio); `AnthropicProvider` covers Claude. They are loaded on demand and only when the user has configured them in Profile → Coach → Intelligence. No key or endpoint is bundled; an incomplete configuration, an unreachable endpoint or a provider error falls back to the built-in coach for that message.
- **Sportly owns memory and facts.** `save_memory` is a request: Sportly decides category, persistence, expiry and conflict resolution. Weight, meals, workouts, goals, calendar and progress always come from the store; the model reasons over them.
- **Audit.** Every executed action records the tool, the model-level tool that requested it (`via`), the validated arguments, the tool call id, the outcome and the affected entities.

Tests: `src/coach/__tests__/model.test.ts` (provider contract, a `FakeLLMProvider` operating the app end to end, error handling, loop limits, reverse flow, journeys), `adapters.test.ts` (native formats → neutral tool calls with mocked responses, configuration, migration, architecture scans), `journeys.test.ts` (the same journeys through the built-in engine).

### V5 foundations that V6 builds on

- **Single source of truth.** `useStore` holds every entity once. `CoachContextSnapshot` (`src/coach/context.ts`) is derived from it on every turn and never stored. Priority is enforced by construction: structured state first, then recent actions, then conversation, then memory, then history.
- **Tools, not mutations.** Read tools and action tools (`src/coach/tools`) have typed inputs and outputs (`ToolResult`), validate against the current store, refuse impossible or ambiguous requests with a reason, and report exactly what changed (`DomainChange`). The registry adds a repeat window and records every call in a persisted action log.
- **Honest responses.** A reply carries the actions that were really executed (`Message.actions`). Tests enforce a NO-LIE rule (every claim of change is backed by an executed action) and a NO-DEAD-END rule (every suggestion chip resolves to a real intent).
- **Temporal context.** `src/coach/time.ts` distinguishes today, yesterday, tomorrow, this week and next week, and “what did I do” from “what was planned” from “what is coming”.
- **Multi-action requests.** “I want muscle gain, four days a week and a 12-week program” is split into ordered steps, each executed with a refreshed context.
- **Memory with rules.** Memories carry confidence, persistence, expiry and subjects. New explicit information replaces a contradicting older memory. Passing states are check-ins, not memories.
- **Knowledge, separate from behaviour.** `src/knowledge` defines sources, documents and chunks with provenance and a `KnowledgeRetriever` interface. Relevant hits are attached to the model input per message; the base is never dumped whole.

## The provider boundary (V8a)

V6 gave the client a provider-neutral seam. V8a puts the same idea behind a server, so a model call can be paid for by Sportly rather than by a key the user pastes into the app. It is a boundary only: no feature is wired through it yet.

```
CLIENT                                  SERVER (api/ + server/)
POST /api/identity/token  ──────────▶  mint one signed token per subject (trust-on-first-use)
POST /api/model/call      ──────────▶  verify token  →  subject
  Authorization: Bearer …                  ↓
                                       admission for (subject, route)  ── refused? ──▶ BUDGET_EXCEEDED, nothing sent
                                         model priced? cap has room?
                                         hold taken, atomically
                                           ↓ admitted
                                       VisionProvider / TextProvider   (neutral interface)
                                           ↓                            adapters hold the vendor shape
                                       call log row written + hold released — on success AND on failure
```

- **One entry point.** `api/model/call.ts` is the only way to reach a provider. Provider keys live in server-only environment variables and are read behind it; `scripts/check-bundle-secrets.mjs` runs as part of `pnpm build` and fails the build if a `SPORTLY_*` name or a key-shaped literal appears in `dist/`.
- **A neutral interface, two adapters.** Feature code imports `VisionProvider` / `TextProvider` from `server/provider` and never a vendor SDK. `adapters/anthropicVision.ts` is a real Messages-API adapter with image input; `adapters/notImplementedText.ts` conforms in full and refuses at the call, which keeps the interface honest without a coaching model existing yet.
- **Identity without accounts.** A subject token is an HMAC over `{ v, sub, iat }`. The signing secret is server-only and has no fallback — a missing secret stops the boundary from starting rather than degrading to trusting the client. The first mint **adopts** the client's existing local UUID so on-device data (the Alex demo, memories, workouts, meals, goals, calendar) stays attached to the same identity; a subject can be bound exactly once, and the mint endpoint is rate-limited. The column is `subject_id`, not `device_id`: real accounts will link to a subject rather than replace it.
- **Cost, never guessed.** `server/cost/rates.ts` holds per-model rates and cost is derived from token counts. A model that is not in the table records `cost_usd = null` with `cost_unknown_model = true` — never a silent zero. A database check constraint enforces that the two always agree.
- **Caps before the call, and they hold under load.** `server/budget/` holds per-route daily caps (`food_scan`, `coaching`, `program`), overridable per deployment. Admission runs before anything is sent, so a refused call never reaches a provider and never costs anything. Two things make it a cap rather than a gesture: it **fails closed on an unpriced model** (a null cost adds nothing to the day's spend, so a mispointed `SPORTLY_VISION_MODEL` would otherwise mean unlimited spend under a cap that never fires), and admission **takes a hold atomically**, counting committed spend plus live holds. A hold whose request died is returned to its bucket after its TTL.

  Atomicity here is a single `UPDATE` with the cap in its `WHERE` clause, against one counter row per (subject, route, day). That is the only shape that holds in `READ COMMITTED`: a caller that blocks on the row lock re-evaluates its condition against the row the winner committed. A count-then-insert does not work *even wrapped in an advisory lock* — the statement's snapshot is taken before the lock is acquired inside it, so after blocking, the count still reads pre-lock state. Measured on Postgres 16, that version admitted 5, 14 and 7 of 20 concurrent calls against a cap of 5 (holding $0.70 against a $0.25 cap) and 19–20 of 20 mint attempts against a limit of 5. The `UPDATE` gate admits exactly 5, run after run.
- **A log that spends no privacy.** One row per call — success or failure — carrying spend and outcome only. No prompts, no responses, no images, no credentials.
- **Holds have a lifecycle.** A hold is taken by one function invocation and released by that invocation's settle. When the settle never runs — the platform killed the function at its maximum duration, the provider hung, the process died between the hold and the spend record — the hold **expires**: `HOLD_TTL_MS` (server/budget/caps.ts) sits just above the function's `maxDuration` in `vercel.json`, because past that point the invocation that took the hold is dead and nobody is left to settle it. An expired hold stops counting toward admission and its reservation goes back to the bucket, in the same admission decision. Before that, the boundary imposes its own **provider deadline** inside the function maximum, so a hanging provider is aborted with time left to write the row and release the hold rather than left to the TTL. And **reconciliation is idempotent**: `settleSpend` is keyed on the call's `request_id` (a unique index, migration `0002`), so a replayed settle writes no second row, charges no second cost and releases no hold twice — a late settle of a hold that expiry already reclaimed commits the cost and returns nothing.
- **Storage behind a port.** Six operations named after what they do, every one scoped by subject, so a cross-subject read cannot be expressed. `store/postgres.ts` and `store/memory.ts` implement it. The in-memory adapter proves *logic* only — it is single-threaded JavaScript, atomic for free, and provides none of the properties an engine provides: atomicity, isolation, ordering, constraints. Every store declares its `engine`, and a test that asserts an engine property calls `requireRealStorageEngine` first, so pointing it at the in-memory adapter fails loudly instead of passing vacuously. Supabase or another Postgres stays switchable without touching feature code.

**Configuration** (all server-only, never bundled): `SPORTLY_TOKEN_SECRET` (required, ≥ 32 chars), `SPORTLY_DATABASE_URL`, `SPORTLY_ANTHROPIC_API_KEY`, `SPORTLY_VISION_MODEL` (must be in the rate table), `SPORTLY_DAILY_CAP_{FOOD_SCAN,COACHING,PROGRAM}_USD`, `SPORTLY_ALLOW_EPHEMERAL_STORE=1` (local development only — a per-process store resets both the cap and the one-token-per-subject rule on every cold start, so it is never the silent default).

Apply `migrations/*.sql` in order (additive; `0001` creates five tables, `0002` adds one unique index, nothing altered) and set `SPORTLY_DATABASE_URL`. `server/store/pgDriver.ts` is the only file that names a driver, and it picks one by connection string:

- **Neon** → `@neondatabase/serverless` over HTTP. No socket is opened and nothing is held between invocations, so a burst of function instances cannot exhaust the connection limit. This works only because every store operation is a single statement; HTTP mode gives each its own implicit transaction and cannot span several. An operation needing a multi-statement transaction must move to the WebSocket pool first.
- **Anything else** (plain Postgres, Supabase) → a module-scoped node-postgres pool, reused by a warm instance. Point it at a *pooled* endpoint (PgBouncer transaction mode, e.g. Supabase's `:6543`); a direct endpoint runs out of connections under concurrency. Transaction-mode pooling is safe for the same reason: one statement, one transaction, no session state across requests.

Tests: `server/__tests__/` — caps block pre-call and allow under budget, concurrent calls cannot all pass the same check, an unpriced model is refused up front (and a surprising one in a response is flagged rather than zeroed), a row is written on success and on failure, a hold that is never resolved expires and the subject is admitted again, a hanging provider is timed out with its hold released, settling one call twice charges once, scope isolation (subject A cannot touch B's rows **and** a tampered or unsigned token is rejected), driver and configuration messages never reach the client, and the built bundle carries no server configuration.

The concurrency and hold-lifecycle suites run **against a real Postgres, on every push** — the in-memory store is single-threaded JavaScript and so atomic for free, which means it proves nothing about the deployed path. They are not opt-in: without `SPORTLY_TEST_DATABASE_URL` they fail with a message saying so, and skip only under an explicit `SPORTLY_SKIP_POSTGRES_TESTS=1`, which CI never sets. Locally:

```sh
createdb sportly_test
for f in migrations/*.sql; do psql -d sportly_test -v ON_ERROR_STOP=1 -f "$f"; done
SPORTLY_TEST_DATABASE_URL=postgres://localhost/sportly_test pnpm test:unit
```

**Known limits, stated rather than hidden.** A token has no expiry and no revocation list, by design for V8a — a leaked token is valid until the signing secret rotates. Only the winning attempt's token usage is costed, so a retried call that burned tokens upstream before failing under-reports by up to one attempt (`retry_count` makes the gap visible). `cache_creation_input_tokens` is counted at the input rate rather than the higher cache-write rate; the vision adapter sets no `cache_control`, so this is zero in practice today.

**Deploy target: Vercel, and only Vercel.** `vercel.json` deploys the static client and `api/` together, with `maxDuration: 60` on the functions (the number the hold TTL is derived from). The former GitHub Pages workflow was retired: Pages serves static files only, so `api/` cannot run there, and keeping both targets meant shipping a client whose provider boundary 404s the moment a feature is wired through it. `.github/workflows/ci.yml` is the only workflow — it typechecks, lints, runs every test against a Postgres 16 service container with the migrations applied, and builds with the bundle scanner; it deploys nothing.

## Food scan and one living state

- **Food journal.** A meal described in chat (or a photo plus a description) becomes a `LoggedMeal` with per-item portions, macros and a confidence level. Corrections in chat and edits in the card or the Nutrition sheet mutate the same entity, never a copy. Daily totals are never stored: `selectDailyNutrition` derives consumed and remaining from the meals, so Coach, Nutrition and Home cannot disagree.
- **Honest analysis.** `FoodAnalysisProvider` has a local text-only implementation that says it cannot see photos and asks for a description, and an optional vision implementation used only when a key is configured. A meal records whether it came from a description or from a photo.
- **Conversation → state.** The coach only returns structured actions (`log_meal`, `update_meal`, `complete_workout`, `update_availability`, `set_goal`, …) and the orchestrator applies them to the single store. “This week” availability creates and removes calendar workouts; “from now on” updates the profile and memory.
- **State → conversation.** Every turn rebuilds the coach context from live state (today’s intake, the meal in discussion, tomorrow’s session, readiness), so dinner advice is sized to what is left and “what have I eaten” reads the journal.
- **Tests.** `src/coach/__tests__/sync.test.ts` drives the real store through the orchestrator for the scenarios above; `e2e/flows.spec.ts` flows 11 and 12 cover the food scan and state propagation in the browser.

## Architecture

```
UI (React screens & components)
  → coachService (orchestration: builds context, applies actions to state)
    → built-in engine (LocalCoachProvider: intent → proposed actions)
      | model loop (src/coach/model: ModelProvider → tool calls → runToolCall → registry)
      → generators (workout, program, nutrition), readiness, insights, personality voice
  → Zustand store (persisted to localStorage; attachment blobs in IndexedDB)

SERVER (V8a, not yet wired to a feature)
  api/model/call  → verify subject token → daily cap (pre-call) → provider interface → call log
```

| Layer | Where | Notes |
| --- | --- | --- |
| Domain model | `src/domain/types.ts` | User, goals, coach config & memory, conversations, messages, attachments, workouts, exercises, sessions, programs, nutrition plans, meals, measurements, check-ins, calendar events, notifications, preferences. Framework-agnostic. |
| Exercise library | `src/domain/exercises.ts` | ~70 exercises tagged by muscle, movement pattern, equipment and level. |
| State | `src/store/useStore.ts` | Single persisted store with typed actions. `src/store/selectors.ts` derives daily nutrition from logged meals. `src/store/attachments.ts` keeps binaries in IndexedDB. |
| Food | `src/coach/food/` | `foodDatabase.ts` (per-100 g reference with aliases), `foodAnalysis.ts` (portion parsing, corrections, `FoodAnalysisProvider` local and vision implementations). |
| Coach engine | `src/coach/` | `intents.ts` (context-aware parsing incl. slot answers like “6”), `localProvider.ts` (responses + actions + cards), `workoutGenerator.ts`, `programGenerator.ts`, `nutritionGenerator.ts`, `readiness.ts`, `insights.ts`, `personality.ts` (the four dials shape every reply). |
| Orchestration | `src/coach/coachService.ts` | The pipeline: normalise → split compound requests → context → provider → tools → honest reply. Also first conversation, quick actions, contextual notifications. |
| Coach tools | `src/coach/tools/` | `contracts.ts` (ToolResult, ToolDescriptor), `readTools.ts`, `actionTools.ts`, `registry.ts` (idempotency, audit log, tool descriptions). `src/coach/context.ts` builds the `CoachContextSnapshot`; `src/coach/time.ts` the temporal context; `src/coach/memory.ts` the memory rules. |
| Knowledge | `src/knowledge/` | Document / chunk / source types, a local keyword retriever and seed coaching notes with provenance. |
| Model seam | `src/coach/model/` | `contract.ts` (CoachModelInput/Output, ToolCall, ToolCallResult, ModelProvider), `toolDefinitions.ts` (the one tool list with JSON schemas), `schema.ts` (validation), `resolve.ts` (references), `modelTools.ts` (resolve → materialise → execute), `loop.ts` (bounded tool loop with context refresh), `prompt.ts` (model input), `providers.ts` (configuration, lazy adapters), `adapters/` (OpenAI-compatible incl. local endpoints, Anthropic). No key is bundled; the built-in coach is the default and the fallback. |
| Provider boundary | `server/`, `api/` | Server-side only. `api/model/call.ts` (the one entry point), `api/identity/token.ts` (mint). `server/provider/` (neutral `VisionProvider`/`TextProvider` + vendor adapters), `server/cost/` (rate table, cost from tokens), `server/budget/` (per-route daily caps, checked pre-call), `server/log/` (call-log writer), `server/store/` (narrow subject-scoped port, Postgres + in-memory adapters), `server/identity/` (HMAC subject tokens, trust-on-first-use mint), `server/errors.ts` (the closed error vocabulary). No provider key or server env var reaches the client bundle. |
| UI kit | `src/components/ui`, `src/components/charts` | Buttons, cards, sheets, sliders, segmented controls, chips, toasts, rings, dependency-free SVG charts. |
| Screens | `src/screens/*` | Onboarding, Home, Coach, Workout (detail / live session / summary), Nutrition, Progress, Goals, Program, Calendar, Notifications, Profile sections. |

### Real vs mocked

Real: navigation, persistence, onboarding, coach settings, conversation history, contextual actions, workout generation and modification, live workout execution with rest timers, completion → progress/streak/PR updates (from the session screen or from “I just finished my workout”), nutrition plans, the food journal with corrections and derived totals, programs → calendar, rescheduling, availability, goals, memory, notifications, theme, PWA install/offline.

Mocked only where an external service is genuinely required: the LLM (a structured local engine stands in, and a real provider plugs into the same interface), image/PDF understanding (without a configured vision model the coach says it cannot see the photo and estimates from your description; the meal is labelled accordingly), speech-to-text (uses the browser’s Speech Recognition when available, otherwise records a voice note), push delivery (in-app notification center with contextual triggers).

## Design language

Deep black surfaces, a single Higgsfield-inspired green used strategically as the accent, Inter with tight display tracking, generous spacing, restrained motion. Dark is the primary experience; light is a deliberate second palette, not an inversion. The coach has no face: it is represented by a calm point of light, typography and its voice.

## Future native migration

The domain, store and coach engine are plain TypeScript with no DOM dependencies (unit tests run in Node). Screens are thin React components over the store and service layer, which keeps a move to React Native / Expo straightforward.

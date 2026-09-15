# V8a — Provider boundary and cost control

1. Verified at 6888273: Sportly is a **pure client-side PWA** (Vite + React + zustand,
   idb/localStorage). There is no server, no database, no accounts. Provider keys are
   user-supplied and live on-device; browser calls Anthropic/OpenAI directly.
2. Target chosen with the user: portable fetch-style Node handlers under `/api`, deployed
   by the existing `vercel.json`. Storage behind a narrow port with Postgres + in-memory
   adapters; V8a tests run in-memory, no database in CI.
3. `server/env.ts` — server-only env, `SPORTLY_` prefix, fails loudly when the token secret
   is absent. No dev fallback to unsigned tokens.
4. `server/identity/` — HMAC subject tokens (v, sub, iat). Trust-on-first-use mint adopts the
   client's existing local UUID so current on-device data is not orphaned; a subject can be
   bound only once. Column is `subject_id`, never `device_id`.
5. `server/store/port.ts` — six operations named after what they do: `bindSubjectOnce`,
   `admitMintAttempt`, `admitSpend`, `settleSpend`, `readCallLog`, `spendTodayUsd`. Every one
   takes a subject, so scope isolation is structural. No query builder, no repository
   framework. `pgDriver.ts` is the only file that names a driver.
6. `server/provider/` — neutral `VisionProvider` / `TextProvider`. Real Anthropic vision
   adapter (injected transport); text adapter throws `NOT_IMPLEMENTED`. Feature code imports
   the interface only; the vendor shape stays inside the adapter file.
7. `server/cost/` — per-model rate table, cost derived from tokens. Unknown model ⇒
   `cost_usd = null` + `cost_unknown_model = true`. Never a silent zero.
8. `server/budget/` — per-route daily caps (food_scan, coaching, program), admitted BEFORE
   the provider request. Fails closed on an unpriced model (a null cost adds nothing to the
   day's spend), and takes an atomic hold so concurrent calls cannot all pass one check.
   Refused ⇒ `BUDGET_EXCEEDED`, nothing sent. Atomic means one `UPDATE` with the cap in
   its `WHERE`, not a count-then-insert — an advisory lock does not fix the latter, because
   the statement snapshot predates the lock.
9. `server/boundary.ts` — the one path every model call takes: verify token → admit (price
   + cap + hold) → call provider (bounded retry) → write the log row and release the hold,
   on success AND on failure.
10. `api/model/call.ts` is the single entry point for model calls; `api/identity/token.ts`
    mints. Both are thin: parse, delegate, map `BoundaryError` to a status.
11. `migrations/0001_model_call_log.sql` — additive only: five new tables, nothing altered.
12. Bundle proof: `scripts/check-bundle-secrets.mjs` scans `dist/` for `SPORTLY_*` and
    key-shaped literals; wired into `pnpm build`. A test asserts every server-only var
    carries the prefix the scanner looks for, and that no file in `src/` imports `server/`.
13. Tests in `server/__tests__/`: cap blocks pre-call, cap allows under budget, log on
    success, log on provider failure, unknown model flagged, scope isolation (A cannot touch
    B's rows AND a tampered token is rejected), bundle invariants.
14. Additive only: no file under `src/` changes behaviour. No UI changes. The 164 existing
    tests must stay green, and typecheck and lint must stay clean.
15. Out of scope by the brief: no vision call wired into Food Scan, no coaching model, no
    S3N validator, no benchmark scaffolding. Not deployed, not pushed to main.

# V8a.1 — Close out the foundation

1. **Vercel is canonical.** `.github/workflows/deploy-pages.yml` deleted; `api/` cannot run
   on Pages. `vercel.json` gains `functions.maxDuration: 60`. Not deployed from this
   session: the sandbox's network policy refuses `api.vercel.com` (403 on CONNECT) and
   holds no Vercel credentials, so the preview deploy is recorded as blocked in the PR
   and the handlers were exercised end to end locally instead — real `api/*` handlers
   bundled the way Vercel bundles them, real Postgres, stub text adapter.
2. **CI runs the Postgres tests.** `.github/workflows/ci.yml` — Postgres 16 service,
   migrations applied, `pnpm test:unit` with `SPORTLY_TEST_DATABASE_URL`. The Postgres
   suites are no longer opt-in: without a URL they fail with a message, and skip only under
   an explicit `SPORTLY_SKIP_POSTGRES_TESTS=1` (`server/__tests__/pg.ts`).
3. **Hold lifecycle** (`server/store/port.ts` header, `server/budget/caps.ts`): holds expire
   at `HOLD_TTL_MS = maxDuration + 15 s`; the boundary aborts the provider phase at
   `PROVIDER_DEADLINE_MS = 45 s` so a hang settles rather than leaks; `settleSpend` is
   idempotent on `request_id` (unique index, `migrations/0002_hold_lifecycle.sql`, and
   `on conflict do nothing` gating both the release and the charge).
4. **Found by the Postgres tests, fixed:** `latencyMs` was fractional (`performance.now()`)
   against an `integer` column, so every real settle would have failed with
   `PERSISTENCE_FAILURE` — no log row, hold left to the TTL. Rounded in `server/boundary.ts`.
5. **In-memory guard rail.** `BoundaryStore.engine`; `requireRealStorageEngine` throws for the
   memory adapter; the Postgres fixture calls it in `beforeAll`. The in-memory "concurrency"
   test in `boundary.test.ts` is retitled as logic-only.

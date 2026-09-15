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

# V8b — Nutrition data layer

1. Scope held to data: no vision adapter, no `/scan` route, no model call in the diff.
   `server/nutrition/` is importable by the scan session later and by nothing yet.
2. Three sources, three homes, chosen by licence (`migrations/0003_nutrition_data.sql`,
   additive only): `ciqual_foods` + `ciqual_ingest` (ANSES Ciqual 2025, Licence Ouverte 2.0,
   joinable, attribution required); `off.products` in its **own schema** (Open Food Facts,
   ODbL share-alike — a per-barcode API cache, never the dump, no foreign key in either
   direction, nothing in `public` derived from it); `sportly_foods` + `sportly_food_aliases`
   (ours: typical portions, `kind = 'dish'` placeholder for composed dishes, user-confirmed
   corrections scoped by `subject_id`).
3. **Ciqual comes from the official source.** `scripts/ingest-ciqual.mjs fetch` reads the
   ANSES dataset on Recherche Data Gouv (doi:10.57745/RDMHWY, files `alim/compo/const_2025_11_03.xml`),
   resolves each constituent by *name* and cross-checks its code (EU energy kcal 328, protein N×6.25
   25003, carbs 31000, fat 40000, fibre 34100, …; a rename fails the run), and writes a
   committed snapshot `data/ciqual/ciqual-2025.csv` + `.meta.json` with DOI, checksums,
   licence and attribution. `apply` loads the snapshot; CI and production load the same
   bytes and never depend on the source being up. The sandbox this was built in cannot
   reach data.gouv.fr, so the fetch ran on GitHub Actions (`.github/workflows/nutrition-data.yml`),
   which commits the snapshot back to the branch.
4. **Exact matching, in the database.** `sportly_label_norm(text)` (lower-case, accents folded,
   ligatures expanded, whitespace collapsed; no `unaccent` extension) is applied to stored
   names as generated columns and to the query in the `WHERE`, so no TypeScript re-implements
   it. A label matches a food only when the whole normalised label is equal; a prefix is not
   a match and two equal names are `ambiguous`, with candidates, never a pick.
5. **Resolution order** (`server/nutrition/resolve.ts`): barcode → `off.products` (API on a
   miss, 30-day cache, not-found cached 1 day, stale row served marked stale when OFF is
   down) | label → `ciqual_foods` | → `sportly_foods` (a subject's own correction wins) |
   → `unresolved` with `reason` ∈ {empty_query, no_match, ambiguous, source_unavailable},
   the sources `tried`, and the query echoed. `source_unavailable` exists so a caller never
   records "unknown food" because OFF was unreachable.
6. **One place for numbers.** `macrosForPortion(per100g, grams)` (`server/nutrition/macros.ts`)
   is pure: no I/O, no clock. A nutrient the source lacks stays `null`; energy is the source's
   kcal, else derived with the Regulation 1169/2011 factors (4/4/9, fibre 2) and flagged
   `kcalDerived`. Tested against hand-computed values.
7. **Attribution on every resolved food** (`server/nutrition/attribution.ts`): provider,
   licence and URL, the credit line worded as each provider asks, a link to the food's page,
   and `required` (true for ANSES and OFF, false for our own rows).
8. Tests: `nutritionMacros`, `nutritionOff`, `nutritionResolve` (logic, stub store, injected
   fetch, no network) and `postgresNutrition` (real Postgres via `describePostgres`: schema
   separation, exact matching on the real Ciqual rows, cache round-trip, constraints).
   CI applies the snapshot before the suite. Nothing in the test suite touches the network;
   `scripts/off-lookup.mjs` is the live smoke check, run by the data workflow.
9. Deliberately out of scope: composed-dish components, confidence, meal drafts. They belong
   to the scan session; the schema leaves room (`kind`, `subject_id`, `ciqual_alim_code`).

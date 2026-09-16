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
10. **Tests cannot fail the production build.** Vercel runs `pnpm build`, which starts with
    `tsc -b` over tsconfig.json's references (app, node, server). Those now exclude
    `server/__tests__` and `src/**/__tests__`; the suites are typechecked by their own
    programs, `tsconfig.server-tests.json` and `tsconfig.app-tests.json`, through
    `pnpm typecheck` (= `tsc -b && pnpm typecheck:tests`), which is what CI runs. Proven by
    breaking a test file in each tree: `pnpm build` exit 0, `pnpm typecheck` exit 2 naming the
    file; then reverted. `check-api-esm-load` and `off-lookup` emit with tsconfig.server.json,
    so they stop compiling tests too.

# V8c — Food label matching

1. Scope held to label matching: no vision adapter, no `/scan` route, no model call in the diff.
   The resolver's shape from V8b stands — `no_match`, `ambiguous` with candidates,
   `source_unavailable` — and gains the strategy behind it, which was exact and therefore
   resolved almost nothing a vision model actually says.
2. **pg_trgm, additively** (`migrations/0004_food_matching.sql`): `create extension if not exists
   pg_trgm`, a GIN `gin_trgm_ops` index on `ciqual_foods.name_fr_norm` (the planner uses it on its
   own at 3,484 rows; the candidate query runs in ~1.5 ms), `sportly_label_head(text)` (a label's
   food name: before the first comma, parenthetical dropped) and the table `sportly_food_synonyms`.
   Nothing from 0001–0003 is altered. French labels only: "orange" landing on "Orange juice" would
   be noise, not recall.
3. **Two measures, one policy** (`server/nutrition/matching.ts`, thresholds passed into the SQL as
   parameters — the Neon HTTP driver carries no session state, so no `SET`):
   `similarity(query, label)` over the whole label is the confidence; `word_similarity(query,
   label)` is the candidate gate. Bands: exactly one candidate at or above `SIMILARITY_HIGH = 0.75`
   resolves (two is ambiguity, not a coin toss); anything above `SIMILARITY_LOW = 0.6` is
   `ambiguous` with the ten candidates ranked and scored; nothing is `no_match`. Ranking inside
   the band is by name match then score, so "Banane, chair sans peau, crue" sits above "Nectar de
   banane". Both values come from the test set: the highest score a wrong food reaches at the top
   of a ranking is 0.700 ("haricots verts" → "Haricots verts, purée"), the lowest a right food
   reaches with a qualifier is 0.810 ("lait demi-écrémé" → "Lait demi-écrémé, UHT"); 0.75 sits in
   the gap. Between a gate of 0.5 and 0.6 the set moves by one term either way, and 0.6 is
   pg_trgm's shipped `word_similarity_threshold`, so the index-served `<%` operator and the policy
   agree — asserted by the Postgres suite.
4. **Synonyms take precedence** — over similarity and over an exact label, because a synonym is an
   explicit statement. `sportly_food_synonyms` maps a free-text term to one canonical food (a Ciqual
   row or a Sportly row, never an OFF product), keyed by `(term_norm, scope)`: a subject's own
   `user_correction` row and the shared `sportly` row for the same term coexist, the subject's wins
   for that subject only. This is where a user correction lands and where it is reused. The seed
   (`data/food-matching/synonyms.fr.json`, applied by `scripts/seed-food-synonyms.mjs` after the
   Ciqual ingest, in CI too) holds eight rows, each one there because the test set proved the
   resolver alone could not put the right food in front of the user; the suite asserts the seed's
   terms are exactly the measured misses, so a stale or missing seed row fails CI.
5. **The test set is the point** (`data/food-matching/terms.fr.json`): 50 French terms a vision
   model emits — short, common, unqualified — none of them a Ciqual label, each with the codes that
   count as right. Without synonyms: 6 resolved right, 35 ambiguous with the right food listed
   (first in 21), 5 ambiguous without it, 2 wrongly `no_match`, 1 rightly `no_match` ("granola"),
   and **one confident wrong answer, named**: "raisin" → "Raisin sec", not by similarity but by
   V8b's exact match on the *English* label ("Raisin" is English for dried grape). Seeded. With
   the seed: 14 resolved right, 0 wrong, every term Ciqual covers resolved or listed.
   `scripts/food-matching-report.mjs` prints the table through the real code path, read-only.
6. Tests: `nutritionMatching` (bands, precedence, subject scoping, thresholds in force; canned
   scores against the stub) and `postgresFoodMatching` (extension, index plan, GUC agreement, the
   whole test set twice, real scores, the correction round trip, constraints and cascade). The
   real-Postgres fixture now takes a session advisory lock per suite: every suite truncates tables
   before each test, and a fifth Postgres file made parallel workers truncate each other's rows
   mid-test on a 4-core box.
7. Deliberately out of scope: fuzzy matching of synonym terms, English-side similarity, a language
   hint on the query (which is what would retire the "raisin" class of homograph properly), and
   any UI for choosing among candidates.
8. **The coach suites run on an injected clock** (`src/coach/__tests__/clock.ts`, imported first in
   every file of the family): `Date` is faked, pinned to a fixed local 10:00 and still advancing, so
   `todayKey()` at module load, the demo seed's weekday placement and every "demain"/"vendredi" in
   a journey resolve the same way on every run. `SPORTLY_TEST_NOW=YYYY-MM-DD` overrides the pin and
   CI runs the family once per weekday of a full week. Read against the real clock the same tree
   had passed on the 14th and failed on the 15th and 16th on different sentences. The sweep exposed
   three real defects, fixed rather than tolerated: the journey claim detector had been relaxed to
   overlook "Planned yesterday: …" (restored to full strength; the day-report template now reads
   "On the plan yesterday: …"), "Move tomorrow's workout to Friday" on a Thursday answered "Moved …
   from Friday to Friday" (now: already on Friday, nothing moved), and the tool registry's repeat
   ledger keyed `update_workout` on exercises only, so "make it 30 minutes" then "dumbbells only"
   on a session that needed no exercise swap was reported done and never written (the key now
   covers constraints, title and status).

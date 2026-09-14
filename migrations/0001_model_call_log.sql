-- V8a — provider boundary and cost control.
--
-- Additive only. This migration creates four new tables and alters nothing.
-- Sportly's existing user data lives on-device (zustand + IndexedDB) and is
-- untouched by anything here.
--
-- The identity column is `subject_id`, not `device_id`: when real accounts
-- land, a subject gets linked to an account rather than replaced by one.

create table if not exists sportly_subject (
  subject_id  uuid        primary key,
  bound_at    timestamptz not null
);

comment on table sportly_subject is
  'One row per subject, written once at first token mint (trust-on-first-use). The primary key is what makes the one-token-per-subject rule atomic.';

create table if not exists sportly_mint_attempt (
  id            bigserial   primary key,
  attempt_key   text        not null,
  attempted_at  timestamptz not null
);

create index if not exists sportly_mint_attempt_key_time
  on sportly_mint_attempt (attempt_key, attempted_at desc);

comment on table sportly_mint_attempt is
  'Rate-limit ledger for the mint endpoint, which creates rows.';

create table if not exists sportly_spend_hold (
  hold_id     uuid        primary key default gen_random_uuid(),
  subject_id  uuid        not null,
  route       text        not null check (route in ('food_scan', 'coaching', 'program')),
  day         date        not null,
  hold_usd    numeric(12, 6) not null check (hold_usd >= 0),
  taken_at    timestamptz not null
);

create index if not exists sportly_spend_hold_bucket
  on sportly_spend_hold (subject_id, route, day);

comment on table sportly_spend_hold is
  'Reservations taken at admission and released when the call settles. Without them the cap is a read-then-write and concurrent calls all pass the same check. A hold whose request died stops counting after its TTL.';

create table if not exists sportly_model_call_log (
  id                  bigserial   primary key,
  ts                  timestamptz not null,
  subject_id          uuid        not null,
  request_id          uuid        not null,
  route               text        not null check (route in ('food_scan', 'coaching', 'program')),
  provider            text        not null,
  model               text        not null,
  task_type           text        not null check (task_type in ('vision', 'text')),
  tokens_in           integer     not null default 0,
  tokens_cached       integer     not null default 0,
  tokens_out          integer     not null default 0,
  -- Nullable on purpose: an unpriced model records null, never 0.
  cost_usd            numeric(12, 6),
  cost_unknown_model  boolean     not null default false,
  latency_ms          integer     not null default 0,
  retry_count         integer     not null default 0,
  outcome             text        not null check (outcome in ('success', 'error')),
  error_category      text,
  -- A null cost is only ever an unknown model, and an unknown model always
  -- carries a null cost. The database refuses any other combination, so a
  -- silent zero cannot be written even by a future code path that tries.
  constraint sportly_model_call_log_unknown_cost
    check ((cost_usd is null) = cost_unknown_model)
);

-- The shape every cap check reads: one subject, one route, one day.
create index if not exists sportly_model_call_log_spend
  on sportly_model_call_log (subject_id, route, ts desc);

comment on table sportly_model_call_log is
  'One row per model call, success or failure. Carries spend and outcome only: no prompts, no responses, no user content, no credentials.';

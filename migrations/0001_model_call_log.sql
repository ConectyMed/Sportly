-- V8a — provider boundary and cost control.
--
-- Additive only. This migration creates six new tables and alters nothing.
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

-- Counter rows, not ledgers-plus-count.
--
-- Both limiters below gate on a single UPDATE whose WHERE carries the
-- condition. That is the only shape that holds under concurrency in READ
-- COMMITTED: when such an UPDATE blocks on another transaction's row lock, it
-- re-evaluates its WHERE against the *updated* row once that commits.
--
-- The obvious alternative — take an advisory lock, then count rows, then
-- insert if under the limit — does NOT work, however the lock is scoped. A
-- statement's snapshot is taken before the lock is acquired inside it, so
-- after blocking the count still reads pre-lock state and every caller is
-- admitted. Measured on Postgres 16: 19-20 of 20 mint attempts admitted
-- against a limit of 5.

create table if not exists sportly_mint_bucket (
  attempt_key   text        primary key,
  window_start  timestamptz not null,
  n             integer     not null default 0
);

comment on table sportly_mint_bucket is
  'Fixed-window rate limit for the mint endpoint, which creates rows. One row per key; the gate is an UPDATE with the limit in its WHERE clause.';

create table if not exists sportly_spend_bucket (
  subject_id     uuid           not null,
  route          text           not null check (route in ('food_scan', 'coaching', 'program')),
  day            date           not null,
  held_usd       numeric(12, 6) not null default 0,
  committed_usd  numeric(12, 6) not null default 0,
  primary key (subject_id, route, day)
);

comment on table sportly_spend_bucket is
  'The authoritative admission counter: money already spent plus money reserved, for one subject, route and UTC day. Admission is an UPDATE gated on held_usd + committed_usd < cap, which is what makes the cap hold under concurrency.';

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

create index if not exists sportly_spend_hold_stale
  on sportly_spend_hold (taken_at);

comment on table sportly_spend_hold is
  'One row per live reservation, so a hold whose request died can be found and given back to its bucket after its TTL. The bucket row is what admission reads; this table is how the bucket is repaired.';

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

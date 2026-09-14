-- V8a.1 — hold lifecycle.
--
-- Additive only: one unique index, nothing altered.
--
-- `settleSpend` is keyed on request_id. With this index a replayed settle —
-- a retried statement, a duplicated request, a function that ran its settle
-- twice — hits `on conflict (request_id) do nothing`, and the adapter gates
-- the hold release and the bucket charge on that insert having landed. One
-- call, one row, one charge, whatever happens around it.
--
-- request_id is a per-call v4 UUID minted by the boundary; retries within a
-- call share it, and one call writes exactly one row, so uniqueness is the
-- invariant the code already relied on. This makes the database enforce it.

create unique index if not exists sportly_model_call_log_request
  on sportly_model_call_log (request_id);

comment on index sportly_model_call_log_request is
  'One row per call. What makes settleSpend idempotent: a second settle for the same request writes nothing, releases nothing and charges nothing.';

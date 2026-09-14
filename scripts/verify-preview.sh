#!/usr/bin/env bash
# Verify a deployed Sportly V8a preview end to end.
#
#   scripts/verify-preview.sh https://<preview>.vercel.app
#
# Checks, in order (each prints PASS or FAIL; exit status is non-zero if any fail):
#   1. POST /api/identity/token, fresh subject           -> 200 and a token
#   2. POST /api/identity/token, same subject again      -> 401 UNAUTHORIZED
#   3. POST /api/model/call, text task, with that token  -> 502 PROVIDER_UNAVAILABLE, reason not_implemented
#      then, in the database: one log row (outcome error), no hold, nothing held
#   4. set committed spend to the cap in the database, call again
#                                                        -> 402 BUDGET_EXCEEDED
#      then, in the database: still one log row, still no hold
#
# Environment:
#   SPORTLY_DATABASE_URL        Postgres URL of the preview's database. Needed for the
#                               database half of checks 3 and 4. Never printed. Without
#                               it those checks are reported as FAIL (not verified) and
#                               the SQL to run by hand is printed instead.
#   VERCEL_PROTECTION_BYPASS    Optional. Sent as x-vercel-protection-bypass if the
#                               preview has deployment protection on.
#   ROUTE                       Budget route to exercise. Default: coaching.
#   CAP_USD                     The preview's daily cap for ROUTE. Default 1.00, which is
#                               the code default for coaching. If the preview sets
#                               SPORTLY_DAILY_CAP_COACHING_USD, pass the same value here.
#
# The preview itself needs SPORTLY_TOKEN_SECRET, SPORTLY_DATABASE_URL and
# SPORTLY_ANTHROPIC_API_KEY set: without the API key the provider factory fails before
# the stub adapter is reached, and check 3 sees a 502 with no not_implemented reason.
#
# Mint is rate limited to 5 attempts per client IP per hour. Each run uses 2.
#
# Requires: bash, curl, and jq or python3. psql for the database checks.

set -euo pipefail

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
  echo "usage: $0 https://<preview>.vercel.app" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"
ROUTE="${ROUTE:-coaching}"
CAP_USD="${CAP_USD:-1.00}"

MINT_PATH="/api/identity/token"
CALL_PATH="/api/model/call"

FAILS=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n      %s\n' "$1" "$2"; FAILS=$((FAILS + 1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- helpers -----------------------------------------------------------------

new_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  elif [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid
  elif command -v python3 >/dev/null 2>&1; then python3 -c 'import uuid; print(uuid.uuid4())'
  else echo "need uuidgen, /proc/sys/kernel/random/uuid or python3 to make a subject id" >&2; exit 2
  fi
}

# jget <jq path> <file>  -> value or empty. Uses jq, falls back to python3.
jget() {
  if command -v jq >/dev/null 2>&1; then
    jq -r "$1 // empty" "$2" 2>/dev/null || true
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$1" "$2" <<'PY' 2>/dev/null || true
import json, sys
path, file = sys.argv[1], sys.argv[2]
try:
    v = json.load(open(file))
    for k in [p for p in path.split('.') if p]:
        v = v[k]
    if v is None or isinstance(v, (dict, list)): sys.exit(0)
    print(v)
except Exception:
    pass
PY
  else
    echo "need jq or python3 to read JSON responses" >&2; exit 2
  fi
}

# req <path> <body-json> [token]  -> sets HTTP_CODE, writes body to $RESP
RESP="$TMP/resp.json"
req() {
  local path="$1" body="$2" token="${3:-}"
  local -a hdr=(-H 'content-type: application/json' -H 'accept: application/json')
  [ -n "$token" ] && hdr+=(-H "authorization: Bearer $token")
  [ -n "${VERCEL_PROTECTION_BYPASS:-}" ] && hdr+=(-H "x-vercel-protection-bypass: $VERCEL_PROTECTION_BYPASS")
  HTTP_CODE="$(curl -sS --max-time 75 -o "$RESP" -w '%{http_code}' -X POST "${hdr[@]}" --data "$body" "$BASE_URL$path")" || {
    HTTP_CODE="000"; : > "$RESP"
  }
}

describe_resp() {
  local code msg
  code="$(jget .error.code "$RESP")"; msg="$(jget .error.message "$RESP")"
  if [ -n "$code" ]; then printf 'got HTTP %s %s: %s' "$HTTP_CODE" "$code" "$msg"
  elif [ "$HTTP_CODE" = "401" ] && ! jget . "$RESP" >/dev/null 2>&1 && grep -qi 'vercel' "$RESP" 2>/dev/null; then
    printf 'got HTTP 401 with a non-JSON body: deployment protection is probably on; set VERCEL_PROTECTION_BYPASS'
  else printf 'got HTTP %s, body: %s' "$HTTP_CODE" "$(head -c 300 "$RESP" | tr '\n' ' ')"
  fi
}

# ---- database access ---------------------------------------------------------

DB_OK=0
if [ -n "${SPORTLY_DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  DB_OK=1
elif [ -n "${SPORTLY_DATABASE_URL:-}" ]; then
  echo "note: SPORTLY_DATABASE_URL is set but psql is not on PATH; database checks cannot run" >&2
else
  echo "note: SPORTLY_DATABASE_URL is not set; database checks cannot run" >&2
fi

# db <sql>  -> runs SQL with :subject, :route, :cap bound as psql variables.
# The URL is passed only as an argument to psql; it is never echoed.
db() {
  psql "$SPORTLY_DATABASE_URL" -X -q -At -v ON_ERROR_STOP=1 \
    -v subject="$SUBJECT" -v route="$ROUTE" -v cap="$CAP_USD" -f - <<<"$1"
}

# One line: log_rows|error_rows|provider_unavailable_rows|not_impl_rows|holds|held_usd|committed_usd
db_state() {
  db "
select
  (select count(*) from sportly_model_call_log where subject_id = :'subject'::uuid) as log_rows,
  (select count(*) from sportly_model_call_log where subject_id = :'subject'::uuid and outcome = 'error') as error_rows,
  (select count(*) from sportly_model_call_log where subject_id = :'subject'::uuid and error_category = 'PROVIDER_UNAVAILABLE') as pu_rows,
  (select count(*) from sportly_model_call_log where subject_id = :'subject'::uuid and provider = 'not_implemented') as ni_rows,
  (select count(*) from sportly_spend_hold where subject_id = :'subject'::uuid) as holds,
  (select coalesce(sum(held_usd), 0) from sportly_spend_bucket where subject_id = :'subject'::uuid) as held_usd,
  (select coalesce(sum(committed_usd), 0) from sportly_spend_bucket where subject_id = :'subject'::uuid and route = :'route' and day = (now() at time zone 'utc')::date) as committed_usd;
"
}

SQL_SET_CAP="
-- Set committed spend for this subject/route/today (UTC) to exactly the cap.
-- The gate admits while held_usd + committed_usd < cap, so this blocks the next call.
insert into sportly_spend_bucket (subject_id, route, day, held_usd, committed_usd)
values (:'subject'::uuid, :'route', (now() at time zone 'utc')::date, 0, :'cap'::numeric)
on conflict (subject_id, route, day) do update
  set committed_usd = excluded.committed_usd;
"

print_manual_sql() {
  cat <<SQL

---- SQL to run by hand (replace the three placeholders) ----------------------
-- subject: $SUBJECT   route: $ROUTE   cap: $CAP_USD
\\set subject '$SUBJECT'
\\set route '$ROUTE'
\\set cap '$CAP_USD'

-- Inspect this subject's rows:
select route, day, held_usd, committed_usd
  from sportly_spend_bucket where subject_id = :'subject'::uuid;
select hold_id, route, day, hold_usd, taken_at
  from sportly_spend_hold where subject_id = :'subject'::uuid;
select id, ts, route, provider, model, outcome, error_category, retry_count, cost_usd, request_id
  from sportly_model_call_log where subject_id = :'subject'::uuid order by id;
$SQL_SET_CAP
-- After the 402, re-run the three inspect queries: the log row count must not
-- have grown and sportly_spend_hold must still have no row for the subject.

-- Optional cleanup of the test subject:
-- delete from sportly_model_call_log where subject_id = :'subject'::uuid;
-- delete from sportly_spend_hold      where subject_id = :'subject'::uuid;
-- delete from sportly_spend_bucket    where subject_id = :'subject'::uuid;
-- delete from sportly_subject         where subject_id = :'subject'::uuid;
------------------------------------------------------------------------------
SQL
}

# ---- checks ------------------------------------------------------------------

SUBJECT="$(new_uuid)"
echo "preview:  $BASE_URL"
echo "subject:  $SUBJECT"
echo "route:    $ROUTE   cap: $CAP_USD"
echo

# 1. first mint
req "$MINT_PATH" "{\"subjectId\":\"$SUBJECT\"}"
TOKEN="$(jget .token "$RESP")"
if [ "$HTTP_CODE" = "200" ] && [ -n "$TOKEN" ] && [ "$(jget .subjectId "$RESP")" = "$SUBJECT" ]; then
  pass "1. mint token for a new subject -> 200 with token"
else
  if [ "$HTTP_CODE" = "429" ]; then
    fail "1. mint token for a new subject -> 200 with token" "rate limited: mint allows 5 attempts per client IP per hour; wait and retry"
  else
    fail "1. mint token for a new subject -> 200 with token" "$(describe_resp)"
  fi
  echo; echo "cannot continue without a token."; print_manual_sql; exit 1
fi

# 2. second mint, same subject
req "$MINT_PATH" "{\"subjectId\":\"$SUBJECT\"}"
if [ "$HTTP_CODE" = "401" ] && [ "$(jget .error.code "$RESP")" = "UNAUTHORIZED" ]; then
  pass "2. mint again for the same subject -> 401 UNAUTHORIZED"
else
  fail "2. mint again for the same subject -> 401 UNAUTHORIZED" "$(describe_resp) (a 200 here means the preview is on the ephemeral store or the token was not bound)"
fi

# 3. boundary call through the stub text adapter
CALL_BODY="{\"route\":\"$ROUTE\",\"taskType\":\"text\",\"prompt\":\"verify-preview\"}"
req "$CALL_PATH" "$CALL_BODY" "$TOKEN"
if [ "$HTTP_CODE" = "502" ] && [ "$(jget .error.code "$RESP")" = "PROVIDER_UNAVAILABLE" ] && [ "$(jget .error.detail.reason "$RESP")" = "not_implemented" ]; then
  pass "3. text call with token -> 502 PROVIDER_UNAVAILABLE, reason not_implemented"
else
  fail "3. text call with token -> 502 PROVIDER_UNAVAILABLE, reason not_implemented" "$(describe_resp) (a 502 without reason not_implemented usually means SPORTLY_ANTHROPIC_API_KEY is unset on the preview)"
fi

if [ "$DB_OK" = 1 ]; then
  if STATE="$(db_state)"; then
    IFS='|' read -r LOG_ROWS ERR_ROWS PU_ROWS NI_ROWS HOLDS HELD COMMITTED <<<"$STATE"
    if [ "$LOG_ROWS" = 1 ] && [ "$ERR_ROWS" = 1 ] && [ "$PU_ROWS" = 1 ] && [ "$NI_ROWS" = 1 ]; then
      pass "3a. one log row for the subject: outcome error, PROVIDER_UNAVAILABLE, provider not_implemented"
    else
      fail "3a. one log row for the subject: outcome error, PROVIDER_UNAVAILABLE, provider not_implemented" "log_rows=$LOG_ROWS error_rows=$ERR_ROWS provider_unavailable_rows=$PU_ROWS not_implemented_rows=$NI_ROWS"
    fi
    if [ "$HOLDS" = 0 ] && awk -v v="$HELD" 'BEGIN { exit !(v + 0 == 0) }'; then
      pass "3b. hold released: no row in sportly_spend_hold, held_usd is 0"
    else
      fail "3b. hold released: no row in sportly_spend_hold, held_usd is 0" "holds=$HOLDS held_usd=$HELD"
    fi
    LOG_ROWS_BEFORE="$LOG_ROWS"
  else
    fail "3a/3b. database state after the stub call" "psql query failed (see output above)"
    LOG_ROWS_BEFORE=""
  fi
else
  fail "3a/3b. database state after the stub call" "not verified: no database access from here"
  LOG_ROWS_BEFORE=""
fi

# 4. cap at its limit
if [ "$DB_OK" = 1 ] && db "$SQL_SET_CAP" >/dev/null; then
  req "$CALL_PATH" "$CALL_BODY" "$TOKEN"
  if [ "$HTTP_CODE" = "402" ] && [ "$(jget .error.code "$RESP")" = "BUDGET_EXCEEDED" ]; then
    pass "4. call with committed spend at the cap -> 402 BUDGET_EXCEEDED (capUsd=$(jget .error.detail.capUsd "$RESP") spentUsd=$(jget .error.detail.spentUsd "$RESP"))"
  else
    fail "4. call with committed spend at the cap -> 402 BUDGET_EXCEEDED" "$(describe_resp) (if 502: CAP_USD=$CAP_USD is below the preview's real cap for $ROUTE)"
  fi
  if STATE="$(db_state)"; then
    IFS='|' read -r LOG_ROWS ERR_ROWS PU_ROWS NI_ROWS HOLDS HELD COMMITTED <<<"$STATE"
    if [ -n "$LOG_ROWS_BEFORE" ] && [ "$LOG_ROWS" = "$LOG_ROWS_BEFORE" ]; then
      pass "4a. no new log row after the 402 (still $LOG_ROWS)"
    else
      fail "4a. no new log row after the 402" "log rows before=$LOG_ROWS_BEFORE after=$LOG_ROWS"
    fi
    if [ "$HOLDS" = 0 ]; then
      pass "4b. no hold after the 402 (held_usd=$HELD committed_usd=$COMMITTED)"
    else
      fail "4b. no hold after the 402" "holds=$HOLDS held_usd=$HELD committed_usd=$COMMITTED"
    fi
  else
    fail "4a/4b. database state after the 402" "psql query failed (see output above)"
  fi
else
  fail "4. call with committed spend at the cap -> 402 BUDGET_EXCEEDED" "not run: needs database access to set committed spend"
  fail "4a/4b. database state after the 402" "not verified: no database access from here"
fi

echo
if [ "$DB_OK" != 1 ]; then print_manual_sql; fi
if [ "$FAILS" -gt 0 ]; then
  echo "$FAILS check(s) failed."
  exit 1
fi
echo "all checks passed."

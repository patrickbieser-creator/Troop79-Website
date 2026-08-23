#!/usr/bin/env bash
# Replace the LOCAL dev database's public-schema data with a fresh copy of
# production. The practice-reset button: after exercising the site locally
# (imports, test signups, payments, deletions…), run this and local is
# production again.
#
#   npm run refresh-local-from-prod            # dump prod → reload local
#   npm run refresh-local-from-prod -- --from=backups/prod-data-20260822-181500.sql
#                                              # reload local from an existing dump
#
# What it does (the recipe from memory/deployment.md, now a script):
#   1. `supabase db dump --linked --data-only --use-copy -s public` — data
#      only, public schema only (auth.* / storage.* are Supabase-internal and
#      must not be overwritten locally). Saved under next-app/backups/
#      (gitignored — real family PII). The dump opens with
#      `SET session_replication_role = replica`, so triggers and FK checks
#      are off while it loads — restored signup entries do NOT re-fire the
#      car-sync / patrol-seed triggers against the dumped groups.
#   2. TRUNCATE … RESTART IDENTITY CASCADE every table the dump carries, so
#      migration-seeded lookup rows and practice data cannot collide.
#   3. Load the dump with psql inside the local Postgres container.
#   4. setval() every public sequence to max(id) — raw COPY never advances
#      identity sequences, and a stale one makes the next local insert
#      collide with a restored production id.
#   5. Compare per-table row counts (dump lines vs rows loaded); retry any
#      table that came up short once, then verify again.
#
# Never touches production (the dump is read-only). Never run `db reset`
# (memory/feedback-never-reset-local-supabase.md). Requires the local stack
# to be on the same migrations as production (`npx supabase migration up`
# first if a table in the dump does not exist locally).
set -euo pipefail

cd "$(dirname "$0")/.."
CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_next-app}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP=""
for a in "$@"; do
  case "$a" in
    --from=*) DUMP="${a#--from=}" ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "✗ local Supabase is not running (container $CONTAINER). Start it with: npx supabase start" >&2
  exit 1
fi
sql() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=0 -q "$@"; }
count_local() { docker exec "$CONTAINER" psql -U postgres -d postgres -Atc "select count(*) from public.\"$1\""; }

# ── 1. dump production ────────────────────────────────────────────────────
if [ -z "$DUMP" ]; then
  PW="$(grep -E '^SUPABASE_DB_PASSWORD=' .env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
  if [ -z "$PW" ]; then
    echo "✗ SUPABASE_DB_PASSWORD is not set in next-app/.env.local" >&2
    exit 1
  fi
  mkdir -p backups
  DUMP="backups/prod-data-${STAMP}.sql"
  echo "→ dumping production public-schema data to $DUMP …"
  npx supabase db dump --linked --data-only --use-copy -s public -p "$PW" -f "$DUMP"
fi
[ -s "$DUMP" ] || { echo "✗ dump $DUMP is missing or empty" >&2; exit 1; }

# Table list: `COPY "public"."t" (…) FROM stdin;` or `COPY public.t (…) FROM stdin;`
table_of() { sed -E 's/^COPY "?public"?\."?([A-Za-z0-9_]+)"?.*$/\1/'; }
TABLES="$(grep -E '^COPY "?public"?\.' "$DUMP" | table_of | sort -u)"
N="$(printf '%s\n' "$TABLES" | grep -c . || true)"
if [ "$N" -eq 0 ]; then
  echo "✗ $DUMP has no COPY blocks — it was not made with --use-copy; this script only loads COPY dumps." >&2
  exit 1
fi
if ! head -5 "$DUMP" | grep -q 'session_replication_role = replica'; then
  echo "⚠ dump does not disable triggers — prepending SET session_replication_role = replica" >&2
  TMP="$(mktemp)"; { echo 'SET session_replication_role = replica;'; cat "$DUMP"; } > "$TMP"; DUMP="$TMP"
fi

# The COPY block for one table (header line through the terminating "\.").
block_of() {
  awk -v t="$1" '
    BEGIN { p = 0 }
    $0 ~ ("^COPY \"?public\"?\\.\"?" t "\"?[ (]") { p = 1 }
    p { print }
    p && $0 == "\\." { exit }
  ' "$DUMP"
}
dump_count() { block_of "$1" | awk 'NR > 1 && $0 != "\\." { n++ } END { print n + 0 }'; }

# ── 2. truncate exactly the tables the dump carries ───────────────────────
echo "→ dump carries $N tables; truncating them locally (RESTART IDENTITY CASCADE) …"
{
  echo "set client_min_messages = warning;"   # the cascade NOTICEs are expected noise
  echo "begin;"
  for t in $TABLES; do echo "truncate table public.\"$t\" restart identity cascade;"; done
  echo "commit;"
} | sql >/dev/null

# ── 3. load ───────────────────────────────────────────────────────────────
LOG="backups/refresh-${STAMP}.log"
echo "→ loading (log: $LOG) …"
sql < "$DUMP" > "$LOG" 2>&1 || true
ERRS="$(grep -c '^ERROR' "$LOG" || true)"
[ "$ERRS" -eq 0 ] || echo "  $ERRS error(s) during the first pass — will retry short tables"

# ── 4. sequences ──────────────────────────────────────────────────────────
reset_sequences() {
sql <<'SQL' >/dev/null
do $$
declare r record;
begin
  for r in
    select s.relname as seq, t.relname as tbl, a.attname as col
      from pg_class s
      join pg_depend d on d.objid = s.oid and d.deptype in ('a','i')
      join pg_class t on t.oid = d.refobjid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
      join pg_namespace n on n.oid = s.relnamespace
     where s.relkind = 'S' and n.nspname = 'public'
  loop
    execute format('select setval(%L, coalesce((select max(%I) from public.%I), 1))', 'public.' || r.seq, r.col, r.tbl);
  end loop;
end $$;
SQL
}
echo "→ resetting sequences …"
reset_sequences

# ── 5. verify counts; retry short tables once ─────────────────────────────
verify() {
  BAD=""
  for t in $TABLES; do
    e="$(dump_count "$t")"; a="$(count_local "$t")"
    [ "$e" = "$a" ] || { echo "  ✗ $t: dump $e, local $a"; BAD="$BAD $t"; }
  done
}
echo "→ verifying row counts …"
verify
if [ -n "$BAD" ]; then
  echo "→ retrying:$BAD"
  { echo 'SET session_replication_role = replica;'; for t in $BAD; do block_of "$t"; done; } | sql >> "$LOG" 2>&1 || true
  reset_sequences
  verify
fi

if [ -z "$BAD" ]; then
  echo "✓ local dev DB now mirrors production ($N tables, counts verified). Dump kept at $DUMP"
else
  echo "⚠ still short:$BAD — see $LOG (most likely a local migration is behind production: run 'npx supabase migration up', then re-run with --from=$DUMP)." >&2
  exit 1
fi

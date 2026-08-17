-- Data-quality fix: replace synthetic import-batch entered_at values with
-- the row's own earned date, for ledger_entries rows confirmed to be
-- historical migration/backfill artifacts, not real leader-recorded times
-- (Patrick's investigation + Opus risk-assessment, 2026-08-17).
--
-- Patrick's call, made with full knowledge of the tradeoffs raised in
-- review: entered_at for these rows is not, and never will be, truly
-- known (no created_at column, no better source integrated). `date` (the
-- earned date — independently verified correct, untouched by this
-- migration, and never null for the affected set) is a materially better
-- approximation than the arbitrary import-run timestamp it replaces, even
-- though it is not the genuine entered date either.
--
-- SCOPE — two distinct signatures, not one, because the import scripts
-- didn't all stamp entered_at the same way (verified empirically before
-- writing this, not assumed from the entered_by label alone):
--   - entered_by IN ('Import', 'pbieser-import'): unambiguous by the label
--     itself — these two scripts used real now()-precision timestamps
--     (sub-second, NOT round-hour), so no additional corroboration is
--     needed or appropriate. Requiring the round-hour signature here would
--     silently exclude all 1,865 of these genuinely-flagged rows — caught
--     by checking the actual per-marker distribution before relying on a
--     single blanket heuristic.
--   - entered_by = 'PB' OR entered_by IS NULL: less self-evidently an
--     import label on its own, so corroborated by the round-hour signature
--     (minute AND second both exactly zero) — confirmed 100% of these
--     5,299 rows carry it, a pattern essentially impossible for organic
--     Fast Entry usage (which shows natural millisecond variance).
-- Combined scope: 7,164 rows, confirmed by direct count against production
-- data mirrored into local dev before writing this migration.
--
-- REVERSIBLE: pre-change entered_at values are preserved in a snapshot
-- table before the UPDATE runs. To revert:
--   update ledger_entries le
--   set entered_at = bak.entered_at
--   from ledger_entries_entered_at_backup_20260817 bak
--   where le.id = bak.id;
--
-- NOT touched: entered_by (the "this was migrated" signal survives
-- regardless of what entered_at becomes), archived/deleted rows, and any
-- row not matching one of the two signatures above.
--
-- TIMESTAMP CONVENTION: noon America/Chicago, not midnight UTC — matches
-- the existing day-precision convention already used by
-- scripts/import-ledger-backfill.ts (writes 'T12:00:00' for exactly this
-- kind of data). Midnight UTC would render as the PREVIOUS calendar day in
-- any Central-time display (6-7pm CT), silently introducing off-by-one-day
-- bugs across every view that shows these dates.

create table if not exists ledger_entries_entered_at_backup_20260817 (
  id bigint primary key,
  entered_at timestamptz not null
);

insert into ledger_entries_entered_at_backup_20260817 (id, entered_at)
select id, entered_at
from ledger_entries
where (
    entered_by in ('Import', 'pbieser-import')
    or (
      (entered_by = 'PB' or entered_by is null)
      and extract(minute from entered_at) = 0
      and extract(second from entered_at) = 0
    )
  )
  and date is not null
  and archived_at is null
  and deleted_at is null;

-- Self-validating guard: abort (rolling back the CREATE/INSERT above too,
-- migrations run in an implicit transaction) if the affected count falls
-- outside the range confirmed by the investigation, rather than silently
-- touching a different set of rows than what was actually analyzed.
do $$
declare
  affected_count integer;
begin
  select count(*) into affected_count from ledger_entries_entered_at_backup_20260817;
  if affected_count < 6900 or affected_count > 7400 then
    raise exception
      'entered_at backfill: expected ~7164 affected rows (range 6900-7400), found %. Aborting — scope has drifted from the investigated set.',
      affected_count;
  end if;
end $$;

update ledger_entries
set entered_at = (date + time '12:00:00') at time zone 'America/Chicago'
where id in (select id from ledger_entries_entered_at_backup_20260817);

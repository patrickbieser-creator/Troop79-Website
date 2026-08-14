-- One ledger credit per (calendar entry, scout).
--
-- WHY (Operator, 2026-08-14, from qa-lead review — CRITICAL)
-- Roll Call's syncCredit() looked for an existing credit row with
-- `.maybeSingle()` and did not check the error. When TWO rows already share
-- (calendar_entry_id, scout_id), PostgREST returns PGRST116 with data=null —
-- so the code read "no existing row" and INSERTED a third, compounding the
-- duplication every time roll call was re-saved.
--
-- Nothing at the database level prevented that: event_attendance has
-- unique (calendar_entry_id, person_id), but ledger_entries had no equivalent,
-- so the credit side was protected only by application logic that could be
-- defeated by two leaders marking the same scout at the same moment, or by any
-- pre-existing duplicate the backfill happened to stamp.
--
-- The index is deliberately NOT partial, even though it only needs to bind rows
-- Roll Call owns. Postgres treats NULLs as distinct in a unique index, so the
-- ~9,700 historical and Fast-Entry rows — which all have a null
-- calendar_entry_id — remain completely unconstrained: two of them for one
-- scout never conflict. A `where calendar_entry_id is not null` predicate would
-- express the same rule, but ON CONFLICT can only use a partial index if the
-- statement repeats the predicate, and PostgREST's `onConflict` takes bare
-- column names. A partial index here would make the upsert fail with
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- Deliberately NOT filtered on deleted_at either: a soft-deleted row must still
-- block an insert, because syncCredit REVIVES it rather than inserting
-- alongside it. That is what makes uncheck-then-recheck idempotent.

do $$
declare
  dupes int;
begin
  select count(*) into dupes from (
    select calendar_entry_id, scout_id
    from public.ledger_entries
    where calendar_entry_id is not null
    group by calendar_entry_id, scout_id
    having count(*) > 1
  ) d;

  if dupes > 0 then
    raise exception
      'Cannot add the one-credit-per-entry constraint: % (calendar_entry_id, scout_id) pair(s) already have more than one ledger row. Resolve them in Audits → Duplicate Ledger Records first.',
      dupes;
  end if;
end;
$$;

create unique index ledger_entries_one_credit_per_entry
  on public.ledger_entries (calendar_entry_id, scout_id);

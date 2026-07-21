-- Guarded NOT NULL + swap the identity CHECK to person_id-based.
--
-- Guarded rather than assumed (Fable sequencing review, 2026-07-20): the
-- backfill migration already verified this once, but constraints should
-- fail loudly on their own precondition rather than trust an earlier
-- migration's notice was read. Applying this to production requires the
-- same verification query run there first — this guard is what makes doing
-- so safe either way.
--
-- The old signup_entries_identity CHECK (exactly one of four legacy columns,
-- matching person_kind) is replaced by person_id being the enforced
-- identity — legacy columns stay in the table, still written by the RPC,
-- still read by not-yet-migrated admin screens, but are no longer what the
-- database enforces. Dropping them outright is a LATER step, after a soak
-- week in production (Fable review) — this migration only stops requiring
-- them.

do $$
declare v_nulls int;
begin
  select count(*) into v_nulls from public.signup_entries where person_id is null;
  if v_nulls > 0 then
    raise exception 'signup_entries: % row(s) still have NULL person_id — resolve by hand before this migration can run', v_nulls;
  end if;
end $$;

alter table public.signup_entries alter column person_id set not null;

alter table public.signup_entries drop constraint if exists signup_entries_identity;
alter table public.signup_entries add constraint signup_entries_identity check (person_id is not null);

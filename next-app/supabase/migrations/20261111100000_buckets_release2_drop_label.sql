-- Buckets Release 2, migration B (the tightening — Plans/Buckets-Lookup.md, Patrick 2026-10-18).
--
-- CODE-FIRST: push this only after the code that no longer reads or writes activity_label is live. Every writer
-- sets bucket_id (migration A added bucket_id_for_name / event_bucket and moved the wreath card RPCs onto them);
-- every reader takes the name through the buckets join.
--
-- Gate before pushing (must return 0): labelled rows with no bucket —
--   select count(*) from financial_transactions where nullif(btrim(activity_label), '') is not null and bucket_id is null;
--
-- What goes:
--   * financial_transactions.activity_label, and the sync trigger that kept it equal to the bucket's name;
--   * buckets_relabel_rows (a rename no longer has rows to relabel — readers join the name);
--   * finance_activity_labels() (the old Record-form autocomplete; the Bucket picker replaced it).
-- What stays, slimmed: a row linked to an event with no bucket of its own takes the event's bucket — on insert, and
-- when its event changes. A deliberate clear (bucket_id set to null on a row whose event didn't change) stays cleared.

drop trigger if exists financial_transactions_sync_bucket on public.financial_transactions;
drop function if exists public.financial_transactions_sync_bucket();

drop trigger if exists buckets_relabel_rows on public.buckets;
drop function if exists public.buckets_relabel_rows();

drop function if exists public.finance_activity_labels();

create or replace function public.financial_transactions_event_bucket()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.bucket_id is null and new.calendar_entry_id is not null
     and (tg_op = 'INSERT' or new.calendar_entry_id is distinct from old.calendar_entry_id) then
    select c.bucket_id into new.bucket_id from calendar_entries c where c.id = new.calendar_entry_id;
  end if;
  return new;
end $$;

create trigger financial_transactions_event_bucket
  before insert or update of calendar_entry_id on public.financial_transactions
  for each row execute function public.financial_transactions_event_bucket();

alter table public.financial_transactions drop column if exists activity_label;

-- Admin › Health Forms record sheet (Plans/Admin-Health-Record-Sheet-Redesign.md; Patrick 2026-11-16).
--
-- 1. The access log takes 'review' and 'unreview' (Mark reviewed and Undo review; the family sees the full history
--    of reviews, decision 14), 'edit' (a Good until date or "in the BSA form" changed) and 'remind' (a reminder
--    emailed). Every write in the record sheet answers with the record, so every one of them leaves a line naming
--    who did it (qa-lead, 2026-11-16).
-- 2. health_reminders_sent: the last reminder emailed about a person, any time or for a trip (decision 13), so the
--    sheet can say "Reminder emailed to <parent> on <date>" after a reload.
-- 3. health_immunization_in_bsa_form: a named leader's "the immunizations are on the BSA form" for one person
--    (decision 16). The app deletes the row whenever a Parts A and B page is added, replaced or removed.
--
-- Additive: DB-first deploy. Posture (D-051 / D-239): RLS on with no policies, nothing granted to anon or
-- authenticated. Only the service role reads or writes.

alter table public.health_access_log drop constraint if exists health_access_log_action_check;
alter table public.health_access_log add constraint health_access_log_action_check
  check (action in ('upload', 'replace', 'delete', 'view', 'download', 'print', 'review', 'unreview', 'edit', 'remind'));

create table if not exists public.health_reminders_sent (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people(id) on delete cascade,
  sent_at timestamptz not null default now(),
  sent_by_person_id bigint references public.people(id) on delete set null,
  sent_by_name text not null check (length(sent_by_name) between 1 and 120),
  -- The addresses it went to (lower-cased), so the sheet can name who was emailed.
  sent_to text[] not null check (cardinality(sent_to) between 1 and 20),
  -- The trip it was sent for; null for a reminder sent any time.
  event_id bigint references public.calendar_entries(id) on delete set null,
  constraint sent_at_from_1900 check (sent_at >= '1900-01-01')
);
create index if not exists health_reminders_sent_person_idx on public.health_reminders_sent (person_id, sent_at desc);
alter table public.health_reminders_sent enable row level security;
revoke all on public.health_reminders_sent from anon, authenticated;
revoke all on sequence public.health_reminders_sent_id_seq from anon, authenticated;

create table if not exists public.health_immunization_in_bsa_form (
  person_id bigint primary key references public.people(id) on delete cascade,
  set_by_person_id bigint references public.people(id) on delete set null,
  set_by_name text not null check (length(set_by_name) between 1 and 120),
  set_at timestamptz not null default now(),
  constraint set_at_from_1900 check (set_at >= '1900-01-01')
);
alter table public.health_immunization_in_bsa_form enable row level security;
revoke all on public.health_immunization_in_bsa_form from anon, authenticated;

-- A merge: reminders follow the person; "in the BSA form" is dropped on both sides, like a review (the documents
-- just changed hands). Everything else is as 20270104100000.
create or replace function public.health_documents_follow_merge()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  update health_documents d set person_id = new.merged_into_person_id
   where d.person_id = old.id
     and not exists (select 1 from health_documents k
                      where k.person_id = new.merged_into_person_id and k.kind = d.kind and k.page = d.page);
  update health_access_log set person_id = new.merged_into_person_id where person_id = old.id;
  insert into health_viewers (person_id, granted_by_person_id, granted_at)
  select new.merged_into_person_id, granted_by_person_id, granted_at from health_viewers where person_id = old.id
  on conflict (person_id) do nothing;
  delete from health_viewers where person_id = old.id;
  delete from health_reviews where person_id in (old.id, new.merged_into_person_id);
  update health_reminders_sent set person_id = new.merged_into_person_id where person_id = old.id;
  delete from health_immunization_in_bsa_form where person_id in (old.id, new.merged_into_person_id);
  return new;
end;
$$;
revoke all on function public.health_documents_follow_merge() from public, anon, authenticated;

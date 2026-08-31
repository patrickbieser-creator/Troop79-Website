-- Content audit trail (Patrick, 2026-08-30): every CRUD change to website
-- CONTENT — news, calendar, roster, resource library — lands one row here
-- with a date and person tag. Advancement and finance are deliberately
-- excluded: both already have ledgers of record.
--
-- App-level writes (lib/audit.ts), not table triggers: the acting PERSON is
-- only known in the app layer (every DB write goes through the service
-- role, so a trigger would see one anonymous superuser). RLS enabled with
-- no policies = service-role only, matching the 2026-08-25 security
-- posture; a future anon/leader read needs an explicit policy.

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- ON DELETE SET NULL keeps the trail when a person row is hard-deleted
  -- (deletePerson); the label column still says who it was.
  actor_person_id integer references public.people (id) on delete set null,
  actor_label text not null,
  area text not null check (area in ('news', 'calendar', 'roster', 'library')),
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  details jsonb
);

alter table public.audit_log enable row level security;

create index audit_log_occurred_at_idx on public.audit_log (occurred_at desc);
create index audit_log_area_idx on public.audit_log (area, occurred_at desc);

-- What each leader opens from the rail, a menu, search or Everything A–Z (Plans/Admin-Portal-Nav.md decision 12,
-- phase 4). Home's "Your shortcuts" shows the person's pins, then the screens they opened most in the past 30 days.
-- One row per open. Opens through an in-page link, a bookmark or a typed URL are not logged (by design: logging stays
-- in one place). The logging action deletes the person's rows older than 90 days in the same call, so the table stays
-- small without a scheduled job.
--
-- Additive: DB-first deploy. Posture (D-051 / D-239): RLS on with no policies, nothing granted to anon or
-- authenticated. Only the service role reads or writes; the server action scopes every write to the signed-in
-- actor's person_id and never takes a person_id from the client.

create table if not exists public.admin_nav_events (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people(id) on delete cascade,
  feature_key text not null check (feature_key ~ '^[a-z][a-z0-9-]*(\.[a-z0-9-]+)?$' and length(feature_key) <= 80),
  at timestamptz not null default now(),
  constraint at_from_1900 check (at >= '1900-01-01')
);
create index if not exists admin_nav_events_person_at_idx on public.admin_nav_events (person_id, at desc);

alter table public.admin_nav_events enable row level security;
revoke all on public.admin_nav_events from anon, authenticated;
revoke all on sequence public.admin_nav_events_id_seq from anon, authenticated;

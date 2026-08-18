-- Recent Logins dashboard (Plans/Recent-Logins-Dashboard.md, Patrick 2026-08-17).
--
-- Neither existing login mechanism gives a clean unified history:
-- login_tokens has real per-event history for the link/code path
-- (created_at + consumed_at), but passkey_credentials.last_used_at is a
-- single mutable field overwritten on every login — no history at all.
-- Admin and family logins are the SAME flow since the Phase E identity
-- unification (20260816), so this is one event stream, not two merged
-- sources; "leader vs family" is captured here as a role SNAPSHOT at login
-- time, not re-derived later (a person's capabilities can change after the
-- fact — the dashboard should show what they were at the time they signed
-- in, not retroactively rewrite history).
--
-- Zero-policy RLS, same convention as advancement_reports and every other
-- admin-only table in this schema — reads go through createAdminClient()
-- only, never the client-side anon key (PII lockdown).

create table if not exists login_events (
  id bigint generated always as identity primary key,
  person_id bigint references public.people(id),
  method text not null check (method in ('link', 'code', 'passkey')),
  success boolean not null,
  failure_reason text,
  -- 'leader' if the person held any admin capability at login time, else
  -- 'family' — computed once at insert, never re-derived.
  role_snapshot text,
  user_agent text,
  -- Short parsed label ("iPhone - Safari") for display; user_agent above is
  -- kept verbatim alongside it for anything the parser gets wrong.
  device_label text,
  ip text,
  is_first_login boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists login_events_created_at_idx on login_events (created_at desc);
create index if not exists login_events_person_id_idx on login_events (person_id);
create index if not exists login_events_success_created_at_idx on login_events (success, created_at desc);

alter table login_events enable row level security;

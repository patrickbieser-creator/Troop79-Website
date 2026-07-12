-- Meetings: the published agenda for each troop meeting, and its archive.
--
-- Design notes (Plans/Meetings-Page.md):
--   * Three concepts, three homes: the PLAN (meeting_plans — regenerable
--     engine candidates), the AGENDA (these tables — the leader's published
--     decision), and the RECORD (a published meeting whose date has passed).
--     The plan feeds the agenda via a promote step in the editor; nothing
--     here writes back to plan data.
--   * Sessions are first-class rows, not a payload blob, so the future
--     signup feature (Phase 4 auth) can FK to a session. `scouts` and
--     `requirements` stay jsonb display data until then — deliberate debt.
--   * Single sessions table with a `section` discriminator (pre_meeting vs
--     agenda) — house pattern, same shape as ledger_entries/articles.
--   * RLS is enabled with NO anon policies — deliberate deviation from
--     meeting_plans_read_published: sessions carry contact_phone, which must
--     not be anon-readable (Patrick, 2026-07-12: contact name public, phone
--     post-login only). All reads go through server loaders on the
--     service-role client (v0.22 posture); public loaders filter to
--     status = 'published' and strip contact_phone themselves.

create table public.meetings (
  id bigint generated always as identity primary key,
  meeting_date date not null unique,
  status text not null default 'draft' check (status in ('draft', 'published')),
  title text not null default 'Troop Meeting',
  time_range text,
  uniform text,
  location text,
  location_address text,
  snack text,
  flag_ceremony text,
  cleanup text,
  duty_roster_url text,
  updated_by text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meeting_sessions (
  id bigint generated always as identity primary key,
  meeting_id bigint not null references public.meetings(id) on delete cascade,
  section text not null default 'agenda' check (section in ('pre_meeting', 'agenda')),
  sort_order int not null default 0,
  time_label text,
  title text not null,
  description text,
  track text,
  leader_name text,
  contact_name text,
  contact_phone text,
  -- Provenance links back to plan concepts (set when promoted from a plan
  -- suggestion; null for freeform items). Informational, not load-bearing.
  skill_id text references public.skills(id),
  mb_id text references public.merit_badges(id),
  -- [{ "code": "3a", "label": "..." }] — snapshot of promoted requirements.
  requirements jsonb,
  -- Display names as shown publicly, e.g. ["Anjali S.", "Finn P."].
  scouts jsonb
);

create index meeting_sessions_meeting_id_idx
  on public.meeting_sessions (meeting_id, section, sort_order);

alter table public.meetings enable row level security;
alter table public.meeting_sessions enable row level security;
-- No policies on purpose — see header note.

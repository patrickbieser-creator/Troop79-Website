-- Troop 79 — initial schema
-- Mirrors the shape of the static prototype's data/advancement.json so the same
-- code patterns port over cleanly. Soft-delete + archive columns live on
-- ledger_entries directly (no per-kind tables) per the decision in
-- [[troop-79-data-model-decisions]].

set search_path = public;

-- ─── REFERENCE / LOOKUP TABLES ──────────────────────────────────────────────

create table public.leaders (
  code text primary key,
  name text not null,
  role text
);

create table public.activity_types (
  id text primary key,
  label text not null
);

create table public.ranks (
  id text primary key,
  display_name text not null,
  color text,
  sort_order int not null default 0
);

create table public.merit_badges (
  id text primary key,
  name text not null,
  eagle boolean not null default false,
  scoutbook_id text,
  bsa_page_url text,
  workbook_url text
);

-- ─── REQUIREMENT TREES ──────────────────────────────────────────────────────
-- Self-referential trees: parent_id is null at the top of each rank or MB.
-- complete_rule + complete_n encode optionality (e.g. "complete any 2 of these").

create table public.rank_requirements (
  id bigserial primary key,
  rank_id text not null references public.ranks(id) on delete cascade,
  parent_id bigint references public.rank_requirements(id) on delete cascade,
  code text not null,
  label text not null,
  complete_rule text not null default 'all' check (complete_rule in ('all','any','n-of')),
  complete_n int,
  sort_order int not null default 0,
  unique (rank_id, code)
);
create index on public.rank_requirements (rank_id);
create index on public.rank_requirements (parent_id);

create table public.merit_badge_requirements (
  id bigserial primary key,
  mb_id text not null references public.merit_badges(id) on delete cascade,
  parent_id bigint references public.merit_badge_requirements(id) on delete cascade,
  code text not null,
  label text not null,
  complete_rule text not null default 'all' check (complete_rule in ('all','any','n-of')),
  complete_n int,
  sort_order int not null default 0,
  unique (mb_id, code)
);
create index on public.merit_badge_requirements (mb_id);
create index on public.merit_badge_requirements (parent_id);

-- ─── SCOUTS ─────────────────────────────────────────────────────────────────
-- auth_user_id is the Supabase Auth account shared by the scout and their
-- parents (one-to-one). Leaders use a separate "leader" role on their own
-- auth.users rows — they aren't linked to a scout. See [[troop-79-data-model-decisions]].

create table public.scouts (
  id text primary key,
  first_name text not null,
  last_name text not null,
  display_name text not null,
  patrol text,
  current_rank text references public.ranks(id),
  bsa_member_id text,
  active boolean not null default true,
  joined_date date,
  last_activity text,
  auth_user_id uuid unique references auth.users(id) on delete set null
);
create index on public.scouts (current_rank);
create index on public.scouts (active);
create index on public.scouts (auth_user_id);

-- ─── LEDGER ─────────────────────────────────────────────────────────────────
-- The single source of truth for every advancement event, attendance, service
-- hour, leadership term, and merit-badge milestone. Kind discriminates.
-- Archive (lifecycle, e.g. aged-out) and Delete (erroneous, reason required)
-- are both soft and recoverable.

create type public.ledger_kind as enum (
  'rank_requirement',
  'merit_badge_requirement',
  'merit_badge_award',
  'attendance',
  'service_hours',
  'camping_nights',
  'hiking_miles',
  'leadership'
);

create table public.ledger_entries (
  id bigserial primary key,
  scout_id text not null references public.scouts(id) on delete restrict,
  date date not null,
  kind public.ledger_kind not null,
  code text not null,
  label text,
  by text,                              -- not FK: includes 'Camp', 'Clinic', etc. beyond the leaders table
  qty numeric not null default 1,
  unit text not null default 'complete',
  notes text,
  entered_by text,
  entered_at timestamptz not null default now(),

  archived_at timestamptz,
  archived_by text,
  archived_reason text,
  deleted_at timestamptz,
  deleted_by text,
  deleted_reason text,

  -- A delete must have a reason (matches the prototype's prompt).
  constraint deleted_needs_reason check (deleted_at is null or deleted_reason is not null)
);
create index on public.ledger_entries (scout_id);
create index on public.ledger_entries (code);
create index on public.ledger_entries (kind);
create index on public.ledger_entries (date desc);
create index on public.ledger_entries (entered_at desc);
-- Active rows (the default filtered view) — supports the "render only what's
-- visible" pattern from the prototype.
create index ledger_entries_active_idx on public.ledger_entries (scout_id, date desc)
  where archived_at is null and deleted_at is null;

-- ─── COURT OF HONOR ────────────────────────────────────────────────────────

create table public.coh_history (
  id text primary key,
  title text not null,
  date date not null,
  recognitions int,
  rank_awards int,
  merit_badges int,
  notes text
);

-- ─── ROW LEVEL SECURITY ────────────────────────────────────────────────────
-- Skeleton policies — placeholders that allow any authenticated user to read.
-- Phase 4 will tighten these to:
--   • scouts can read/write only their own clipboard (auth.uid() = scouts.auth_user_id)
--   • leaders (custom role / claim) can read/write everything
--   • public pages either bypass RLS via service role or read from anon-allowed views
-- For now we open reads to anon so the prototype's public pages keep working.

alter table public.leaders                  enable row level security;
alter table public.activity_types           enable row level security;
alter table public.ranks                    enable row level security;
alter table public.merit_badges             enable row level security;
alter table public.rank_requirements        enable row level security;
alter table public.merit_badge_requirements enable row level security;
alter table public.scouts                   enable row level security;
alter table public.ledger_entries           enable row level security;
alter table public.coh_history              enable row level security;

-- Reference tables: read by everyone (anon + authenticated). Writes locked
-- down until we add explicit leader-role policies.
create policy ref_read_all on public.leaders                  for select using (true);
create policy ref_read_all on public.activity_types           for select using (true);
create policy ref_read_all on public.ranks                    for select using (true);
create policy ref_read_all on public.merit_badges             for select using (true);
create policy ref_read_all on public.rank_requirements        for select using (true);
create policy ref_read_all on public.merit_badge_requirements for select using (true);
create policy ref_read_all on public.scouts                   for select using (true);
create policy ref_read_all on public.coh_history              for select using (true);

-- Ledger reads: public for prototype demo. Replace with scout-owns-own + leader-sees-all in Phase 4.
create policy ledger_read_all  on public.ledger_entries for select using (true);
-- Ledger writes: any authenticated user for now. Tighten to leaders-only in Phase 4.
create policy ledger_write_any on public.ledger_entries for all
  to authenticated using (true) with check (true);

-- ─── HELPFUL VIEWS ──────────────────────────────────────────────────────────

-- The "active" ledger — what the dashboard, recent activity, and most other
-- screens want by default.
create view public.ledger_active as
  select * from public.ledger_entries
  where archived_at is null and deleted_at is null;

-- Per-scout, per-merit-badge progress summary. Used by the MB Progress catalog
-- to compute completed/in-progress counts without loading the full ledger.
create view public.mb_progress as
  with awards as (
    select scout_id, substring(code from 4) as mb_id
    from public.ledger_active
    where kind = 'merit_badge_award' and code like 'MB:%'
  ),
  reqs as (
    select scout_id, split_part(code, '-', 1) as mb_id
    from public.ledger_active
    where kind = 'merit_badge_requirement'
  ),
  combined as (
    select scout_id, mb_id, true as has_award, false as has_req from awards
    union all
    select scout_id, mb_id, false, true from reqs
  )
  select
    mb_id,
    scout_id,
    bool_or(has_award) as awarded,
    bool_or(has_req)   as has_any_req
  from combined
  group by mb_id, scout_id;

comment on view public.mb_progress is
  'One row per (scout, merit_badge) where the scout has any activity. Used by '
  'the MB Progress catalog to count completed vs in-progress.';

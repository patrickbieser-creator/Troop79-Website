-- Resource Library — Phase 1 schema (Plans/Resource-Library.md).
--
-- WHY (Patrick, 2026-07-21)
-- A troop-curated library of videos/links/docs/posts, organized two ways at
-- once: by advancement requirement (reading rank_requirements /
-- merit_badge_requirements live — no parallel taxonomy to drift) and by
-- webmaster-managed topic shelves (Sparkler, Eagle trail, gear...). Everyone
-- can submit; EVERYTHING queues for webmaster approval before publishing.
--
-- ADDRESSING (tech-lead review 2026-07-21, HIGH finding): placements, notes
-- and submissions key off (target_kind, target_key) using the SAME composite
-- codes ledger_entries already uses —
--   rank_req → '{rankId}-{code}'   (NEVER bare code: "9a" repeats across ranks)
--   mb       → '{mbId}'            (whole-badge page)
--   mb_req   → '{mbId}-{code}'
--   topic    → '{slug}'
-- target_kind is a NEW discriminator, distinct from ledger_entries.kind.
-- The D-019 top-level code-rename cascade in lookups/actions.ts updateReqCode
-- is extended to these tables in the same change that ships this migration.
--
-- requirement_submissions is created now (Phase 2 uses it) so the rename
-- cascade covers all three keyed tables from day one.

-- ── Topic shelves — the only taxonomy the webmaster maintains ─────────────
create table public.library_topics (
  id bigint generated always as identity primary key,
  slug text not null unique,
  title text not null,
  blurb_md text,
  icon text,
  sort_order integer not null default 0,
  -- Retire, don't delete — placements keep their history.
  retired_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Resources — one row per video/link/document/image/post ────────────────
create table public.library_resources (
  id bigint generated always as identity primary key,
  title text not null,
  blurb text,
  kind text not null check (kind in ('link', 'video', 'document', 'image', 'post')),
  -- link-ish kinds carry url; 'post' carries body_md. Not DB-enforced so a
  -- messy family submission ("my orienteering powerpoint", no title, no
  -- placement) can still land in the queue — the webmaster fixes it up
  -- before publish, which is where the app enforces completeness.
  url text,
  body_md text,
  thumbnail_url text,
  host text,
  visibility text not null default 'public' check (visibility in ('public', 'leaders')),
  status text not null default 'pending' check (status in ('pending', 'published', 'archived')),
  -- Who sent it in (display label + optional person link), and the
  -- webmaster-editable credit shown publicly (defaults from submitted_by_label
  -- at publish; scouts credited first-name last-initial per publicScoutName).
  submitted_by_label text,
  submitted_person_id bigint references public.people(id),
  submitter_note text,
  attribution_label text,
  reviewed_by text,
  reviewed_at timestamptz,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- coalesce() each operand — `title || blurb || body_md` would NULL the
  -- whole vector for every non-post resource (tech-lead HIGH finding; same
  -- "worked on seed data, broke on real content" class as D-039/D-053).
  fts tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(blurb, '') || ' ' || coalesce(body_md, ''))
  ) stored
);

create index library_resources_fts_idx on public.library_resources using gin (fts);
create index library_resources_status_idx on public.library_resources (status);

-- ── Placements — one resource can sit on many pages ───────────────────────
create table public.library_placements (
  id bigint generated always as identity primary key,
  resource_id bigint not null references public.library_resources(id) on delete cascade,
  target_kind text not null check (target_kind in ('rank_req', 'mb', 'mb_req', 'topic')),
  target_key text not null,
  pinned boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (resource_id, target_kind, target_key)
);

-- The common read is "everything placed on THIS page" — the unique
-- constraint leads with resource_id, so give the page lookup its own index.
create index library_placements_target_idx
  on public.library_placements (target_kind, target_key);

-- ── Requirement narratives — the leader-written intro paragraph ───────────
create table public.requirement_notes (
  id bigint generated always as identity primary key,
  target_kind text not null check (target_kind in ('rank_req', 'mb', 'mb_req')),
  target_key text not null,
  narrative_md text not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (target_kind, target_key)
);

-- ── Proof-of-completion submissions (Phase 2 flow; schema cut now) ────────
-- Approve writes the ledger row through the same dup-blocked path Fast Entry
-- uses and back-links it here. Media entries are private-bucket storage paths
-- (photos of minors — NEVER the public CDN); retention: delete 3 months after
-- review via a routine job (Patrick, 2026-07-21).
create table public.requirement_submissions (
  id bigint generated always as identity primary key,
  scout_id text not null references public.scouts(id),
  target_kind text not null check (target_kind in ('rank_req', 'mb_req')),
  target_key text not null,
  proof_type text not null check (proof_type in ('photo', 'report', 'link')),
  body_md text,
  link_url text,
  media jsonb not null default '[]'::jsonb,
  submitted_via text not null check (submitted_via in ('family', 'scout')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'returned')),
  feedback_md text,
  reviewed_by text,
  reviewed_at timestamptz,
  ledger_entry_id bigint references public.ledger_entries(id),
  created_at timestamptz not null default now()
);

create index requirement_submissions_status_idx on public.requirement_submissions (status);
create index requirement_submissions_target_idx
  on public.requirement_submissions (scout_id, target_kind, target_key);

-- ── RLS: enabled, zero policies — service-role only (D-051 pattern). ──────
-- Every access path goes through createAdminClient(); the anon key gets
-- nothing. Verified both directions by tests/resource-library.test.ts.
alter table public.library_topics enable row level security;
alter table public.library_resources enable row level security;
alter table public.library_placements enable row level security;
alter table public.requirement_notes enable row level security;
alter table public.requirement_submissions enable row level security;

-- ── Seed the launch shelves (webmaster can rename/reorder/retire) ─────────
insert into public.library_topics (slug, title, blurb_md, icon, sort_order) values
  ('sparkler', 'The Sparkler', 'Every week''s joke from the Bugle, archived for posterity. Groans guaranteed.', '✨', 10),
  ('eagle-project-trail', 'The Eagle Project Trail', 'How to pick, propose, fund, and finish an Eagle project — the troop''s collected wisdom.', '🦅', 20),
  ('gear-and-packing', 'Gear & Packing', 'Which cot survives summer camp, what sleeping-bag rating actually matters, packing lists that work.', '🎒', 30),
  ('the-bugle', 'The Bugle', 'Subscribe to the weekly newsletter, browse back issues, and see how to submit an item.', '📯', 40),
  ('fun-and-films', 'Fun & Films', 'Funny scout videos, campout bloopers, and the skits nobody will let die.', '🎬', 50);

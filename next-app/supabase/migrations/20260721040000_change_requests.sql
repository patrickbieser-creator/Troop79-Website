-- Family self-service demographic updates — pending review queue.
--
-- WHY (Patrick, 2026-07-21)
-- Plans/Scout-Self-Service-Demographics.md: a family can propose an update to
-- their own scout's demographic fields (including "things_we_should_know",
-- D-054) from a new public /profile page. Nothing they submit touches the
-- live scouts row directly — it lands here as 'pending' and only applies once
-- a leader approves it from the Scout editor.
--
-- Generic entity_type/entity_id rather than a scout-specific staging table —
-- mirrors the import_batches/import_rows staged-and-human-accepted shape
-- (20260720110000) that already validated this pattern, and future-proofs
-- beyond scouts without a schema change.
--
-- One pending request per (entity_type, entity_id) — a second submission
-- overwrites the first rather than queuing a second row for review. Enforced
-- with a partial unique index so the app-level upsert has a DB backstop.
create table public.change_requests (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  submitted_by_person_id bigint references public.people(id),
  submitted_at timestamptz not null default now(),
  proposed_changes jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  rejection_reason text
);

create unique index change_requests_one_pending_per_entity
  on public.change_requests (entity_type, entity_id)
  where status = 'pending';

create index change_requests_entity_idx on public.change_requests (entity_type, entity_id);

-- RLS enabled with zero policies — service-role only, same D-051 pattern.
-- Every access path (submit from /profile, review from the Scout editor)
-- goes through createAdminClient(); there is no anon read/write path to lock
-- down separately.
alter table public.change_requests enable row level security;

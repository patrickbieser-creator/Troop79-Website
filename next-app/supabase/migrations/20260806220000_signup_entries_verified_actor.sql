-- Event Signup: verified-identity actor columns (Plans/Family-Identity-Auth.md
-- Phase 2). Additive only — the existing `entered_by` / `updated_by` TEXT
-- columns keep working exactly as they do today for Tier 1 (unverified
-- family-password) submissions. These new nullable FKs are populated only
-- when the submitter carries a verified Tier 2 identity session
-- (events/[id]/actions.ts), turning "who really did this" from a text label
-- someone typed into a real FK — the same upgrade `entered_by` already gave
-- the ledger on the leader side (D-041).
--
-- entered_by_person_id is set once (first write only); updated_by_person_id
-- is refreshed on every verified write. Deliberately NOT backfilled for
-- existing rows — a pre-Phase-2 Tier 1 submission has no verified identity to
-- attribute, and guessing one from entered_by's text label would reintroduce
-- exactly the name-matching inference class D-042 replaced.

alter table public.signup_entries
  add column if not exists entered_by_person_id bigint references public.people(id),
  add column if not exists updated_by_person_id bigint references public.people(id);

create index if not exists signup_entries_entered_by_person_idx
  on public.signup_entries (entered_by_person_id);

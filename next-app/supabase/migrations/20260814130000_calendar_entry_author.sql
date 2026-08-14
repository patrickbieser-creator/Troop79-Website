-- Author attribution for calendar entries.
--
-- WHY (Operator, 2026-08-14)
-- News has shown an author on every post since it shipped, and gates editing on
-- it (`canEdit = isLeader || author === session`). The calendar — the other
-- primary content screen — recorded nobody. Two screens that do the same job
-- should answer "who put this here?" the same way.
--
-- Paired with a policy decision (Patrick, 2026-08-14): calendar entries are
-- LEADER-ONLY to edit. News keeps its scout-drafts-leader-publishes flow, which
-- is what the author column is load-bearing for there; here the column is pure
-- attribution, because the answer to "who may edit this?" is now simply
-- "a leader". That also retires the panel-level scout split in the workbench —
-- a scout no longer reaches the calendar admin at all, so there is nothing left
-- to split.
--
-- Nullable and unbackfilled on purpose: the ~105 existing entries predate any
-- record of who created them, and inventing an author would be worse than an
-- honest blank. They render as "—".

alter table public.calendar_entries
  add column author_name text;

comment on column public.calendar_entries.author_name is
  'Display name of the leader who created this entry (session.leader at insert). Attribution only — editing is leader-only regardless, unlike articles.author_name which also gates who may edit. Null for entries created before this column existed.';

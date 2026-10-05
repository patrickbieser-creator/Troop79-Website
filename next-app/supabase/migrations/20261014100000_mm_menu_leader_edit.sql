-- Menu Monster — a leader may edit a scout's menu, and the scout is told.
--
-- Patrick, 2026-10-05: "Adult leaders need full rights to edit (and fix) scout menus before they go
-- shopping." Until now a leader read every menu but could only leave a note (Scout Workspace Phase 3,
-- Decision 2). The save action now lets a leader write a menu they do not own. The menu stays the scout's:
-- the owner never changes, and these two columns record that a leader's save is the latest one so the
-- owner's Plan tab can say so. The owner's own next save clears them.
--
-- Additive; the code that reads them deploys after this (DB-first).
alter table public.mm_menus
  add column if not exists leader_edited_at timestamptz,
  add column if not exists leader_edited_by_person_id bigint references public.people(id) on delete set null;

comment on column public.mm_menus.leader_edited_at is
  'Set when the latest save of the plan was made by a leader, not the owner; cleared by the owner''s next save.';

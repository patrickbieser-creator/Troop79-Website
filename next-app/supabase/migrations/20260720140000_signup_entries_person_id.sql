-- signup_entries gains a single participant identity.
--
-- WHY (Patrick, 2026-07-20)
-- A participant is currently recorded as ONE OF four nullable columns —
-- scout_id, scout_parent_id, leader_code, adult_name — each guarded by its own
-- unique index. Those four indexes cannot see each other, so the database has
-- no way to state "this human signed up once": the same person reachable as
-- both a leaders row and a scout_parents row could take two places at one
-- event, and did, until application code started deduplicating them by name.
-- That code was the source of two production bugs in a week.
--
-- With the people spine in place the fix is a single FK and a single unique
-- index. This runs while signup_entries is EMPTY (0 rows), which is the only
-- moment it is free; every week of signups makes it more expensive.
--
-- ADDITIVE ONLY. The legacy columns stay, still populated, still indexed —
-- the submit RPC and every reader continue to work untouched. person_id is
-- filled alongside them until those readers migrate, which is a separate,
-- test-covered change (the submit RPC is D-033's single-transaction capacity
-- guard and has been through three reviews).
--
-- It also unblocks something the legacy columns cannot express at all: 42
-- people created by the roster import hold no scout_parents or leaders row, so
-- there is literally no column in which to record them as a participant. They
-- are invisible in the signup picker today for exactly that reason.

alter table public.signup_entries
  add column if not exists person_id bigint references public.people(id) on delete restrict;

create index if not exists signup_entries_person_idx
  on public.signup_entries (person_id);

-- The constraint the four legacy indexes could never express between them.
-- Same semantics as its siblings: scoped to one event, ignoring cancellations.
create unique index if not exists signup_entries_person_uniq
  on public.signup_entries (event_signup_id, person_id)
  where person_id is not null and status <> 'cancelled';

comment on column public.signup_entries.person_id is
  'Single participant identity. Written alongside the legacy scout_id / scout_parent_id / leader_code / adult_name columns until every reader migrates, after which those become dead weight and can be dropped.';

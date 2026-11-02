-- Roster Created / Left columns (Patrick, 2026-11-01): when a scout first and last appears in the ledger.
--
-- people.created_at is the day the record was built, and for everyone imported it is the people-spine
-- build day (2026-07-20) — not when they joined. The ledger goes back to 2020, so a scout's first entry
-- is the honest "on record since", and their last entry (meeting attendance included) is when they
-- stopped coming. The roster takes the earlier of this and people.created_at.
--
-- Dates before 2000 are typos, not history (2026-11-01: eight entries dated year 0025), so they are left
-- out rather than reading "Nov 8, 25".
--
-- Additive, DB-first: nothing reads it until the roster ships.

create view public.scout_tenure with (security_invoker = true) as
select
  l.scout_id,
  min(l.date) as first_activity_date,
  max(l.date) as last_activity_date
from public.ledger_entries l
where l.deleted_at is null
  and l.archived_at is null
  and l.date >= date '2000-01-01'
group by l.scout_id;

comment on view public.scout_tenure is
  'Per scout: first and last live ledger date (any kind, attendance included; pre-2000 typos ignored). Roster Created / Left columns.';

-- Service role only (2026-08-25 security posture).
revoke all on public.scout_tenure from anon, authenticated;
grant select on public.scout_tenure to service_role;

-- Backfill person_id for any signup_entries rows written before the previous
-- migration taught the RPC to populate it.
--
-- WHY A VERIFIED BACKFILL, NOT AN ASSUMPTION (Fable sequencing review,
-- 2026-07-20) — the original additive migration (20260720140000) assumed
-- signup_entries was empty. Checked against local dev today: it is NOT —
-- 8 rows exist (4 scout, 4 adult, all resolvable via scout_id/scout_parent_id,
-- none via leader_code or adult_name). Production status is unverified from
-- this machine and MUST be checked before this migration is applied there —
-- do not assume the same "it's empty" claim holds twice.

update public.signup_entries se
set person_id = s.person_id
from public.scouts s
where se.person_id is null and se.scout_id is not null and se.scout_id = s.id;

update public.signup_entries se
set person_id = sp.person_id
from public.scout_parents sp
where se.person_id is null and se.scout_parent_id is not null and se.scout_parent_id = sp.id;

update public.signup_entries se
set person_id = l.person_id
from public.leaders l
where se.person_id is null and se.leader_code is not null and se.leader_code = l.code;

-- adult_name-only rows have no backing record to resolve against — surfaced
-- loudly rather than silently left null, since a NOT NULL constraint is
-- coming in a later migration and this is the one point where a human needs
-- to look at them by hand.
do $$
declare
  v_unresolvable int;
begin
  select count(*) into v_unresolvable
  from public.signup_entries
  where person_id is null and status <> 'cancelled';

  if v_unresolvable > 0 then
    raise notice 'signup_entries: % non-cancelled row(s) could not be backfilled to a person_id (likely adult_name-only) — resolve by hand before adding NOT NULL', v_unresolvable;
  end if;
end $$;

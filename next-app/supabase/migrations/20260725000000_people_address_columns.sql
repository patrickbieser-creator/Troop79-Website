-- Give scout_parents' address fields a permanent home on people, so a FUTURE
-- DROP TABLE scout_parents (held for a later session, after this data has a
-- verified-complete destination) won't destroy it.
--
-- WHY (Patrick, 2026-07-25)
-- scout_parents.relationship is already safely duplicated into
-- relationships.source_label by the 2026-07-20 spine backfill (D-043's
-- parent_of edges) — no action needed there. But address_line1/2, city,
-- state, zip, and same_address_as_scout have NO equivalent anywhere else in
-- the schema. That data was collected specifically for a future mail-program
-- export (D-031) and would be destroyed permanently by an unprepared drop.
--
-- This is pure additive backfill. Nothing reads these columns yet — that's
-- deliberate. The point is only to make a future scout_parents drop safe,
-- not to wire up a consumer today.

alter table public.people add column if not exists address_line1 text;
alter table public.people add column if not exists address_line2 text;
alter table public.people add column if not exists city text;
alter table public.people add column if not exists state text;
alter table public.people add column if not exists zip text;

-- Canonical scout_parents row per person: lowest id wins, matching
-- households.ts's parentByPerson convention exactly, so the choice is
-- consistent with what the app already treats as "the" row for a person who
-- holds more than one (siblings each carry their own scout_parents row for
-- the same adult).
--
-- same_address_as_scout = true means "use the scout's own address" — that
-- row's own address_* columns may be null and must not be trusted directly,
-- so resolve through the linked scout's address instead.
with canonical as (
  select distinct on (sp.person_id) sp.*
  from public.scout_parents sp
  where sp.person_id is not null
  order by sp.person_id, sp.id asc
),
resolved as (
  select
    c.person_id,
    case when c.same_address_as_scout then s.address_line1 else c.address_line1 end as address_line1,
    case when c.same_address_as_scout then s.address_line2 else c.address_line2 end as address_line2,
    case when c.same_address_as_scout then s.city         else c.city end         as city,
    case when c.same_address_as_scout then s.state        else c.state end        as state,
    case when c.same_address_as_scout then s.zip          else c.zip end          as zip
  from canonical c
  join public.scouts s on s.id = c.scout_id
)
update public.people p
set address_line1 = r.address_line1,
    address_line2 = r.address_line2,
    city = r.city,
    state = r.state,
    zip = r.zip
from resolved r
where p.id = r.person_id
  and (r.address_line1 is not null or r.city is not null or r.state is not null or r.zip is not null);

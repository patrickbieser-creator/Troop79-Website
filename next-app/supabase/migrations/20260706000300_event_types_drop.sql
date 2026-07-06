-- Migrate rows tagged via the old event_types lookup to their real kind, then
-- drop the lookup table and the ledger_entries.event_type_id column — kind
-- alone is now the single source of truth for Camping/Hike/Day Outing/
-- Fundraiser, matching how camping_nights/hiking_miles already worked.
update public.ledger_entries e
set kind = 'day_outing'
from public.event_types t
where e.event_type_id = t.id and t.name = 'Day Outing';

update public.ledger_entries e
set kind = 'fundraiser'
from public.event_types t
where e.event_type_id = t.id and t.name = 'Fundraiser';

-- ledger_active/scout_summary/mb_progress are all `select *`-rooted views
-- that transitively depend on every ledger_entries column (including
-- event_type_id) — drop them (dependency order) before the column drop, then
-- recreate all three verbatim from their original migrations afterward.
drop view if exists public.mb_progress;
drop view if exists public.scout_summary;
drop view if exists public.ledger_active;

alter table public.ledger_entries drop column if exists event_type_id;
drop table if exists public.event_types;

create view public.ledger_active as
  select * from public.ledger_entries
  where archived_at is null and deleted_at is null;

create view public.scout_summary as
  with mb_awards as (
    select
      la.scout_id,
      count(*) filter (where mb.id is not null)               as mb_count,
      count(*) filter (where mb.id is not null and mb.eagle)  as eagle_mb_count
    from public.ledger_active la
    left join public.merit_badges mb
      on la.kind = 'merit_badge_award'
     and substring(la.code from 4) = mb.id
    where la.kind = 'merit_badge_award'
    group by la.scout_id
  ),
  nights as (
    select scout_id, sum(qty)::int as camping_nights
    from public.ledger_active
    where kind = 'camping_nights'
    group by scout_id
  ),
  service as (
    select scout_id, sum(qty)::int as service_hours
    from public.ledger_active
    where kind = 'service_hours'
    group by scout_id
  ),
  last_act as (
    select scout_id, max(date) as last_activity_date
    from public.ledger_active
    group by scout_id
  )
  select
    s.id                                       as scout_id,
    coalesce(mba.mb_count, 0)                  as mb_count,
    coalesce(mba.eagle_mb_count, 0)            as eagle_mb_count,
    coalesce(n.camping_nights, 0)              as camping_nights,
    coalesce(sv.service_hours, 0)              as service_hours,
    la.last_activity_date
  from public.scouts s
  left join mb_awards mba on mba.scout_id = s.id
  left join nights    n   on n.scout_id   = s.id
  left join service   sv  on sv.scout_id  = s.id
  left join last_act  la  on la.scout_id  = s.id;

comment on view public.scout_summary is
  'One row per scout with merit-badge count, Eagle-required MB count, total '
  'camping nights, total service hours, and the date of their most recent '
  'ledger activity. Excludes archived and soft-deleted entries.';

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

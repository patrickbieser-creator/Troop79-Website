-- Remove `attendance` from ledger_kind entirely. It only ever meant "no
-- quantity to tally" and every historical row that used it has already been
-- reclassified as `fundraiser` (20260706000300) — zero rows use it as of this
-- migration. Going forward every Events-tab check-in must resolve to a real
-- category (camping_nights/hiking_miles/day_outing/fundraiser), driven by the
-- event's own stored classification (events.default_kind, added below) or an
-- explicit Type pick for a brand-new event — there's no ambiguous fallback
-- left to fall into.
--
-- Postgres can't drop an enum value in place, so recreate the type without it.

drop view if exists public.mb_progress;
drop view if exists public.scout_summary;
drop view if exists public.ledger_active;

alter type public.ledger_kind rename to ledger_kind_old;

create type public.ledger_kind as enum (
  'rank_requirement',
  'rank_award',
  'merit_badge_requirement',
  'merit_badge_award',
  'service_hours',
  'camping_nights',
  'hiking_miles',
  'day_outing',
  'fundraiser',
  'leadership',
  'award'
);

alter table public.ledger_entries
  alter column kind type public.ledger_kind
  using kind::text::public.ledger_kind;

drop type public.ledger_kind_old;

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

-- Each named event (Spring Campout, Pancake Breakfast, ...) gets a stored
-- classification so leaders never re-pick a Type for a recurring event —
-- Fast Entry looks this up automatically when an existing event is selected.
alter table public.events
  add column if not exists default_kind public.ledger_kind;

-- Backfill from history: every event name so far has had exactly one kind
-- across all its ledger rows (checked live), so the most-common kind per
-- label is an unambiguous, safe default.
with dominant as (
  select
    label,
    kind,
    row_number() over (partition by label order by count(*) desc) as rn
  from public.ledger_entries
  where kind in ('camping_nights', 'hiking_miles', 'day_outing', 'fundraiser')
    and label is not null
  group by label, kind
)
update public.events e
set default_kind = d.kind
from dominant d
where d.label = e.name and d.rn = 1;

-- Per-scout aggregate roll-up consumed by the /advancement page and any other
-- screen that needs "all scouts with their counts in one query."
--
-- One row per scout (whether active or not). Counts come from ledger_active so
-- archived and soft-deleted rows are excluded automatically.

create view public.scout_summary as
  with mb_awards as (
    -- Per scout: how many merit badges have been awarded, and how many of
    -- those are Eagle-required. Awards are kind='merit_badge_award' with
    -- code='MB:<mb_id>'.
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

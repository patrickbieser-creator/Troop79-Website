-- Meeting attendance: leader-side table, per-meeting counts view, and the
-- scout_summary exclusion that keeps attendance off the public site.
--
-- Scout attendance lives in ledger_entries (kind='meeting_attendance',
-- code='MTG:<date>' — see 20260712060000). Leaders can't live there (the
-- ledger is scout-keyed), so they get their own table, keyed by meeting_date
-- to match the ledger's date-based convention (no meetings FK — a meeting row
-- can be deleted/recreated without orphaning its attendance history).
--
-- `status` is designed one size ahead: 'attended' is the only status the Roll
-- Call screen writes today; 'committed' is reserved for the planned
-- meeting-plan integration where a leader signs up ahead of time — optionally
-- to teach a specific skill (`skill_id`) — and roll call later confirms them.

create table public.meeting_attendance_leaders (
  id bigint generated always as identity primary key,
  meeting_date date not null,
  leader_code text not null references public.leaders(code) on delete cascade,
  status text not null default 'attended' check (status in ('committed', 'attended')),
  skill_id text references public.skills(id),
  note text,
  created_at timestamptz not null default now(),
  unique (meeting_date, leader_code)
);

create index meeting_attendance_leaders_date_idx
  on public.meeting_attendance_leaders (meeting_date);

alter table public.meeting_attendance_leaders enable row level security;
-- No anon policies on purpose — attendance is admin-only (v0.22 posture:
-- all reads via server loaders on the service-role client).

-- Per-date counts for the admin meetings list. security_invoker so the anon
-- role can't use the view to bypass ledger_entries RLS (same reasoning as
-- ledger_active in 20260712020000).
create view public.meeting_attendance_counts
  with (security_invoker = true) as
  select
    coalesce(s.meeting_date, l.meeting_date) as meeting_date,
    coalesce(s.scout_count, 0)               as scout_count,
    coalesce(l.leader_count, 0)              as leader_count
  from (
    select date as meeting_date, count(distinct scout_id)::int as scout_count
    from public.ledger_active
    where kind = 'meeting_attendance'
    group by date
  ) s
  full outer join (
    select meeting_date, count(*)::int as leader_count
    from public.meeting_attendance_leaders
    where status = 'attended'
    group by meeting_date
  ) l on l.meeting_date = s.meeting_date;

-- Recreate scout_summary so last_activity_date ignores meeting attendance —
-- attendance is admin-only, and the public roster's "last activity" must not
-- move just because roll call was taken. Everything else is unchanged from
-- 20260526000000.
create or replace view public.scout_summary as
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
    where kind <> 'meeting_attendance'
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
  'ledger activity (excluding meeting attendance, which is admin-only). '
  'Excludes archived and soft-deleted entries.';

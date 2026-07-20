-- Fix mb_progress under-reporting "in progress" scouts for any merit badge
-- whose id contains a hyphen (30 of 64 badges: first-aid, citizenship-*,
-- emergency-preparedness, etc.) — the "in progress" count is correct on each
-- badge's own detail page but wrong on the catalog list (public and admin)
-- and silently fed wrong candidates to the Meeting Plan engine.
--
-- Root cause: the reqs CTE extracted a merit badge id from a ledger
-- requirement code (shape `<mb_id>-<reqCode>`, e.g. "first-aid-2a") with
-- split_part(code, '-', 1) — which only takes the text up to the FIRST
-- hyphen. For "first-aid-2a" that yields "first", not "first-aid", so those
-- scouts' progress was attributed to a merit badge id that doesn't exist and
-- vanished from every consumer of this view. The awards CTE was unaffected
-- (it strips the fixed 3-char "MB:" prefix instead of splitting on '-').
--
-- Fix: match the code against real merit_badges ids as a prefix instead of
-- guessing from hyphen position, picking the longest match per code in case
-- one id is ever a prefix of another (defense in depth — not currently true
-- of the catalog, but cheap to guard against).

set search_path = public;

create or replace view public.mb_progress as
  with awards as (
    select scout_id, substring(code from 4) as mb_id
    from public.ledger_active
    where kind = 'merit_badge_award' and code like 'MB:%'
  ),
  req_matches as (
    select
      l.scout_id,
      m.id as mb_id,
      row_number() over (
        partition by l.scout_id, l.code
        order by length(m.id) desc
      ) as rn
    from public.ledger_active l
    join public.merit_badges m on l.code like (m.id || '-%')
    where l.kind = 'merit_badge_requirement'
  ),
  reqs as (
    select scout_id, mb_id from req_matches where rn = 1
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
  'the MB Progress catalog to count completed vs in-progress. mb_id is '
  'resolved by matching the ledger code against real merit_badges ids, not '
  'by splitting on the first hyphen (see 20260719060000).';

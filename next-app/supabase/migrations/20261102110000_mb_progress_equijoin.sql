-- mb_progress: resolve each requirement code's merit badge with an equality (hash) join.
--
-- 20260719060000 matched `l.code like (m.id || '-%')` — correct, but the planner can only run it as a
-- nested loop (every requirement row x every badge, 188,720 rows removed by the join filter in prod,
-- ~66 ms per read). Same answer, different shape: a requirement code `<mb_id>-<reqCode>` has the badge id
-- as one of its hyphen-delimited prefixes ('first-aid-2a' -> 'first', 'first-aid'), so generate those
-- prefixes and join on m.id = prefix. The longest matching id still wins (hyphenated ids, and defense in
-- depth if one id is ever a prefix of another). Output columns, types and row set are unchanged;
-- CREATE OR REPLACE keeps the grants; security_invoker is restated because replacing a view without WITH resets it.

set search_path = public;

create or replace view public.mb_progress with (security_invoker = true) as
  with awards as (
    select scout_id, substring(code from 4) as mb_id
    from public.ledger_active
    where kind = 'merit_badge_award' and code like 'MB:%'
  ),
  req_codes as (
    select scout_id, code
    from public.ledger_active
    where kind = 'merit_badge_requirement'
  ),
  req_matches as (
    select
      c.scout_id,
      m.id as mb_id,
      row_number() over (
        partition by c.scout_id, c.code
        order by length(m.id) desc
      ) as rn
    from req_codes c
    cross join lateral (
      select left(c.code, p.pos - 1) as prefix
      from generate_series(2, length(c.code)) as p(pos)
      where substr(c.code, p.pos, 1) = '-'
    ) cand
    join public.merit_badges m on m.id = cand.prefix
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
  'resolved by equi-joining merit_badges.id to the hyphen-delimited prefixes of the '
  'ledger code, longest match wins (see 20260719060000, 20261102110000).';

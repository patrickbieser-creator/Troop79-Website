-- Meeting Planner: a board of review is pickable when allowed (Patrick, 2026-10-21: "The board of review can't be
-- offered unless all other requirements are completed for a rank"; "board of review should be pickable when allowed").
--
-- There is no BoR row in rank_requirements (removed 2026-08-19, 20260819120000_remove_redundant_bor_catalog_rows.sql);
-- a BoR is recorded as the ledger code '<rankId>-BoR' or a rank award. On a meeting board it is a topic of kind
-- rank_req with req_code 'BoR' (key '<rankId>-BoR'), which the existing meeting_topics CHECK already accepts
-- (topic_key = rank_id || '-' || req_code), so only _meeting_topic_id changes: it now resolves '<rankId>-BoR' for
-- every rank except Scout (Scout has no board of review). WHEN a scout may pick it (every other requirement of the
-- rank done, not already on their ledger) is the app's rule (lib/rank-calculus rankBorPickable), checked by the
-- server action before the pick RPC runs, as for every other pick.
--
-- Body copied from 20261204100000 (this repo's latest) with only the BoR branch added. CREATE OR REPLACE keeps the
-- grants; they are restated below.
-- DEPLOY ORDER: DB-first (it only widens what resolves), then the code.

create or replace function public._meeting_topic_id(p_entry bigint, p_key text) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_rank text;
  v_mb text;
  v_code text;
begin
  select id into v_id from meeting_topics where calendar_entry_id = p_entry and topic_key = p_key;
  if found then return v_id; end if;
  if p_key like 'ff:%' or p_key like 'fg:%' then return null; end if;
  if p_key like 'mb:%' then
    if not exists (select 1 from merit_badges where id = substr(p_key, 4)) then return null; end if;
    insert into meeting_topics (calendar_entry_id, topic_key, kind, mb_id)
    values (p_entry, p_key, 'merit_badge', substr(p_key, 4))
    on conflict (calendar_entry_id, topic_key) do nothing;
  else
    -- A rank requirement first: '<rankId>-<top-level code>'. Rank ids carry dashes ('second-class'), so take the
    -- longest rank id the key starts with.
    select r.id into v_rank from ranks r where p_key like r.id || '-%' order by length(r.id) desc limit 1;
    if v_rank is not null and v_rank <> 'scout' and p_key = v_rank || '-BoR' then
      -- A board of review: no catalog row, the rank is the reference.
      insert into meeting_topics (calendar_entry_id, topic_key, kind, rank_id, req_code)
      values (p_entry, p_key, 'rank_req', v_rank, 'BoR')
      on conflict (calendar_entry_id, topic_key) do nothing;
    elsif v_rank is not null and exists (
      select 1 from rank_requirements q where q.rank_id = v_rank and q.code = substr(p_key, length(v_rank) + 2) and q.parent_id is null
    ) then
      v_code := substr(p_key, length(v_rank) + 2);
      insert into meeting_topics (calendar_entry_id, topic_key, kind, rank_id, req_code)
      values (p_entry, p_key, 'rank_req', v_rank, v_code)
      on conflict (calendar_entry_id, topic_key) do nothing;
    else
      -- Then a top-level merit badge requirement: '<mbId>-<code>', the longest badge id that names one.
      select q.mb_id, q.code into v_mb, v_code
        from merit_badge_requirements q
       where q.parent_id is null and p_key = q.mb_id || '-' || q.code
       order by length(q.mb_id) desc limit 1;
      if v_mb is null then return null; end if;
      insert into meeting_topics (calendar_entry_id, topic_key, kind, mb_id, req_code)
      values (p_entry, p_key, 'mb_req', v_mb, v_code)
      on conflict (calendar_entry_id, topic_key) do nothing;
    end if;
  end if;
  select id into v_id from meeting_topics where calendar_entry_id = p_entry and topic_key = p_key;
  return v_id;
end;
$$;

revoke all on function public._meeting_topic_id(bigint, text) from public, anon, authenticated;
grant execute on function public._meeting_topic_id(bigint, text) to service_role;

-- Meeting board, Phase 3a (Plans/Meeting-Requests-And-Teaching-Offers.md): the leader sets a meeting's board.
--
-- 1. meeting_set_board(entry, mode, mb, blocks), for a troop meeting whose day hasn't passed: rank (1-3 teaching blocks), merit badge (one badge that has
--    requirement rows; its stations and rotations are Phase 3b) or closed. Upserts meeting_boards and bumps updated_at,
--    which meeting_board_stamp already reads, so an open This Sunday tab refreshes. Picks are never touched: on a merit
--    badge or closed week they are held and carry to the next rank board with their first-asked dates.
--    A merit badge or closed board keeps the block count it had (Phase 3b owns rotations).
--
-- Additive only: one function, no table change. DEPLOY ORDER: DB-first, then the code.
-- Posture (D-051 / D-239): invoker, search_path pinned, EXECUTE revoked from public/anon/authenticated, granted to
-- service_role. The capability check (meeting_plan.use) is the server action's.

create or replace function public.meeting_set_board(p_entry bigint, p_mode text, p_mb_id text, p_block_count integer)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_blocks smallint;
begin
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting isn’t on the calendar.';
  end if;
  -- Same day rule as the pick and answer RPCs: a meeting whose day has passed (Central) is history.
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  -- Boards belong to troop meetings (category behavior 'meeting', the rule meeting_board_mode() defaults by).
  if not exists (
    select 1 from calendar_entries c join calendar_categories k on k.label = c.category
    where c.id = p_entry and k.behavior = 'meeting'
  ) then
    raise exception 'Only troop meetings have a board.';
  end if;
  if p_mode is null or p_mode not in ('rank', 'merit_badge', 'closed') then
    raise exception 'Choose rank, merit badge or closed.';
  end if;

  if p_mode = 'rank' then
    if p_block_count is null or p_block_count not between 1 and 3 then
      raise exception 'Teaching blocks are 1, 2 or 3.';
    end if;
    v_blocks := p_block_count;
  else
    v_blocks := coalesce((select block_count from meeting_boards where calendar_entry_id = p_entry), 2);
  end if;

  if p_mode = 'merit_badge' then
    if p_mb_id is null or btrim(p_mb_id) = '' then
      raise exception 'Choose the badge for this night.';
    end if;
    if not exists (select 1 from merit_badges where id = p_mb_id) then
      raise exception 'That badge isn’t in the catalog.';
    end if;
    if not exists (select 1 from merit_badge_requirements where mb_id = p_mb_id) then
      raise exception 'That badge has no requirements entered yet, so there is nothing to build stations from.';
    end if;
  end if;

  insert into meeting_boards (calendar_entry_id, board_mode, board_mb_id, block_count, updated_at)
  values (p_entry, p_mode, case when p_mode = 'merit_badge' then p_mb_id end, v_blocks, now())
  on conflict (calendar_entry_id) do update
    set board_mode = excluded.board_mode,
        board_mb_id = excluded.board_mb_id,
        block_count = excluded.block_count,
        updated_at = now();
end;
$$;

revoke all on function public.meeting_set_board(bigint, text, text, integer) from public, anon, authenticated;
grant execute on function public.meeting_set_board(bigint, text, text, integer) to service_role;

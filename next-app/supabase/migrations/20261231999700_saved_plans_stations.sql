-- Station rotations step 6 (Plans/Planner-Station-Rotations.md): saved plans carry Stations on/off and the station
-- order (criteria.stations: indexes into criteria.focus). meeting_load_saved_plan restores them after the focus
-- (20261231950000's body otherwise). Never the hand moves or also-assignments: a saved plan holds no people.
--
-- DEPLOY ORDER: DB-first (a plan saved by the old code has no stations key and loads exactly as before, except that
-- loading it now turns a meeting's Stations off). Posture (D-051 / D-239): invoker, search_path pinned, EXECUTE to
-- service_role only.

create or replace function public.meeting_load_saved_plan(p_entry bigint, p_plan bigint, p_actor bigint) returns text[]
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c jsonb;
  f jsonb;
  v_set bigint;
  v_items text[];
  v_title text;
  v_wanted text[] := '{}';
  v_badges text[];
  v_singles text[];
  v_skipped text[] := '{}';
  v_i bigint;
  v_new bigint;
  k text;
  r record;
  v_keys text[];
begin
  perform public._meeting_seed_guard(p_entry);
  select criteria into c from meeting_saved_plans where id = p_plan;
  if c is null then raise exception 'That saved plan no longer exists.'; end if;
  v_singles := array(select e from jsonb_array_elements_text(case when jsonb_typeof(c->'singles') = 'array' then c->'singles' else '[]'::jsonb end) e);
  v_badges := array(select e from jsonb_array_elements_text(case when jsonb_typeof(c->'badges') = 'array' then c->'badges' else '[]'::jsonb end) e);
  -- What stays: each saved focus whose set still exists, and each saved requirement. A setId that isn't a whole number
  -- counts as gone: the focus is made again from its items.
  for f in select * from jsonb_array_elements(case when jsonb_typeof(c->'focus') = 'array' then c->'focus' else '[]'::jsonb end) loop
    v_set := case when coalesce(f->>'setId', '') ~ '^\d{1,18}$' then (f->>'setId')::bigint end;
    if v_set is not null and exists (select 1 from focus_sets where id = v_set) then v_wanted := v_wanted || ('fg:' || v_set); end if;
  end loop;
  v_wanted := v_wanted || v_singles;
  -- Out with the rest of the focus and the planner-added requirements.
  for r in select topic_key from meeting_topics where calendar_entry_id = p_entry and seeded_at is not null and kind in ('focus_group', 'rank_req', 'mb_req') loop
    if not (r.topic_key = any(v_wanted)) then perform public.meeting_unseed_topic(p_entry, r.topic_key); end if;
  end loop;
  delete from meeting_night_badges where calendar_entry_id = p_entry and not (mb_id = any(v_badges));
  insert into meeting_night_badges (calendar_entry_id, mb_id, added_by_person_id)
  select p_entry, b, p_actor from unnest(v_badges) b where exists (select 1 from merit_badges m where m.id = b)
  on conflict (calendar_entry_id, mb_id) do nothing;
  v_skipped := v_skipped || array(select 'merit badge ' || b from unnest(v_badges) b where not exists (select 1 from merit_badges m where m.id = b));
  -- In with the saved focus: its own set when it still exists (with the saved items and title if they differ), else a
  -- new set made from what was saved. Items no longer in the catalog are left out and named; a focus with none left is
  -- skipped and named.
  for f, v_i in select e, o from jsonb_array_elements(case when jsonb_typeof(c->'focus') = 'array' then c->'focus' else '[]'::jsonb end) with ordinality x(e, o) loop
    v_set := case when coalesce(f->>'setId', '') ~ '^\d{1,18}$' then (f->>'setId')::bigint end;
    v_title := coalesce(nullif(btrim(f->>'title'), ''), 'Focus');
    v_items := array(select e from jsonb_array_elements_text(case when jsonb_typeof(f->'items') = 'array' then f->'items' else '[]'::jsonb end) e);
    v_skipped := v_skipped || array(select i from unnest(v_items) i where not public._focus_item_valid(i));
    v_items := array(select i from unnest(v_items) i where public._focus_item_valid(i));
    if cardinality(v_items) = 0 then
      v_skipped := v_skipped || ('focus set ' || v_title);
      continue;
    end if;
    if v_set is not null and exists (select 1 from focus_sets where id = v_set) then
      perform public.meeting_seed_focus_set(p_entry, v_set, p_actor);
      if v_items is distinct from array(
           select m.item_key from meeting_topic_members m join meeting_topics t on t.id = m.topic_id
            where t.calendar_entry_id = p_entry and t.topic_key = 'fg:' || v_set order by m.position)
         or v_title is distinct from (select title from meeting_topics where calendar_entry_id = p_entry and topic_key = 'fg:' || v_set) then
        perform public.meeting_edit_mix(p_entry, v_set, v_title, v_items, p_actor, false);
      end if;
    else
      -- The set is gone: a new one from what was saved, and the saved plan points at it from now on (no duplicate
      -- set on the next load).
      v_new := public.meeting_new_mix(p_entry, v_title, v_items, p_actor);
      update meeting_saved_plans set criteria = jsonb_set(criteria, array['focus', (v_i - 1)::text, 'setId'], to_jsonb(v_new)) where id = p_plan;
    end if;
  end loop;
  -- The planner-added requirements, one at a time in a savepoint each: one that no longer resolves is skipped and
  -- named, and the rest still load.
  foreach k in array v_singles loop
    begin
      perform public.meeting_seed_many(p_entry, jsonb_build_array(k), p_actor);
    exception when others then
      v_skipped := v_skipped || k;
    end;
  end loop;
  -- Split groups (S6): a plan saved with splits brings its groups back, in place of the meeting's (one that no longer
  -- fits, say a rank no longer on the night, is skipped and named). A plan saved without any, or before split groups,
  -- merges the meeting's splits: softly, so Split or merge… can still bring them back.
  if jsonb_typeof(c->'splits') = 'array' and jsonb_array_length(c->'splits') > 0 then
    delete from meeting_group_splits where calendar_entry_id = p_entry;
    for f in select * from jsonb_array_elements(c->'splits') loop
      begin
        perform public.meeting_split_group(
          p_entry,
          f->>'group',
          f->'sections',
          case when jsonb_typeof(f->'levels') = 'array' then array(select (e)::integer from jsonb_array_elements_text(f->'levels') e) end,
          p_actor
        );
      exception when others then
        v_skipped := v_skipped || ('the split of ' || coalesce(f->>'group', 'a group'));
      end;
    end loop;
  else
    update meeting_group_splits set merged_at = now(), updated_by_person_id = p_actor, updated_at = now()
     where calendar_entry_id = p_entry and merged_at is null;
  end if;
  -- Station rotations (step 6): a plan saved with Stations on brings back the switch and the station order (indexes
  -- into its focus, read again now: a focus whose set was gone got a new set above). A plan saved without them turns
  -- the meeting's off, keeping its order for later as the switch always does.
  if jsonb_typeof(c->'stations') = 'array' then
    select criteria into c from meeting_saved_plans where id = p_plan;
    -- (Aliases avoid 'k', a variable of this function.)
    v_keys := array(
      select z.skey from (
        select distinct on (y.skey) y.skey, y.pos from (
          select 'fg:' || (c->'focus'->(x.i::int)->>'setId') as skey, x.o as pos
            from jsonb_array_elements_text(c->'stations') with ordinality x(i, o)
           where x.i ~ '^\d{1,3}$'
        ) y
        where y.skey is not null
          and exists (select 1 from meeting_topics t where t.calendar_entry_id = p_entry and t.topic_key = y.skey and t.kind = 'focus_group' and t.seeded_at is not null)
        order by y.skey, y.pos
      ) z order by z.pos);
    perform public.meeting_order_stations(p_entry, v_keys);
    perform public.meeting_set_rotation(p_entry, true);
  elsif exists (select 1 from meeting_rotations where calendar_entry_id = p_entry and stations_on) then
    perform public.meeting_set_rotation(p_entry, false);
  end if;
  return v_skipped;
end;
$$;
revoke all on function public.meeting_load_saved_plan(bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.meeting_load_saved_plan(bigint, bigint, bigint) to service_role;

-- Build a Plan B1 (Plans/Build-A-Plan.md): seed several top-level requirements on one meeting in one call.
--
-- The planner's Suggested column adds one or more suggestions with one Add: one round trip, one advisory lock
-- (_meeting_seed_guard takes it), the same guards as meeting_seed_topic for every key. Idempotent per key: a key
-- already seeded keeps its seeder and time; a key on the board but not seeded (picked, or offered) becomes seeded.
-- A bad key refuses the whole batch with meeting_seed_topic's own message, so nothing is half-added.
-- Returns the keys this call newly seeded, in the order given.

create or replace function public.meeting_seed_many(p_entry bigint, p_keys jsonb, p_actor bigint)
returns text[]
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_topic bigint;
  v_done text[] := '{}';
begin
  if p_keys is null or jsonb_typeof(p_keys) <> 'array' then
    raise exception 'Malformed request';
  end if;
  if jsonb_array_length(p_keys) = 0 then
    return v_done;
  end if;
  if jsonb_array_length(p_keys) > 20 then
    raise exception 'Add up to 20 at a time.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_keys) e where jsonb_typeof(e) <> 'string') then
    raise exception 'Malformed request';
  end if;
  perform public._meeting_seed_guard(p_entry);
  for v_key in select e.value from jsonb_array_elements_text(p_keys) with ordinality as e(value, n) order by e.n loop
    if v_key like 'mb:%' or v_key like 'ff:%' or v_key like 'fg:%' then
      raise exception 'Seed one requirement at a time.';
    end if;
    v_topic := public._meeting_topic_id(p_entry, v_key);
    if v_topic is null then raise exception 'Seed a whole requirement (like Tenderfoot 4a), not a part of one.'; end if;
    update meeting_topics set seeded_by_person_id = p_actor, seeded_at = now() where id = v_topic and seeded_at is null;
    if found then v_done := v_done || v_key; end if;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.meeting_seed_many(bigint, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.meeting_seed_many(bigint, jsonb, bigint) to service_role;

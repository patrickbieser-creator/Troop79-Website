-- Merit Badge Catalog save: rewrite a badge's requirement tree in ONE transaction.
--
-- updateMeritBadge used to delete the tree and re-insert it row by row from the server action; a failure midway
-- (a duplicate code, a transient error) left a partial or empty tree and lost every requirement's teach_minutes and
-- venue. This function does the delete + re-insert as a single statement, so any error rolls the whole rewrite back
-- and the original tree stands.
--
-- p_tree is the editor's tree: [{ code, label, complete_rule, complete_n, originalCode?, children: [...] }, ...].
-- The editor doesn't send teach_minutes or venue; they ride through the rewrite, matched by code — the original code
-- when a requirement is renamed (so an A<->B swap in one save keeps each requirement's own values). A node with a
-- blank code or label is skipped, with its children (same as the old action). sort_order is the position among the
-- kept siblings.
--
-- Posture (D-051 / D-239): invoker, search_path pinned, EXECUTE revoked from public/anon/authenticated, granted to
-- service_role only.

create or replace function public._insert_merit_badge_requirement_nodes(
  p_mb_id text,
  p_nodes jsonb,
  p_parent bigint,
  p_kept jsonb
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_node jsonb;
  v_code text;
  v_label text;
  v_rule text;
  v_carry jsonb;
  v_id bigint;
  v_sort integer := 0;
begin
  if p_nodes is null or jsonb_typeof(p_nodes) <> 'array' then
    return;
  end if;
  for v_node in select value from jsonb_array_elements(p_nodes) loop
    v_code := btrim(coalesce(v_node->>'code', ''));
    v_label := btrim(coalesce(v_node->>'label', ''));
    continue when v_code = '' or v_label = '';
    v_rule := coalesce(v_node->>'complete_rule', 'all');
    v_carry := p_kept -> btrim(coalesce(v_node->>'originalCode', v_node->>'code'));

    insert into merit_badge_requirements (mb_id, parent_id, code, label, complete_rule, complete_n, sort_order)
    values (
      p_mb_id,
      p_parent,
      v_code,
      v_label,
      v_rule,
      case when v_rule = 'n-of' then (v_node->>'complete_n')::integer end,
      v_sort
    )
    returning id into v_id;

    if v_carry is not null then
      update merit_badge_requirements
         set teach_minutes = (v_carry->>'teach_minutes')::smallint,
             venue = v_carry->>'venue'
       where id = v_id;
    end if;

    v_sort := v_sort + 1;
    perform public._insert_merit_badge_requirement_nodes(p_mb_id, v_node->'children', v_id, p_kept);
  end loop;
end;
$$;

create or replace function public.replace_merit_badge_requirements(p_mb_id text, p_tree jsonb) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_kept jsonb;
begin
  if p_tree is null or jsonb_typeof(p_tree) <> 'array' then
    raise exception 'requirement tree must be a JSON array';
  end if;

  select coalesce(jsonb_object_agg(code, jsonb_build_object('teach_minutes', teach_minutes, 'venue', venue)), '{}'::jsonb)
    into v_kept
    from merit_badge_requirements
   where mb_id = p_mb_id;

  delete from merit_badge_requirements where mb_id = p_mb_id;

  perform public._insert_merit_badge_requirement_nodes(p_mb_id, p_tree, null, v_kept);
end;
$$;

revoke all on function public._insert_merit_badge_requirement_nodes(text, jsonb, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.replace_merit_badge_requirements(text, jsonb) from public, anon, authenticated;
grant execute on function public._insert_merit_badge_requirement_nodes(text, jsonb, bigint, jsonb) to service_role;
grant execute on function public.replace_merit_badge_requirements(text, jsonb) to service_role;

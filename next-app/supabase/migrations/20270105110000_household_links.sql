-- Family links built everywhere (Plans/Person-Record-One-Save.md, step 2).
--
-- One rule, in the database so every writer gets it (the record page, family sign-up's
-- add_parent_to_household, change-request approval, merges, imports):
--   * a youth member of a household is anyone person_directory lists as active_scout,
--     inactive_scout or webelos;
--   * an adult member who is parent_of / guardian_of ANY youth in the household is a
--     carer there, and is linked the same way to EVERY youth in it (parent_of wins when
--     they hold both kinds);
--   * every youth in the household is sibling_of every other youth, stored both ways.
-- An adult in the household with no parent/guardian link (a grandparent, another adult)
-- gets nothing. Links are only ever ADDED here: ending them is always an explicit choice
-- (the record page's "Also remove ..." question), never automatic.
--
-- household_link_gaps() is the read-only answer (the dry run and the record page's
-- "Saving will also link ..." preview); link_household_relationships() inserts it.
-- Two AFTER INSERT triggers call it: a new household member, and a new parent/guardian
-- row between two people who share a household. The triggers write one History row per
-- link they add (actor from troop79.actor_* settings when a caller sets them, else
-- 'system') unless troop79.record_save = 'on', where save_person_record writes the
-- History itself (one row per person touched).
--
-- Additive: DB-first deploy. Posture: nothing granted to anon or authenticated.

create or replace function public.household_link_gaps(p_household_id bigint)
returns table (person_id bigint, related_person_id bigint, type text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with members as (
    select hm.person_id, pd.tab
      from household_members hm
      join person_directory pd on pd.person_id = hm.person_id
     where hm.household_id = p_household_id
  ),
  youth as (
    select m.person_id from members m where m.tab in ('active_scout', 'inactive_scout', 'webelos')
  ),
  carers as (
    select r.person_id,
           case when bool_or(r.type = 'parent_of') then 'parent_of' else 'guardian_of' end as type
      from relationships r
      join youth y on y.person_id = r.related_person_id
      join members m on m.person_id = r.person_id
     where r.type in ('parent_of', 'guardian_of')
       and not exists (select 1 from youth y2 where y2.person_id = r.person_id)
     group by r.person_id
  ),
  wanted as (
    select c.person_id, y.person_id as related_person_id, c.type
      from carers c cross join youth y
    union
    select a.person_id, b.person_id, 'sibling_of'
      from youth a join youth b on a.person_id <> b.person_id
  )
  select w.person_id, w.related_person_id, w.type
    from wanted w
   where not exists (
           select 1 from relationships r
            where r.person_id = w.person_id
              and r.related_person_id = w.related_person_id
              and (r.type = w.type
                   or (w.type in ('parent_of', 'guardian_of') and r.type in ('parent_of', 'guardian_of')))
         )
   order by 1, 2, 3;
$$;

revoke all on function public.household_link_gaps(bigint) from public, anon, authenticated;

-- One audit row per link the triggers add; skipped inside save_person_record.
create or replace function public.audit_household_link(p_person_id bigint, p_related_person_id bigint, p_type text)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_phrase text := case p_type
    when 'parent_of' then 'Parent of'
    when 'guardian_of' then 'Guardian of'
    when 'sibling_of' then 'Sibling of'
    else p_type end;
  v_person text;
  v_other text;
  v_actor_id integer := nullif(current_setting('troop79.actor_person_id', true), '')::integer;
  v_actor_label text := coalesce(nullif(current_setting('troop79.actor_label', true), ''), 'system');
begin
  if coalesce(current_setting('troop79.record_save', true), '') = 'on' then
    return;
  end if;
  select display_name into v_person from people where id = p_person_id;
  select display_name into v_other from people where id = p_related_person_id;
  insert into audit_log (actor_person_id, actor_label, area, action, entity_type, entity_id, summary, details)
  values (
    v_actor_id,
    v_actor_label,
    'roster',
    'create',
    'relationship',
    p_person_id::text,
    format('Linked automatically (same household): %s %s %s', coalesce(v_person, 'person ' || p_person_id), v_phrase, coalesce(v_other, 'person ' || p_related_person_id)),
    jsonb_build_object(
      'changes', jsonb_build_array(jsonb_build_object(
        'field', v_phrase || ' ' || coalesce(v_other, 'person ' || p_related_person_id),
        'from', 'not linked',
        'to', 'linked (same household)')),
      'people', jsonb_build_array(p_related_person_id))
  );
end;
$$;

revoke all on function public.audit_household_link(bigint, bigint, text) from public, anon, authenticated;

create or replace function public.link_household_relationships(p_household_id bigint)
returns table (person_id bigint, related_person_id bigint, type text)
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  g record;
begin
  for g in select * from household_link_gaps(p_household_id) loop
    insert into relationships (person_id, related_person_id, type, is_guardian)
    values (g.person_id, g.related_person_id, g.type, false)
    on conflict (person_id, related_person_id, type) do nothing;
    if found then
      perform audit_household_link(g.person_id, g.related_person_id, g.type);
      person_id := g.person_id;
      related_person_id := g.related_person_id;
      type := g.type;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.link_household_relationships(bigint) from public, anon, authenticated;

-- A new member: link them into the household. Nested inserts made by the link itself
-- (pg_trigger_depth() > 1) don't re-enter.
create or replace function public.household_members_link_trg()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  perform link_household_relationships(new.household_id);
  return null;
end;
$$;

drop trigger if exists household_members_link on public.household_members;
create trigger household_members_link
  after insert on public.household_members
  for each row execute function public.household_members_link_trg();

-- A new parent/guardian link between two people who share a household: the carer is now
-- a carer there, so they are linked to the household's other youth too.
create or replace function public.relationships_link_trg()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  h bigint;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  for h in
    select a.household_id
      from household_members a
      join household_members b on b.household_id = a.household_id
     where a.person_id = new.person_id
       and b.person_id = new.related_person_id
  loop
    perform link_household_relationships(h);
  end loop;
  return null;
end;
$$;

drop trigger if exists relationships_link on public.relationships;
create trigger relationships_link
  after insert on public.relationships
  for each row
  when (new.type in ('parent_of', 'guardian_of'))
  execute function public.relationships_link_trg();

revoke all on function public.household_members_link_trg() from public, anon, authenticated;
revoke all on function public.relationships_link_trg() from public, anon, authenticated;

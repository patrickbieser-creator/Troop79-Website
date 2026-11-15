-- One form, one Save (Plans/Person-Record-One-Save.md, step 3).
--
-- save_person_record(p jsonb) applies everything a leader changed on a person's record page
-- in ONE transaction: demographics, the scout row, status, emails, household, relationships,
-- roles and sign-off initials. Any failure rolls all of it back. The server action
-- (savePersonRecord) validates the draft and works out the History lines for the record's
-- own fields; this function applies the writes, lets the household-link triggers add what
-- the family rule implies, and then writes ONE audit row per person touched: the edited
-- person's (their fields + their link changes) and one for every other person whose links
-- changed, each naming whose record it came from.
--
-- preview_person_record(p jsonb) runs the same writes inside a savepoint, reports the link
-- changes, and rolls them back: the "Saving will also link ..." line and the
-- remove-from-household question read it.
--
-- Input (every key optional except person_id):
--   person_id, actor_person_id, actor_label
--   people:        { <column>: value }  -- whitelisted columns below; '' or null clears
--   scout:         { patrol, school_id, graduation_year, swim_class, junior_leader_override,
--                    active, inactive_reason }
--   emails:        { remove: [id], add: [{ email, label }], relabel: [{ id, label }], primary: email-text }
--   household:     { household_id: id|null, end_links: bool, add_members: [person id] }
--                  household_id present = the person moves; add_members joins others to the
--                  person's (new) household, moving them out of any other
--   relationships: { remove: [id], add: [{ person_id, related_person_id, type }] }
--   roles:         { grant: [role], end: [person_roles.id] }
--   initials:      [{ op: 'add'|'rename'|'retire'|'restore', code }]  -- applied in order
--   details:       [{ field, from, to }]  -- the record's own field lines, from the server action
--
-- Refusals raise SQLSTATE T7902 with a message the form can show.
-- Additive: DB-first deploy. Posture: nothing granted to anon or authenticated.

create or replace function public.person_link_phrase(p_type text, p_outgoing boolean, p_other text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when p_outgoing or p_type = 'sibling_of' then
      (case p_type
         when 'parent_of' then 'Parent of '
         when 'guardian_of' then 'Guardian of '
         when 'sibling_of' then 'Sibling of '
         when 'emergency_contact_for' then 'Emergency contact for '
         else p_type || ' ' end) || p_other
    else
      (case p_type
         when 'parent_of' then 'Parent: '
         when 'guardian_of' then 'Guardian: '
         when 'emergency_contact_for' then 'Emergency contact: '
         else p_type || ': ' end) || p_other
  end;
$$;

revoke all on function public.person_link_phrase(text, boolean, text) from public, anon, authenticated;

-- The writes, shared by save and preview. Returns the link diff:
--   { added: [[person_id, related_person_id, type], ...], removed: [...] }
create or replace function public.apply_person_record(p jsonb)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pid bigint := (p->>'person_id')::bigint;
  v_people jsonb := coalesce(p->'people', '{}'::jsonb);
  v_scout jsonb := p->'scout';
  v_emails jsonb := p->'emails';
  v_household jsonb := p->'household';
  v_rels jsonb := p->'relationships';
  v_roles jsonb := p->'roles';
  v_initials jsonb := coalesce(p->'initials', '[]'::jsonb);
  v_op jsonb;
  v_add_members bigint[];
  v_old_household bigint;
  v_new_household bigint;
  v_scope bigint[];
  v_before text[];
  v_after text[];
  v_unlinked text[] := '{}';
  v_today date := (now() at time zone 'America/Chicago')::date;
  r record;
  v_code text;
  v_primary text;
begin
  if v_pid is null or not exists (select 1 from people where id = v_pid and merged_into_person_id is null) then
    raise exception using errcode = 'T7902', message = 'That person is no longer on the roster.';
  end if;
  perform 1 from people where id = v_pid for update;

  select household_id into v_old_household from household_members where person_id = v_pid limit 1;
  v_new_household := case when v_household ? 'household_id' then nullif(v_household->>'household_id', '')::bigint
                          else v_old_household end;
  select coalesce(array_agg((j #>> '{}')::bigint), '{}') into v_add_members
    from jsonb_array_elements(coalesce(v_household->'add_members', '[]')) j;

  -- Everyone whose links this save could change: the person, both households' members,
  -- and anyone named in a relationship change.
  select array_agg(distinct x) into v_scope from (
    select v_pid as x
    union select person_id from household_members where household_id in (v_old_household, v_new_household)
    union select unnest(v_add_members)
    union select (e->>'person_id')::bigint from jsonb_array_elements(coalesce(v_rels->'add', '[]')) e
    union select (e->>'related_person_id')::bigint from jsonb_array_elements(coalesce(v_rels->'add', '[]')) e
    union select rr.person_id from relationships rr
           where rr.id in (select (j #>> '{}')::bigint from jsonb_array_elements(coalesce(v_rels->'remove', '[]')) j)
    union select rr.related_person_id from relationships rr
           where rr.id in (select (j #>> '{}')::bigint from jsonb_array_elements(coalesce(v_rels->'remove', '[]')) j)
  ) s where x is not null;

  -- Link snapshots as 'person>related:type' text: jsonb array containment ignores element order, so
  -- [2,1,'sibling_of'] would count as present when only [1,2,'sibling_of'] is.
  select coalesce(array_agg(person_id || '>' || related_person_id || ':' || type), '{}') into v_before
    from relationships where person_id = any(v_scope) or related_person_id = any(v_scope);

  -- 1. Demographics and the adult's status (people).
  if v_people <> '{}'::jsonb then
    if (v_people ? 'first_name' and coalesce(btrim(v_people->>'first_name'), '') = '')
       or (v_people ? 'last_name' and coalesce(btrim(v_people->>'last_name'), '') = '') then
      raise exception using errcode = 'T7902', message = 'First and last name are required.';
    end if;
    update people set
      first_name = case when v_people ? 'first_name' then btrim(v_people->>'first_name') else first_name end,
      last_name = case when v_people ? 'last_name' then btrim(v_people->>'last_name') else last_name end,
      suffix = case when v_people ? 'suffix' then nullif(btrim(v_people->>'suffix'), '') else suffix end,
      nickname = case when v_people ? 'nickname' then nullif(btrim(v_people->>'nickname'), '') else nickname end,
      birthdate = case when v_people ? 'birthdate' then nullif(v_people->>'birthdate', '')::date else birthdate end,
      gender = case when v_people ? 'gender' then nullif(v_people->>'gender', '') else gender end,
      primary_phone = case when v_people ? 'primary_phone' then nullif(btrim(v_people->>'primary_phone'), '') else primary_phone end,
      address_line1 = case when v_people ? 'address_line1' then nullif(btrim(v_people->>'address_line1'), '') else address_line1 end,
      address_line2 = case when v_people ? 'address_line2' then nullif(btrim(v_people->>'address_line2'), '') else address_line2 end,
      city = case when v_people ? 'city' then nullif(btrim(v_people->>'city'), '') else city end,
      state = case when v_people ? 'state' then nullif(btrim(v_people->>'state'), '') else state end,
      zip = case when v_people ? 'zip' then nullif(btrim(v_people->>'zip'), '') else zip end,
      bsa_member_id = case when v_people ? 'bsa_member_id' then nullif(btrim(v_people->>'bsa_member_id'), '') else bsa_member_id end,
      ypt_completed = case when v_people ? 'ypt_completed' then nullif(v_people->>'ypt_completed', '')::date else ypt_completed end,
      health_form_date = case when v_people ? 'health_form_date' then nullif(v_people->>'health_form_date', '')::date else health_form_date end,
      things_we_should_know = case when v_people ? 'things_we_should_know' then nullif(btrim(v_people->>'things_we_should_know'), '') else things_we_should_know end,
      active = case when v_people ? 'active' then (v_people->>'active')::boolean else active end,
      inactive_reason = case when v_people ? 'inactive_reason' then nullif(btrim(v_people->>'inactive_reason'), '') else inactive_reason end,
      updated_at = now()
    where id = v_pid;
  end if;

  -- 2. The scout's own row.
  if v_scout is not null and v_scout <> '{}'::jsonb then
    if not exists (select 1 from scouts where person_id = v_pid) then
      raise exception using errcode = 'T7902', message = 'This person has no scout record.';
    end if;
    update scouts set
      patrol = case when v_scout ? 'patrol' then nullif(btrim(v_scout->>'patrol'), '') else patrol end,
      school_id = case when v_scout ? 'school_id' then nullif(v_scout->>'school_id', '')::bigint else school_id end,
      graduation_year = case when v_scout ? 'graduation_year' then nullif(v_scout->>'graduation_year', '')::integer else graduation_year end,
      swim_class = case when v_scout ? 'swim_class' then nullif(v_scout->>'swim_class', '') else swim_class end,
      junior_leader_override = case when v_scout ? 'junior_leader_override' then nullif(v_scout->>'junior_leader_override', '') else junior_leader_override end,
      active = case when v_scout ? 'active' then (v_scout->>'active')::boolean else active end,
      inactive_reason = case when v_scout ? 'inactive_reason' then nullif(v_scout->>'inactive_reason', '') else inactive_reason end
    where person_id = v_pid;
  end if;

  -- 3. Emails: remove, add, then make one primary (demote-then-promote in one statement).
  if v_emails is not null then
    delete from person_emails
     where person_id = v_pid
       and id in (select (j #>> '{}')::bigint from jsonb_array_elements(coalesce(v_emails->'remove', '[]')) j);
    for r in select e->>'email' as email, coalesce(nullif(e->>'label', ''), 'home') as label
               from jsonb_array_elements(coalesce(v_emails->'add', '[]')) e loop
      begin
        insert into person_emails (person_id, email, label, is_primary)
        values (v_pid, lower(btrim(r.email)), r.label, false);
      exception when unique_violation then
        raise exception using errcode = 'T7902', message = format('%s is already on file for this person.', r.email);
      end;
    end loop;
    update person_emails pe set label = x.label
      from (select (e->>'id')::bigint as id, e->>'label' as label
              from jsonb_array_elements(coalesce(v_emails->'relabel', '[]')) e) x
     where pe.id = x.id and pe.person_id = v_pid;
    v_primary := lower(btrim(coalesce(v_emails->>'primary', '')));
    if v_primary = '' then
      -- No choice sent: keep the current primary, or promote the first address left.
      select lower(btrim(email)) into v_primary from person_emails
       where person_id = v_pid order by is_primary desc, id limit 1;
    end if;
    if v_primary is not null and v_primary <> '' then
      if not exists (select 1 from person_emails where person_id = v_pid and lower(btrim(email)) = v_primary) then
        raise exception using errcode = 'T7902', message = 'The primary address must be one of the addresses on file.';
      end if;
      -- Demote first, then promote: person_emails_one_primary is checked row by row, so a single
      -- UPDATE that flips both can trip it depending on the order rows are visited.
      update person_emails set is_primary = false
       where person_id = v_pid and is_primary and lower(btrim(email)) <> v_primary;
      update person_emails set is_primary = true
       where person_id = v_pid and not is_primary and lower(btrim(email)) = v_primary;
    end if;
  end if;

  -- 4. Household. Ending the links that came with the old household is the leader's choice.
  if v_household is not null and v_household ? 'household_id' and v_new_household is distinct from v_old_household then
    if v_old_household is not null and coalesce((v_household->>'end_links')::boolean, false) then
      delete from relationships rr
       where rr.type in ('parent_of', 'guardian_of', 'sibling_of')
         and ((rr.person_id = v_pid and rr.related_person_id in
                (select person_id from household_members where household_id = v_old_household and person_id <> v_pid))
           or (rr.related_person_id = v_pid and rr.person_id in
                (select person_id from household_members where household_id = v_old_household and person_id <> v_pid)));
    end if;
    delete from household_members where person_id = v_pid;
    if v_new_household is not null then
      if not exists (select 1 from households where id = v_new_household) then
        raise exception using errcode = 'T7902', message = 'That household no longer exists.';
      end if;
      insert into household_members (household_id, person_id) values (v_new_household, v_pid);
    end if;
  end if;
  if array_length(v_add_members, 1) > 0 then
    if v_new_household is null then
      raise exception using errcode = 'T7902', message = 'Pick a household before adding people to it.';
    end if;
    if exists (select 1 from people where id = any(v_add_members) and (merged_into_person_id is not null or guest_host_household_id is not null)) then
      raise exception using errcode = 'T7902', message = 'Only people on the roster can join a household.';
    end if;
    delete from household_members where person_id = any(v_add_members) and household_id <> v_new_household;
    insert into household_members (household_id, person_id)
    select v_new_household, x from unnest(v_add_members) x where x <> v_pid
    on conflict do nothing;
  end if;

  -- 5. Relationships: every change must involve this person. Siblings are stored both ways.
  if v_rels is not null then
    for r in select rr.* from relationships rr
              where rr.id in (select (j #>> '{}')::bigint from jsonb_array_elements(coalesce(v_rels->'remove', '[]')) j) loop
      if r.person_id <> v_pid and r.related_person_id <> v_pid then
        raise exception using errcode = 'T7902', message = 'That relationship belongs to someone else.';
      end if;
      delete from relationships where id = r.id;
      v_unlinked := v_unlinked || (r.person_id || '>' || r.related_person_id || ':' || r.type);
      if r.type = 'sibling_of' then
        delete from relationships
         where person_id = r.related_person_id and related_person_id = r.person_id and type = 'sibling_of';
      end if;
    end loop;
    for r in select (e->>'person_id')::bigint as a, (e->>'related_person_id')::bigint as b, e->>'type' as t
               from jsonb_array_elements(coalesce(v_rels->'add', '[]')) e loop
      if r.a <> v_pid and r.b <> v_pid then
        raise exception using errcode = 'T7902', message = 'A relationship on this record must include this person.';
      end if;
      if r.a = r.b then
        raise exception using errcode = 'T7902', message = 'A person cannot relate to themselves.';
      end if;
      if exists (select 1 from people where id in (r.a, r.b)
                  and (merged_into_person_id is not null or guest_host_household_id is not null)) then
        raise exception using errcode = 'T7902', message = 'Only people on the roster can be linked.';
      end if;
      insert into relationships (person_id, related_person_id, type, is_guardian)
      values (r.a, r.b, r.t, false) on conflict (person_id, related_person_id, type) do nothing;
      if r.t = 'sibling_of' then
        insert into relationships (person_id, related_person_id, type, is_guardian)
        values (r.b, r.a, 'sibling_of', false) on conflict (person_id, related_person_id, type) do nothing;
      end if;
    end loop;
  end if;

  -- 6. Roles: grant (today) and end (today). Ended rows stay as history.
  if v_roles is not null then
    update person_roles set end_date = v_today
     where person_id = v_pid and end_date is null
       and id in (select (j #>> '{}')::bigint from jsonb_array_elements(coalesce(v_roles->'end', '[]')) j);
    for r in select j #>> '{}' as role from jsonb_array_elements(coalesce(v_roles->'grant', '[]')) j loop
      if exists (select 1 from person_roles where person_id = v_pid and role = r.role and end_date is null) then
        continue;
      end if;
      insert into person_roles (person_id, role, start_date) values (v_pid, r.role, v_today);
    end loop;
  end if;

  -- 7. Sign-off initials, through the existing RPCs (their T7901 refusals roll this back too).
  for v_op in select * from jsonb_array_elements(v_initials) loop
    v_code := btrim(coalesce(v_op->>'code', ''));
    case v_op->>'op'
      when 'add' then perform add_leader_initials(v_pid, v_code);
      when 'rename' then perform rename_leader_initials(v_pid, v_code);
      when 'retire' then perform set_leader_initials_retired(v_pid, true);
      when 'restore' then perform set_leader_initials_retired(v_pid, false);
      else raise exception using errcode = 'T7902', message = 'Unknown initials change.';
    end case;
  end loop;

  -- A link the leader removed must stay removed: if the household rule would add it straight back
  -- (the adult is still parent of another scout there, or two scouts share the household), say so
  -- instead of saving a choice the next household change would silently undo.
  if array_length(v_unlinked, 1) > 0 and v_new_household is not null then
    select g.person_id, g.related_person_id, g.type into r
      from household_link_gaps(v_new_household) g
     where (g.person_id || '>' || g.related_person_id || ':' || g.type) = any(v_unlinked)
        or (g.type = 'parent_of' and (g.person_id || '>' || g.related_person_id || ':guardian_of') = any(v_unlinked))
        or (g.type = 'guardian_of' and (g.person_id || '>' || g.related_person_id || ':parent_of') = any(v_unlinked))
     limit 1;
    if found then
      raise exception using errcode = 'T7902', message = case
        when r.type = 'sibling_of' then format(
          '%s and %s share a household, so they stay linked as siblings. Move one of them to another household to unlink them.',
          (select display_name from people where id = r.person_id), (select display_name from people where id = r.related_person_id))
        else format(
          '%s is a parent or guardian of another scout in this household, so the household links them to %s too. Move one of them to another household to unlink them.',
          (select display_name from people where id = r.person_id), (select display_name from people where id = r.related_person_id))
      end;
    end if;
  end if;

  -- The household-link triggers already ran on each insert, so this is the whole diff.
  select coalesce(array_agg(person_id || '>' || related_person_id || ':' || type), '{}') into v_after
    from relationships where person_id = any(v_scope) or related_person_id = any(v_scope)
       or person_id in (select person_id from household_members where household_id = v_new_household)
       or related_person_id in (select person_id from household_members where household_id = v_new_household);

  return jsonb_build_object(
    'added', (select coalesce(jsonb_agg(jsonb_build_array(split_part(k, '>', 1)::bigint,
                                                           split_part(split_part(k, '>', 2), ':', 1)::bigint,
                                                           split_part(k, ':', 2))), '[]'::jsonb)
                from unnest(v_after) k where not (k = any(v_before))),
    'removed', (select coalesce(jsonb_agg(jsonb_build_array(split_part(k, '>', 1)::bigint,
                                                             split_part(split_part(k, '>', 2), ':', 1)::bigint,
                                                             split_part(k, ':', 2))), '[]'::jsonb)
                  from unnest(v_before) k where not (k = any(v_after)))
  );
end;
$$;

revoke all on function public.apply_person_record(jsonb) from public, anon, authenticated;

-- The link diff, with names, for the UI: [{ person_id, person_name, related_person_id, related_name, type, change }]
create or replace function public.person_record_link_rows(p_diff jsonb)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', x.a, 'person_name', pa.display_name,
           'related_person_id', x.b, 'related_name', pb.display_name,
           'type', x.t, 'change', x.change)
           order by x.change, pa.display_name, pb.display_name), '[]'::jsonb)
    from (
      select (e->>0)::bigint a, (e->>1)::bigint b, e->>2 t, 'added' change from jsonb_array_elements(p_diff->'added') e
      union all
      select (e->>0)::bigint, (e->>1)::bigint, e->>2, 'removed' from jsonb_array_elements(p_diff->'removed') e
    ) x
    join people pa on pa.id = x.a
    join people pb on pb.id = x.b;
$$;

revoke all on function public.person_record_link_rows(jsonb) from public, anon, authenticated;

create or replace function public.save_person_record(p jsonb)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pid bigint := (p->>'person_id')::bigint;
  v_actor_id integer := nullif(p->>'actor_person_id', '')::integer;
  v_actor_label text := coalesce(nullif(p->>'actor_label', ''), 'system');
  v_record_name text;
  v_diff jsonb;
  v_rows jsonb;
  v_own jsonb := coalesce(p->'details', '[]'::jsonb);
  v_by_person jsonb := '{}'::jsonb;
  v_line jsonb;
  v_key text;
  v_lines jsonb;
  v_name text;
  e jsonb;
begin
  perform set_config('troop79.record_save', 'on', true);
  perform set_config('troop79.actor_person_id', coalesce(v_actor_id::text, ''), true);
  perform set_config('troop79.actor_label', v_actor_label, true);

  select display_name into v_record_name from people where id = v_pid;
  v_diff := apply_person_record(p);
  v_rows := person_record_link_rows(v_diff);

  -- Each link change becomes a line on BOTH people's History, phrased from their side.
  for e in select * from jsonb_array_elements(v_rows) loop
    v_line := jsonb_build_object(
      'field', person_link_phrase(e->>'type', true, e->>'related_name'),
      'from', case when e->>'change' = 'added' then 'not linked' else 'linked' end,
      'to', case when e->>'change' = 'added' then 'linked' else 'not linked' end);
    v_by_person := jsonb_set(v_by_person, array[e->>'person_id'],
      coalesce(v_by_person->(e->>'person_id'), '[]'::jsonb) || v_line);
    if e->>'type' <> 'sibling_of' then
      v_line := jsonb_build_object(
        'field', person_link_phrase(e->>'type', false, e->>'person_name'),
        'from', case when e->>'change' = 'added' then 'not linked' else 'linked' end,
        'to', case when e->>'change' = 'added' then 'linked' else 'not linked' end);
      v_by_person := jsonb_set(v_by_person, array[e->>'related_person_id'],
        coalesce(v_by_person->(e->>'related_person_id'), '[]'::jsonb) || v_line);
    end if;
  end loop;

  -- The edited person: their own field lines + their link lines, one row.
  v_lines := v_own || coalesce(v_by_person->(v_pid::text), '[]'::jsonb);
  if jsonb_array_length(v_lines) > 0 then
    select display_name into v_name from people where id = v_pid;
    insert into audit_log (actor_person_id, actor_label, area, action, entity_type, entity_id, summary, details)
    values (v_actor_id, v_actor_label, 'roster', 'update', 'person', v_pid::text,
      format('Updated %s''s record: %s', v_name,
        (select string_agg(f, ', ') from (select distinct l->>'field' as f from jsonb_array_elements(v_lines) l order by 1 limit 8) s)),
      v_lines);
  end if;

  -- Everyone else whose links changed: one row each, naming whose record it came from.
  for v_key in select jsonb_object_keys(v_by_person) loop
    continue when v_key = v_pid::text;
    select display_name into v_name from people where id = v_key::bigint;
    insert into audit_log (actor_person_id, actor_label, area, action, entity_type, entity_id, summary, details)
    values (v_actor_id, v_actor_label, 'roster', 'update', 'person', v_key,
      format('Family links changed for %s, from %s''s record', v_name, v_record_name),
      v_by_person->v_key);
  end loop;

  perform set_config('troop79.record_save', '', true);
  return jsonb_build_object('links', v_rows);
end;
$$;

revoke all on function public.save_person_record(jsonb) from public, anon, authenticated;

-- Same writes, rolled back: the link changes a save WOULD make, with names.
create or replace function public.preview_person_record(p jsonb)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rows jsonb;
  v_state text;
  v_msg text;
begin
  begin
    perform set_config('troop79.record_save', 'on', true);
    v_rows := person_record_link_rows(apply_person_record(p));
    raise exception using errcode = 'T7909', message = 'preview rollback';
  exception
    when sqlstate 'T7909' then
      null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      perform set_config('troop79.record_save', '', true);
      return jsonb_build_object('links', '[]'::jsonb, 'problem', case when v_state in ('T7901', 'T7902') then v_msg else 'error' end);
  end;
  perform set_config('troop79.record_save', '', true);
  return jsonb_build_object('links', coalesce(v_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.preview_person_record(jsonb) from public, anon, authenticated;

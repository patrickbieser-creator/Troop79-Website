-- add_parent_to_household gains a person, not just a scout_parents row.
--
-- WHY (Patrick / Operator, 2026-07-20)
-- This RPC is the one live write path confirmed to still create a
-- scout_parents row with NO people row and NO person_id — the "+ Add another
-- adult" flow mid-signup (person-first-form.tsx). Everything else in the app
-- has a person_id by now; this was the one open faucet. Left alone, it would
-- undermine both in-flight identity migrations: the signup dedup fix (a new
-- parent added here has no person_id to dedupe by) and the scout_parents
-- retirement (a table can't be dropped while something still writes to it
-- without a person_id).
--
-- Find-or-create matches the spine backfill's OWN rule (20260720100000):
-- exact email only, never fuzzy name. No email at all means a new person,
-- same as an existing scout_parents row with no email got its own person.
--
-- Still attaches to exactly one scout in the household, unchanged from the
-- original — siblings resolve through the household, so one scout_parents
-- row (and now one parent_of relationship edge) is enough, matching every
-- other adult in this table.

create or replace function public.add_parent_to_household(
  p_household_id bigint,
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_relationship text default null
)
returns bigint
language plpgsql
as $$
declare
  v_scout text;
  v_scout_person_id bigint;
  v_parent_id bigint;
  v_person_id bigint;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'PARENT_NAME_REQUIRED'; end if;

  select id, person_id into v_scout, v_scout_person_id from public.scouts
  where household_id = p_household_id order by id limit 1;
  if v_scout is null then raise exception 'HOUSEHOLD_HAS_NO_SCOUTS: %', p_household_id; end if;

  -- Find-or-create the person FIRST, so the scout_parents row is never
  -- written without one.
  if v_email is not null then
    select id into v_person_id from public.people
    where merged_into_person_id is null and lower(trim(primary_email)) = v_email
    limit 1;
  end if;

  if v_person_id is null then
    insert into public.people (first_name, last_name, display_name, primary_email, primary_phone)
    values (
      nullif(split_part(trim(p_name), ' ', 1), ''),
      nullif(trim(substring(trim(p_name) from position(' ' in trim(p_name)) + 1)), ''),
      trim(p_name), v_email, nullif(trim(p_phone), '')
    )
    returning id into v_person_id;
  end if;

  insert into public.scout_parents (scout_id, name, relationship, email, phone, person_id)
  values (v_scout, trim(p_name), nullif(trim(coalesce(p_relationship, '')), ''),
          v_email, nullif(trim(p_phone), ''), v_person_id)
  returning id into v_parent_id;

  if v_email is not null then
    insert into public.scout_parent_emails (scout_parent_id, email, label, is_primary)
    values (v_parent_id, v_email, 'home', true)
    on conflict (scout_parent_id, email) do nothing;
  end if;

  insert into public.household_members (household_id, person_id)
  values (p_household_id, v_person_id)
  on conflict do nothing;

  if v_scout_person_id is not null and v_scout_person_id <> v_person_id then
    insert into public.relationships (person_id, related_person_id, type, source_label)
    values (v_person_id, v_scout_person_id, 'parent_of', nullif(trim(coalesce(p_relationship, '')), ''))
    on conflict do nothing;
  end if;

  return v_parent_id;
end;
$$;

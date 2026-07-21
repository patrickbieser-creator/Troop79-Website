-- Split parent/child identities the spine backfill wrongly fused into one.
--
-- WHAT HAPPENED (Operator, 2026-07-20)
-- The spine backfill (20260720100000) matches people on EXACT email only —
-- deliberately, to avoid the fuzzy-name bugs (D-042) this whole model exists
-- to end. But "same email" isn't "same person" when a minor's contact email
-- IS a parent's: a scout row is inserted as a person FIRST, and when the
-- parent step later finds an EXISTING person with that same email, it
-- attaches the parent's scout_parents row to the CHILD's person instead of
-- creating a distinct one. The backfill's own self-loop guard on the
-- parent_of insert (`sp.person_id <> s.person_id`) silently swallowed the
-- resulting no-op relationship rather than surfacing that the merge itself
-- was wrong.
--
-- Found while backfilling signup_entries.person_id (20260720190000): two
-- different signup rows for the same event resolved to one person_id,
-- tripping signup_entries_person_uniq. Confirmed in local dev: Michelle
-- Porter/Lily Porter (E01), Summer Kimble/Fiona Kimble (E07), Kevin Barry/
-- Piper Kingston (E06) — each parent shares one child's email.
--
-- REVISED (qa-lead review, same day) — the first version of this fix matched
-- only `sp.person_id = s.person_id` where `s.id = sp.scout_id`: a
-- scout_parents row whose OWN linked scout is the one it got conflated with.
-- That misses a parent with MULTIPLE children: the original backfill grouped
-- scout_parents rows by EMAIL ACROSS THE WHOLE TABLE, so Kevin Barry's row
-- for Quinn Barry (scout_id=B05) got attached to Piper Kingston's person
-- (E06, a SIBLING, not Quinn) purely because both rows share Kevin's email.
-- The old signature never looked past a row's own scout_id, so that sibling
-- row stayed silently conflated even after "fixing" the household.
--
-- FIX: generic, not a hardcoded list. A scout_parents row is conflated if its
-- person_id belongs to ANY scout at all (not just its own linked one) — that
-- is only possible when the backfill's email-match wrongly reused a scout's
-- person row. Rows are grouped by email first, so a parent with several
-- children collapses onto ONE new person, not one per row (and reuses an
-- already-created non-scout person with that email if a previous run of this
-- migration already made one — safe to re-run after a partial fix).
--
-- Idempotent: once a row points at a real (non-scout) person, it no longer
-- matches the conflation signature, so a second run finds nothing further.

do $$
declare
  gk record;
  v_rep record;
  r record;
  v_new_person_id bigint;
  v_fixed int := 0;
begin
  for gk in
    select coalesce(nullif(lower(trim(sp.email)), ''), 'row:' || sp.id::text) as gkey,
           min(nullif(lower(trim(sp.email)), '')) as email
    from public.scout_parents sp
    where sp.person_id is not null
      and exists (select 1 from public.scouts s2 where s2.person_id = sp.person_id)
    group by coalesce(nullif(lower(trim(sp.email)), ''), 'row:' || sp.id::text)
  loop
    v_new_person_id := null;

    -- Reuse an already-correct person with this email — one that is NOT
    -- itself a scout identity — so a partial prior run (or several parents
    -- sharing one email) never produces a second row for the same human.
    if gk.email is not null then
      select p.id into v_new_person_id
      from public.people p
      where lower(trim(p.primary_email)) = gk.email
        and not exists (select 1 from public.scouts s3 where s3.person_id = p.id)
      limit 1;
    end if;

    if v_new_person_id is null then
      select sp.name, sp.email, sp.phone into v_rep
      from public.scout_parents sp
      where sp.person_id is not null
        and exists (select 1 from public.scouts s2 where s2.person_id = sp.person_id)
        and coalesce(nullif(lower(trim(sp.email)), ''), 'row:' || sp.id::text) = gk.gkey
      order by sp.id
      limit 1;

      insert into public.people (first_name, last_name, display_name, primary_email, primary_phone)
      values (
        nullif(split_part(trim(v_rep.name), ' ', 1), ''),
        nullif(trim(substring(trim(v_rep.name) from position(' ' in trim(v_rep.name)) + 1)), ''),
        trim(v_rep.name), nullif(lower(trim(v_rep.email)), ''), nullif(trim(v_rep.phone), '')
      )
      returning id into v_new_person_id;
    end if;

    -- Repoint EVERY scout_parents row in this email group — covers a parent
    -- with several children in one pass — and restore the household
    -- membership + parent_of edge for each of their linked scouts.
    for r in
      select sp.id as scout_parent_id, sp.relationship, s.person_id as scout_person_id, s.household_id
      from public.scout_parents sp
      join public.scouts s on s.id = sp.scout_id
      where sp.person_id is not null
        and exists (select 1 from public.scouts s2 where s2.person_id = sp.person_id)
        and coalesce(nullif(lower(trim(sp.email)), ''), 'row:' || sp.id::text) = gk.gkey
    loop
      update public.scout_parents set person_id = v_new_person_id where id = r.scout_parent_id;

      if r.household_id is not null then
        insert into public.household_members (household_id, person_id)
        values (r.household_id, v_new_person_id)
        on conflict do nothing;
      end if;

      insert into public.relationships (person_id, related_person_id, type, source_label)
      values (v_new_person_id, r.scout_person_id, 'parent_of', nullif(trim(r.relationship), ''))
      on conflict do nothing;

      v_fixed := v_fixed + 1;
    end loop;
  end loop;

  raise notice 'unmerge_parent_child_person_conflations: split % conflated scout_parents row(s)', v_fixed;
end $$;

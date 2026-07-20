-- Merging two person records, and bulk-accepting unambiguous import rows.
--
-- WHY (Patrick, 2026-07-20)
-- The spine backfill deliberately matches on exact email only, so it leaves
-- behind every duplicate that email cannot resolve — on production, 10 pairs
-- where the same human holds both a `leaders` record and a `scout_parents`
-- record with no email in common. Until those are merged, pointing
-- households.ts at person_id would list each of them TWICE in the family
-- signup picker, which is the exact bug this whole effort exists to end.
--
-- Merging is destructive in a way nothing else here is: it moves every link
-- off one person and onto another. So it happens in one transaction, and the
-- losing row is RETAINED with merged_into_person_id set rather than deleted —
-- a wrong merge stays visible and reversible instead of vanishing.

create or replace function public.merge_people(
  p_survivor bigint,
  p_loser bigint,
  p_decided_by text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_survivor people%rowtype;
  v_loser people%rowtype;
begin
  if p_survivor = p_loser then
    raise exception 'Cannot merge a person into themselves';
  end if;

  -- Locked so two reviewers cannot merge the same pair in opposite directions.
  select * into v_survivor from people where id = p_survivor for update;
  if not found then raise exception 'Person to keep not found'; end if;
  select * into v_loser from people where id = p_loser for update;
  if not found then raise exception 'Duplicate not found'; end if;

  if v_survivor.merged_into_person_id is not null then
    raise exception 'The person you are keeping has itself already been merged away';
  end if;
  if v_loser.merged_into_person_id is not null then
    raise exception 'That duplicate has already been merged';
  end if;

  -- Fill gaps only; never overwrite. The duplicate usually holds something the
  -- survivor lacks — a leaders row carries a BSA id and YPT date, a
  -- scout_parents row carries the email — and losing that on merge would make
  -- the merge itself destructive.
  update people set
    first_name    = coalesce(first_name, v_loser.first_name),
    last_name     = coalesce(last_name, v_loser.last_name),
    birthdate     = coalesce(birthdate, v_loser.birthdate),
    gender        = coalesce(gender, v_loser.gender),
    primary_email = coalesce(nullif(primary_email, ''), v_loser.primary_email),
    primary_phone = coalesce(nullif(primary_phone, ''), v_loser.primary_phone),
    bsa_member_id = coalesce(nullif(bsa_member_id, ''), v_loser.bsa_member_id),
    updated_at    = now()
  where id = p_survivor;

  update scouts        set person_id = p_survivor where person_id = p_loser;
  update leaders       set person_id = p_survivor where person_id = p_loser;
  update scout_parents set person_id = p_survivor where person_id = p_loser;

  insert into household_members (household_id, person_id, is_primary_contact)
  select hm.household_id, p_survivor, hm.is_primary_contact
  from household_members hm where hm.person_id = p_loser
  on conflict do nothing;
  delete from household_members where person_id = p_loser;

  -- One row per role on the survivor: a duplicate holding 'adult_leader' that
  -- the survivor already holds must not produce a second, and the partial
  -- unique index only guards CURRENT roles, so ended ones need this guard too.
  insert into person_roles (person_id, role, start_date, end_date, notes)
  select p_survivor, r.role, r.start_date, r.end_date, r.notes
  from person_roles r
  where r.person_id = p_loser
    and not exists (
      select 1 from person_roles x where x.person_id = p_survivor and x.role = r.role
    );
  delete from person_roles where person_id = p_loser;

  -- Relationship edges move in both directions. Anything that would point the
  -- survivor at themselves is dropped rather than moved: after a merge, "X is
  -- parent of X" is what a self-edge would mean, and the table forbids it.
  insert into relationships (person_id, related_person_id, type, is_guardian, source_label)
  select p_survivor, r.related_person_id, r.type, r.is_guardian, r.source_label
  from relationships r
  where r.person_id = p_loser and r.related_person_id <> p_survivor
  on conflict (person_id, related_person_id, type) do nothing;

  insert into relationships (person_id, related_person_id, type, is_guardian, source_label)
  select r.person_id, p_survivor, r.type, r.is_guardian, r.source_label
  from relationships r
  where r.related_person_id = p_loser and r.person_id <> p_survivor
  on conflict (person_id, related_person_id, type) do nothing;

  delete from relationships where person_id = p_loser or related_person_id = p_loser;

  -- Import suggestions pointing at the duplicate follow it, unless the same
  -- source row already has a suggestion for the survivor — unique
  -- (import_row_id, person_id) forbids the collision, so those are dropped.
  update merge_suggestions m set person_id = p_survivor
  where m.person_id = p_loser
    and not exists (
      select 1 from merge_suggestions m2
      where m2.import_row_id = m.import_row_id and m2.person_id = p_survivor
    );
  delete from merge_suggestions where person_id = p_loser and status = 'pending';

  update people set
    merged_into_person_id = p_survivor,
    notes = trim(coalesce(notes, '') || ' [merged into person ' || p_survivor
            || ' by ' || p_decided_by || ' on ' || now()::date || ']'),
    updated_at = now()
  where id = p_loser;
end;
$$;

-- ── Bulk accept ────────────────────────────────────────────────────────────
-- 59 of the 125 staged rows match on BSA id or corroborated email AND carry no
-- conflicting field. Clicking those one at a time is not review, it is fatigue
-- — and fatigue is what makes a reviewer rubber-stamp the 13 rows that DO need
-- judgement. This takes the unambiguous ones off the pile in a single action.
--
-- Deliberately excludes: name_only (the evidence class behind both duplicate
-- bugs), 'none' (creating people in bulk would bake in the matcher's own false
-- negatives, e.g. "Summer Curtis" who is already on record as "Summer Kimble"),
-- and anything with a conflict. Only 'fill' fields are taken, so nothing
-- already on record is overwritten.
create or replace function public.accept_clean_suggestions(
  p_batch_id bigint,
  p_decided_by text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_fields text[];
  n integer := 0;
begin
  for r in
    select s.id, s.field_changes
    from merge_suggestions s
    join import_rows ir on ir.id = s.import_row_id
    where ir.batch_id = p_batch_id
      and s.status = 'pending'
      and s.person_id is not null
      and s.confidence in ('bsa_member_id', 'email')
      and not exists (
        select 1 from jsonb_array_elements(s.field_changes) fc
        where fc->>'kind' = 'conflict'
      )
    order by s.id
  loop
    select coalesce(array_agg(fc->>'field'), '{}')
      into v_fields
    from jsonb_array_elements(r.field_changes) fc
    where fc->>'kind' = 'fill';

    perform accept_merge_suggestion(
      r.id, v_fields, p_decided_by,
      'Bulk accepted: strong evidence, no conflicting field'
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── Candidate detail for the merge screen ──────────────────────────────────
-- Each side with the counts a reviewer needs to choose which record survives:
-- the one carrying real links is almost always the one to keep.
create or replace view public.person_merge_candidate_detail as
select
  c.person_id, c.person_name, c.candidate_id, c.candidate_name, c.evidence,
  a.primary_email as person_email, b.primary_email as candidate_email,
  a.bsa_member_id as person_bsa,   b.bsa_member_id as candidate_bsa,
  (select count(*) from scouts s where s.person_id = c.person_id)
   + (select count(*) from leaders l where l.person_id = c.person_id)
   + (select count(*) from scout_parents sp where sp.person_id = c.person_id)  as person_links,
  (select count(*) from scouts s where s.person_id = c.candidate_id)
   + (select count(*) from leaders l where l.person_id = c.candidate_id)
   + (select count(*) from scout_parents sp where sp.person_id = c.candidate_id) as candidate_links,
  (select count(*) from relationships r
    where r.person_id = c.person_id or r.related_person_id = c.person_id)      as person_rels,
  (select count(*) from relationships r
    where r.person_id = c.candidate_id or r.related_person_id = c.candidate_id) as candidate_rels
from public.person_merge_candidates c
join public.people a on a.id = c.person_id
join public.people b on b.id = c.candidate_id;

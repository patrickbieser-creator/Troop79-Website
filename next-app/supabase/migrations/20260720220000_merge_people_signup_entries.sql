-- merge_people gains signup_entries — the one link it forgot to move.
--
-- WHY (qa-lead review, 2026-07-20)
-- merge_people reassigns person_id on scouts, leaders, scout_parents,
-- household_members, person_roles, relationships, and merge_suggestions —
-- but not signup_entries, because that column didn't exist when merge_people
-- was written earlier today. Left alone, this reopens D-042 through the
-- merge feature itself rather than the dual-legacy-column path it was fixed
-- for: a signup submitted before a merge keeps the LOSER's now-superseded
-- person_id forever (submit_household_signup's UPDATE branch never
-- overwrites an already-set person_id), so a later submission through the
-- SURVIVOR's identity resolves to a different person_id and matches none of
-- the old row's legacy columns either — producing a genuine duplicate
-- signup_entries row for one event, silently, well after the merge.
--
-- Existing merged people are NOT at risk from this gap: every past merge
-- happened before signup_entries.person_id existed, so today's backfill
-- (20260720190000) resolved through scouts/leaders/scout_parents.person_id,
-- which merge_people already keeps current. This closes the gap only for
-- FUTURE merges.
--
-- CONFLICT HANDLING: if both people already hold a live signup for the SAME
-- event, blind reassignment would violate signup_entries_person_uniq (or
-- silently drop one, if written as an upsert). That is a genuine "two
-- different reviews needed" situation — deciding which entry is correct
-- needs a human looking at both, not a merge script guessing. Block the
-- WHOLE merge with a clear error rather than resolving it silently; the
-- reviewer cancels the stale one via the existing Roster tools, then merges.

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
  v_conflict_event bigint;
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

  -- signup_entries: blocked, not silently resolved, if both sides already
  -- hold a live entry for the same event — see header comment.
  select se_loser.event_signup_id into v_conflict_event
  from signup_entries se_loser
  join signup_entries se_survivor
    on se_survivor.event_signup_id = se_loser.event_signup_id
   and se_survivor.person_id = p_survivor
   and se_survivor.status <> 'cancelled'
  where se_loser.person_id = p_loser
    and se_loser.status <> 'cancelled'
  limit 1;

  if v_conflict_event is not null then
    raise exception 'MERGE_BLOCKED_DUPLICATE_SIGNUP: both people already have a live signup for event_signup_id % — cancel one via the event Roster before merging', v_conflict_event;
  end if;

  update signup_entries set person_id = p_survivor, updated_at = now() where person_id = p_loser;

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

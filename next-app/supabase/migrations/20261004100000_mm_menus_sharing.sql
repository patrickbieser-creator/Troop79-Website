-- Menu Monster Phase 3: sharing menus with the troop, and a leader's review note
-- (Plans/Menu-Monster-Scout-Workspace.md, "Phase 3 design (2026-10-03 …)").
--
--   shared_at              set by the owner's Share with the troop, cleared by Stop
--                          sharing or a leader's Hide from the shelf. Re-sharing resets it.
--   review_note …          one note per menu from any admin viewer, replaced on save.
--
-- No indexes (≈30 scouts; the shelf query is small) and no copied_from_menu_id (the
-- audit row records a copy) — both trimmed in review.
--
-- DEPLOY ORDER: DB-first. Additive, nullable columns; merge_people body only.
-- Posture (D-239): mm_menus keeps RLS on with zero policies.

alter table public.mm_menus
  add column shared_at timestamptz,
  add column review_note text,
  add column reviewed_by_person_id bigint references public.people (id) on delete set null,
  add column reviewed_at timestamptz;

alter table public.mm_menus
  add constraint mm_menus_review_note_len_chk check (review_note is null or char_length(review_note) between 1 and 1000),
  add constraint mm_menus_review_pair_chk check ((review_note is null) = (reviewed_at is null));

-- ── merge_people: + mm_menus.reviewed_by_person_id ─────────────────────────
-- Body is the 20261003160000 definition plus the one line marked "Phase 3".


CREATE OR REPLACE FUNCTION public.merge_people(p_survivor bigint, p_loser bigint, p_decided_by text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_survivor people%rowtype;
  v_loser people%rowtype;
  v_conflict_event bigint;
begin
  if p_survivor = p_loser then
    raise exception 'Cannot merge a person into themselves';
  end if;

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

  -- Guest promotion (Plans/Guests-As-People.md): the merged identity is a
  -- member if either side was one.
  if v_survivor.guest_host_household_id is not null and v_loser.guest_host_household_id is null then
    update people set guest_host_household_id = null, updated_at = now() where id = p_survivor;
  end if;
  if v_loser.guest_host_household_id is not null then
    update people set guest_host_household_id = null where id = p_loser;
  end if;

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

  -- mm_*: Menu Monster workspace references (menus a scout owns, prices they
  -- reported or a leader decided, packages they added).
  update public.mm_menus set owner_person_id = p_survivor where owner_person_id = p_loser;
  update public.mm_price_history set reported_by_person_id = p_survivor where reported_by_person_id = p_loser;
  update public.mm_price_history set decided_by_person_id = p_survivor where decided_by_person_id = p_loser;
  update public.mm_packages set added_by_person_id = p_survivor where added_by_person_id = p_loser;
  -- Phase 4: recipes a scout wrote (the frozen credit text stays as it was).
  update public.mm_recipes set author_person_id = p_survivor where author_person_id = p_loser;
  -- Phase 4B: ingredients a scout typed in.
  update public.mm_ingredients set added_by_person_id = p_survivor where added_by_person_id = p_loser;
  -- Phase 3: the leader who left a menu its review note.
  update public.mm_menus set reviewed_by_person_id = p_survivor where reviewed_by_person_id = p_loser;
  update leaders        set person_id = p_survivor where person_id = p_loser;

  -- Addresses: the loser's person_emails move to the survivor. A duplicate
  -- address merges its flags; the loser's primary stays primary only if the
  -- survivor has none (the one-primary index forbids two).
  update public.person_emails surv
  set bounced_at = coalesce(surv.bounced_at, dup.bounced_at),
      unsubscribed_at = coalesce(surv.unsubscribed_at, dup.unsubscribed_at),
      verified_at = coalesce(surv.verified_at, dup.verified_at)
  from public.person_emails dup
  where surv.person_id = p_survivor and dup.person_id = p_loser
    and lower(trim(dup.email)) = lower(trim(surv.email));
  update public.person_emails pe
  set person_id = p_survivor,
      is_primary = pe.is_primary and not exists (
        select 1 from public.person_emails x where x.person_id = p_survivor and x.is_primary
      )
  where pe.person_id = p_loser
    and not exists (
      select 1 from public.person_emails x
      where x.person_id = p_survivor and lower(trim(x.email)) = lower(trim(pe.email))
    );
  delete from public.person_emails where person_id = p_loser;

  insert into household_members (household_id, person_id)
  select hm.household_id, p_survivor
  from household_members hm where hm.person_id = p_loser
  on conflict do nothing;
  delete from household_members where person_id = p_loser;

  insert into person_roles (person_id, role, start_date, end_date, notes)
  select p_survivor, r.role, r.start_date, r.end_date, r.notes
  from person_roles r
  where r.person_id = p_loser
    and not exists (
      select 1 from person_roles x where x.person_id = p_survivor and x.role = r.role
    );
  delete from person_roles where person_id = p_loser;

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

  update merge_suggestions m set person_id = p_survivor
  where m.person_id = p_loser
    and not exists (
      select 1 from merge_suggestions m2
      where m2.import_row_id = m.import_row_id and m2.person_id = p_survivor
    );
  delete from merge_suggestions where person_id = p_loser and status = 'pending';

  update people set
    merged_into_person_id = p_survivor,
    -- The loser is a retired identity: it must drop out of every
    -- active-filtered list (rosters, pickers, counts). Found 2026-08-26 —
    -- all 13 merged-away rows were still active.
    active = false,
    notes = trim(coalesce(notes, '') || ' [merged into person ' || p_survivor
            || ' by ' || p_decided_by || ' on ' || now()::date || ']'),
    updated_at = now()
  where id = p_loser;
end;
$function$;

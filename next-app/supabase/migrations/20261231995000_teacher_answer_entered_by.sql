-- A leader records a teacher's answer for them (Patrick, 2026-11-01: "they texted me they're coming, no time to
-- click"). meeting_teacher_answers gains entered_by_person_id: null = the person answered themselves; set = the
-- editor who entered it on the planner. Their own later answer replaces it (the app writes null).
--
-- 1. The column (nullable, references people; additive).
-- 2. merge_people: 20261231990000's body with the answer's entered_by carried on the loser's rows, and the survivor
--    becoming whoever entered an answer the loser did. Nothing else changes.
-- 3. meeting_invites: a reminder has no token, every other invite has one. 20261231990000 dropped page_id, and with it
--    meeting_invites_token_or_page (the check named the column), so nothing was checking this. NOT VALID: new rows are
--    checked; the one teach invite left from a test teach page (no token, its page gone) stays as it is.
--
-- DEPLOY ORDER: DB-first (additive; the old app writes no column and reads none).

-- ── 1. the column ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.meeting_teacher_answers add column if not exists entered_by_person_id bigint references public.people(id);

-- ── 2. merge_people ───────────────────────────────────────────────────────────────────────────────────────────────
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
  -- Planned by: the survivor inherits the loser's planner rows (a menu both planned keeps one).
  update public.mm_menu_planners p set person_id = p_survivor
  where p.person_id = p_loser
    and not exists (select 1 from public.mm_menu_planners x where x.menu_id = p.menu_id and x.person_id = p_survivor);
  delete from public.mm_menu_planners where person_id = p_loser;
  -- Teaching (Phase 0a): the survivor keeps every skill and counselor badge either side had.
  insert into public.teaching_skills (person_id, skill_id, authorized_by, authorized_at)
  select p_survivor, t.skill_id, t.authorized_by, t.authorized_at from public.teaching_skills t where t.person_id = p_loser
  on conflict do nothing;
  delete from public.teaching_skills where person_id = p_loser;
  insert into public.merit_badge_counselors (mb_id, person_id, leader_code, sort_order)
  select m.mb_id, p_survivor, null, m.sort_order from public.merit_badge_counselors m where m.person_id = p_loser
  on conflict do nothing;
  delete from public.merit_badge_counselors where person_id = p_loser;
  -- Meeting board (Phase 1): the survivor keeps every pick, pick list and answer either side had (a board both used
  -- keeps the survivor's), and becomes whoever entered the loser's rows. The survivor may end up over 5 picks on a
  -- board: accepted (rare, harmless; the cap applies to the next add).
  insert into public.meeting_pick_lists (calendar_entry_id, person_id, created_at)
  select l.calendar_entry_id, p_survivor, l.created_at from public.meeting_pick_lists l where l.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_pick_lists where person_id = p_loser;
  insert into public.meeting_topic_picks (topic_id, calendar_entry_id, person_id, priority, first_asked_on, note, later, entered_by_person_id, created_at, updated_at)
  select k.topic_id, k.calendar_entry_id, p_survivor, k.priority, k.first_asked_on, k.note, k.later, k.entered_by_person_id, k.created_at, k.updated_at
    from public.meeting_topic_picks k where k.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_topic_picks where person_id = p_loser;
  insert into public.meeting_intents (calendar_entry_id, person_id, intent, entered_by_person_id, updated_at)
  select i.calendar_entry_id, p_survivor, i.intent, i.entered_by_person_id, i.updated_at from public.meeting_intents i where i.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_intents where person_id = p_loser;
  update public.meeting_topic_picks set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  update public.meeting_intents set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Teacher board (Phase 2): the survivor keeps every commitment and skill offer either side had (a topic or skill both
  -- signed up for keeps the survivor's row), and becomes whoever entered the loser's rows. The survivor may end up over
  -- 2 on a meeting: accepted (rare, harmless; the cap applies to the next add).
  insert into public.meeting_topic_teachers (topic_id, calendar_entry_id, person_id, note, entered_by_person_id, created_at, updated_at, for_picks)
  select t.topic_id, t.calendar_entry_id, p_survivor, t.note, t.entered_by_person_id, t.created_at, t.updated_at, t.for_picks
    from public.meeting_topic_teachers t where t.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_topic_teachers where person_id = p_loser;
  insert into public.meeting_teaching_offers (calendar_entry_id, person_id, skill_id, note, entered_by_person_id, created_at, updated_at)
  select o.calendar_entry_id, p_survivor, o.skill_id, o.note, o.entered_by_person_id, o.created_at, o.updated_at
    from public.meeting_teaching_offers o where o.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_teaching_offers where person_id = p_loser;
  update public.meeting_topic_teachers set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  update public.meeting_teaching_offers set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Wreath sale (W-1): the survivor becomes the last editor of any order note the loser saved.
  update public.wreath_orders set order_note_updated_by_person_id = p_survivor where order_note_updated_by_person_id = p_loser;
  -- Meeting Planner P3: the survivor becomes whoever seeded a topic or created a focus set the loser did.
  update public.meeting_topics set seeded_by_person_id = p_survivor where seeded_by_person_id = p_loser;
  update public.focus_sets set created_by_person_id = p_survivor where created_by_person_id = p_loser;
  update public.meeting_saved_plans set created_by_person_id = p_survivor where created_by_person_id = p_loser;
  -- Split groups (S2): the survivor becomes whoever last changed a split the loser did.
  update public.meeting_group_splits set updated_by_person_id = p_survivor where updated_by_person_id = p_loser;
  -- Answers (Confirmations C1): the survivor keeps every answer either side gave (a card both answered keeps the
  -- survivor's).
  insert into public.meeting_teacher_answers (calendar_entry_id, person_id, group_key, answer, note, answered_at, answered_plan, entered_by_person_id)
  select a.calendar_entry_id, p_survivor, a.group_key, a.answer, a.note, a.answered_at, a.answered_plan, a.entered_by_person_id from public.meeting_teacher_answers a where a.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_teacher_answers where person_id = p_loser;
  update public.meeting_teacher_answers set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  insert into public.meeting_scout_answers (calendar_entry_id, person_id, answered_at, answered_plan)
  select a.calendar_entry_id, p_survivor, a.answered_at, a.answered_plan from public.meeting_scout_answers a where a.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_scout_answers where person_id = p_loser;
  -- Meeting Live attendance (P4c): the survivor keeps every event either side attended (an event both attended keeps
  -- the survivor's row). Ledger credit is keyed by scout and needs no move.
  insert into public.event_attendance (calendar_entry_id, person_id, qty, source, note, recorded_by, recorded_at)
  select a.calendar_entry_id, p_survivor, a.qty, a.source, a.note, a.recorded_by, a.recorded_at
    from public.event_attendance a where a.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.event_attendance where person_id = p_loser;
  -- Meeting Live draft presence (B8): the survivor keeps every draft tick either side had (a meeting both were ticked
  -- at keeps the survivor's row), and becomes whoever entered the loser's ticks.
  insert into public.meeting_live_presence (calendar_entry_id, person_id, present, entered_by_person_id, updated_at)
  select lp.calendar_entry_id, p_survivor, lp.present, lp.entered_by_person_id, lp.updated_at
    from public.meeting_live_presence lp where lp.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.meeting_live_presence where person_id = p_loser;
  update public.meeting_live_presence set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Talent discovery (B10c): the survivor keeps every active interest either side had. A key both hold keeps the
  -- survivor's row; the loser's duplicate is dropped. Removed rows (history) move as they are.
  delete from public.teaching_interests l
   where l.person_id = p_loser and l.removed_at is null
     and exists (select 1 from public.teaching_interests s where s.person_id = p_survivor and s.topic_key = l.topic_key and s.removed_at is null);
  update public.teaching_interests set person_id = p_survivor where person_id = p_loser;
  -- Meeting Planner III (P2): the loser's hand choices become the survivor's (a meeting both had a choice at keeps the
  -- survivor's), and the survivor becomes whoever set a choice or added a night's badge.
  insert into public.meeting_scout_roles (calendar_entry_id, person_id, role, ref_key, set_by_person_id, set_at)
  select r.calendar_entry_id, p_survivor, r.role, r.ref_key, r.set_by_person_id, r.set_at
    from public.meeting_scout_roles r where r.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.meeting_scout_roles where person_id = p_loser;
  update public.meeting_scout_roles set set_by_person_id = p_survivor where set_by_person_id = p_loser;
  -- Meeting Planner III Emails (E1): a family's unticks, suggestions and helper answers become the survivor's (a key
  -- or meeting both had keeps the survivor's), the survivor becomes whoever set them, and the email log follows.
  insert into public.meeting_scout_exclusions (calendar_entry_id, person_id, topic_key, set_by_person_id, set_at)
  select x.calendar_entry_id, p_survivor, x.topic_key, x.set_by_person_id, x.set_at
    from public.meeting_scout_exclusions x where x.person_id = p_loser
  on conflict (calendar_entry_id, person_id, topic_key) do nothing;
  delete from public.meeting_scout_exclusions where person_id = p_loser;
  update public.meeting_scout_exclusions set set_by_person_id = p_survivor where set_by_person_id = p_loser;
  insert into public.meeting_scout_suggestions (calendar_entry_id, person_id, topic_key, suggested_by_person_id, created_at)
  select x.calendar_entry_id, p_survivor, x.topic_key, x.suggested_by_person_id, x.created_at
    from public.meeting_scout_suggestions x where x.person_id = p_loser
  on conflict (calendar_entry_id, person_id, topic_key) do nothing;
  delete from public.meeting_scout_suggestions where person_id = p_loser;
  update public.meeting_scout_suggestions set suggested_by_person_id = p_survivor where suggested_by_person_id = p_loser;
  insert into public.meeting_scout_helpers (calendar_entry_id, person_id, group_key, set_by_person_id, set_at)
  select h.calendar_entry_id, p_survivor, h.group_key, h.set_by_person_id, h.set_at
    from public.meeting_scout_helpers h where h.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.meeting_scout_helpers where person_id = p_loser;
  update public.meeting_scout_helpers set set_by_person_id = p_survivor where set_by_person_id = p_loser;
  update public.meeting_emails set recipient_person_id = p_survivor where recipient_person_id = p_loser;
  update public.meeting_emails set queued_by_person_id = p_survivor where queued_by_person_id = p_loser;
  update public.meeting_emails
     set about = jsonb_set(about, '{scouts}', (
           select coalesce(jsonb_agg(distinct case when s::bigint = p_loser then p_survivor else s::bigint end), '[]'::jsonb)
             from jsonb_array_elements_text(about->'scouts') s))
   where about ? 'scouts' and about->'scouts' @> to_jsonb(p_loser);
  update public.meeting_night_badges set added_by_person_id = p_survivor where added_by_person_id = p_loser;
  -- A family link keeps working for the survivor only if it was the loser's live epoch; its scouts follow the merge.
  update public.meeting_plan_pages pg
     set recipient_person_id = p_survivor,
         recipient_epoch = case when pg.recipient_epoch = v_loser.session_epoch then v_survivor.session_epoch else pg.recipient_epoch end
   where pg.recipient_person_id = p_loser;
  update public.meeting_plan_pages
     set scout_person_ids = array(select distinct unnest(array_replace(scout_person_ids, p_loser, p_survivor)))
   where p_loser = any (scout_person_ids);
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

revoke all on function public.merge_people(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.merge_people(bigint, bigint, text) to service_role;

-- ── 3. invite tokens by kind ──────────────────────────────────────────────────────────────────────────────────────
alter table public.meeting_invites drop constraint if exists meeting_invites_token_by_kind;
alter table public.meeting_invites
  add constraint meeting_invites_token_by_kind check (case kind when 'remind' then token_hash is null else token_hash is not null end) not valid;

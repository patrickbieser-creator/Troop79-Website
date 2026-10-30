-- Meeting Planner III: saved meeting plans (Patrick, 2026-10-29). A plan's CRITERIA, saved under a name and a date, to
-- load onto another meeting later: the focus sets (each as its set id, title and items, so a focus whose set was
-- deleted, or was edited for that meeting only, still comes back), the planner-added requirements and the night's
-- merit badges. Never scouts, teachers, roles or answers.
--
-- 1. meeting_saved_plans: name (1-80), plan_date, criteria jsonb {focus:[{setId,title,items}], singles:[], badges:[]}.
-- 2. meeting_load_saved_plan(p_entry, p_plan, p_actor): REPLACES the meeting's focus, planner-added requirements and
--    night badges with the saved ones, in one transaction under the meeting's seed lock. What goes is unseeded the usual
--    way (a topic with picks or teachers stays, unseeded); a focus whose set is gone comes back as a new set
--    (meeting_new_mix) and the saved plan is pointed at it; a saved badge no longer in the catalog is skipped.
-- 3. merge_people: + meeting_saved_plans.created_by_person_id (20261231400000's body otherwise).
--
-- DEPLOY ORDER: DB-first (additive). Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or
-- authenticated; functions invoker with search_path pinned, EXECUTE to service_role only.

-- ── 1. the table ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_saved_plans (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  plan_date date not null,
  criteria jsonb not null check (jsonb_typeof(criteria) = 'object'),
  created_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meeting_saved_plans_created_by_idx on public.meeting_saved_plans (created_by_person_id) where created_by_person_id is not null;
alter table public.meeting_saved_plans enable row level security;
revoke all on public.meeting_saved_plans from anon, authenticated;

-- ── 2. load one onto a meeting ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.meeting_load_saved_plan(p_entry bigint, p_plan bigint, p_actor bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c jsonb;
  f jsonb;
  v_set bigint;
  v_items text[];
  v_title text;
  v_wanted text[] := '{}';
  v_badges text[];
  v_singles jsonb;
  v_i bigint;
  v_new bigint;
  r record;
begin
  perform public._meeting_seed_guard(p_entry);
  select criteria into c from meeting_saved_plans where id = p_plan;
  if c is null then raise exception 'That saved plan no longer exists.'; end if;
  v_singles := coalesce(c->'singles', '[]'::jsonb);
  v_badges := array(select jsonb_array_elements_text(coalesce(c->'badges', '[]'::jsonb)));
  -- What stays: each saved focus whose set still exists, and each saved requirement.
  for f in select * from jsonb_array_elements(coalesce(c->'focus', '[]'::jsonb)) loop
    v_set := nullif(f->>'setId', '')::bigint;
    if v_set is not null and exists (select 1 from focus_sets where id = v_set) then v_wanted := v_wanted || ('fg:' || v_set); end if;
  end loop;
  v_wanted := v_wanted || array(select jsonb_array_elements_text(v_singles));
  -- Out with the rest of the focus and the planner-added requirements.
  for r in select topic_key from meeting_topics where calendar_entry_id = p_entry and seeded_at is not null and kind in ('focus_group', 'rank_req', 'mb_req') loop
    if not (r.topic_key = any(v_wanted)) then perform public.meeting_unseed_topic(p_entry, r.topic_key); end if;
  end loop;
  delete from meeting_night_badges where calendar_entry_id = p_entry and not (mb_id = any(v_badges));
  insert into meeting_night_badges (calendar_entry_id, mb_id, added_by_person_id)
  select p_entry, b, p_actor from unnest(v_badges) b where exists (select 1 from merit_badges m where m.id = b)
  on conflict (calendar_entry_id, mb_id) do nothing;
  -- In with the saved focus: its own set when it still exists (with the saved items and title if they differ), else a
  -- new set made from what was saved.
  for f, v_i in select e, o from jsonb_array_elements(coalesce(c->'focus', '[]'::jsonb)) with ordinality x(e, o) loop
    v_set := nullif(f->>'setId', '')::bigint;
    v_title := coalesce(nullif(btrim(f->>'title'), ''), 'Focus');
    v_items := array(select jsonb_array_elements_text(coalesce(f->'items', '[]'::jsonb)));
    if cardinality(v_items) = 0 then continue; end if;
    if v_set is not null and exists (select 1 from focus_sets where id = v_set) then
      perform public.meeting_seed_focus_set(p_entry, v_set, p_actor);
      if v_items is distinct from array(
           select m.item_key from meeting_topic_members m join meeting_topics t on t.id = m.topic_id
            where t.calendar_entry_id = p_entry and t.topic_key = 'fg:' || v_set order by m.position)
         or v_title is distinct from (select title from meeting_topics where calendar_entry_id = p_entry and topic_key = 'fg:' || v_set) then
        perform public.meeting_edit_mix(p_entry, v_set, v_title, v_items, p_actor, false);
      end if;
    else
      -- The set is gone: a new one from what was saved, and the saved plan points at it from now on (no duplicate
      -- set on the next load).
      v_new := public.meeting_new_mix(p_entry, v_title, v_items, p_actor);
      update meeting_saved_plans set criteria = jsonb_set(criteria, array['focus', (v_i - 1)::text, 'setId'], to_jsonb(v_new)) where id = p_plan;
    end if;
  end loop;
  if jsonb_array_length(v_singles) > 0 then perform public.meeting_seed_many(p_entry, v_singles, p_actor); end if;
end;
$$;

-- ── 3. merge_people, + saved plans ────────────────────────────────────────────────────────────────────────────────
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
  -- Teacher answer pages (B10b): the loser's pages and the teach rows on them become the survivor's. A page still
  -- open takes the survivor's session_epoch, so the link already in the (now the survivor's) inbox keeps working;
  -- a page already voided by a sign-out-everywhere stays void (its open rows were consumed then).
  update public.meeting_invite_pages pg
     set recipient_person_id = p_survivor,
         recipient_epoch = case when pg.recipient_epoch = v_loser.session_epoch then v_survivor.session_epoch else pg.recipient_epoch end
   where pg.recipient_person_id = p_loser;
  update public.meeting_invites mi
     set invitee_person_id = case when mi.invitee_person_id = p_loser then p_survivor else mi.invitee_person_id end,
         recipient_person_id = case when mi.recipient_person_id = p_loser then p_survivor else mi.recipient_person_id end,
         invitee_epoch = case when mi.invitee_person_id = p_loser and mi.invitee_epoch = v_loser.session_epoch then v_survivor.session_epoch else mi.invitee_epoch end,
         recipient_epoch = case when mi.recipient_person_id = p_loser and mi.recipient_epoch = v_loser.session_epoch then v_survivor.session_epoch else mi.recipient_epoch end
   where mi.page_id is not null and (mi.invitee_person_id = p_loser or mi.recipient_person_id = p_loser);
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

revoke all on function public.meeting_load_saved_plan(bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.meeting_load_saved_plan(bigint, bigint, bigint) to service_role;
revoke all on function public.merge_people(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.merge_people(bigint, bigint, text) to service_role;

-- Meeting Planner III, Emails E1: the email log and send queue, and what a family's answer writes
-- (Plans/Meeting-Planner-III-Emails.md, Technical Approach 2-6 and 10, with tech-lead's review folded in).
--
-- 1. meeting_emails: one row per email about a meeting (a household's plan email, a teacher invite, a reminder). A
--    Send queues every row first; the open page then sends them one at a time (meeting_email_claim). Status:
--      queued → sending → sent | failed | unknown
--    'unknown' = the send timed out, or a claim went stale: Resend may still have delivered it. A retry sends the same
--    row with the same Resend Idempotency-Key, so it can't arrive twice. plan_sent keeps each scout's plan exactly as
--    emailed (the "Plan changed since sent" flag compares it with the planner-side plan). body_md_override = "Edit this
--    email". delivery_status / delivered_at / opened_at come from Resend's webhook, and only ever move forward.
-- 2. meeting_scout_exclusions: a family unticked a planned requirement. It applies at once: placement leaves that
--    requirement out of the scout's plan. A key no longer in the plan is ignored, then pruned by the app.
-- 3. meeting_scout_suggestions: something a family added. Only a flag for the planners, never a placement; at most
--    p_cap (SUGGESTION_CAP, 5) per scout, counted under the scout's board lock.
-- 4. meeting_scout_helpers: a Merit badge scout's "help teach": listed under that group as a helper, not a teacher.
--    Its own table, because meeting_scout_roles holds one hand choice per scout (tech-lead #4).
-- 5. meeting_invites.decline_note: a teacher's optional note with "Not this week" (240 characters, 3 lines).
-- 6. meeting_plan_pages.snapshot_n: nullable. A family link minted by the Emails screen belongs to no snapshot.
-- 7. meeting_board_stamp: + exclusions, suggestions, helpers and emails, so This week refreshes when a family answers.
-- 8. merge_people: + the three new per-scout tables and the email log (production's body, only those lines added).
--
-- DEPLOY ORDER: DB-first. Additive only (a nullable column, new tables, a wider stamp); production's code keeps
-- working. Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or authenticated; functions invoker
-- with search_path pinned, EXECUTE to service_role only (merge_people stays as it was: definer).

-- ── 1. the email log ──────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_emails (
  id bigint generated always as identity primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  kind text not null check (kind in ('plan', 'teacher', 'reminder')),
  batch_id uuid not null,
  recipient_person_id bigint references public.people(id) on delete set null,
  sent_to text not null check (char_length(sent_to) between 3 and 320),
  -- {"scouts":[ids]} for a plan or reminder; {"group":"fr:…"} for a teacher invite.
  about jsonb not null default '{}'::jsonb,
  -- Each scout's plan as emailed: {"<personId>":{"group":"fr:…","items":["…"]}}.
  plan_sent jsonb,
  subject text,
  body_md_override text check (body_md_override is null or char_length(body_md_override) <= 8000),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'unknown')),
  failure text check (failure is null or char_length(failure) <= 500),
  claimed_at timestamptz,
  resend_id text,
  -- What the dev relay rewrote the address to (EMAIL_REDIRECT_TO), so the log never claims a family got it.
  delivered_to text,
  queued_by_person_id bigint references public.people(id) on delete set null,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivery_status text check (delivery_status in ('delivered', 'bounced', 'complained')),
  delivered_at timestamptz,
  opened_at timestamptz,
  constraint meeting_emails_claimed check (status <> 'sending' or claimed_at is not null)
);
create index if not exists meeting_emails_entry_idx on public.meeting_emails (calendar_entry_id, queued_at desc);
create index if not exists meeting_emails_batch_idx on public.meeting_emails (batch_id) where status in ('queued', 'sending');
create unique index if not exists meeting_emails_resend_idx on public.meeting_emails (resend_id) where resend_id is not null;
create index if not exists meeting_emails_recipient_idx on public.meeting_emails (recipient_person_id) where recipient_person_id is not null;
create index if not exists meeting_emails_queued_by_idx on public.meeting_emails (queued_by_person_id) where queued_by_person_id is not null;
alter table public.meeting_emails enable row level security;
revoke all on public.meeting_emails from anon, authenticated;

-- The next queued email of a batch, claimed for one sender: queued → sending, stamped. skip locked, so two tabs
-- sending the same batch each get a different row and never the same one. A 'sending' row whose claim is older than
-- p_stale_seconds turns 'unknown' first (the sender died mid-send; Resend may have it). p_stale_seconds must stay
-- above the send route's maxDuration (60 s).
create or replace function public.meeting_email_claim(p_batch uuid, p_entry bigint, p_stale_seconds integer)
returns table (email_id bigint, claimed_at timestamptz)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_at timestamptz := clock_timestamp();
begin
  update meeting_emails e set status = 'unknown', failure = 'The send didn’t report back. Check before sending again.'
   where e.batch_id = p_batch and e.calendar_entry_id = p_entry and e.status = 'sending'
     and e.claimed_at < v_at - make_interval(secs => p_stale_seconds);
  select e.id into v_id from meeting_emails e
   where e.batch_id = p_batch and e.calendar_entry_id = p_entry and e.status = 'queued'
   order by e.id
   limit 1
   for update skip locked;
  if v_id is null then return; end if;
  update meeting_emails e set status = 'sending', claimed_at = v_at where e.id = v_id;
  return query select v_id, v_at;
end;
$$;

-- ── 2. a family's unticks ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_scout_exclusions (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  topic_key text not null check (char_length(topic_key) between 1 and 200),
  set_by_person_id bigint references public.people(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (calendar_entry_id, person_id, topic_key)
);
create index if not exists meeting_scout_exclusions_person_idx on public.meeting_scout_exclusions (person_id);
create index if not exists meeting_scout_exclusions_set_by_idx on public.meeting_scout_exclusions (set_by_person_id) where set_by_person_id is not null;
alter table public.meeting_scout_exclusions enable row level security;
revoke all on public.meeting_scout_exclusions from anon, authenticated;

-- ── 3. a family's suggestions ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_scout_suggestions (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  topic_key text not null check (char_length(topic_key) between 1 and 200),
  suggested_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (calendar_entry_id, person_id, topic_key)
);
create index if not exists meeting_scout_suggestions_person_idx on public.meeting_scout_suggestions (person_id);
create index if not exists meeting_scout_suggestions_by_idx on public.meeting_scout_suggestions (suggested_by_person_id) where suggested_by_person_id is not null;
alter table public.meeting_scout_suggestions enable row level security;
revoke all on public.meeting_scout_suggestions from anon, authenticated;

-- A suggestion, with the cap counted under the scout's board lock (the lock the pick writers take), so two taps at
-- once can't both pass. Adding one already there is a no-op.
create or replace function public.meeting_add_suggestion_capped(
  p_entry bigint, p_person bigint, p_actor bigint, p_topic_key text, p_cap integer
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
  if exists (select 1 from meeting_scout_suggestions where calendar_entry_id = p_entry and person_id = p_person and topic_key = p_topic_key) then
    return;
  end if;
  select count(*) into v_n from meeting_scout_suggestions where calendar_entry_id = p_entry and person_id = p_person;
  if v_n >= p_cap then
    raise exception 'Suggest up to % things. Remove one first.', p_cap;
  end if;
  insert into meeting_scout_suggestions (calendar_entry_id, person_id, topic_key, suggested_by_person_id)
  values (p_entry, p_person, p_topic_key, p_actor);
end;
$$;

-- ── 4. helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_scout_helpers (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  group_key text not null check (group_key like 'fr:%'),
  set_by_person_id bigint references public.people(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (calendar_entry_id, person_id)
);
create index if not exists meeting_scout_helpers_person_idx on public.meeting_scout_helpers (person_id);
create index if not exists meeting_scout_helpers_set_by_idx on public.meeting_scout_helpers (set_by_person_id) where set_by_person_id is not null;
alter table public.meeting_scout_helpers enable row level security;
revoke all on public.meeting_scout_helpers from anon, authenticated;

-- ── 5. a teacher's note ───────────────────────────────────────────────────────────────────────────────────────────
alter table public.meeting_invites add column if not exists decline_note text;
alter table public.meeting_invites drop constraint if exists meeting_invites_decline_note_check;
alter table public.meeting_invites add constraint meeting_invites_decline_note_check check (
  decline_note is null or (char_length(decline_note) <= 240 and array_length(string_to_array(decline_note, E'\n'), 1) <= 3)
);

-- ── 6. links from the Emails screen ───────────────────────────────────────────────────────────────────────────────
alter table public.meeting_plan_pages alter column snapshot_n drop not null;

-- ── 7. the board stamp: + exclusions, suggestions, helpers, emails ────────────────────────────────────────────────
create or replace function public.meeting_board_stamp(p_entry bigint) returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select concat_ws(':',
    (select count(*) from meeting_topic_picks where calendar_entry_id = p_entry),
    (select count(*) from meeting_intents where calendar_entry_id = p_entry),
    (select count(*) from meeting_pick_lists where calendar_entry_id = p_entry),
    (select count(*) from meeting_topic_teachers where calendar_entry_id = p_entry),
    (select count(*) from meeting_teaching_offers where calendar_entry_id = p_entry),
    (select count(*) from meeting_topics where calendar_entry_id = p_entry and seeded_at is not null),
    (select count(*) from event_attendance where calendar_entry_id = p_entry),
    (select count(*) from meeting_scout_roles where calendar_entry_id = p_entry),
    (select count(*) from meeting_night_badges where calendar_entry_id = p_entry),
    (select count(*) from meeting_plan_snapshots where calendar_entry_id = p_entry),
    (select count(*) from meeting_live_presence where calendar_entry_id = p_entry and present),
    (select count(*) from meeting_scout_exclusions where calendar_entry_id = p_entry),
    (select count(*) from meeting_scout_suggestions where calendar_entry_id = p_entry),
    (select count(*) from meeting_scout_helpers where calendar_entry_id = p_entry),
    (select count(*) from meeting_emails where calendar_entry_id = p_entry and status = 'sent'),
    (select coalesce(extract(epoch from greatest(
        (select max(updated_at) from meeting_topic_picks where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_intents where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_pick_lists where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_topic_teachers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_teaching_offers where calendar_entry_id = p_entry),
        (select max(seeded_at) from meeting_topics where calendar_entry_id = p_entry),
        (select max(recorded_at) from event_attendance where calendar_entry_id = p_entry),
        (select updated_at from meeting_boards where calendar_entry_id = p_entry),
        (select max(set_at) from meeting_scout_roles where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_night_badges where calendar_entry_id = p_entry),
        (select max(published_at) from meeting_plan_snapshots where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_live_presence where calendar_entry_id = p_entry),
        (select max(set_at) from meeting_scout_exclusions where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_scout_suggestions where calendar_entry_id = p_entry),
        (select max(set_at) from meeting_scout_helpers where calendar_entry_id = p_entry),
        (select max(sent_at) from meeting_emails where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
$$;

-- ── 8. merge_people: + exclusions, suggestions, helpers and the email log (20261229100000's body otherwise) ─────────
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
  update public.meeting_plan_snapshots set published_by_person_id = p_survivor where published_by_person_id = p_loser;
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


revoke all on function public.meeting_email_claim(uuid, bigint, integer) from public, anon, authenticated;
grant execute on function public.meeting_email_claim(uuid, bigint, integer) to service_role;
revoke all on function public.meeting_add_suggestion_capped(bigint, bigint, bigint, text, integer) from public, anon, authenticated;
grant execute on function public.meeting_add_suggestion_capped(bigint, bigint, bigint, text, integer) to service_role;
revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
grant execute on function public.meeting_board_stamp(bigint) to service_role;
revoke all on function public.merge_people(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.merge_people(bigint, bigint, text) to service_role;

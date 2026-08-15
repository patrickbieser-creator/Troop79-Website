-- D-066: retire scout_parents and the legacy signup_entries identity columns.
--
-- Held since 2026-07-25 for a soak on the person_id re-key (D-065) and because
-- three fields on scout_parents had no home anywhere else. Re-audited
-- 2026-08-15 before dropping, and the picture had changed:
--
--   address   SAFE   — backfilled onto people in D-066; 0 rows at risk.
--   phone     SAFE   — the 2 apparent misses are the SAME numbers, formatted
--                      better on people ('(414) 554-0067' vs '414-554-0067').
--   email     SAFE   — the 5 apparent misses are all on people.primary_email;
--                      only their scout_parent_emails row is absent.
--   relationship  NOT SAFE — 11 of 36 rows would have lost their word.
--
-- D-066 recorded relationship as "already safe — duplicated into
-- relationships.source_label". That is true only loosely: source_label holds
-- the RAW import string ('Mom Melissa Kingston / Dad Kevin', 'Maya & Anjali',
-- and 3 nulls), while the normalised word families actually see on /profile
-- and in the signup party list ('Mom', 'Dad') lives only here. So this
-- migration gives that word a real home first, then drops.
--
-- What this changes for callers, all of it deliberate:
--   * add_parent_to_household now returns people.id, NOT scout_parents.id, and
--     no longer requires the household to contain a scout. That second part
--     retires HOUSEHOLD_HAS_NO_SCOUTS, which was blocking /profile's add-member
--     form for any family whose scouts had aged out.
--   * cancel_party_signup loses its three legacy id array parameters.
--   * submit_household_signup requires person_id on every entry.

begin;

-- ── 1. Give the relationship word somewhere to live ────────────────────────
--
-- Distinct from source_label, which stays as-is: source_label is the raw text
-- an import produced and is worth keeping as provenance, role_label is the
-- normalised family word meant for display.
alter table public.relationships add column if not exists role_label text;

comment on column public.relationships.role_label is
  'Normalised family word for display — Mom, Dad, Grandparent. Migrated from '
  'scout_parents.relationship when that table was retired (D-066). Distinct '
  'from source_label, which keeps the raw text an import produced.';

-- Backfill: match the adult to the scout they hold the parent row for, so an
-- adult who is "Mom" to one scout and "Stepmom" to another keeps both. Lowest
-- scout_parents.id wins per pair, matching how households.ts already chose
-- between sibling rows.
update public.relationships r
   set role_label = src.relationship
  from (
    select distinct on (sp.person_id, s.person_id)
           sp.person_id      as adult_person_id,
           s.person_id       as scout_person_id,
           nullif(trim(sp.relationship), '') as relationship
      from public.scout_parents sp
      join public.scouts s on s.id = sp.scout_id
     where sp.person_id is not null
       and s.person_id is not null
       and nullif(trim(sp.relationship), '') is not null
     order by sp.person_id, s.person_id, sp.id
  ) src
 where r.person_id = src.adult_person_id
   and r.related_person_id = src.scout_person_id
   and r.role_label is null;

-- Any adult whose parent row pointed at a scout with no person row, or whose
-- relationships row is missing, still keeps the word at person level rather
-- than losing it outright.
update public.people p
   set notes = coalesce(nullif(trim(p.notes), '') || ' | ', '')
               || 'relationship (migrated): ' || src.relationship
  from (
    select distinct on (sp.person_id)
           sp.person_id, nullif(trim(sp.relationship), '') as relationship
      from public.scout_parents sp
     where sp.person_id is not null
       and nullif(trim(sp.relationship), '') is not null
     order by sp.person_id, sp.id
  ) src
 where p.id = src.person_id
   and not exists (
     select 1 from public.relationships r
      where r.person_id = src.person_id and r.role_label is not null
   );

-- Prove the backfill actually matched something, WHILE scout_parents still
-- exists to be compared against. A backfill that silently matched nothing is
-- the failure worth catching here rather than in production a week later.
--
-- Guarded on v_src > 0 so this stays true on an empty database: `supabase db
-- reset` and any fresh clone run every migration against no data at all, and
-- an unconditional assertion would abort the rebuild for every developer.
do $$
declare v_src int; v_done int;
begin
  select count(*) into v_src
    from public.scout_parents
   where person_id is not null and nullif(trim(relationship), '') is not null;

  select count(*) into v_done from public.relationships where role_label is not null;

  raise notice 'D-066: % source relationship words, % role_labels written', v_src, v_done;

  if v_src > 0 and v_done = 0 then
    raise exception 'D-066 backfill matched nothing (% source rows) — refusing to drop', v_src;
  end if;
end $$;

-- ── 2. add_parent_to_household: a person, not a parent row ─────────────────
--
-- Returns people.id now. The old return was scout_parents.id, which every
-- caller immediately traded for a person_id anyway (/profile did a second
-- SELECT to get one), so this removes a round-trip as well as the table.
--
-- The scout lookup is gone from the required path. It existed only to fill
-- scout_parents.scout_id; with that column retired, a household with no scouts
-- can finally add an adult — the HOUSEHOLD_HAS_NO_SCOUTS error is retired with
-- it. A scout is still looked up opportunistically, because the parent_of
-- relationship needs one, and that link is worth keeping when it's available.
create or replace function public.add_parent_to_household(
  p_household_id bigint,
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_relationship text default null
) returns bigint
language plpgsql
as $function$
declare
  v_scout_person_id bigint;
  v_person_id bigint;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_rel text := nullif(trim(coalesce(p_relationship, '')), '');
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'PARENT_NAME_REQUIRED'; end if;

  select s.person_id into v_scout_person_id
    from public.scouts s
   where s.household_id = p_household_id and s.person_id is not null
   order by s.id limit 1;

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

  if v_email is not null then
    insert into public.scout_parent_emails (person_id, email, label, is_primary)
    values (v_person_id, v_email, 'home', true)
    on conflict (person_id, email) do nothing;
  end if;

  insert into public.household_members (household_id, person_id)
  values (p_household_id, v_person_id)
  on conflict do nothing;

  if v_scout_person_id is not null and v_scout_person_id <> v_person_id then
    insert into public.relationships (person_id, related_person_id, type, source_label, role_label)
    values (v_person_id, v_scout_person_id, 'parent_of', v_rel, v_rel)
    on conflict (person_id, related_person_id, type)
    do update set role_label = coalesce(public.relationships.role_label, excluded.role_label);
  end if;

  return v_person_id;
end;
$function$;

-- ── 3. cancel_party_signup: person ids only ────────────────────────────────
--
-- Dropped rather than replaced: the parameter list changes, so the old
-- signature would otherwise linger as a second overload that still names
-- columns this migration removes.
drop function if exists public.cancel_party_signup(bigint, text, bigint, text[], bigint[], text[], bigint[]);

create function public.cancel_party_signup(
  p_event_signup_id bigint,
  p_actor text,
  p_household_id bigint default null,
  p_person_ids bigint[] default '{}'::bigint[]
) returns integer
language plpgsql
as $function$
declare v_count int;
begin
  perform 1 from public.event_signups where id = p_event_signup_id for update;

  update public.signup_entries
  set status = 'cancelled', cancelled_at = now(), updated_by = p_actor, updated_at = now()
  where event_signup_id = p_event_signup_id
    and status <> 'cancelled'
    and (
      case
        when p_household_id is not null then household_id = p_household_id
        else person_id = any (p_person_ids)
      end
    );
  get diagnostics v_count = row_count;

  perform public.promote_waitlist(p_event_signup_id);
  return v_count;
end;
$function$;

-- ── 4. merge_people: nothing left to re-point ──────────────────────────────
--
-- The scout_parents re-point is gone; scout_parent_emails handling stays,
-- since that is a different table that survives this migration.
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
  update leaders        set person_id = p_survivor where person_id = p_loser;

  -- scout_parent_emails: promote any bounce/unsubscribe signal the loser's
  -- duplicate-address row alone carries onto the survivor's matching row
  -- first (same rule as the re-key dedup — real signal is never dropped),
  -- then move every address the survivor doesn't already have (clearing
  -- is_primary on a moved row if the survivor already has one — the partial
  -- unique index allows only one primary per person), then delete what's
  -- left as pure duplicates. Without this, a merge silently orphans the
  -- loser's deliverability history now that emails carry person_id directly.
  update public.scout_parent_emails surv
  set bounced_at = coalesce(surv.bounced_at, dup.bounced_at),
      unsubscribed_at = coalesce(surv.unsubscribed_at, dup.unsubscribed_at)
  from public.scout_parent_emails dup
  where surv.person_id = p_survivor and dup.person_id = p_loser
    and lower(trim(dup.email)) = lower(trim(surv.email));

  update public.scout_parent_emails spe
  set person_id = p_survivor,
      is_primary = spe.is_primary and not exists (
        select 1 from public.scout_parent_emails x where x.person_id = p_survivor and x.is_primary
      )
  where spe.person_id = p_loser
    and not exists (
      select 1 from public.scout_parent_emails x
      where x.person_id = p_survivor and lower(trim(x.email)) = lower(trim(spe.email))
    );

  delete from public.scout_parent_emails where person_id = p_loser;

  insert into household_members (household_id, person_id, is_primary_contact)
  select hm.household_id, p_survivor, hm.is_primary_contact
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
    notes = trim(coalesce(notes, '') || ' [merged into person ' || p_survivor
            || ' by ' || p_decided_by || ' on ' || now()::date || ']'),
    updated_at = now()
  where id = p_loser;
end;
$function$;

-- ── 5. submit_household_signup: person_id is the only identity ─────────────
CREATE OR REPLACE FUNCTION public.submit_household_signup(p_event_signup_id bigint, p_entries jsonb, p_actor text, p_household_id bigint DEFAULT NULL::bigint, p_allowed_person_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_deadline timestamptz;
  v_status text;
  v_capacity int;
  v_waitlist boolean;
  v_allow_guests boolean;
  v_audience text;
  e jsonb;
  a jsonb;
  v_kind text;
  v_want text;
  v_part text;
  v_price_id bigint;
  v_price_applies text;
  v_price_per text;
  v_price_event bigint;
  v_days int;
  v_guests int;
  v_seats int;
  v_existing bigint;
  v_assigned text;
  v_entry_id bigint;
  v_used int;
  v_result jsonb := '[]'::jsonb;
  v_q record;
  v_val text;
  v_person_id bigint;
begin
  select deadline, status, capacity, waitlist_enabled, allow_guests, audience
    into v_deadline, v_status, v_capacity, v_waitlist, v_allow_guests, v_audience
  from public.event_signups where id = p_event_signup_id for update;

  if not found then raise exception 'event_signup % not found', p_event_signup_id; end if;
  if v_status = 'closed' then raise exception 'SIGNUP_CLOSED'; end if;
  if v_deadline < now() then raise exception 'SIGNUP_DEADLINE_PASSED'; end if;

  select coalesce(sum(1 + guest_count), 0)::int into v_used
  from public.signup_entries
  where event_signup_id = p_event_signup_id and status = 'yes' and participation = 'full'
    and (p_household_id is null or household_id is distinct from p_household_id);

  for e in select * from jsonb_array_elements(p_entries)
  loop
    v_kind  := e->>'person_kind';
    v_want  := coalesce(e->>'status', 'no');
    v_part  := coalesce(e->>'participation', 'full');
    v_price_id := nullif(e->>'price_id', '')::bigint;
    v_days  := nullif(e->>'days', '')::int;
    v_guests := coalesce(nullif(e->>'guest_count', '')::int, 0);

    if v_kind not in ('scout', 'adult') then raise exception 'BAD_PERSON_KIND: %', v_kind; end if;
    if v_want not in ('yes', 'no') then
      raise exception 'BAD_STATUS: % (waitlist is assigned, not requested)', v_want;
    end if;
    if v_want = 'yes' and v_audience <> 'both'
       and v_audience <> (case when v_kind = 'scout' then 'scouts' else 'adults' end) then
      raise exception 'AUDIENCE_MISMATCH: this event is % only', v_audience;
    end if;
    if v_guests > 0 and not v_allow_guests then raise exception 'GUESTS_NOT_ALLOWED'; end if;

    if v_price_id is not null then
      select event_signup_id, applies_to, per into v_price_event, v_price_applies, v_price_per
      from public.event_prices where id = v_price_id;
      if not found then raise exception 'PRICE_NOT_FOUND: %', v_price_id; end if;
      if v_price_event <> p_event_signup_id then
        raise exception 'PRICE_WRONG_EVENT: tier % belongs to another event', v_price_id;
      end if;
      if v_price_applies <> 'both'
         and v_price_applies <> (case when v_kind = 'scout' then 'scouts' else 'adults' end) then
        raise exception 'PRICE_APPLIES_MISMATCH: tier % is not offered to %s', v_price_id, v_kind;
      end if;
      if v_price_per = 'day' and (v_days is null or v_days < 1) then
        raise exception 'DAYS_REQUIRED: tier % is priced per day', v_price_id;
      end if;
      if v_price_per <> 'day' and v_days is not null then
        raise exception 'DAYS_NOT_APPLICABLE: tier % is a flat price', v_price_id;
      end if;
    end if;

    v_assigned := v_want;
    if v_want = 'yes' and v_part = 'full' then
      v_seats := 1 + v_guests;
      if v_capacity is not null and v_used + v_seats > v_capacity then
        if v_waitlist then v_assigned := 'waitlist'; else raise exception 'EVENT_FULL'; end if;
      else
        v_used := v_used + v_seats;
      end if;
    end if;

    -- Prefer the CLIENT-supplied person_id (households.ts has exposed one for
    -- every reachable party since before this migration); fall back to
    -- resolving it from whichever legacy column the entry carries, so older
    -- client payloads that don't send person_id yet still get one written.
    -- person_id is the ONLY identity an entry carries now. The legacy
    -- scout_id / scout_parent_id / leader_code fallbacks are gone with the
    -- columns (D-066); every client has sent person_id since the 2026-07-25
    -- re-key, and signup_entries.person_id is NOT NULL, so an entry without
    -- one has to fail loudly here rather than at the insert.
    v_person_id := nullif(e->>'person_id', '')::bigint;
    if v_person_id is null then
      raise exception 'ENTRY_HAS_NO_PERSON';
    end if;

    -- Validate the person_id belongs to the submitting party before it can be
    -- looked up or written. Every entry now has one (see above), so the
    -- unvalidated adult_name-only case this used to leave open is closed by
    -- construction rather than by a check.
    if p_allowed_person_ids is not null
       and not (v_person_id = any (p_allowed_person_ids)) then
      raise exception 'PERSON_NOT_IN_PARTY: %', v_person_id;
    end if;

    -- One entry per person per signup, which is exactly what
    -- signup_entries_person_uniq enforces. The legacy OR-arms matched on
    -- columns that no longer exist.
    select id into v_existing
    from public.signup_entries
    where event_signup_id = p_event_signup_id and status <> 'cancelled'
      and person_id = v_person_id
    limit 1;

    if v_existing is not null then
      update public.signup_entries set
        status = v_assigned, participation = v_part, price_id = v_price_id, days = v_days,
        drives_out = coalesce((e->>'drives_out')::boolean, false),
        drives_back = coalesce((e->>'drives_back')::boolean, false),
        seats_offered_out = nullif(e->>'seats_offered_out', '')::int,
        seats_offered_back = nullif(e->>'seats_offered_back', '')::int,
        guest_count = v_guests,
        guest_note = nullif(e->>'guest_note', ''),
        notes = nullif(e->>'notes', ''),
        volunteer_note = nullif(e->>'volunteer_note', ''),
        household_id = coalesce(p_household_id, household_id),
        person_id = v_person_id,
        updated_by = p_actor, updated_at = now()
      where id = v_existing returning id into v_entry_id;
    else
      insert into public.signup_entries (
        event_signup_id, person_kind,
        status, price_id, days, participation, drives_out, drives_back,
        seats_offered_out, seats_offered_back, guest_count, guest_note, notes,
        volunteer_note, household_id, person_id, entered_by, updated_by
      ) values (
        p_event_signup_id, v_kind,
        v_assigned, v_price_id, v_days, v_part,
        coalesce((e->>'drives_out')::boolean, false),
        coalesce((e->>'drives_back')::boolean, false),
        nullif(e->>'seats_offered_out', '')::int, nullif(e->>'seats_offered_back', '')::int,
        v_guests, nullif(e->>'guest_note', ''), nullif(e->>'notes', ''),
        nullif(e->>'volunteer_note', ''), p_household_id, v_person_id, p_actor, p_actor
      ) returning id into v_entry_id;
    end if;

    -- ── Answers ────────────────────────────────────────────────────────────
    if v_assigned in ('yes', 'waitlist') then
      for v_q in
        select id, prompt, input_type, choices, required, applies_to
        from public.signup_questions
        where event_signup_id = p_event_signup_id
          and (applies_to = 'both'
               or applies_to = (case when v_kind = 'scout' then 'scouts' else 'adults' end))
      loop
        v_val := null;
        for a in select * from jsonb_array_elements(coalesce(e->'answers', '[]'::jsonb))
        loop
          if (a->>'question_id')::bigint = v_q.id then v_val := nullif(trim(a->>'value'), ''); end if;
        end loop;

        if v_q.required and v_val is null then
          raise exception 'ANSWER_REQUIRED: %', v_q.prompt;
        end if;

        if v_val is not null then
          if v_q.input_type = 'choice' and not (v_val = any (v_q.choices)) then
            raise exception 'ANSWER_NOT_A_CHOICE: % is not an option for "%"', v_val, v_q.prompt;
          end if;
          if v_q.input_type = 'number' and v_val !~ '^-?[0-9]+(\.[0-9]+)?$' then
            raise exception 'ANSWER_NOT_A_NUMBER: "%" expects a number', v_q.prompt;
          end if;

          insert into public.signup_answers (signup_entry_id, question_id, value)
          values (v_entry_id, v_q.id, v_val)
          on conflict (signup_entry_id, question_id) do update set value = excluded.value;
        else
          delete from public.signup_answers
          where signup_entry_id = v_entry_id and question_id = v_q.id;
        end if;
      end loop;
    end if;

    v_result := v_result || jsonb_build_object(
      'key', e->>'key', 'entry_id', v_entry_id, 'status', v_assigned
    );
  end loop;

  perform public.promote_waitlist(p_event_signup_id);

  return v_result;
end;
$function$;

-- ── 6. Drop the legacy identity columns ────────────────────────────────────
--
-- Every signup_entries row has a person_id (NOT NULL since D-065), and
-- signup_entries_person_uniq already enforces one entry per person per signup
-- — so the three legacy unique indexes below are duplicates of a guard that
-- outlives them. They go with their columns.
--
-- NOT dropped: entered_by / updated_by. They look like the legacy half of a
-- pair with entered_by_person_id / updated_by_person_id, but the data says the
-- opposite — all 34 rows have the text columns and ZERO have the person ones.
-- The text columns are the live ones; the person columns are the unused
-- experiment. Removing the wrong pair would silently blank the roster's
-- "entered by" column.
drop index if exists public.signup_entries_scout_uniq;
drop index if exists public.signup_entries_parent_uniq;
drop index if exists public.signup_entries_leader_uniq;
drop index if exists public.signup_entries_adultname_uniq;

alter table public.signup_entries
  drop column if exists scout_id,
  drop column if exists scout_parent_id,
  drop column if exists leader_code,
  drop column if exists adult_name;

-- ── 7. Rebuild the view that counted scout_parents rows as "links" ─────────
--
-- person_merge_candidate_detail feeds the roster-import merge screen, where a
-- leader compares two possible duplicates and decides which survives.
-- person_links / candidate_links counted role records — scouts + leaders +
-- scout_parents — as a rough "how attached is this person" signal.
--
-- Only the scout_parents term goes. Relationships are NOT folded in to
-- compensate: the view already reports them separately as person_rels /
-- candidate_rels, and quietly moving them into the links total would change
-- what a number the merge screen already displays means.
create or replace view public.person_merge_candidate_detail as
  select c.person_id,
         c.person_name,
         c.candidate_id,
         c.candidate_name,
         c.evidence,
         a.primary_email as person_email,
         b.primary_email as candidate_email,
         a.bsa_member_id as person_bsa,
         b.bsa_member_id as candidate_bsa,
         ((select count(*) from public.scouts s where s.person_id = c.person_id))
           + ((select count(*) from public.leaders l where l.person_id = c.person_id))
           as person_links,
         ((select count(*) from public.scouts s where s.person_id = c.candidate_id))
           + ((select count(*) from public.leaders l where l.person_id = c.candidate_id))
           as candidate_links,
         (select count(*) from public.relationships r
           where r.person_id = c.person_id or r.related_person_id = c.person_id) as person_rels,
         (select count(*) from public.relationships r
           where r.person_id = c.candidate_id or r.related_person_id = c.candidate_id) as candidate_rels
    from public.person_merge_candidates c
    join public.people a on a.id = c.person_id
    join public.people b on b.id = c.candidate_id;

-- ── 8. Drop the table ──────────────────────────────────────────────────────
--
-- scout_parent_emails is NOT this table despite the name — it is the
-- deliverability record, already keyed on person_id, and stays.
--
-- No CASCADE: if something still depends on this table, the migration should
-- stop and be read, not quietly take the dependent object with it. That is
-- exactly how the merge-candidate view above was found.
drop table if exists public.scout_parents;

commit;

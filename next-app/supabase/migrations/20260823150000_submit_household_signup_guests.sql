-- Guests as people — Phase 0b, the RPC (Plans/Guests-As-People.md).
--
-- submit_household_signup learns guest_mode, and named-guest rows move INTO
-- its payload (tech-lead: consistent with D-048 — one transaction for the
-- party validation, the capacity math and the replace, instead of the
-- delete-then-insert the family action did afterwards). Same signature ⇒
-- CREATE OR REPLACE replaces in place, no overload.
--
-- Payload contract (p_entries, one element per party member as before, plus
-- one per named guest):
--   member  { key, person_id, person_kind, status, participation, price_id,
--             days, guest_count, guest_note, drives_*, vehicle_seats_*,
--             ride_*, notes, volunteer_note, answers[] }        (unchanged)
--   guest   { key, guest: true, guest_of_key, participant_class,
--             person_id (a re-pick of one of the household's guests)
--               OR guest_name (+ guest_phone for an adult_guest),
--             participation, price_id, days, drives_*, vehicle_seats_*, ride_* }
--
-- Rules (all raised as codes the action maps to family-facing text):
--   GUESTS_NOT_ALLOWED     guest_count > 0 outside count mode; a guest row
--                          outside named mode
--   GUEST_NEEDS_HOST       guest_of_key missing or not a member row in this
--                          payload
--   GUEST_NEEDS_HOUSEHOLD  no household to attach the guest person to
--   GUEST_CLASS_INVALID    participant_class not one of the four guest classes
--   GUEST_NAME_REQUIRED / GUEST_NAME_TOO_LONG (80)
--   GUEST_HOUSEHOLD_CAP    25 live guest people per household (qa-lead:
--                          Tier-1 shared-password submissions must not be
--                          able to create unbounded people rows)
--   GUEST_EVENT_CAP        20 guest rows per household per event
--   PERSON_NOT_IN_PARTY    a re-picked person_id that is not a guest of THIS
--                          household (or is a member — members go through
--                          p_allowed_person_ids)
--
-- Re-use is explicit, never by name (People-Identity-Model's merge rule):
-- the client sends person_id for "Grandma Pat again"; a typed name always
-- makes a new person. A guest's status follows its host: host 'no' ⇒ guest
-- 'no'; host waitlisted ⇒ guest waitlisted; host 'yes' ⇒ the guest takes a
-- seat through the same capacity check. Guests answer no questions.
--
-- Reconcile: in named mode, a guest row hosted by one of this submit's
-- member entries that the payload no longer carries becomes status 'no' —
-- the same thing the form does for a member it dropped. Never deleted: a
-- guest row can hold payments and placements.
--
-- ALSO (Patrick, 2026-08-23, BACKLOG "Remove → re-register"): the existing-
-- row lookup now REVIVES the most recent cancelled row for a person instead
-- of inserting a twin beside it — placements, job claims, leader answers and
-- payments stay attached; "Put back" on the old row can no longer collide
-- with a live one. Applies to members and guests alike.

-- ── the guest-person writer ──────────────────────────────────────────────
create or replace function public.ensure_guest_person(
  p_household_id bigint,
  p_name text,
  p_phone text,
  p_actor text
) returns bigint
language plpgsql
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_live int;
  v_id bigint;
begin
  if p_household_id is null then raise exception 'GUEST_NEEDS_HOUSEHOLD'; end if;
  if length(v_name) = 0 then raise exception 'GUEST_NAME_REQUIRED'; end if;
  if length(v_name) > 80 then raise exception 'GUEST_NAME_TOO_LONG: % characters (max 80)', length(v_name); end if;

  select count(*) into v_live
  from public.people p
  where p.guest_host_household_id = p_household_id
    and p.merged_into_person_id is null
    and p.active;
  if v_live >= 25 then
    raise exception 'GUEST_HOUSEHOLD_CAP: this household already has % guests on record — forget some from People → Guests first', v_live;
  end if;

  insert into public.people (display_name, guest_host_household_id, primary_phone, notes)
  values (v_name, p_household_id, nullif(trim(coalesce(p_phone, '')), ''),
          'Guest — added ' || now()::date || ' by ' || coalesce(p_actor, 'unknown'))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.ensure_guest_person(bigint, text, text, text) is
  'Creates a guest people row for a host household (Plans/Guests-As-People.md) under the 25-per-household cap and the 80-char name limit. Re-use of an existing guest is by person_id, never by name.';

-- ── submit_household_signup ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_household_signup(p_event_signup_id bigint, p_entries jsonb, p_actor text, p_household_id bigint DEFAULT NULL::bigint, p_allowed_person_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_deadline timestamptz;
  v_status text;
  v_capacity int;
  v_waitlist boolean;
  v_guest_mode text;
  v_audience text;
  e jsonb;
  a jsonb;
  v_is_guest boolean;
  v_kind text;
  v_want text;
  v_part text;
  v_class text;
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
  v_hosts jsonb := '{}'::jsonb;        -- member key → {entry_id, status, household_id}
  v_host jsonb;
  v_host_entry bigint;
  v_guest_hh bigint;
  v_guest_n int := 0;
  v_guest_ids bigint[] := '{}';
  v_pass int;
begin
  select deadline, status, capacity, waitlist_enabled, guest_mode, audience
    into v_deadline, v_status, v_capacity, v_waitlist, v_guest_mode, v_audience
  from public.event_signups where id = p_event_signup_id for update;

  if not found then raise exception 'event_signup % not found', p_event_signup_id; end if;
  if v_status = 'closed' then raise exception 'SIGNUP_CLOSED'; end if;
  if v_deadline < now() then raise exception 'SIGNUP_DEADLINE_PASSED'; end if;

  select coalesce(sum(1 + guest_count), 0)::int into v_used
  from public.signup_entries
  where event_signup_id = p_event_signup_id and status = 'yes' and participation = 'full'
    and (p_household_id is null or household_id is distinct from p_household_id);

  -- Two passes over the same payload: members first (they are the hosts),
  -- then guests, so a guest can name a host that appears after it.
  for v_pass in 1..2 loop
  for e in select * from jsonb_array_elements(p_entries)
  loop
    v_is_guest := coalesce((e->>'guest')::boolean, false);
    if (v_pass = 1) = v_is_guest then continue; end if;

    v_want  := coalesce(e->>'status', 'no');
    v_part  := coalesce(e->>'participation', 'full');
    v_price_id := nullif(e->>'price_id', '')::bigint;
    v_days  := nullif(e->>'days', '')::int;
    v_guests := coalesce(nullif(e->>'guest_count', '')::int, 0);
    v_host_entry := null;
    v_class := null;

    if v_is_guest then
      -- ── guest row: mode, host, class, identity ───────────────────────
      if v_guest_mode <> 'named' then raise exception 'GUESTS_NOT_ALLOWED'; end if;
      if v_guests > 0 then raise exception 'GUESTS_NOT_ALLOWED'; end if;

      v_host := v_hosts -> coalesce(e->>'guest_of_key', '');
      if v_host is null then
        raise exception 'GUEST_NEEDS_HOST: guest % names no attending member of this party', coalesce(e->>'key', '?');
      end if;
      v_host_entry := (v_host->>'entry_id')::bigint;
      v_guest_hh := coalesce(p_household_id, nullif(v_host->>'household_id', '')::bigint);
      if v_guest_hh is null then raise exception 'GUEST_NEEDS_HOUSEHOLD'; end if;

      v_class := e->>'participant_class';
      if v_class is null or v_class not in ('webelos', 'cub_scout', 'youth_guest', 'adult_guest') then
        raise exception 'GUEST_CLASS_INVALID: %', coalesce(v_class, '(none)');
      end if;
      v_kind := case when v_class = 'adult_guest' then 'adult' else 'scout' end;

      v_guest_n := v_guest_n + 1;
      if v_guest_n > 20 then raise exception 'GUEST_EVENT_CAP: more than 20 guests on one sign-up'; end if;

      v_person_id := nullif(e->>'person_id', '')::bigint;
      if v_person_id is not null then
        -- A re-pick: must be one of THIS household's guests.
        if not exists (
          select 1 from public.people p
          where p.id = v_person_id
            and p.guest_host_household_id = v_guest_hh
            and p.merged_into_person_id is null
        ) then
          raise exception 'PERSON_NOT_IN_PARTY: %', v_person_id;
        end if;
        -- An adult guest may (re)state a phone; a youth guest never carries one.
        if v_class = 'adult_guest' and nullif(trim(coalesce(e->>'guest_phone', '')), '') is not null then
          update public.people set primary_phone = trim(e->>'guest_phone'), updated_at = now()
          where id = v_person_id;
        end if;
      else
        v_person_id := public.ensure_guest_person(
          v_guest_hh,
          e->>'guest_name',
          case when v_class = 'adult_guest' then e->>'guest_phone' else null end,
          p_actor
        );
      end if;

      -- A guest goes where the host goes.
      if (v_host->>'status') = 'no' then v_want := 'no'; else v_want := 'yes'; end if;
    else
      -- ── member row (unchanged rules) ─────────────────────────────────
      v_kind := e->>'person_kind';
      if v_kind not in ('scout', 'adult') then raise exception 'BAD_PERSON_KIND: %', v_kind; end if;
      if v_want not in ('yes', 'no') then
        raise exception 'BAD_STATUS: % (waitlist is assigned, not requested)', v_want;
      end if;
      if v_guests > 0 and v_guest_mode <> 'count' then raise exception 'GUESTS_NOT_ALLOWED'; end if;
    end if;

    if v_want = 'yes' and v_audience <> 'both'
       and v_audience <> (case when v_kind = 'scout' then 'scouts' else 'adults' end) then
      raise exception 'AUDIENCE_MISMATCH: this event is % only', v_audience;
    end if;

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
    if v_is_guest and v_want = 'yes' and (v_host->>'status') = 'waitlist' then
      v_assigned := 'waitlist';
    elsif v_want = 'yes' and v_part = 'full' then
      v_seats := 1 + v_guests;
      if v_capacity is not null and v_used + v_seats > v_capacity then
        if v_waitlist then v_assigned := 'waitlist'; else raise exception 'EVENT_FULL'; end if;
      else
        v_used := v_used + v_seats;
      end if;
    end if;

    if not v_is_guest then
      -- person_id is the ONLY identity an entry carries (D-066).
      v_person_id := nullif(e->>'person_id', '')::bigint;
      if v_person_id is null then
        raise exception 'ENTRY_HAS_NO_PERSON';
      end if;
      if p_allowed_person_ids is not null
         and not (v_person_id = any (p_allowed_person_ids)) then
        raise exception 'PERSON_NOT_IN_PARTY: %', v_person_id;
      end if;
    end if;

    -- The live row wins; failing that, the most recent cancelled one is
    -- REVIVED rather than twinned (signup_entries_person_uniq is partial on
    -- status <> 'cancelled', so a blind insert used to slip past it).
    select id into v_existing
    from public.signup_entries
    where event_signup_id = p_event_signup_id
      and person_id = v_person_id
    order by (status <> 'cancelled') desc, id desc
    limit 1;

    if v_existing is not null then
      update public.signup_entries set
        status = v_assigned, participation = v_part, price_id = v_price_id, days = v_days,
        drives_out = coalesce((e->>'drives_out')::boolean, false),
        drives_back = coalesce((e->>'drives_back')::boolean, false),
        vehicle_seats_out = nullif(e->>'vehicle_seats_out', '')::int,
        vehicle_seats_back = nullif(e->>'vehicle_seats_back', '')::int,
        ride_out = nullif(e->>'ride_out', ''),
        ride_back = nullif(e->>'ride_back', ''),
        guest_count = v_guests,
        guest_note = nullif(e->>'guest_note', ''),
        notes = nullif(e->>'notes', ''),
        volunteer_note = nullif(e->>'volunteer_note', ''),
        household_id = coalesce(p_household_id, household_id),
        person_id = v_person_id,
        person_kind = case when v_is_guest then v_kind else person_kind end,
        participant_class = case when v_is_guest then v_class else participant_class end,
        host_entry_id = case when v_is_guest then v_host_entry else host_entry_id end,
        cancelled_at = null,
        updated_by = p_actor, updated_at = now()
      where id = v_existing returning id into v_entry_id;
    else
      insert into public.signup_entries (
        event_signup_id, person_kind, participant_class, host_entry_id,
        status, price_id, days, participation, drives_out, drives_back,
        vehicle_seats_out, vehicle_seats_back,
        ride_out, ride_back, guest_count, guest_note, notes,
        volunteer_note, household_id, person_id, entered_by, updated_by
      ) values (
        p_event_signup_id, v_kind, v_class, v_host_entry,
        v_assigned, v_price_id, v_days, v_part,
        coalesce((e->>'drives_out')::boolean, false),
        coalesce((e->>'drives_back')::boolean, false),
        nullif(e->>'vehicle_seats_out', '')::int, nullif(e->>'vehicle_seats_back', '')::int,
        nullif(e->>'ride_out', ''), nullif(e->>'ride_back', ''),
        v_guests, nullif(e->>'guest_note', ''), nullif(e->>'notes', ''),
        nullif(e->>'volunteer_note', ''), p_household_id, v_person_id, p_actor, p_actor
      ) returning id into v_entry_id;
    end if;

    if v_is_guest then
      v_guest_ids := v_guest_ids || v_entry_id;
    else
      v_hosts := v_hosts || jsonb_build_object(
        coalesce(e->>'key', ''),
        jsonb_build_object('entry_id', v_entry_id, 'status', v_assigned,
                           'household_id', p_household_id)
      );
    end if;

    -- ── Answers (members only — a guest answers no questions) ──────────
    -- Leader-only questions are NOT the family's to answer: skipped entirely,
    -- so their answers are neither required of nor erased by a family submit.
    if not v_is_guest and v_assigned in ('yes', 'waitlist') then
      for v_q in
        select id, prompt, input_type, choices, required, applies_to
        from public.signup_questions
        where event_signup_id = p_event_signup_id
          and not leader_only
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
  end loop;

  -- ── Reconcile dropped guests (named mode only) ─────────────────────────
  if v_guest_mode = 'named' then
    update public.signup_entries g
    set status = 'no', updated_by = p_actor, updated_at = now()
    where g.event_signup_id = p_event_signup_id
      and g.status <> 'cancelled'
      and g.status <> 'no'
      and g.host_entry_id in (
        select (value->>'entry_id')::bigint from jsonb_each(v_hosts)
      )
      and not (g.id = any (v_guest_ids));
  end if;

  perform public.promote_waitlist(p_event_signup_id);

  return v_result;
end;
$function$;

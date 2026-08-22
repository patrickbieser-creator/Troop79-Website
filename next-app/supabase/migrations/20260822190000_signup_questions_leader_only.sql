-- Event Logistics, Phase 0 / D — leader-only columns (Plans/Event-Logistics.md).
--
-- Patrick, 2026-08-22: "Registered and health forms are items that should be
-- leader only." A signup_question flagged leader_only is a roster column the
-- leader fills ("Health form in hand", "Registered with council", "Tent plan",
-- "Rental/Pass"), never a family prompt. print_allowed gates whether a
-- FREE-TEXT leader column reaches the printed snapshot / CSV (checkbox and
-- number columns always print; text is off by default — qa-lead, the
-- no-medical-content-on-paper guard from roster-print). Patrick allowed text
-- columns ("not a concern"); the gate is a convenience, not a policy wall.
--
-- This migration also re-creates submit_household_signup (same signature, so
-- CREATE OR REPLACE replaces rather than overloads) for two reasons:
--   1. the family RPC must SKIP leader_only questions — otherwise a required
--      one blocks the family, and an optional one gets its leader-entered
--      answer DELETED on every resubmit (the loop deletes answers the payload
--      doesn't carry);
--   2. it writes the Phase 0/A transport columns (vehicle_seats_*, ride_*)
--      when the payload carries them; old payloads keep sending
--      seats_offered_* and the normalizer trigger derives the rest.
-- Body otherwise identical to 20260815200000_retire_scout_parents.sql §5.

alter table public.signup_questions
  add column if not exists leader_only   boolean not null default false,
  add column if not exists print_allowed boolean not null default false;

comment on column public.signup_questions.leader_only is
  'Leader-managed roster column: never rendered on family forms, skipped by submit_household_signup.';
comment on column public.signup_questions.print_allowed is
  'Free-text leader-only answers print on the snapshot/CSV only when true; checkbox/number columns always print.';

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

    -- person_id is the ONLY identity an entry carries (D-066).
    v_person_id := nullif(e->>'person_id', '')::bigint;
    if v_person_id is null then
      raise exception 'ENTRY_HAS_NO_PERSON';
    end if;

    if p_allowed_person_ids is not null
       and not (v_person_id = any (p_allowed_person_ids)) then
      raise exception 'PERSON_NOT_IN_PARTY: %', v_person_id;
    end if;

    select id into v_existing
    from public.signup_entries
    where event_signup_id = p_event_signup_id and status <> 'cancelled'
      and person_id = v_person_id
    limit 1;

    -- Transport: the payload may carry either seat representation (the
    -- normalizer trigger derives the other) and an optional ride status per
    -- leg (the trigger defaults a missing one).
    if v_existing is not null then
      update public.signup_entries set
        status = v_assigned, participation = v_part, price_id = v_price_id, days = v_days,
        drives_out = coalesce((e->>'drives_out')::boolean, false),
        drives_back = coalesce((e->>'drives_back')::boolean, false),
        seats_offered_out = nullif(e->>'seats_offered_out', '')::int,
        seats_offered_back = nullif(e->>'seats_offered_back', '')::int,
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
        updated_by = p_actor, updated_at = now()
      where id = v_existing returning id into v_entry_id;
    else
      insert into public.signup_entries (
        event_signup_id, person_kind,
        status, price_id, days, participation, drives_out, drives_back,
        seats_offered_out, seats_offered_back, vehicle_seats_out, vehicle_seats_back,
        ride_out, ride_back, guest_count, guest_note, notes,
        volunteer_note, household_id, person_id, entered_by, updated_by
      ) values (
        p_event_signup_id, v_kind,
        v_assigned, v_price_id, v_days, v_part,
        coalesce((e->>'drives_out')::boolean, false),
        coalesce((e->>'drives_back')::boolean, false),
        nullif(e->>'seats_offered_out', '')::int, nullif(e->>'seats_offered_back', '')::int,
        nullif(e->>'vehicle_seats_out', '')::int, nullif(e->>'vehicle_seats_back', '')::int,
        nullif(e->>'ride_out', ''), nullif(e->>'ride_back', ''),
        v_guests, nullif(e->>'guest_note', ''), nullif(e->>'notes', ''),
        nullif(e->>'volunteer_note', ''), p_household_id, v_person_id, p_actor, p_actor
      ) returning id into v_entry_id;
    end if;

    -- ── Answers ────────────────────────────────────────────────────────────
    -- Leader-only questions are NOT the family's to answer: skipped entirely,
    -- so their answers are neither required of nor erased by a family submit.
    if v_assigned in ('yes', 'waitlist') then
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

  perform public.promote_waitlist(p_event_signup_id);

  return v_result;
end;
$function$;

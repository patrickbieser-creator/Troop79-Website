-- submit_household_signup WRITES person_id, still READS legacy columns.
--
-- WHY THIS IS ITS OWN STEP (Fable sequencing review, 2026-07-20)
-- Splitting write from read is what makes this safe to ship alone: the
-- existing-row lookup stays keyed on the four legacy columns (unchanged
-- behavior, unchanged risk), while every entry ALSO gets its real identity
-- resolved and stored. If the lookup were flipped to person_id in this same
-- migration, any row still carrying person_id = NULL (there are 8 in local
-- dev today, all pre-dating this migration) would be invisible to it and get
-- silently re-inserted — recreating the exact duplicate-row bug this whole
-- migration exists to end. Reading person_id is a LATER step, once every row
-- is guaranteed to have one (see the backfill migration that follows this).
--
-- person_id is resolved server-side from whichever legacy column the entry
-- carries — the client does not need to send it for this step to work.
-- adult_name-only entries resolve to NULL (no backing record to look up);
-- neither form in this app emits adult_name today, so this is a no-op path
-- kept only because the column still legally allows it.

create or replace function public.submit_household_signup(
  p_event_signup_id bigint,
  p_entries jsonb,
  p_actor text,
  p_household_id bigint default null
)
returns jsonb
language plpgsql
as $$
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

    -- Resolve real identity server-side from whichever legacy column this
    -- entry carries. The client does not need to send person_id yet.
    v_person_id := null;
    if (e->>'scout_id') is not null then
      select person_id into v_person_id from public.scouts where id = e->>'scout_id';
    elsif (e->>'scout_parent_id') is not null then
      select person_id into v_person_id from public.scout_parents where id = (e->>'scout_parent_id')::bigint;
    elsif (e->>'leader_code') is not null then
      select person_id into v_person_id from public.leaders where code = e->>'leader_code';
    end if;

    -- Existing-row lookup UNCHANGED — still the four-legacy-column OR match.
    -- Flipping this to person_id is a later, separate step (see the
    -- "read_person_id" migration): every row must have person_id populated
    -- FIRST, or this lookup would miss pre-existing NULL rows and re-insert.
    select id into v_existing
    from public.signup_entries
    where event_signup_id = p_event_signup_id and status <> 'cancelled'
      and ((e->>'scout_id') is not null and scout_id = e->>'scout_id'
        or (e->>'scout_parent_id') is not null and scout_parent_id = (e->>'scout_parent_id')::bigint
        or (e->>'leader_code') is not null and leader_code = e->>'leader_code'
        or (e->>'adult_name') is not null and lower(adult_name) = lower(e->>'adult_name'))
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
        person_id = coalesce(person_id, v_person_id),
        updated_by = p_actor, updated_at = now()
      where id = v_existing returning id into v_entry_id;
    else
      insert into public.signup_entries (
        event_signup_id, person_kind, scout_id, scout_parent_id, leader_code, adult_name,
        status, price_id, days, participation, drives_out, drives_back,
        seats_offered_out, seats_offered_back, guest_count, guest_note, notes,
        volunteer_note, household_id, person_id, entered_by, updated_by
      ) values (
        p_event_signup_id, v_kind,
        nullif(e->>'scout_id', ''), nullif(e->>'scout_parent_id', '')::bigint,
        nullif(e->>'leader_code', ''), nullif(e->>'adult_name', ''),
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
$$;

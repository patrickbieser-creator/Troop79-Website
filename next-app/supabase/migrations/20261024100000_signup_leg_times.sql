-- Event signup: when people arrive and leave (Plans/Event-Signup-Arrival-Times.md).
--
-- Patrick, 2026-10-06: "How does the Signup currently handle adults and
-- scouts who are driving to an event a day late but can drive scouts home?
-- The system should be able to keep track of who's coming and going and how
-- they're getting there."
--
-- A leg already says HOW (drive N seats / needs a ride / driving separately /
-- meeting there / not traveling). It could not say WHEN. Each leg now carries
-- an optional departure instant; NULL means "with the group" (the event's own
-- times), so every existing row keeps its meaning. "Meeting there" stays a
-- status and "Later" is a time on "With the group" / "Driving separately"
-- (Patrick's call, 2026-10-06 — statuses are not collapsed).
--
-- ADDITIVE (deploy DB-first). Both functions keep the pinned search_path of
-- the 2026-08-25 security posture. Three pieces:
--   1. the columns;
--   2. sync_car_groups_for_entry stamps a driver's leg time on the car it
--      creates / resizes (a car inherits its driver's time), and the sync
--      trigger now also fires when a leg time changes;
--   3. submit_household_signup carries the two instants from the family form.
--      Same signature => CREATE OR REPLACE in place; the body is the
--      20260823150000 body with ONLY the two new columns added to its UPDATE
--      and INSERT.

-- ── 1. columns ──────────────────────────────────────────────────────────────
alter table public.signup_entries
  add column if not exists out_departs_at  timestamptz,
  add column if not exists back_departs_at timestamptz;

comment on column public.signup_entries.out_departs_at is
  'When this person travels THERE, if not with the group: an instant (read in America/Chicago). NULL = with the group (the event''s own start). Meaningful with any ride status or when driving; a driver''s car inherits it (signup_groups.departs_at).';
comment on column public.signup_entries.back_departs_at is
  'When this person travels BACK, if not with the group: an instant (read in America/Chicago). NULL = with the group (the event''s own end).';

alter table public.signup_groups
  add column if not exists departs_at timestamptz;

comment on column public.signup_groups.departs_at is
  'Cars only: the car''s wave — copied from the driver''s out_departs_at / back_departs_at by sync_car_groups_for_entry. NULL = leaves with the group. Never written by clients (the car guard stays in force).';

-- ── 2. cars inherit the driver's leg time ──────────────────────────────────
-- Body identical to 20260823170000 except departs_at (insert + conflict update).
CREATE OR REPLACE FUNCTION public.sync_car_groups_for_entry(p_entry_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  e record;
  v_name text;
  v_leg text;
  v_drives boolean;
  v_seats int;
  v_departs timestamptz;
  v_set bigint;
  v_group bigint;
begin
  select se.*, p.display_name into e
    from public.signup_entries se left join public.people p on p.id = se.person_id
   where se.id = p_entry_id;
  if not found then return; end if;

  v_name := coalesce(e.display_name, 'Driver');

  perform set_config('app.car_sync', '1', true);   -- transaction-local; see signup_groups_car_guard

  foreach v_leg in array array['out', 'back'] loop
    v_drives  := case v_leg when 'out' then e.drives_out else e.drives_back end;
    v_seats   := case v_leg when 'out' then e.vehicle_seats_out else e.vehicle_seats_back end;
    v_departs := case v_leg when 'out' then e.out_departs_at else e.back_departs_at end;

    select id into v_set from public.signup_group_sets
     where event_signup_id = e.event_signup_id and kind = 'car' and leg = v_leg;
    if v_set is null then continue; end if;         -- event has no car set for this leg

    if e.status = 'yes' and v_drives and v_seats is not null then
      insert into public.signup_groups (set_id, name, capacity, driver_entry_id, departs_at)
      values (v_set, v_name, v_seats, e.id, v_departs)
      on conflict (set_id, driver_entry_id) where driver_entry_id is not null
        do update set capacity = excluded.capacity, name = excluded.name, departs_at = excluded.departs_at
      returning id into v_group;
      insert into public.signup_group_members (group_id, entry_id, set_id, role, placed_by)
      values (v_group, e.id, v_set, 'driver', 'system')
      on conflict (group_id, entry_id) do nothing;
    else
      delete from public.signup_groups where set_id = v_set and driver_entry_id = e.id;
    end if;
  end loop;

  perform set_config('app.car_sync', '', true);
end;
$function$;

-- A changed leg time must re-stamp the car, so it joins the trigger's columns.
drop trigger if exists signup_entries_sync_groups on public.signup_entries;
create trigger signup_entries_sync_groups
  after insert or update of status, drives_out, drives_back, vehicle_seats_out, vehicle_seats_back,
                            participation, out_departs_at, back_departs_at
  on public.signup_entries
  for each row execute function public.signup_entries_sync_groups();

-- Backfill: nothing to do — every existing leg is "with the group" (NULL).

-- ── 3. the family submit carries the two instants ──────────────────────────
CREATE OR REPLACE FUNCTION public.submit_household_signup(p_event_signup_id bigint, p_entries jsonb, p_actor text, p_household_id bigint DEFAULT NULL::bigint, p_allowed_person_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
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
        out_departs_at = nullif(e->>'out_departs_at', '')::timestamptz,
        back_departs_at = nullif(e->>'back_departs_at', '')::timestamptz,
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
        ride_out, ride_back, out_departs_at, back_departs_at, guest_count, guest_note, notes,
        volunteer_note, household_id, person_id, entered_by, updated_by
      ) values (
        p_event_signup_id, v_kind, v_class, v_host_entry,
        v_assigned, v_price_id, v_days, v_part,
        coalesce((e->>'drives_out')::boolean, false),
        coalesce((e->>'drives_back')::boolean, false),
        nullif(e->>'vehicle_seats_out', '')::int, nullif(e->>'vehicle_seats_back', '')::int,
        nullif(e->>'ride_out', ''), nullif(e->>'ride_back', ''),
        nullif(e->>'out_departs_at', '')::timestamptz, nullif(e->>'back_departs_at', '')::timestamptz,
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

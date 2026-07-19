-- The atomic write path for a household signup submission.
--
-- Replaces the advisory signup_capacity_verdict() for anything that WRITES.
-- That function decided under a lock but released it on return, so a caller
-- doing rpc-then-insert was never atomic: two families could both be told
-- "yes" and both insert, overbooking the event. (qa-lead, 2026-07-18.)
--
-- The fix is to do the whole household submission inside ONE function, so a
-- single FOR UPDATE on the event_signups row covers the capacity read AND
-- every insert that depends on it. A household submits together, so one
-- household submission = one lock = one transaction.
--
-- Entries arrive as a jsonb array so the signature doesn't grow a parameter
-- per column. Each element:
--   { "key":"s0",                       -- caller's handle, echoed back
--     "person_kind":"scout"|"adult",
--     "scout_id":"...", "scout_parent_id":1, "leader_code":"..","adult_name":"..",
--     "status":"yes"|"no",              -- 'waitlist' is assigned HERE, not asked for
--     "participation":"full"|"driver_only"|"contributor",
--     "price_id":1, "days":2,
--     "drives_out":true, "drives_back":false,
--     "seats_offered_out":3, "seats_offered_back":null,
--     "guest_count":0, "guest_note":"..", "notes":"..", "volunteer_note":".." }
--
-- Returns jsonb: [{ "key":"s0", "entry_id":12, "status":"yes" }, ...]
-- Raises on any rule violation, which rolls the whole submission back — a
-- household is never left half-submitted.

create or replace function public.submit_household_signup(
  p_event_signup_id bigint,
  p_entries jsonb,
  p_actor text,
  p_household_scout_id text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_deadline timestamptz;
  v_status text;
  v_capacity int;
  v_waitlist boolean;
  v_attendance boolean;
  v_allow_guests boolean;
  v_audience text;
  e jsonb;
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
begin
  -- One lock, held for the whole submission.
  select deadline, status, capacity, waitlist_enabled, attendance_enabled, allow_guests, audience
    into v_deadline, v_status, v_capacity, v_waitlist, v_attendance, v_allow_guests, v_audience
  from public.event_signups
  where id = p_event_signup_id
  for update;

  if not found then
    raise exception 'event_signup % not found', p_event_signup_id;
  end if;

  -- The deadline is a hard gate, enforced here rather than only in the UI.
  if v_status = 'closed' then
    raise exception 'SIGNUP_CLOSED';
  end if;
  if v_deadline < now() then
    raise exception 'SIGNUP_DEADLINE_PASSED';
  end if;

  -- Seats already taken by OTHER people (this household's own live rows are
  -- excluded so an edit doesn't count itself twice).
  select coalesce(sum(1 + guest_count), 0)::int into v_used
  from public.signup_entries
  where event_signup_id = p_event_signup_id
    and status = 'yes'
    and participation = 'full'
    and (p_household_scout_id is null or household_scout_id is distinct from p_household_scout_id);

  for e in select * from jsonb_array_elements(p_entries)
  loop
    v_kind  := e->>'person_kind';
    v_want  := coalesce(e->>'status', 'no');
    v_part  := coalesce(e->>'participation', 'full');
    v_price_id := nullif(e->>'price_id', '')::bigint;
    v_days  := nullif(e->>'days', '')::int;
    v_guests := coalesce(nullif(e->>'guest_count', '')::int, 0);

    if v_kind not in ('scout', 'adult') then
      raise exception 'BAD_PERSON_KIND: %', v_kind;
    end if;
    if v_want not in ('yes', 'no') then
      raise exception 'BAD_STATUS: % (waitlist is assigned, not requested)', v_want;
    end if;

    -- Audience scoping: an adults-only event may not enrol scouts.
    if v_want = 'yes' and v_audience <> 'both'
       and v_audience <> (case when v_kind = 'scout' then 'scouts' else 'adults' end) then
      raise exception 'AUDIENCE_MISMATCH: this event is % only', v_audience;
    end if;

    -- Guests only where the event allows them.
    if v_guests > 0 and not v_allow_guests then
      raise exception 'GUESTS_NOT_ALLOWED';
    end if;

    -- Tier rules, re-checked server-side on EVERY write path (the UI hides
    -- ineligible tiers; hiding is not enforcing).
    if v_price_id is not null then
      select event_signup_id, applies_to, per
        into v_price_event, v_price_applies, v_price_per
      from public.event_prices where id = v_price_id;

      if not found then
        raise exception 'PRICE_NOT_FOUND: %', v_price_id;
      end if;
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

    -- Capacity: only attending people consume a seat. driver_only and
    -- contributor never do, so they are never waitlisted either.
    v_assigned := v_want;
    if v_want = 'yes' and v_part = 'full' then
      v_seats := 1 + v_guests;
      if v_capacity is not null and v_used + v_seats > v_capacity then
        if v_waitlist then
          v_assigned := 'waitlist';
        else
          raise exception 'EVENT_FULL';
        end if;
      else
        v_used := v_used + v_seats;
      end if;
    end if;

    -- Edit in place: entries need stable identity so leader-managed slip and
    -- payment ticks survive a family changing their RSVP.
    select id into v_existing
    from public.signup_entries
    where event_signup_id = p_event_signup_id
      and status <> 'cancelled'
      and ((e->>'scout_id') is not null and scout_id = e->>'scout_id'
        or (e->>'scout_parent_id') is not null and scout_parent_id = (e->>'scout_parent_id')::bigint
        or (e->>'leader_code') is not null and leader_code = e->>'leader_code'
        or (e->>'adult_name') is not null and lower(adult_name) = lower(e->>'adult_name'))
    limit 1;

    if v_existing is not null then
      update public.signup_entries set
        status = v_assigned,
        participation = v_part,
        price_id = v_price_id,
        days = v_days,
        drives_out = coalesce((e->>'drives_out')::boolean, false),
        drives_back = coalesce((e->>'drives_back')::boolean, false),
        seats_offered_out = nullif(e->>'seats_offered_out', '')::int,
        seats_offered_back = nullif(e->>'seats_offered_back', '')::int,
        guest_count = v_guests,
        guest_note = nullif(e->>'guest_note', ''),
        notes = nullif(e->>'notes', ''),
        volunteer_note = nullif(e->>'volunteer_note', ''),
        household_scout_id = coalesce(p_household_scout_id, household_scout_id),
        updated_by = p_actor,
        updated_at = now()
      where id = v_existing
      returning id into v_entry_id;
    else
      insert into public.signup_entries (
        event_signup_id, person_kind, scout_id, scout_parent_id, leader_code, adult_name,
        status, price_id, days, participation, drives_out, drives_back,
        seats_offered_out, seats_offered_back, guest_count, guest_note, notes,
        volunteer_note, household_scout_id, entered_by, updated_by
      ) values (
        p_event_signup_id, v_kind,
        nullif(e->>'scout_id', ''), nullif(e->>'scout_parent_id', '')::bigint,
        nullif(e->>'leader_code', ''), nullif(e->>'adult_name', ''),
        v_assigned, v_price_id, v_days, v_part,
        coalesce((e->>'drives_out')::boolean, false),
        coalesce((e->>'drives_back')::boolean, false),
        nullif(e->>'seats_offered_out', '')::int, nullif(e->>'seats_offered_back', '')::int,
        v_guests, nullif(e->>'guest_note', ''), nullif(e->>'notes', ''),
        nullif(e->>'volunteer_note', ''), p_household_scout_id, p_actor, p_actor
      )
      returning id into v_entry_id;
    end if;

    v_result := v_result || jsonb_build_object(
      'key', e->>'key', 'entry_id', v_entry_id, 'status', v_assigned
    );
  end loop;

  return v_result;
end;
$$;

-- Cancel a household's signup: soft-status so slot claims and answers survive
-- (coverage counts filter to status='yes', so the spots release immediately).
create or replace function public.cancel_household_signup(
  p_event_signup_id bigint,
  p_household_scout_id text,
  p_actor text
)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  update public.signup_entries
  set status = 'cancelled', cancelled_at = now(), updated_by = p_actor, updated_at = now()
  where event_signup_id = p_event_signup_id
    and household_scout_id = p_household_scout_id
    and status <> 'cancelled';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

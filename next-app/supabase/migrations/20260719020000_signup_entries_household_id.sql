-- Point signup entries at the real household.
--
-- signup_entries.household_scout_id was a stand-in from when households were
-- derived: "the household identified by one of its scouts". Now that
-- households are a stored entity, entries should reference it directly —
-- otherwise there are two competing notions of "which household is this",
-- and the grouping that powers edit/cancel depends on the weaker one.
--
-- Safe to replace outright: this feature has never been deployed and the
-- table holds no production data.

alter table public.signup_entries
  add column if not exists household_id bigint references public.households(id) on delete set null;

-- Carry across anything local/dev, then retire the old pointer.
update public.signup_entries e
set household_id = s.household_id
from public.scouts s
where e.household_scout_id = s.id and e.household_id is null;

alter table public.signup_entries drop column if exists household_scout_id;

create index if not exists signup_entries_household_idx
  on public.signup_entries (event_signup_id, household_id);

-- ── RPCs updated to the new key ────────────────────────────────────────────

drop function if exists public.submit_household_signup(bigint, jsonb, text, text);

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
  select deadline, status, capacity, waitlist_enabled, allow_guests, audience
    into v_deadline, v_status, v_capacity, v_waitlist, v_allow_guests, v_audience
  from public.event_signups
  where id = p_event_signup_id
  for update;                                  -- one lock for the whole submission

  if not found then raise exception 'event_signup % not found', p_event_signup_id; end if;
  if v_status = 'closed' then raise exception 'SIGNUP_CLOSED'; end if;
  if v_deadline < now() then raise exception 'SIGNUP_DEADLINE_PASSED'; end if;

  -- Seats held by OTHER households (ours are excluded so an edit doesn't
  -- count itself twice).
  select coalesce(sum(1 + guest_count), 0)::int into v_used
  from public.signup_entries
  where event_signup_id = p_event_signup_id
    and status = 'yes'
    and participation = 'full'
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
      select event_signup_id, applies_to, per
        into v_price_event, v_price_applies, v_price_per
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
        updated_by = p_actor, updated_at = now()
      where id = v_existing
      returning id into v_entry_id;
    else
      insert into public.signup_entries (
        event_signup_id, person_kind, scout_id, scout_parent_id, leader_code, adult_name,
        status, price_id, days, participation, drives_out, drives_back,
        seats_offered_out, seats_offered_back, guest_count, guest_note, notes,
        volunteer_note, household_id, entered_by, updated_by
      ) values (
        p_event_signup_id, v_kind,
        nullif(e->>'scout_id', ''), nullif(e->>'scout_parent_id', '')::bigint,
        nullif(e->>'leader_code', ''), nullif(e->>'adult_name', ''),
        v_assigned, v_price_id, v_days, v_part,
        coalesce((e->>'drives_out')::boolean, false),
        coalesce((e->>'drives_back')::boolean, false),
        nullif(e->>'seats_offered_out', '')::int, nullif(e->>'seats_offered_back', '')::int,
        v_guests, nullif(e->>'guest_note', ''), nullif(e->>'notes', ''),
        nullif(e->>'volunteer_note', ''), p_household_id, p_actor, p_actor
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

drop function if exists public.cancel_household_signup(bigint, text, text);

create or replace function public.cancel_household_signup(
  p_event_signup_id bigint,
  p_household_id bigint,
  p_actor text
)
returns int
language plpgsql
as $$
declare v_count int;
begin
  update public.signup_entries
  set status = 'cancelled', cancelled_at = now(), updated_by = p_actor, updated_at = now()
  where event_signup_id = p_event_signup_id
    and household_id = p_household_id
    and status <> 'cancelled';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Add a parent to a scout record mid-signup ──────────────────────────────
-- Parent contact info is hard to collect ahead of time, so the signup form is
-- often the first moment a second adult's details exist. Capturing them as a
-- real scout_parents row (not a throwaway name on one entry) is what makes
-- the roster improve over time instead of staying stale.
create or replace function public.add_parent_to_household(
  p_household_id bigint,
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_relationship text default null
)
returns bigint
language plpgsql
as $$
declare
  v_scout text;
  v_parent_id bigint;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'PARENT_NAME_REQUIRED'; end if;

  -- Attach to one scout in the household; siblings resolve to the same adult
  -- through the household, so one row is enough.
  select id into v_scout from public.scouts
  where household_id = p_household_id order by id limit 1;
  if v_scout is null then raise exception 'HOUSEHOLD_HAS_NO_SCOUTS: %', p_household_id; end if;

  insert into public.scout_parents (scout_id, name, relationship, email, phone)
  values (v_scout, trim(p_name), nullif(trim(coalesce(p_relationship, '')), ''),
          nullif(lower(trim(coalesce(p_email, ''))), ''), nullif(trim(coalesce(p_phone, '')), ''))
  returning id into v_parent_id;

  if nullif(trim(coalesce(p_email, '')), '') is not null then
    insert into public.scout_parent_emails (scout_parent_id, email, label, is_primary)
    values (v_parent_id, lower(trim(p_email)), 'home', true)
    on conflict (scout_parent_id, email) do nothing;
  end if;

  return v_parent_id;
end;
$$;

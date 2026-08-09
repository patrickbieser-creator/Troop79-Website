-- Per-claim comment.
--
-- "I have a 6ft table", "can only stay until noon", "bringing my own dolly" —
-- a note about ONE person doing ONE job. signup_entries.notes already exists
-- but is per person per EVENT, so someone claiming three jobs would have a
-- single box for all three. signup_slot_claims' primary key is
-- (slot_id, signup_entry_id), which is exactly the grain wanted.
alter table public.signup_slot_claims
  add column if not exists comment text;

comment on column public.signup_slot_claims.comment is
  'Optional short note the claimant wrote about doing this specific job. Shown to leaders on the roster.';

-- claim_signup_slot gains p_comment. The 2-argument version is DROPPED rather
-- than left in place: a default on the new third parameter would make
-- claim_signup_slot(bigint, bigint) ambiguous between the two overloads and
-- every existing call would start failing. Dropping first is what makes the
-- signature change safe, and the only caller
-- (app/(public)/events/[id]/actions.ts) is updated in the same commit.
drop function if exists public.claim_signup_slot(bigint, bigint);

-- Claim a slot under a row lock on the slot. Enforces eligibility, capacity,
-- and the attendance rule server-side — the UI hides these, but hiding is not
-- enforcing. Returns 'claimed', 'already', or 'full'.
create or replace function public.claim_signup_slot(
  p_slot_id bigint,
  p_signup_entry_id bigint,
  p_comment text default null
)
returns text
language plpgsql
as $$
declare
  v_needed int;
  v_elig text;
  v_attend_req boolean;
  v_slot_signup bigint;
  v_filled int;
  v_kind text;
  v_part text;
  v_entry_signup bigint;
  v_status text;
begin
  select needed, eligibility, attendance_required, event_signup_id
    into v_needed, v_elig, v_attend_req, v_slot_signup
  from public.signup_slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot % not found', p_slot_id;
  end if;

  select person_kind, participation, event_signup_id, status
    into v_kind, v_part, v_entry_signup, v_status
  from public.signup_entries where id = p_signup_entry_id;
  if not found then
    raise exception 'entry % not found', p_signup_entry_id;
  end if;

  -- A claim may never cross events.
  if v_entry_signup <> v_slot_signup then
    raise exception 'entry % does not belong to the same event as slot %',
      p_signup_entry_id, p_slot_id;
  end if;

  if v_status = 'cancelled' then
    raise exception 'cannot claim a slot for a cancelled entry';
  end if;

  -- Eligibility: scouts-only / adults-only slots.
  if v_elig <> 'both'
     and v_elig <> (case when v_kind = 'scout' then 'scouts' else 'adults' end) then
    raise exception 'entry % (%) is not eligible for an %-only slot', p_signup_entry_id, v_kind, v_elig;
  end if;

  -- Non-attending participants may only claim donation-style tasks.
  if v_attend_req and v_part in ('driver_only', 'contributor') then
    raise exception 'a % entry may only claim tasks that do not require attendance', v_part;
  end if;

  -- Already claimed: still apply the comment. A family editing their signup
  -- resubmits every claim they hold, so without this an edited note would be
  -- silently dropped on everything except brand-new claims.
  if exists (select 1 from public.signup_slot_claims
             where slot_id = p_slot_id and signup_entry_id = p_signup_entry_id) then
    update public.signup_slot_claims
       set comment = nullif(btrim(coalesce(p_comment, '')), '')
     where slot_id = p_slot_id and signup_entry_id = p_signup_entry_id;
    return 'already';
  end if;

  -- Coverage counts only live entries, so cancelling releases a spot.
  if v_needed is not null then
    select count(*) into v_filled
    from public.signup_slot_claims c
    join public.signup_entries e on e.id = c.signup_entry_id
    where c.slot_id = p_slot_id and e.status = 'yes';

    if v_filled >= v_needed then
      return 'full';
    end if;
  end if;

  insert into public.signup_slot_claims (slot_id, signup_entry_id, comment)
  values (p_slot_id, p_signup_entry_id, nullif(btrim(coalesce(p_comment, '')), ''));
  return 'claimed';
end;
$$;

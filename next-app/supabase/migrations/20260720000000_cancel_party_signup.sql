-- ═══════════════════════════════════════════════════════════════════════════
-- Cancel a signup for parties that have no stored household row
-- ═══════════════════════════════════════════════════════════════════════════
-- Cancelling was keyed on households.id. Two of the three party shapes in the
-- signup flow don't have one:
--
--   * an unassigned scout (`scout:<id>` — scouts.household_id is null)
--   * an adult on the leader roster with no scout in the troop (`leader:<code>`)
--
-- Their entries carry household_id = null, so `household_id = p_household_id`
-- matched nothing and Cancel silently reported success while changing zero
-- rows. Harmless while standalone adults couldn't sign up at all; a real bug
-- now that they can.
--
-- cancel_party_signup takes the party's identities instead. A party WITH a
-- stored household passes p_household_id and behaves exactly as before — same
-- filter, same waitlist promotion in the same transaction. A party without one
-- passes the identity arrays it owns, which the caller reads off the same
-- Household object it used to render the form, so a crafted POST can't cancel
-- someone else's entry by guessing an id it wasn't given.
--
-- cancel_household_signup is left in place: it is still correct for households
-- and may have other callers.

create or replace function public.cancel_party_signup(
  p_event_signup_id bigint,
  p_actor text,
  p_household_id bigint default null,
  p_scout_ids text[] default '{}',
  p_scout_parent_ids bigint[] default '{}',
  p_leader_codes text[] default '{}'
)
returns int
language plpgsql
as $$
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
        else
          (scout_id is not null and scout_id = any (p_scout_ids))
          or (scout_parent_id is not null and scout_parent_id = any (p_scout_parent_ids))
          or (leader_code is not null and leader_code = any (p_leader_codes))
      end
    );
  get diagnostics v_count = row_count;

  perform public.promote_waitlist(p_event_signup_id);
  return v_count;
end;
$$;

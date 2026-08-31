'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';

/**
 * People → Guests tab writes (Plans/Guests-As-People.md Phase 2).
 *
 * Both are gated exactly like every other roster action ('roster.manage' —
 * qa-lead: the Guests tab is leader-only, same as the rest of the roster).
 */

const PATHS = ['/admin/advancement/roster'];

interface Result {
  ok: boolean;
  error?: string;
}

function revalidate() {
  for (const p of PATHS) revalidatePath(p);
}

/**
 * Forget a guest. A guest nothing references (never signed up) is deleted
 * outright; one with sign-up history is deactivated instead
 * (active=false, inactive_reason='guest-forgotten') — signup_entries.person_id
 * is ON DELETE RESTRICT, so the delete path is only taken when the count is
 * zero, never by catching the constraint error.
 */
export async function forgetGuest(personId: number): Promise<Result> {
  await requireCapability('roster.manage');
  const supabase = createAdminClient();

  const { data: person } = await supabase
    .from('people')
    .select('id, guest_host_household_id')
    .eq('id', personId)
    .maybeSingle();
  if (!person) return { ok: false, error: 'That person is not on record.' };
  if (person.guest_host_household_id == null) {
    return { ok: false, error: 'That person is a member, not a guest — use the Adults/Scouts tabs.' };
  }

  const { count } = await supabase
    .from('signup_entries')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', personId);

  let summary: string;
  if ((count ?? 0) === 0) {
    const { error } = await supabase.from('people').delete().eq('id', personId);
    if (error) return { ok: false, error: error.message };
    summary = `Forgot guest ${personId} (deleted)`;
  } else {
    const { error } = await supabase
      .from('people')
      .update({ active: false, inactive_reason: 'guest-forgotten', updated_at: new Date().toISOString() })
      .eq('id', personId);
    if (error) return { ok: false, error: error.message };
    summary = `Forgot guest ${personId} (deactivated — had signup history)`;
  }

  await recordAudit({
    area: 'roster',
    action: 'delete',
    entityType: 'guest',
    entityId: personId,
    summary
  });

  revalidate();
  return { ok: true };
}

/**
 * Promote a guest: merge them into the member record they became (a Webelos
 * who crossed over, a sibling who joined). merge_people moves their sign-up
 * history onto the member and clears the guest flag; the guest row stays
 * flagged merged, never destroyed.
 */
export async function promoteGuest(guestPersonId: number, survivorPersonId: number): Promise<Result> {
  const session = await requireCapability('roster.manage');
  if (guestPersonId === survivorPersonId) return { ok: false, error: 'Pick a different person to merge into.' };
  const supabase = createAdminClient();

  const { data: guest } = await supabase
    .from('people')
    .select('id, guest_host_household_id')
    .eq('id', guestPersonId)
    .maybeSingle();
  if (!guest || guest.guest_host_household_id == null) {
    return { ok: false, error: 'That person is not a guest.' };
  }

  const { error } = await supabase.rpc('merge_people', {
    p_survivor: survivorPersonId,
    p_loser: guestPersonId,
    p_decided_by: session.label
  });
  if (error) {
    if (error.message.includes('MERGE_BLOCKED_DUPLICATE_SIGNUP')) {
      return {
        ok: false,
        error:
          'Both people already hold a live sign-up for the same event. Remove one of them on that event’s Roster, then merge again.'
      };
    }
    return { ok: false, error: error.message };
  }

  await recordAudit({
    area: 'roster',
    action: 'promote',
    entityType: 'guest',
    entityId: guestPersonId,
    summary: `Promoted guest ${guestPersonId} into person ${survivorPersonId}`
  });

  revalidate();
  return { ok: true };
}

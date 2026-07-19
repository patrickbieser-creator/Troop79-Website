'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { requireFamilyAccess } from '@/lib/family-access';
import { FAMILY_COOKIE, signFamilySession } from '@/lib/family-session';
import { secretMatches } from '@/lib/signed-cookie';
import { safeInternalPath } from '@/lib/safe-redirect';

/**
 * Family gate: exchange the shared troop password for the family cookie.
 *
 * One password for the whole troop, printed in the Bugle — no accounts, no
 * email, no signup wall, because login friction is the single biggest
 * suppressor of RSVP response rates. See lib/family-session.ts for the
 * accepted risk this carries.
 */
export async function familyGateAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/events');

  // Only ever redirect same-origin — a prefix check is not enough here.
  const safeNext = safeInternalPath(next, '/events');

  if (!process.env.FAMILY_PASSWORD) redirect(`${safeNext}?gate=not-configured`);
  if (!password) redirect(`${safeNext}?gate=missing`);
  if (!secretMatches(password, process.env.FAMILY_PASSWORD)) {
    redirect(`${safeNext}?gate=bad-password`);
  }

  const token = await signFamilySession({ role: 'family', iat: Date.now() });
  const jar = await cookies();
  jar.set(FAMILY_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: FAMILY_COOKIE.maxAgeSeconds
  });

  redirect(safeNext);
}

/** Maps the RPC's raised codes to something a family can act on. */
function friendlyError(message: string): string {
  if (message.includes('SIGNUP_DEADLINE_PASSED'))
    return 'The signup deadline has passed. Contact the Scoutmaster if you still need to make a change.';
  if (message.includes('SIGNUP_CLOSED')) return 'Signups are closed for this event.';
  if (message.includes('EVENT_FULL'))
    return 'This event filled up while you were signing up. Contact the Scoutmaster.';
  if (message.includes('GUESTS_NOT_ALLOWED')) return 'Guests aren’t allowed at this event.';
  if (message.includes('AUDIENCE_MISMATCH'))
    return 'This event isn’t open to everyone you selected.';
  if (message.includes('PRICE_')) return 'That price option isn’t valid for this event — reload and try again.';
  if (message.includes('DAYS_')) return 'Please enter how many days each adult is attending.';
  if (message.includes('SLOT_FULL')) return 'Someone took the last spot on that job. Pick another.';
  return 'Something went wrong saving your signup. Please try again.';
}

/**
 * Submit (or edit) a whole household's signup.
 *
 * All the real enforcement — deadline, capacity/waitlist, tier eligibility,
 * audience, slot eligibility — lives in Postgres, not here: the form hides
 * invalid options, but hiding is not enforcing, and this action is reachable
 * by anyone who can craft a POST.
 */
export async function submitSignupAction(formData: FormData): Promise<void> {
  const audience = await requireFamilyAccess();

  const eventId = Number(formData.get('eventId'));
  const signupId = Number(formData.get('signupId'));
  const householdKey = String(formData.get('householdKey') ?? '');
  const entriesRaw = String(formData.get('entries') ?? '[]');
  const slotClaimsRaw = String(formData.get('slotClaims') ?? '{}');
  const back = `/events/${eventId}?household=${encodeURIComponent(householdKey)}`;

  let entries: unknown[];
  let slotClaims: Record<string, string[]>;
  try {
    entries = JSON.parse(entriesRaw);
    slotClaims = JSON.parse(slotClaimsRaw);
  } catch {
    redirect(`${back}&err=${encodeURIComponent('Could not read the form. Please try again.')}`);
  }

  const supabase = createAdminClient();
  const actor = `family:${audience}`;

  // Adults added on the fly become real scout_parents rows, not throwaway names
  // on one entry — that's what makes the roster improve over time. Done BEFORE
  // the entries submit so their new parent ids can be referenced immediately.
  const householdId = householdKey ? Number(householdKey) : null;
  if (householdId) {
    let newAdults: { name?: string; email?: string; relationship?: string }[] = [];
    try {
      newAdults = JSON.parse(String(formData.get('newAdults') ?? '[]'));
    } catch {
      newAdults = [];
    }
    for (const na of newAdults) {
      if (!na?.name?.trim()) continue;
      const { error: addErr } = await supabase.rpc('add_parent_to_household', {
        p_household_id: householdId,
        p_name: na.name.trim(),
        p_email: na.email?.trim() || null,
        p_phone: null,
        p_relationship: na.relationship?.trim() || null
      });
      if (addErr) {
        redirect(`${back}&err=${encodeURIComponent('Could not save the new adult: ' + addErr.message)}`);
      }
    }
  }

  const { data: written, error } = await supabase.rpc('submit_household_signup', {
    p_event_signup_id: signupId,
    p_entries: entries,
    p_actor: actor,
    p_household_id: householdId
  });
  if (error) redirect(`${back}&err=${encodeURIComponent(friendlyError(error.message))}`);

  // Slot claims resolve per person, so they need the entry ids the RPC just
  // returned. Each claim goes through claim_signup_slot, which holds its own
  // lock and re-checks eligibility.
  const byKey = new Map(
    ((written ?? []) as { key: string; entry_id: number }[]).map((r) => [r.key, r.entry_id])
  );
  for (const [personKey, slotIds] of Object.entries(slotClaims)) {
    const entryId = byKey.get(personKey);
    if (!entryId) continue;
    for (const slotId of slotIds) {
      const { error: claimErr } = await supabase.rpc('claim_signup_slot', {
        p_slot_id: Number(slotId),
        p_signup_entry_id: entryId
      });
      if (claimErr) redirect(`${back}&err=${encodeURIComponent(friendlyError(claimErr.message))}`);
    }
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath('/events');
  redirect(`${back}&saved=1`);
}

export async function cancelSignupAction(formData: FormData): Promise<void> {
  const audience = await requireFamilyAccess();
  const eventId = Number(formData.get('eventId'));
  const signupId = Number(formData.get('signupId'));
  const householdKey = String(formData.get('householdKey') ?? '');

  const supabase = createAdminClient();
  const { error } = await supabase.rpc('cancel_household_signup', {
    p_event_signup_id: signupId,
    p_household_id: Number(householdKey),
    p_actor: `family:${audience}`
  });

  const back = `/events/${eventId}?household=${encodeURIComponent(householdKey)}`;
  if (error) redirect(`${back}&err=${encodeURIComponent(friendlyError(error.message))}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath('/events');
  redirect(`${back}&cancelled=1`);
}

export async function familySignOutAction(formData: FormData): Promise<void> {
  const safeNext = safeInternalPath(String(formData.get('next') ?? ''), '/events');
  const jar = await cookies();
  jar.delete(FAMILY_COOKIE.name);
  redirect(safeNext);
}

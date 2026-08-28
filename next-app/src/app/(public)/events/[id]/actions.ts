'use server';

import { normalizeGuestRows, guestEntriesFor, guestHostKey, staleClaims, groupStaleClaimsByEntry } from '@/lib/event-signup';
import { placementPayloadFromForm } from '@/lib/group-sets';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireVerifiedSignupAccess, requireWritableHouseholdKey, getIdentitySessionIfValid } from '@/lib/family-access';
import { FAMILY_COOKIE, signFamilySession } from '@/lib/family-session';
import { secretMatches } from '@/lib/signed-cookie';
import { safeInternalPath } from '@/lib/safe-redirect';
import { loadHouseholdByKey, storedHouseholdId } from '@/lib/households';
import { changeFor, loadHouseholdSnapshot, sendSignupConfirmations } from '@/lib/signup-confirmation-send';

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
  if (message.includes('GUEST_HOUSEHOLD_CAP'))
    return 'Your household already has a lot of guests on record — ask a leader to tidy the list (People → Guests) before adding more.';
  if (message.includes('GUEST_EVENT_CAP')) return 'That’s more than 20 guests on one sign-up — contact the Scoutmaster.';
  if (message.includes('GUEST_NAME_TOO_LONG')) return 'A guest’s name is too long (80 characters max).';
  if (message.includes('GUEST_NAME_REQUIRED')) return 'Give each guest a name, or remove the empty row.';
  if (message.includes('GUEST_NEEDS_HOST') || message.includes('GUEST_NEEDS_HOUSEHOLD'))
    return 'Guests are saved with whoever from your household is attending — mark at least one person as attending.';
  if (message.includes('GUEST_CLASS_INVALID')) return 'Pick a guest type for each guest.';
  if (message.includes('AUDIENCE_MISMATCH'))
    return 'This event isn’t open to everyone you selected.';
  if (message.includes('PRICE_')) return 'That price option isn’t valid for this event — reload and try again.';
  if (message.includes('DAYS_')) return 'Please enter how many days each adult is attending.';
  if (message.includes('ANSWER_REQUIRED'))
    return 'Please answer every required question for each person attending.';
  if (message.includes('ANSWER_NOT_A_NUMBER')) return 'One of the answers needs to be a number.';
  if (message.includes('SLOT_FULL')) return 'Someone took the last spot on that job. Pick another.';
  if (message.includes('PERSON_NOT_IN_PARTY'))
    return 'That doesn’t look like someone in your household. Reload the page and try again.';
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
  const eventId = Number(formData.get('eventId'));
  const signupId = Number(formData.get('signupId'));
  const requestedHouseholdKey = String(formData.get('householdKey') ?? '');
  const entriesRaw = String(formData.get('entries') ?? '[]');
  const slotClaimsRaw = String(formData.get('slotClaims') ?? '{}');
  const slotCommentsRaw = String(formData.get('slotComments') ?? '{}');
  const back = `/events/${eventId}/signup?household=${encodeURIComponent(requestedHouseholdKey)}`;

  // Verified Signup (2026-08-26): a troop-password-only visitor is refused
  // here, server-side, not just by the page hiding the form. The guard also
  // rejects a revoked identity session (qa-lead 2026-08-06) — caught rather
  // than left to crash the request, same polish as every other guard clause.
  // Household scope (2026-08-27): the posted key is a request — a family is
  // pinned to its own household; only a superuser may name another.
  let audience;
  let householdKey: string;
  try {
    audience = await requireVerifiedSignupAccess();
    householdKey = await requireWritableHouseholdKey(requestedHouseholdKey, audience);
  } catch (e) {
    redirect(`${back}&err=${encodeURIComponent(e instanceof Error ? e.message : 'Please sign in to sign up.')}`);
  }

  let entries: unknown[];
  let slotClaims: Record<string, string[]>;
  // slotId -> the household's note about that job. One note per job rather
  // than per person: the storage grain is (slot, entry) so each claimant's row
  // gets its own copy, but two people from one family doing the same job share
  // one thing to say about it, and a box per person-chip would be noise.
  let slotComments: Record<string, string>;
  try {
    entries = JSON.parse(entriesRaw);
    slotClaims = JSON.parse(slotClaimsRaw);
    slotComments = JSON.parse(slotCommentsRaw);
  } catch {
    redirect(`${back}&err=${encodeURIComponent('Could not read the form. Please try again.')}`);
  }

  const supabase = createAdminClient();
  const actor = `family:${audience}`;

  // Named guests (Plans/Guests-As-People.md) ride INSIDE the RPC payload, each
  // hosted by the party's first attending member (an adult when there is one)
  // — the RPC creates or re-picks the guest's people row, takes their seat,
  // and turns a dropped guest's row to 'no'. With nobody attending there is
  // nothing to attach a guest to, so the list is simply not sent (the RPC's
  // reconcile then marks any saved guests 'no' along with the family).
  const guestRows = normalizeGuestRows(String(formData.get('guests') ?? ''));
  if (guestRows.length > 0) {
    const hostKey = guestHostKey(entries as Record<string, unknown>[]);
    if (hostKey) entries = [...entries, ...guestEntriesFor(guestRows, hostKey)];
  }

  // Adults added on the fly become real people, not throwaway names on one
  // entry — that's what makes the roster improve over time. Done BEFORE the
  // entries submit so the new person ids can be referenced immediately.
  // Null for the two party shapes with no stored household row (`scout:<id>`,
  // `leader:<code>`). The submit RPC already accepts a null household.
  const householdId = storedHouseholdId(householdKey);
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

  // Resolved server-side from the same source loadHouseholdByKey renders the
  // form from — never trusted from the client's entries payload. Covers all
  // 3 party shapes (stored household, unassigned scout, standalone adult)
  // with no shape-specific logic; the RPC just checks membership in this list.
  const party = await loadHouseholdByKey(householdKey);
  const allowedPersonIds = [
    ...(party?.scouts.map((s) => s.personId).filter((v): v is number => v != null) ?? []),
    ...(party?.adults.map((a) => a.personId) ?? [])
  ];

  // For the confirmation email's "what changed" (and new-vs-update): the
  // household's rows as they are BEFORE this write. Never blocks the submit.
  const before = await loadHouseholdSnapshot(supabase, signupId, party, householdId).catch(() => null);

  const { data: written, error } = await supabase.rpc('submit_household_signup', {
    p_event_signup_id: signupId,
    p_entries: entries,
    p_actor: actor,
    p_household_id: householdId,
    p_allowed_person_ids: allowedPersonIds
  });
  if (error) redirect(`${back}&err=${encodeURIComponent(friendlyError(error.message))}`);

  // Verified-identity attribution (Plans/Family-Identity-Auth.md Phase 2) —
  // additive only, a follow-up UPDATE rather than touching the RPC itself
  // (that function has a documented history of breaking on signature
  // changes without an explicit DROP FUNCTION first; a separate UPDATE
  // carries none of that risk). entered_by_person_id is set once — an
  // existing entry someone else originally created keeps its original
  // attribution even when a second verified household member edits it;
  // updated_by_person_id always reflects the most recent verified writer.
  // Unverified (Tier 1) submissions leave both null, same as before.
  const writtenRows = (written ?? []) as { key: string; entry_id: number }[];
  if (audience === 'household') {
    const session = await getIdentitySessionIfValid();
    const entryIds = writtenRows.map((r) => r.entry_id);
    if (session && entryIds.length > 0) {
      // Two disjoint-column writes on the same id set (one unconditional,
      // one gated on entered_by_person_id still being null) — nothing here
      // reads the other's result, so they go out together instead of one
      // round trip after the other.
      await Promise.all([
        supabase.from('signup_entries').update({ updated_by_person_id: session.personId }).in('id', entryIds),
        supabase
          .from('signup_entries')
          .update({ entered_by_person_id: session.personId })
          .in('id', entryIds)
          .is('entered_by_person_id', null)
      ]);
    }
  }

  // (Guest rows used to be deleted and re-inserted here; since Guests as
  // People the RPC owns them — see the payload build above.)
  const partyEntryIds = writtenRows.map((r) => r.entry_id);

  // Slot claims resolve per person, so they need the entry ids the RPC just
  // returned. Each claim goes through claim_signup_slot, which holds its own
  // lock and re-checks eligibility.
  const byKey = new Map(writtenRows.map((r) => [r.key, r.entry_id]));

  // Reconcile FIRST: drop the party's claims the form no longer carries
  // (Patrick, 2026-08-23 — removing a name on the job board and saving
  // brought the name back: the person was absent from the payload, so their
  // entry stayed 'yes' and the claim stayed). The form now sends a removed
  // person as status 'no' (the RPC handles that above) and this deletes the
  // claims nobody asked for. Only when the form carried a slotClaims field
  // at all — a form without a jobs section must not wipe leader-made claims.
  if (formData.has('slotClaims') && partyEntryIds.length > 0) {
    const wanted = new Set<string>();
    for (const [personKey, slotIds] of Object.entries(slotClaims)) {
      const entryId = byKey.get(personKey);
      if (!entryId) continue;
      for (const slotId of slotIds) wanted.add(`${entryId}:${Number(slotId)}`);
    }
    const { data: current } = await supabase
      .from('signup_slot_claims')
      .select('slot_id, signup_entry_id')
      .in('signup_entry_id', partyEntryIds);
    const stale = staleClaims(
      ((current ?? []) as { slot_id: number; signup_entry_id: number }[]).map((c) => ({ entryId: c.signup_entry_id, slotId: c.slot_id })),
      wanted
    );
    // One `.in()` delete per entry rather than one per stale claim — a
    // person dropping several jobs at once used to be several round trips.
    await Promise.all(
      groupStaleClaimsByEntry(stale).map(({ entryId, slotIds }) =>
        supabase.from('signup_slot_claims').delete().eq('signup_entry_id', entryId).in('slot_id', slotIds)
      )
    );
  }

  for (const [personKey, slotIds] of Object.entries(slotClaims)) {
    const entryId = byKey.get(personKey);
    if (!entryId) continue;
    for (const slotId of slotIds) {
      const note = slotComments?.[String(slotId)];
      const { error: claimErr } = await supabase.rpc('claim_signup_slot', {
        p_slot_id: Number(slotId),
        p_signup_entry_id: entryId,
        // Length-capped here as well as in the input: this action is reachable
        // by anyone who can craft a POST, same reasoning as the eligibility
        // checks living in the RPC rather than the UI.
        p_comment: typeof note === 'string' ? note.trim().slice(0, 300) || null : null
      });
      if (claimErr) redirect(`${back}&err=${encodeURIComponent(friendlyError(claimErr.message))}`);
    }
  }

  // Self-select placements (Plans/Event-Logistics.md §B): the family's
  // "tent preference" lands directly as a membership, leaders can move it.
  // Only sets the SERVER marks self_select are honoured; a full group comes
  // back as 'full' from the RPC and is simply not applied (the form disables
  // full options — a race is the only way to get here). Blank clears a
  // prior pick in that set.
  const { data: selfSets } = await supabase
    .from('signup_group_sets')
    .select('id')
    .eq('event_signup_id', signupId)
    .eq('self_select', true)
    .neq('kind', 'car');
  const selfSetIds = new Set(((selfSets ?? []) as { id: number }[]).map((s) => s.id));
  // Each pick is a distinct (setId, entryId) pair (placementPayloadFromForm
  // is keyed that way), so no two picks touch the same group membership row
  // — safe to run them concurrently instead of one at a time.
  const picks = placementPayloadFromForm(String(formData.get('placements') ?? ''), selfSetIds);
  await Promise.all(
    picks.map(async (pick) => {
      const entryId = byKey.get(pick.personKey);
      if (!entryId) return;
      if (pick.groupId == null) {
        const { data: current } = await supabase
          .from('signup_group_members')
          .select('group_id')
          .eq('set_id', pick.setId)
          .eq('entry_id', entryId)
          .maybeSingle();
        if (current) {
          await supabase.rpc('unplace_from_group', {
            p_group_id: (current as { group_id: number }).group_id,
            p_entry_id: entryId
          });
        }
        return;
      }
      await supabase.rpc('place_in_group', { p_group_id: pick.groupId, p_entry_id: entryId, p_actor: actor });
    })
  );

  // The receipt (Plans/Signup-Confirmation-Email.md): family + leaders, each
  // once, after everything above succeeded. It never throws — and it no
  // longer holds the redirect: templates, two snapshots and the Resend call
  // were the "signup click is delayed" wait
  // (Plans/Performance-Review-2026-08-27.md #2). after() runs it once the
  // response is out; the family sees "Saved" at once, the mail follows.
  const session = audience === 'household' ? await getIdentitySessionIfValid() : null;
  after(() =>
    sendSignupConfirmations({
      signupId,
      party,
      householdId,
      submitterPersonId: session?.personId ?? null,
      change: changeFor(before),
      before
    })
  );

  // Not `/events`: the list shows no signup data, and it is the one ISR page
  // (Plans/Performance-Review-2026-08-27.md #9).
  revalidatePath(`/events/${eventId}`);
  redirect(`${back}&saved=1`);
}

export async function cancelSignupAction(formData: FormData): Promise<void> {
  const eventId = Number(formData.get('eventId'));
  const signupId = Number(formData.get('signupId'));
  const requestedHouseholdKey = String(formData.get('householdKey') ?? '');
  const back = `/events/${eventId}/signup?household=${encodeURIComponent(requestedHouseholdKey)}`;

  // Same two guards as submitSignupAction: who may write, then for whom —
  // cancelling another family's signup was the sharpest edge of the old
  // any-household rule (2026-08-27).
  let audience;
  let householdKey: string;
  try {
    audience = await requireVerifiedSignupAccess();
    householdKey = await requireWritableHouseholdKey(requestedHouseholdKey, audience);
  } catch (e) {
    redirect(`${back}&err=${encodeURIComponent(e instanceof Error ? e.message : 'Please sign in to sign up.')}`);
  }

  const supabase = createAdminClient();
  // Resolve the party server-side rather than trusting posted identities — the
  // caller only ever names a household key, and we cancel exactly the people
  // that key resolves to.
  const party = await loadHouseholdByKey(householdKey);
  const cancelHouseholdId = storedHouseholdId(householdKey);
  // What is about to be dropped — the cancel receipt is built from this.
  const before = await loadHouseholdSnapshot(supabase, signupId, party, cancelHouseholdId).catch(() => null);
  const { error } = await supabase.rpc('cancel_party_signup', {
    p_event_signup_id: signupId,
    p_actor: `family:${audience}`,
    p_household_id: storedHouseholdId(householdKey),
    // Person ids only — cancel_party_signup dropped its scout / parent-row /
    // leader-code arrays with the columns they matched on (D-066).
    p_person_ids: [
      ...(party?.scouts.map((s) => s.personId).filter((v): v is number => v != null) ?? []),
      ...(party?.adults.map((a) => a.personId) ?? [])
    ]
  });

  if (error) redirect(`${back}&err=${encodeURIComponent(friendlyError(error.message))}`);
  if (before && before.rows.length) {
    const session = audience === 'household' ? await getIdentitySessionIfValid() : null;
    after(() =>
      sendSignupConfirmations({
        signupId,
        party,
        householdId: cancelHouseholdId,
        submitterPersonId: session?.personId ?? null,
        change: 'cancel',
        before
      })
    );
  }
  // Not `/events`: the list shows no signup data, and it is the one ISR page
  // (Plans/Performance-Review-2026-08-27.md #9).
  revalidatePath(`/events/${eventId}`);
  redirect(`${back}&cancelled=1`);
}

export async function familySignOutAction(formData: FormData): Promise<void> {
  const safeNext = safeInternalPath(String(formData.get('next') ?? ''), '/events');
  const jar = await cookies();
  jar.delete(FAMILY_COOKIE.name);
  // Land with a flag so the page can confirm it worked. Without this the
  // redirect is silent and indistinguishable from the button doing nothing.
  const sep = safeNext.includes('?') ? '&' : '?';
  redirect(`${safeNext}${sep}signedout=1`);
}

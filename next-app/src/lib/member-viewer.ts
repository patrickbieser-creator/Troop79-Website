/**
 * "Whose Members area is this?" — the read-only superuser proxy for /member,
 * /member/scout-account, /profile and /member/reimbursements (Patrick,
 * 2026-10-13: "add the ability to superuser proxy from the members page, same
 * as is true under the advancement page").
 *
 * GATE: the existing `library.proxy_view` capability (the Librarian bundle) —
 * no new capability — with the same `subjectKind !== 'scout'` guard as
 * actorCanProxyLibrary(): a scout holding the grant by mistake must never see
 * another family's household details or money.
 *
 * READ-ONLY, ALWAYS. A proxy viewer sees the chosen scout's FAMILY as that
 * family would, but every page drops its forms and buttons that write
 * (profile editors, reimbursement submit/withdraw, passkeys, sign-out). The
 * server actions still act only on the SESSION's own household/person — none
 * accepts a household id from request data that outranks the session — so no
 * request can point a write at a proxied household.
 *
 * SHAPE follows lib/finance-viewer.ts: default to the viewer's own family
 * with the switcher offered alongside; `?viewScout=<personId>` turns proxy on
 * and its absence turns it off (no server-side toggle state). A leader with
 * no family of their own gets 'proxy-available' (an explicit picker).
 * Leaders always arrive with a t79_identity session under the unified model
 * (resolveAdminActor's legacy cookie is dead since 2026-08-16), but the
 * resolver does not require one — proxy rights alone reach the picker.
 *
 * "FAMILY" = the chosen scout's household (loadProxyFamily): everyone
 * loadHouseholdByKey returns for the scout's person — the scout, siblings and
 * the household's adults — NOT resolveFamilyScope (a scout's scope there is
 * only themselves). A scout with no household row is a family of one.
 *
 * Decision logic is pure (decideMemberViewer / pickChosenScout) and the
 * cookie/DB resolution is separate, for the same D-049 reason as the library
 * and finance viewers.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAdminActor, actorHas, type AdminActor } from '@/lib/admin-actor';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { loadHouseholdByKey, resolveHouseholdKeyForPerson, type Household } from '@/lib/households';

/** Same guard as actorCanProxyLibrary(), restated so this module does not
 *  import the library resolver's data layer. Keep the two in step. */
export function actorCanProxyMembers(actor: AdminActor | null): boolean {
  return !!actor && actor.subjectKind !== 'scout' && actorHas(actor, 'library.proxy_view');
}

export interface MemberScoutOption {
  personId: number;
  name: string;
}

export type MemberViewer =
  /** The viewer's own session (or none). switchOptions is non-empty only for
   *  a proxy-capable viewer, where it drives the "view as a scout" offer. */
  | { kind: 'own'; switchOptions: MemberScoutOption[] }
  | { kind: 'proxy-available'; options: MemberScoutOption[] }
  | { kind: 'proxy'; personId: number; name: string; switchOptions: MemberScoutOption[] };

/** A `?viewScout=` value only counts if it names an ACTIVE scout in the list
 *  the caller loaded (which is empty unless the viewer may proxy). */
export function pickChosenScout(param: string | undefined, activeScouts: MemberScoutOption[]): MemberScoutOption | null {
  if (!param) return null;
  const id = Number(param);
  if (!Number.isFinite(id)) return null;
  return activeScouts.find((s) => s.personId === id) ?? null;
}

export function decideMemberViewer(input: {
  canProxy: boolean;
  /** A valid, unrevoked identity session exists. */
  hasOwnFamily: boolean;
  activeScouts: MemberScoutOption[];
  /** Already validated by pickChosenScout. */
  chosen: MemberScoutOption | null;
}): MemberViewer {
  if (!input.canProxy) return { kind: 'own', switchOptions: [] };
  if (input.chosen) {
    return { kind: 'proxy', personId: input.chosen.personId, name: input.chosen.name, switchOptions: input.activeScouts };
  }
  if (input.hasOwnFamily || input.activeScouts.length === 0) {
    return { kind: 'own', switchOptions: input.activeScouts };
  }
  return { kind: 'proxy-available', options: input.activeScouts };
}

export async function loadActiveScoutOptions(supabase: SupabaseClient): Promise<MemberScoutOption[]> {
  const { data } = await supabase
    .from('scouts')
    .select('person_id, display_name')
    .eq('active', true)
    .not('person_id', 'is', null)
    .order('display_name');
  return ((data ?? []) as { person_id: number; display_name: string }[]).map((s) => ({
    personId: s.person_id,
    name: s.display_name
  }));
}

export async function resolveMemberViewer(
  supabase: SupabaseClient,
  viewScoutParam: string | undefined
): Promise<MemberViewer> {
  const actor = await resolveAdminActor();
  const canProxy = actorCanProxyMembers(actor);
  if (!canProxy) return decideMemberViewer({ canProxy, hasOwnFamily: false, activeScouts: [], chosen: null });

  const identity = await getIdentitySessionIfValid();
  const hasOwnFamily = !!identity && (await isEpochCurrent(supabase, identity));
  const activeScouts = await loadActiveScoutOptions(supabase);
  return decideMemberViewer({
    canProxy,
    hasOwnFamily,
    activeScouts,
    chosen: pickChosenScout(viewScoutParam, activeScouts)
  });
}

/** The proxied scout's household and every person in it. Null household = a
 *  scout with no household row: a family of one (personIds = [scout]). */
export async function loadProxyFamily(
  scoutPersonId: number
): Promise<{ household: Household | null; personIds: number[] }> {
  const key = await resolveHouseholdKeyForPerson(scoutPersonId);
  const household = key ? await loadHouseholdByKey(key) : null;
  if (!household) return { household: null, personIds: [scoutPersonId] };
  const ids = new Set<number>([scoutPersonId]);
  for (const s of household.scouts) if (s.personId != null) ids.add(s.personId);
  for (const a of household.adults) ids.add(a.personId);
  return { household, personIds: [...ids] };
}

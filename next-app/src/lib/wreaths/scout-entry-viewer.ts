/**
 * Who is typing? The ONE place a request becomes a ScoutEntryViewer for the wreath sale's scout-entry features: the
 * store page's switch, the order action, and the Members edit / cancel / goal actions. Nothing here reads a person id
 * from a request. The viewer is the verified identity session (signature AND the revocation epoch), scoped by
 * resolveFamilyScope: a scout acts for themself, an adult for themself and their children (parent_of / guardian_of).
 *
 * A leader browsing as a family (`?viewScout=`, library.proxy_view) is NOT a viewer here: that proxy is a page-level
 * lens on /member and never changes the session, so a leader who is not that scout's parent has no right to the scout
 * and the actions refuse. Server-only (reads cookies).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { resolveFamilyScope } from '@/lib/household-scope';
import { emailForPerson } from '@/lib/person-emails';
import type { ScoutEntryViewer } from './place-order';

export async function resolveScoutEntryViewer(sb: SupabaseClient): Promise<ScoutEntryViewer | null> {
  const session = await getIdentitySessionIfValid();
  if (!session || !(await isEpochCurrent(sb, session))) return null;
  const scope = await resolveFamilyScope(sb, session.personId, session.subjectKind);
  const { data } = await sb.from('people').select('display_name').eq('id', session.personId).maybeSingle();
  return { personId: session.personId, name: (data as { display_name: string } | null)?.display_name ?? `Person ${session.personId}`, scope };
}

/** The viewer's own deliverable address, as a list (empty when they have none, the usual case for a young scout). */
export async function entererEmails(sb: SupabaseClient, personId: number): Promise<string[]> {
  const e = await emailForPerson(sb, personId);
  return e ? [e] : [];
}

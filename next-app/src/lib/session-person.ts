import { cookies } from 'next/headers';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { loadAuthorizedAdults, matchAuthorizedAdult } from '@/lib/authorized-adults';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Which PERSON the current leader session belongs to.
 *
 * A leader session is already an identified human: login matches the typed
 * username against the authorized-adults list and stores that adult's label
 * (admin/login/actions.ts). What it does NOT store is a person_id, so the
 * label has to be matched back — the same match the login itself performed,
 * run in reverse.
 *
 * That reverse match is why this lives behind a function rather than being
 * inlined: it is lossy in principle (two adults sharing a label would
 * collide), and the durable fix is to put person_id in the session token at
 * login so nothing has to be re-derived. Doing that only helps sessions
 * signed AFTER the change, so this path is needed either way and is the one
 * place to revisit.
 *
 * Returns null for a scout-role session: those store whatever username was
 * typed, unmatched against any roster, so there is no person to resolve.
 */
export async function leaderSessionPersonId(): Promise<number | null> {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session || session.role !== 'leader') return null;

  const supabase = createAdminClient();
  const matched = matchAuthorizedAdult(await loadAuthorizedAdults(supabase), session.leader);
  if (!matched) return null;

  const { data } = await supabase
    .from('leaders')
    .select('person_id')
    .eq('code', matched.code)
    .maybeSingle();
  const personId = (data as { person_id?: number | null } | null)?.person_id;
  return typeof personId === 'number' ? personId : null;
}

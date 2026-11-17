/**
 * GET /admin/search?q= — the records half of search (Plans/Admin-Portal-Nav.md decision 8): people, calendar entries
 * and articles, at most five of each, only the kinds the signed-in person could open (lib/admin-record-search.ts).
 * A route handler rather than a server action: server actions run one at a time, so a slow search would hold up the
 * navigation that follows it, and a typed-ahead request can be aborted. proxy.ts has already turned away a request
 * with no admin credential; this re-resolves the actor for its capabilities.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { actorCanEnterAdmin, resolveAdminActor } from '@/lib/admin-actor';
import { NO_RECORDS, searchRecords } from '@/lib/admin-record-search';

export async function GET(req: Request): Promise<Response> {
  const actor = await resolveAdminActor();
  if (!actor || !actorCanEnterAdmin(actor)) return Response.json(NO_RECORDS, { status: 403 });
  const q = new URL(req.url).searchParams.get('q') ?? '';
  try {
    const results = await searchRecords(createAdminClient(), q, actor.capabilities);
    return Response.json(results, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('[search]', e instanceof Error ? e.message : e);
    return Response.json(NO_RECORDS, { status: 500 });
  }
}

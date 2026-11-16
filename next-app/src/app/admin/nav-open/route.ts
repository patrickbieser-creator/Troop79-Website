/**
 * POST /admin/nav-open — shortcut tracking's beacon (Plans/Admin-Portal-Nav.md decision 12). The body is one feature
 * key as plain text. proxy.ts has already turned away a request with no admin credential; logNavOpenForActor checks
 * the actor and the key. A cross-site post is refused on its Origin. Always 204: the page never waits on it.
 */
import { logNavOpenForActor } from '../(workspace)/_components/nav-open-log';

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return new Response(null, { status: 403 });
    } catch {
      return new Response(null, { status: 403 });
    }
  }
  const body = (await req.text().catch(() => '')).trim();
  await logNavOpenForActor(body);
  return new Response(null, { status: 204 });
}

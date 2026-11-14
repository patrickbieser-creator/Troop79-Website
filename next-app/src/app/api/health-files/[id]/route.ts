import { healthDeps, healthFamilyAccess } from '@/lib/health-access';
import { healthPageOwner, openHealthPage } from '@/lib/health-store';

/**
 * The only way a health file leaves the site (Plans/Health-Forms.md): who is asking is resolved from the session,
 * the page's owner is checked against who they may see, the access-log row is written, and only then is the
 * ciphertext fetched and opened. The answer is never cached and carries no link to anything.
 *
 * A stranger and a missing page get the same 404: the route never says a document exists.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  // Whatever is shown runs nothing and loads nothing. (A PDF, the one type that can carry active content, is
  // always sent as a download: browsers' PDF viewers don't open inside a sandbox.)
  'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow'
};

const notFound = () => new Response('Not found', { status: 404, headers: HEADERS });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await healthFamilyAccess();
    if (!access) return notFound();
    const deps = healthDeps();
    const owner = await healthPageOwner(deps.supabase, id);
    if (!owner || !access.personIds.includes(owner.personId)) return notFound();
    const download = owner.contentType === 'application/pdf' || new URL(request.url).searchParams.get('download') === '1';
    const res = await openHealthPage(id, access.viewer, download ? 'download' : 'view', deps);
    if (!res.ok) return new Response(res.status === 404 ? 'Not found' : 'This file could not be opened.', { status: res.status, headers: HEADERS });
    return new Response(new Uint8Array(res.bytes), {
      status: 200,
      headers: {
        ...HEADERS,
        'Content-Type': res.contentType,
        'Content-Length': String(res.bytes.length),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${res.filename}"`
      }
    });
  } catch (e) {
    // Includes a failed access-log write: nothing was read.
    console.error('[health] file route failed:', e instanceof Error ? e.message : e);
    return new Response('This file could not be opened.', { status: 500, headers: HEADERS });
  }
}

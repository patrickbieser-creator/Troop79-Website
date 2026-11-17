import { healthAccess, healthDeps } from '@/lib/health-access';
import { healthPageOwner, healthViewerFor, openHealthPage } from '@/lib/health-store';

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
  // Whatever is shown runs nothing and loads nothing.
  'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow'
};

/**
 * A PDF shown in the browser (Patrick, 2026-11-17: View as well as Download). Browsers' PDF viewers won't open under
 * `sandbox`, so a PDF gets its own policy: no scripts in the page, no frames around it, nothing loaded from anywhere.
 * The browser's own viewer draws it; a bug in that viewer is the residual risk (qa-lead, 2026-11-17: Firefox's pdf.js
 * had one, fixed in Firefox 126). Only the named leaders and the family open these.
 */
const PDF_CSP = "default-src 'none'; object-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'";

const notFound = () => new Response('Not found', { status: 404, headers: HEADERS });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await healthAccess();
    if (!access) return notFound();
    const deps = healthDeps();
    const owner = await healthPageOwner(deps.supabase, id);
    // Family, the named list, or an adult on the same trip inside its window: otherwise the page doesn't exist.
    const viewer = owner ? healthViewerFor(access, owner.personId) : null;
    if (!owner || !viewer) return notFound();
    const download = new URL(request.url).searchParams.get('download') === '1';
    const res = await openHealthPage(id, viewer, download ? 'download' : 'view', deps);
    if (!res.ok) return new Response(res.status === 404 ? 'Not found' : 'This file could not be opened.', { status: res.status, headers: HEADERS });
    return new Response(new Uint8Array(res.bytes), {
      status: 200,
      headers: {
        ...HEADERS,
        ...(res.contentType === 'application/pdf' && !download ? { 'Content-Security-Policy': PDF_CSP, 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY' } : {}),
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

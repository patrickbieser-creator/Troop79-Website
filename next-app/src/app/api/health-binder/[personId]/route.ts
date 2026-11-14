import { healthAccess, healthDeps } from '@/lib/health-access';
import { healthFilesConfigured } from '@/lib/health-files';
import { listHealthReviews, loadUpcomingTrip, openHealthPagesForPrint } from '@/lib/health-store';
import { buildPersonBinder } from '@/lib/health-binder';
import { HEALTH_KIND, HEALTH_KINDS, HEALTH_STANDING_LABEL, HEALTH_STATUS_LABEL, healthStanding, kindStatus, pageName, type HealthPage } from '@/lib/health-records';
import { centralToday } from '@/lib/dates';
import { fmtDate } from '@/lib/format-date';

/**
 * One person's section of the medical binder, as a PDF (Plans/Health-Forms.md). The browser asks for each attendee
 * in turn and joins the sections, so no request ever holds a whole troop's scans in memory.
 *
 * NAMED leaders only, and only for someone going on the trip named by `?event=` (a sign-up id): printing is bulk
 * access, so an adult who is merely on the trip can open records but not print the binder. One 'print' line per
 * person is written to the access log before any file is read. Anyone else gets the same 404 as a missing person.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HEADERS = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow'
};
const notFound = () => new Response('Not found', { status: 404, headers: HEADERS });

export async function GET(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  try {
    const personId = Number((await params).personId);
    const access = await healthAccess();
    if (!access?.named || !healthFilesConfigured() || !Number.isInteger(personId) || personId <= 0) return notFound();
    const deps = healthDeps();
    const sb = deps.supabase;
    const today = centralToday();
    const trip = await loadUpcomingTrip(sb, Number(new URL(request.url).searchParams.get('event')), today);
    if (!trip || !trip.attendeeIds.includes(personId)) return notFound();

    const viewer = { personId: access.me.personId, name: access.me.name, via: 'named' as const, eventId: trip.eventId };
    // The log line is written inside, first; a failure throws and nothing is read.
    const printed = await openHealthPagesForPrint(personId, viewer, deps);

    const [{ data: person }, { data: scout }, { data: parentRows }, reviews] = await Promise.all([
      sb.from('people').select('display_name, things_we_should_know').eq('id', personId).maybeSingle(),
      sb.from('scouts').select('person_id').eq('person_id', personId).limit(1),
      sb.from('relationships').select('person_id').eq('related_person_id', personId).in('type', ['parent_of', 'guardian_of']),
      listHealthReviews(sb, [personId])
    ]);
    if (!person) return notFound();
    const p = person as { display_name: string; things_we_should_know: string | null };
    const parentIds = ((parentRows ?? []) as { person_id: number }[]).map((r) => Number(r.person_id));
    const { data: parents } = parentIds.length ? await sb.from('people').select('display_name, primary_phone').in('id', parentIds) : { data: [] };

    const pages: HealthPage[] = printed.map((x, i) => ({ id: String(i), personId, kind: x.kind, page: x.page, contentType: x.contentType, uploadedAt: '', effectiveOn: null, expiresOn: x.expiresOn }));
    const asOf = trip.endDate ?? trip.entryDate;
    const standing = healthStanding(pages, { reviewed: reviews.has(personId), needsPartC: trip.needsPartC, today, asOf });
    const unreadable: string[] = [];
    const docs = HEALTH_KINDS.filter((k) => HEALTH_KIND[k].required || (k === 'bsa_c' && trip.needsPartC) || printed.some((x) => x.kind === k)).map((k) => {
      const mine = printed.filter((x) => x.kind === k);
      const expires = mine.map((x) => x.expiresOn).filter((d): d is string => !!d).sort()[0];
      for (const x of mine) if (!x.bytes) unreadable.push(`${p.display_name}: ${HEALTH_KIND[k].label}, ${pageName(k, x.page).toLowerCase()}`);
      return {
        label: HEALTH_KIND[k].label,
        status: `${HEALTH_STATUS_LABEL[kindStatus(k, pages, today)]}${expires ? `, good until ${fmtDate(expires)}` : ''}`,
        pages: mine.filter((x) => x.bytes).map((x) => ({ name: pageName(k, x.page), contentType: x.contentType, bytes: new Uint8Array(x.bytes!) }))
      };
    });

    const { pdf, unmerged } = await buildPersonBinder({
      name: p.display_name,
      kind: (scout ?? []).length > 0 ? 'Scout' : 'Adult',
      standing: HEALTH_STANDING_LABEL[standing],
      eventTitle: trip.title,
      printedOn: fmtDate(today),
      told: p.things_we_should_know,
      contacts: ((parents ?? []) as { display_name: string; primary_phone: string | null }[]).map((c) => `${c.display_name}: ${c.primary_phone ?? 'no phone on file'}`),
      docs
    });
    // Trimmed as a LIST, so the header always decodes: a cut-off escape would lose every flag.
    const flagged = [...unreadable, ...unmerged].slice(0, 20).map((f) => f.slice(0, 120));
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        ...HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="binder-section.pdf"',
        // What the cover sheet lists as "print separately" (names only; percent-encoded for a header).
        'X-Binder-Flagged': encodeURIComponent(JSON.stringify(flagged))
      }
    });
  } catch (e) {
    console.error('[health] binder route failed:', e instanceof Error ? e.message : e);
    return new Response('This section could not be built.', { status: 500, headers: HEADERS });
  }
}

/**
 * /health/[personId] — one person's health record for a leader at an event (Plans/Health-Forms.md, release 2):
 * what the family told us first, who to call, then the documents. Opening this page is itself logged for anyone
 * who isn't the person's own family, before anything is shown; a failed log shows nothing.
 *
 * Someone with no way in gets the same "not found" as a person who doesn't exist.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { healthAccess, healthDeps } from '@/lib/health-access';
import { healthFilesConfigured } from '@/lib/health-files';
import { healthViewerFor, listHealthPages, listHealthReviews, loadUpcomingTrips, logHealthRecordOpen } from '@/lib/health-store';
import { HEALTH_KIND, HEALTH_KINDS, HEALTH_STANDING_LABEL, HEALTH_STANDING_TONE, HEALTH_STATUS_LABEL, healthStanding, kindStatus, pageName } from '@/lib/health-records';
import { centralToday } from '@/lib/dates';
import { fmtDate } from '@/lib/format-date';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Badge } from '@/app/_components/badge';
import surface from '@/app/_components/card.module.css';
import { ReviewTick } from '../health-controls';
import { setHealthReviewedAction } from '../actions';
import styles from '../health.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Health record — Scout Troop 79',
  robots: { index: false, follow: false }
};

const digits = (phone: string) => phone.replace(/[^\d+]/g, '');

export default async function HealthPersonPage({ params, searchParams }: { params: Promise<{ personId: string }>; searchParams: Promise<{ event?: string }> }) {
  const [{ personId: raw }, sp] = await Promise.all([params, searchParams]);
  const personId = Number(raw);
  const access = await healthAccess();
  if (!access || !Number.isInteger(personId) || personId <= 0 || !healthFilesConfigured()) notFound();
  const viewer = healthViewerFor(access, personId);
  if (!viewer) notFound();

  const supabase = createAdminClient();
  const { data: exists } = await supabase.from('people').select('id').eq('id', personId).maybeSingle();
  if (!exists) notFound();

  // Logged before anything about them is read, for someone outside the family; a failed insert throws and
  // nothing is shown.
  if (viewer.via !== 'family') await logHealthRecordOpen(personId, viewer, healthDeps());
  const { data: person } = await supabase.from('people').select('id, display_name, things_we_should_know').eq('id', personId).maybeSingle();
  if (!person) notFound();
  const p = person as { id: number; display_name: string; things_we_should_know: string | null };

  const today = centralToday();
  // The trip being planned sets whether Part C is needed and the day the forms must still be good on.
  const trips = access.named && sp.event && sp.event !== 'everyone' ? await loadUpcomingTrips(supabase, today) : access.trips;
  const trip = trips.find((t) => String(t.signupId) === sp.event) ?? (viewer.via === 'trip' ? access.trips.find((t) => t.eventId === viewer.eventId) : undefined);
  const [pages, reviews, { data: parentRows }] = await Promise.all([
    listHealthPages(supabase, [personId]),
    listHealthReviews(supabase, [personId]),
    supabase.from('relationships').select('person_id, role_label').eq('related_person_id', personId).in('type', ['parent_of', 'guardian_of'])
  ]);
  const parentIds = ((parentRows ?? []) as { person_id: number }[]).map((r) => Number(r.person_id));
  const { data: parents } = parentIds.length ? await supabase.from('people').select('id, display_name, primary_phone').in('id', parentIds) : { data: [] };
  const review = reviews.get(personId) ?? null;
  const standing = healthStanding(pages, { reviewed: review != null, needsPartC: trip?.needsPartC ?? false, today, asOf: trip ? (trip.endDate ?? trip.entryDate) : undefined });
  const back = sp.event ? `/health?event=${encodeURIComponent(sp.event)}` : '/health';

  return (
    <>
      <PageHeader kicker="Leaders" title="Health record" />
      <PageShell>
        <div className={styles.wrap}>
          <p className={styles.links}>
            <Link href={back}>← Back to the list</Link>
          </p>
          <h2 className={styles.personHead}>
            {p.display_name}
            <Badge tone={HEALTH_STANDING_TONE[standing]}>{HEALTH_STANDING_LABEL[standing]}</Badge>
          </h2>
          <p className={styles.note}>Viewing is logged.</p>

          <section className={`${surface.card} ${styles.block}`} aria-labelledby="told">
            <h3 id="told" className={styles.blockHead}>
              What the family told us
            </h3>
            <p className={styles.told}>{p.things_we_should_know?.trim() || 'Nothing written.'}</p>
            <p className={styles.toldBy}>Typed by the family, not read from the form. Check the form for allergies and medicines.</p>
          </section>

          {(parents ?? []).length > 0 && (
            <section className={`${surface.card} ${styles.block}`} aria-labelledby="contacts">
              <h3 id="contacts" className={styles.blockHead}>
                Who to call
              </h3>
              <ul className={styles.contacts}>
                {((parents ?? []) as { id: number; display_name: string; primary_phone: string | null }[]).map((c) => (
                  <li key={c.id} className={styles.contact}>
                    <span>
                      {c.display_name}
                      {c.primary_phone ? ` · ${c.primary_phone}` : ' · no phone on file'}
                    </span>
                    {c.primary_phone && (
                      <span className={styles.contactActs}>
                        <a href={`tel:${digits(c.primary_phone)}`}>Call</a>
                        <a href={`sms:${digits(c.primary_phone)}`}>Text</a>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={`${surface.card} ${styles.block}`} aria-labelledby="docs">
            <h3 id="docs" className={styles.blockHead}>
              Documents
            </h3>
            {HEALTH_KINDS.map((k) => {
              const mine = pages.filter((x) => x.kind === k);
              const status = kindStatus(k, mine, today);
              const expires = mine.map((x) => x.expiresOn).filter((d): d is string => !!d).sort()[0];
              const notNeeded = mine.length === 0 && !HEALTH_KIND[k].required && !(k === 'bsa_c' && trip?.needsPartC);
              return (
                <div key={k} className={styles.doc}>
                  <div className={styles.docHead}>
                    {HEALTH_KIND[k].label}
                    {notNeeded ? <Badge tone="neutral">Not needed</Badge> : <Badge tone={status === 'on_file' ? 'success' : status === 'expires_soon' ? 'warning' : 'danger'}>{HEALTH_STATUS_LABEL[status]}</Badge>}
                  </div>
                  {expires && <p className={styles.docMeta}>Good until {fmtDate(expires)}</p>}
                  {mine.length > 0 && (
                    <ul className={styles.pages}>
                      {mine.map((x) => (
                        <li key={x.id}>
                          <a href={`/api/health-files/${x.id}`} target="_blank" rel="noopener noreferrer">
                            {x.contentType === 'application/pdf' ? 'Download' : 'View'} {pageName(k, x.page).toLowerCase()}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>

          {access.named ? (
            <section className={`${surface.card} ${styles.block}`} aria-label="Review">
              <ReviewTick personId={personId} name={p.display_name} review={review} setReviewed={setHealthReviewedAction} />
            </section>
          ) : (
            <p className={styles.note}>{review ? `Reviewed by ${review.byName}, ${fmtDate(review.at)}.` : 'Not reviewed yet by the health officer.'}</p>
          )}
        </div>
      </PageShell>
    </>
  );
}

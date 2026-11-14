/**
 * /health — the leader side of health records, built for a phone at an event (Plans/Health-Forms.md, release 2).
 *
 * Who gets in (lib/health-access): the named list sees every event and everyone; an adult attending a trip sees
 * that trip's attendees from 7 days before it starts until 2 days after it ends. Everyone else is told why not.
 * This page shows names and standings only. A person's record opens on its own page, and that is logged.
 * There is no offline copy by design: the paper binder is the fallback.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { healthAccess } from '@/lib/health-access';
import { healthFilesConfigured } from '@/lib/health-files';
import { listHealthPages, listHealthReviews, loadUpcomingTrips, type HealthTrip } from '@/lib/health-store';
import { healthNeeds, healthStanding, needsAttention, TRIP_DAYS_AFTER, TRIP_DAYS_BEFORE } from '@/lib/health-records';
import { PrintBinder } from './print-binder';
import { RemindFamilies } from './remind-families';
import { remindFamiliesAction } from './actions';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { centralToday } from '@/lib/dates';
import { fmtRange } from '@/lib/format-date';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import memberStyles from '../member/member.module.css';
import { HealthRoster, type RosterPerson } from './health-roster';
import styles from './health.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Health records — Scout Troop 79',
  robots: { index: false, follow: false }
};

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader kicker="Leaders" title="Health records" />
      <PageShell width="narrow">
        <div className={memberStyles.gate}>{children}</div>
      </PageShell>
    </>
  );
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const sp = await searchParams;
  const access = await healthAccess();
  if (!access) {
    const session = await getIdentitySessionIfValid();
    return (
      <Gate>
        {session?.subjectKind === 'scout' ? (
          <p>Health records are for parents and leaders.</p>
        ) : (
          <>
            <p>Sign in with your own name to open health records. A shared leader password isn&rsquo;t enough for these.</p>
            <p>
              <Button variant="primary" href={`/signin?next=${encodeURIComponent('/health')}`}>
                Sign in
              </Button>
            </p>
          </>
        )}
      </Gate>
    );
  }
  if (!healthFilesConfigured()) {
    return (
      <Gate>
        <p>Health records aren&rsquo;t switched on yet.</p>
      </Gate>
    );
  }

  const supabase = createAdminClient();
  const today = centralToday();
  const trips: HealthTrip[] = access.named ? await loadUpcomingTrips(supabase, today) : access.trips;
  if (!access.named && trips.length === 0) {
    return (
      <Gate>
        <p>
          Adults going on a trip can open the health records of everyone on it, from {TRIP_DAYS_BEFORE} days before it starts until{' '}
          {TRIP_DAYS_AFTER} days after it ends. You aren&rsquo;t signed up for one in that window right now.
        </p>
        <p>
          Your own family&rsquo;s forms are under <Link href="/member/health-forms">Members › Health forms</Link>.
        </p>
      </Gate>
    );
  }

  const everyone = access.named && (sp.event === 'everyone' || trips.length === 0);
  const trip = everyone ? null : (trips.find((t) => String(t.signupId) === sp.event) ?? trips[0]);

  let personIds: number[];
  if (trip) personIds = trip.attendeeIds;
  else {
    // Everyone: the active scouts, plus anyone with a document on file.
    const [{ data: scouts }, docs] = await Promise.all([
      supabase.from('scouts').select('person_id').eq('active', true).not('person_id', 'is', null),
      fetchAllRows<{ person_id: number }>((from, to) => supabase.from('health_documents').select('person_id').order('id').range(from, to))
    ]);
    personIds = [...new Set([...((scouts ?? []) as { person_id: number }[]), ...docs].map((r) => Number(r.person_id)))];
  }

  const [{ data: peopleRows }, { data: scoutRows }, pages, reviews] = await Promise.all([
    personIds.length ? supabase.from('people').select('id, display_name').in('id', personIds) : Promise.resolve({ data: [] }),
    personIds.length ? supabase.from('scouts').select('person_id').in('person_id', personIds) : Promise.resolve({ data: [] }),
    listHealthPages(supabase, personIds),
    listHealthReviews(supabase, personIds)
  ]);
  const scoutIds = new Set(((scoutRows ?? []) as { person_id: number }[]).map((s) => Number(s.person_id)));
  const asOf = trip ? (trip.endDate ?? trip.entryDate) : undefined;
  const people: RosterPerson[] = ((peopleRows ?? []) as { id: number; display_name: string }[])
    .map((p) => ({
      personId: Number(p.id),
      name: p.display_name,
      isScout: scoutIds.has(Number(p.id)),
      standing: healthStanding(
        pages.filter((x) => x.personId === Number(p.id)),
        { reviewed: reviews.has(Number(p.id)), needsPartC: trip?.needsPartC ?? false, today, asOf }
      )
    }))
    .sort((a, b) => Number(b.isScout) - Number(a.isScout) || a.name.localeCompare(b.name));
  const attention = people.filter((p) => needsAttention(p.standing)).length;

  return (
    <>
      <PageHeader kicker="Leaders" title="Health records" />
      <PageShell>
        <div className={styles.wrap}>
          <p className={styles.note}>Viewing is logged. Families can see who opened their records.</p>
          {access.named && (
            <p className={styles.links}>
              <Link href="/health/access">Who can open records</Link>
              <Link href="/health/log">Access log</Link>
            </p>
          )}
          <ul className={styles.trips} aria-label="Which list">
            {trips.map((t) => (
              <li key={t.signupId}>
                <Link href={`/health?event=${t.signupId}`} className={styles.trip} aria-current={trip?.signupId === t.signupId ? 'page' : undefined}>
                  {t.title}
                  <span className={styles.tripWhen}>{fmtRange(t.entryDate, t.endDate ?? t.entryDate)}</span>
                </Link>
              </li>
            ))}
            {access.named && (
              <li>
                <Link href="/health?event=everyone" className={styles.trip} aria-current={everyone ? 'page' : undefined}>
                  Everyone
                  <span className={styles.tripWhen}>Scouts and anyone with a form</span>
                </Link>
              </li>
            )}
          </ul>
          <p className={styles.summary}>
            {people.length} {trip ? 'going' : 'people'} · {people.length - attention} complete · {attention} need attention
            {trip?.needsPartC ? ' · Part C required' : ''}
          </p>
          {access.named && trip && (
            <div className={styles.tripActs}>
              <PrintBinder signupId={trip.signupId} title={trip.title} when={fmtRange(trip.entryDate, trip.endDate ?? trip.entryDate)} people={people} />
              <RemindFamilies
                signupId={trip.signupId}
                count={people.filter((p) => healthNeeds(pages.filter((x) => x.personId === p.personId), { needsPartC: trip.needsPartC, today, asOf }).length > 0).length}
                remind={remindFamiliesAction}
              />
            </div>
          )}
          <HealthRoster people={people} query={trip ? `?event=${trip.signupId}` : '?event=everyone'} />
        </div>
      </PageShell>
    </>
  );
}

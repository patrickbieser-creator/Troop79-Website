import Link from 'next/link';
import { notFound } from 'next/navigation';
import styles from '../../events/events-admin.module.css';
import { PageTitle } from '../../_components/page-title';
import { EventNav } from './event-nav';
import { loadRoster, RosterView, type RosterData } from './roster-view';
// The row type moved with the view; roster-table and its tests import it from here.
export type { RosterRow } from './roster-view';

export const metadata = { title: 'Event Roster — Troop 79' };

/**
 * /admin/rosters/[signupId] — one event's roster, standalone. The same view
 * renders inside the calendar workbench's Signup tab (?view=roster), which is
 * where the event tab strip sends you from there; this page stays for links
 * from elsewhere (emails, the finance ledger) and keeps the entry's crumbs.
 */
export default async function EventRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();
  const data = await loadRoster(signupId);
  if (!data || !data.entry) notFound();

  return (
    <>
      <PageTitle
        back={{
          crumbs: [{ label: 'Calendar', href: '/admin/calendar' }, { label: String(data.entry.title), href: `/admin/calendar/${data.nav.entryId}?tab=signup` }],
          current: 'Roster'
        }}
        title={`${String(data.entry.title)} — Roster`}
        sub={
          <Link href={`/events/${String(data.entry.id)}`} className={styles.actionLinkMuted}>
            Public page
          </Link>
        }
      />
      <EventNav signupId={signupId} entryId={data.nav.entryId} active="roster" sets={data.nav.sets} hasMoney={data.nav.hasMoney} />
      <RosterView data={data as RosterData} signupId={signupId} />
    </>
  );
}

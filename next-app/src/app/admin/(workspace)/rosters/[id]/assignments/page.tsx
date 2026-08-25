import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageTitle } from '../../../_components/page-title';
import { EventNav } from '../event-nav';
import styles from '../../../events/events-admin.module.css';
import { activeSetFor, AssignmentsView, loadAssignments } from './assignments-view';

export const metadata = { title: 'Rides & Assignments — Troop 79' };

export default async function AssignmentsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ set?: string }>;
}) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();
  const data = await loadAssignments(signupId);
  if (!data || !data.entry) notFound();
  const activeSetId = activeSetFor(data, Number((await searchParams).set));

  return (
    <>
      <PageTitle
        back={{
          crumbs: [{ label: 'Calendar', href: '/admin/calendar' }, { label: String(data.entry.title), href: `/admin/calendar/${data.nav.entryId}?tab=signup` }],
          current: 'Rides & assignments'
        }}
        title={`${data.entry.title} — Rides & assignments`}
        sub={
          <Link href={`/events/${data.entry.id}`} className={styles.actionLinkMuted}>
            Public page
          </Link>
        }
      />
      <EventNav signupId={signupId} entryId={data.nav.entryId} active={activeSetId != null ? `set:${activeSetId}` : 'assignments'} sets={data.nav.sets} hasMoney={data.nav.hasMoney} />
      <AssignmentsView data={data} signupId={signupId} activeSetId={activeSetId} />
    </>
  );
}

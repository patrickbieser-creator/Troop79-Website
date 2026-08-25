import Link from 'next/link';
import { EventNav } from '../../rosters/[id]/event-nav';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/require-capability';
import { BuilderPanels } from './builder-panels';
import { loadBuilderData } from './load-builder';
import { PageTitle } from '../../_components/page-title';
import styles from '../events-admin.module.css';

export const metadata = { title: 'Event Builder — Troop 79' };

/*
 * The event builder — a BLOCK CHECKLIST, not a per-event-type template.
 *
 * Every event composes the same small set of blocks; the category only seeds
 * which ones start on. A new event shape needs no new code, just a different
 * combination (Plans/Event-Signup.md). The loader lives in load-builder.ts so
 * the calendar entry workbench can render the same builder in its Signup tab.
 */

export default async function EventBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();

  // Leader-only: rosters carry guest notes, driving arrangements, payment
  // status and household composition. A scout-role session must not see them.
  await requireCapability('calendar.write');
  const data = await loadBuilderData(signupId);
  if (!data || !data.entry) notFound();

  const entryId = data.entry.id as number;

  return (
    <>
      <PageTitle
        title={String(data.entry.title)}
        sub={
          <>
            {String(data.entry.category)} ·{' '}
            <Link href="/admin/events" className={styles.actionLinkMuted}>
              All signups
            </Link>{' '}
            ·{' '}
            <Link href={`/events/${entryId}`} className={styles.actionLinkMuted}>
              View public page
            </Link>
          </>
        }
      />
      <EventNav signupId={signupId} active="builder" sets={data.nav.sets} hasMoney={data.nav.hasMoney} />

      <BuilderPanels
        signupId={signupId}
        calendarEntryId={entryId}
        entryDate={String(data.entry.entry_date ?? '')}
        endDate={(data.entry.end_date as string | null) ?? null}
        signup={data.signup}
        prices={data.prices}
        slots={data.slots}
        questions={data.questions}
        sets={data.sets}
        category={String(data.entry.category ?? '')}
      />
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { parseRosterOrder, ROSTER_ORDERS, ROSTER_ORDER_LABEL, type RosterOrder } from '@/lib/event-snapshot';
import { PageTitle } from '../../../_components/page-title';
import { EventNav } from '../event-nav';
import { loadEventNav } from '../event-nav-data';
import { SnapshotDocument } from '../../../../snapshot/[id]/snapshot-document';
import styles from '../../../events/events-admin.module.css';
import snap from '../../../../snapshot/[id]/snapshot.module.css';

export const metadata = { title: 'Event Snapshot — Troop 79' };

/*
 * The snapshot INSIDE the workspace (Patrick, 2026-08-22): the same document
 * the print view renders, but with the sidebar and the event tabs, so moving
 * between Builder / Roster / sets / Money / Snapshot is one click each way.
 * Printing is one more step — the Print button opens /admin/snapshot/[id]
 * (the bare document) in a new tab, carrying the chosen roster order.
 */
export default async function SnapshotWorkspacePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();
  await requireCapability('calendar.write');
  const order = parseRosterOrder((await searchParams).order);

  const supabase = createAdminClient();
  const { data: sig } = await supabase.from('event_signups').select('id, calendar_entry_id, calendar_entries!inner(id, title)').eq('id', signupId).maybeSingle();
  if (!sig) notFound();
  const s = sig as unknown as { calendar_entry_id: number; calendar_entries: { id: number; title: string } };
  const nav = await loadEventNav(supabase, signupId, s.calendar_entry_id);
  const orderHref = (o: RosterOrder) => `/admin/rosters/${signupId}/snapshot${o === 'patrol' ? '' : `?order=${o}`}`;

  return (
    <>
      <PageTitle
        title={`${s.calendar_entries.title} — Snapshot`}
        sub={
          <>
            <Link href="/admin/rosters" className={styles.actionLinkMuted}>
              Event Management
            </Link>{' '}
            ·{' '}
            <Link href={`/events/${s.calendar_entries.id}`} className={styles.actionLinkMuted}>
              Public page
            </Link>
          </>
        }
      />
      <EventNav signupId={signupId} entryId={nav.entryId} active="snapshot" sets={nav.sets} hasMoney={nav.hasMoney} />

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <span className={snap.orderLinks} aria-label="Roster order">
            {ROSTER_ORDERS.map((o) => (
              <Link key={o} href={orderHref(o)} className={`${snap.orderLink}${order === o ? ` ${snap.orderOn}` : ''}`} aria-current={order === o ? 'page' : undefined}>
                {ROSTER_ORDER_LABEL[o]}
              </Link>
            ))}
          </span>
          <div>
            {/* The print view is the bare document; it opens in its own tab so this page stays put. */}
            <Link
              href={`/admin/snapshot/${signupId}${order === 'patrol' ? '' : `?order=${order}`}`}
              target="_blank"
              rel="noopener"
              className={styles.enableBtn}
            >
              Print
            </Link>
          </div>
        </div>
        <SnapshotDocument signupId={signupId} order={order} printView={false} />
      </section>
    </>
  );
}

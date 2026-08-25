import Link from 'next/link';
import { ROSTER_ORDERS, ROSTER_ORDER_LABEL, type RosterOrder } from '@/lib/event-snapshot';
import { SnapshotDocument } from '../../../../snapshot/[id]/snapshot-document';
import styles from '../../../events/events-admin.module.css';
import snap from '../../../../snapshot/[id]/snapshot.module.css';

/** The snapshot panel (order links, Print, the document) — standalone page
 *  and the workbench's Signup tab (?view=snapshot, 2026-08-25). `orderHref`
 *  differs by host: the standalone page links its own URL, the workbench its
 *  tab URL. */
export function SnapshotView({
  signupId,
  order,
  orderHref
}: {
  signupId: number;
  order: RosterOrder;
  orderHref: (o: RosterOrder) => string;
}) {
  return (
    <>
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

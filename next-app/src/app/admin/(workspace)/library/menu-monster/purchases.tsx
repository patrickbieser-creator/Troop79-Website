/**
 * Menu Monster › Purchases — each outing's menus, what they planned to spend and what was paid
 * (Plans/Menu-Monster-Brands-Gear.md, release 6). Read-only: a purchase is corrected where it was recorded,
 * on the menu's own "What we bought" tab (a leader may record there like any of the outing's crew).
 * Reimbursement is out of scope (Patrick, 2026-10-03).
 */
import Link from 'next/link';
import { fmtDate, fmtRange } from '@/lib/format-date';
import { priceText as money } from '@/lib/menu-monster/units';
import type { PurchaseOuting } from '@/lib/menu-monster/purchases';
import { Badge } from '../../_components/badge';
import styles from './menu-monster.module.css';

const MENUS = '/library/menu-monster/menus';

export function Purchases({ outings }: { outings: PurchaseOuting[] }) {
  if (outings.length === 0) {
    return (
      <div className={styles.activity}>
        <p className={styles.emptyLine}>No menu is linked to an outing yet. When a scout picks an outing on a menu’s Plan tab, it shows up here.</p>
      </div>
    );
  }
  return (
    <div className={styles.activity}>
      {outings.map((o) => (
        <section key={o.id} className={styles.activitySection} aria-labelledby={`mm-pur-${o.id}`}>
          <div className={styles.activityHead}>
            <h2 id={`mm-pur-${o.id}`} className={styles.activityTitle}>
              {o.title}
            </h2>
            <span className={styles.cardMeta}>
              {fmtRange(o.startDate, o.endDate)} · planned {money(o.planned)} · {o.projected ? 'projected' : 'paid'} {money(o.paid)}
            </span>
            <span className={styles.spacer} />
            <Link href={`/library/menu-monster/outings/${o.id}`}>Outing shopping list →</Link>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Menu</th>
                  <th>Planned by</th>
                  <th className={styles.numCell}>Planned</th>
                  <th className={styles.numCell}>Paid</th>
                  <th>Recorded</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {o.menus.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`${MENUS}/${m.id}/bought`}>{m.label}</Link>
                      {m.label !== m.name && m.name ? <span className={styles.muted}> · {m.name}</span> : null}
                    </td>
                    <td>{m.planner}</td>
                    <td className={styles.numCell}>{money(m.totals.planned)}</td>
                    <td className={styles.numCell}>{money(m.totals.paid)}</td>
                    <td>
                      {m.totals.total - m.totals.unconfirmed} of {m.totals.total}
                      {m.recordedBy.length > 0 ? <span className={styles.muted}> · {m.recordedBy.join(', ')}</span> : null}
                    </td>
                    <td>
                      {m.done ? (
                        <>
                          <Badge variant="success">Done</Badge> <span className={styles.muted}>{[m.done.by, fmtDate(m.done.at)].filter(Boolean).join(' · ')}</span>
                        </>
                      ) : m.totals.unconfirmed === m.totals.total ? (
                        <Badge variant="muted">Nothing recorded</Badge>
                      ) : (
                        <Badge variant="warning">Not finished</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className={styles.hint}>To correct a purchase, open the menu: its What we bought tab is where prices are recorded, by leaders as well as scouts.</p>
    </div>
  );
}

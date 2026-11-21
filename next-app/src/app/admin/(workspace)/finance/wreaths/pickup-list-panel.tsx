/**
 * Wreath sale › Pickup list (Patrick, 2026-11-21 — distribution day): one card per scout with every order credited to
 * them and how many of each item (an order the scout isn't delivering says how it goes out), their customers' orders underneath (and what is still to collect), then customer pickups at the lot,
 * troop deliveries, and donated wreaths. A totals table up top checks the stack against the Rose order. Read-only and
 * server-rendered from lib/wreaths/pickup-list; Print keeps only the list (data-pickup-print), and Print scout pages
 * keeps only the scout cards, one per page, to hand each scout to take home (2026-11-21).
 */
import { fmtMoney2 } from '@/lib/wreaths/rules';
import type { PickupItem, PickupList, PickupOrder } from '@/lib/wreaths/pickup-list';
import { PrintStatementButton } from './reconciliation-controls';
import { PrintScoutPagesButton } from './pickup-print-button';
import styles from './wreaths.module.css';

const itemsText = (items: PickupItem[]) => items.map((i) => `${i.quantity} × ${i.label}`).join(', ');
const count = (items: PickupItem[]) => items.reduce((n, i) => n + i.quantity, 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function PickupListPanel({ p, year }: { p: PickupList; year: number }) {
  const empty = p.scouts.length === 0 && p.lotPickups.length === 0 && p.troopDelivery.length === 0 && p.donated.length === 0;
  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.spacer} />
        {p.scouts.length > 0 && <PrintScoutPagesButton />}
        {!empty && <PrintStatementButton />}
      </div>
      {empty ? (
        <p className={styles.muted}>No orders yet. Each scout’s pickup appears here as orders come in.</p>
      ) : (
        <div data-pickup-print="">
          <div className={styles.pickupSummary}>
            <TotalsTable p={p} />
          </div>

          <h3 className={`${styles.dashHeading} ${styles.pickupHeading}`}>Scouts ({p.scouts.length})</h3>
          <div className={styles.pickupGrid}>
            {p.scouts.map((s) => (
              <section key={s.personId} className={styles.pickupCard} aria-label={`${s.name} pickup`}>
                <p className={styles.pickupPageHead}>Troop 79 Wreath Sale {year} · your wreaths to deliver</p>
                <div className={styles.pickupHead}>
                  <span className={styles.pickupBox} aria-hidden="true" />
                  <h4 className={styles.pickupName}>{s.name}</h4>
                  <span className={styles.pickupCount}>{plural(count(s.items), 'item')}</span>
                </div>
                <ul className={styles.pickupItems}>
                  {s.items.map((i) => (
                    <li key={i.catalogNumber}>
                      <span className={styles.pickupQty}>{i.quantity}</span> {i.label}
                    </li>
                  ))}
                </ul>
                {s.donated > 0 && <p className={styles.pickupDonated}>Plus {s.donated} donated to veterans (the troop delivers those)</p>}
                <OrderList orders={s.orders} showAddress />
                {s.due > 0 && <p className={styles.pickupDue}>To collect: {fmtMoney2(s.due)}</p>}
              </section>
            ))}
          </div>

          <div className={styles.pickupSummary}>
          {p.lotPickups.length > 0 && <OrderSection title="Customer pickup at the lot" orders={p.lotPickups} />}
          {p.troopDelivery.length > 0 && <OrderSection title="Troop delivers" orders={p.troopDelivery} showAddress />}

          {p.donated.length > 0 && (
            <section className={`${styles.pickupCard} ${styles.dashGap}`} aria-label="Donated to veterans">
              <div className={styles.pickupHead}>
                <h3 className={styles.pickupName}>Donated to veterans</h3>
                <span className={styles.pickupCount}>{plural(count(p.donated), 'item')}</span>
              </div>
              <ul className={styles.pickupItems}>
                {p.donated.map((i) => (
                  <li key={i.catalogNumber}>
                    <span className={styles.pickupQty}>{i.quantity}</span> {i.label}
                  </li>
                ))}
              </ul>
            </section>
          )}
          </div>
        </div>
      )}
    </>
  );
}

function OrderList({ orders, showAddress = false }: { orders: PickupOrder[]; showAddress?: boolean }) {
  return (
    <ul className={styles.pickupOrders}>
      {orders.map((o) => (
        <li key={o.id}>
          <span className={styles.mono}>{o.orderNumber}</span> <strong>{o.customerName}</strong>
          {o.customerPhone && <> · {o.customerPhone}</>}
          {showAddress && o.address && <> · {o.address}</>}
          {o.items.length > 0 && <>{' — '}{itemsText(o.items)}</>}
          {o.donated > 0 && <> · {o.donated} donated</>}
          {o.due > 0 && <span className={styles.pickupUnpaid}> · Unpaid {fmtMoney2(o.due)}</span>}
          {o.how && <span className={styles.pickupHow}>{o.how}</span>}
          {o.note && <span className={styles.pickupNote}>Note: {o.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function OrderSection({ title, orders, showAddress = false }: { title: string; orders: PickupOrder[]; showAddress?: boolean }) {
  const due = orders.reduce((n, o) => n + o.due, 0);
  return (
    <section className={`${styles.pickupCard} ${styles.dashGap}`} aria-label={title}>
      <div className={styles.pickupHead}>
        <h3 className={styles.pickupName}>{title}</h3>
        <span className={styles.pickupCount}>
          {plural(orders.length, 'order')} · {plural(count(orders.flatMap((o) => o.items)), 'item')}
        </span>
      </div>
      <OrderList orders={orders} showAddress={showAddress} />
      {due > 0 && <p className={styles.pickupDue}>To collect: {fmtMoney2(due)}</p>}
    </section>
  );
}

function TotalsTable({ p }: { p: PickupList }) {
  const sum = (k: 'scouts' | 'pickup' | 'delivery' | 'donated' | 'total') => p.totals.reduce((n, t) => n + t[k], 0);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>No.</th>
            <th>Item</th>
            <th className={styles.numCell}>Scouts</th>
            <th className={styles.numCell}>Lot pickup</th>
            <th className={styles.numCell}>Troop delivers</th>
            <th className={styles.numCell}>Donated</th>
            <th className={styles.numCell}>Total</th>
          </tr>
        </thead>
        <tbody>
          {p.totals.map((t) => (
            <tr key={t.catalogNumber}>
              <td className={styles.mono}>{t.catalogNumber}</td>
              <td>{t.label}</td>
              <td className={styles.numCell}>{t.scouts || '—'}</td>
              <td className={styles.numCell}>{t.pickup || '—'}</td>
              <td className={styles.numCell}>{t.delivery || '—'}</td>
              <td className={styles.numCell}>{t.donated || '—'}</td>
              <td className={styles.numCell}>{t.total}</td>
            </tr>
          ))}
          <tr className={styles.totalRow}>
            <td />
            <td>All items</td>
            <td className={styles.numCell}>{sum('scouts')}</td>
            <td className={styles.numCell}>{sum('pickup')}</td>
            <td className={styles.numCell}>{sum('delivery')}</td>
            <td className={styles.numCell}>{sum('donated')}</td>
            <td className={styles.numCell}>{sum('total')}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

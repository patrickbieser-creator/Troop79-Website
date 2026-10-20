/**
 * Wreath sale › Dashboard (Patrick, 2026-10-16): the sale at a glance. Server-rendered from the orders the page already
 * loads (lib/wreaths/dashboard builds every number). Read-only: every "needs a hand" row links to the Orders tab, where
 * the work is done. Estimates until the books close the sale (Release C).
 */
import Link from 'next/link';
import { fmtDay } from '@/lib/format-date';
import { FULFILLMENT_LABEL, METHOD_LABEL, SOURCE_LABEL, fmtMoney2, fromCents, toCents, type PaymentMethod } from '@/lib/wreaths/rules';
import type { SalesDashboard } from '@/lib/wreaths/dashboard';
import styles from './wreaths.module.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ORDERS = '/admin/finance/wreaths';

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statSub}>{sub}</div>
    </div>
  );
}

/** A labelled bar: `of` is the largest value in its list, so the longest bar fills the row. */
function Bar({ value, of }: { value: number; of: number }) {
  const pct = of > 0 ? Math.round((value / of) * 100) : 0;
  return (
    <span className={styles.bar} aria-hidden="true">
      {/* inline: dynamic — bar width is the computed share */}
      <span className={styles.barFill} style={{ width: `${pct}%` }} />
    </span>
  );
}

function Mix({ title, rows }: { title: string; rows: { label: string; orders: number; amount: number }[] }) {
  const max = Math.max(0, ...rows.map((r) => r.orders));
  return (
    <div className={styles.dashCard}>
      <h3 className={styles.dashCardTitle}>{title}</h3>
      {rows.length === 0 ? (
        <p className={styles.muted}>No orders yet.</p>
      ) : (
        <ul className={styles.mixList}>
          {rows.map((r) => (
            <li key={r.label}>
              <span className={styles.mixLabel}>{r.label}</span>
              <Bar value={r.orders} of={max} />
              <span className={styles.mixNum}>{r.orders}</span>
              <span className={styles.mixNum}>{fmtMoney2(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SalesDashboardView({ d }: { d: SalesDashboard }) {
  const t = d.totals;
  const a = d.attention;
  const attention = [
    a.unpaid > 0 && {
      key: 'unpaid',
      href: `${ORDERS}?pay=unpaid`,
      text: `${plural(a.unpaid, 'order')} not paid, ${fmtMoney2(t.owed)}`,
      sub: a.oldestUnpaidDays != null && a.oldestUnpaidDays > 0 ? `oldest placed ${plural(a.oldestUnpaidDays, 'day')} ago` : 'all placed in the last day'
    },
    a.cardUnfinished > 0 && { key: 'card', href: `${ORDERS}?pay=unpaid`, text: `${plural(a.cardUnfinished, 'customer')} left card payment unfinished`, sub: 'they may need a nudge' },
    a.needsRefund > 0 && { key: 'refund', href: ORDERS, text: `${plural(a.needsRefund, 'card payment')} to refund`, sub: 'open the order to refund it' },
    a.toTurnIn > 0 && { key: 'turnin', href: ORDERS, text: `${fmtMoney2(a.toTurnIn)} held by scouts`, sub: 'collected on scout-entered orders, not turned in yet' },
    a.toCollect > 0 && { key: 'collect', href: ORDERS, text: `${fmtMoney2(a.toCollect)} for scouts to collect`, sub: 'scout-entered orders not paid yet' }
  ].filter(Boolean) as { key: string; href: string; text: string; sub: string }[];

  const dayMax = Math.max(0, ...d.byDay.map((x) => x.sales));
  const scouts = d.sellers.filter((s) => s.personId != null);
  const store = d.sellers.find((s) => s.personId == null);

  return (
    <>
      <div className={styles.stats}>
        <Stat label="Wreath sales" value={fmtMoney2(t.sales)} sub={`${plural(t.orders, 'order')} · ${plural(t.items, 'item')}${t.donated ? ` (${t.donated} donated)` : ''}`} />
        <Stat
          label="Collected"
          value={fmtMoney2(t.collected)}
          sub={[t.owed > 0 ? `${fmtMoney2(t.owed)} still owed` : 'nothing owed', t.shortAccepted > 0 && `${fmtMoney2(t.shortAccepted)} accepted short`].filter(Boolean).join(' · ')}
        />
        <Stat
          label="Donations"
          value={fmtMoney2(t.gifts)}
          sub={t.gifts > 0 ? `${fmtMoney2(t.donationsNet)} after card fees and short payments` : 'none yet'}
        />
        <Stat
          label="Shares after card fees (est.)"
          value={fmtMoney2(fromCents(toCents(t.scoutShare) + toCents(t.troopShare)))}
          sub={`scouts ${fmtMoney2(t.scoutShare)} · troop ${fmtMoney2(t.troopShare)}`}
        />
        <Stat label="Scouts selling" value={`${t.sellersSelling} of ${t.sellersActive}`} sub={t.sellersActive - t.sellersSelling > 0 ? `${t.sellersActive - t.sellersSelling} with no orders yet` : 'every seller has an order'} />
      </div>

      <div className={styles.dashGrid}>
        <div className={styles.dashCard}>
          <h3 className={styles.dashCardTitle}>Needs a hand</h3>
          {attention.length === 0 ? (
            <p className={styles.muted}>Nothing waiting. Every order is paid.</p>
          ) : (
            <ul className={styles.attnList}>
              {attention.map((x) => (
                <li key={x.key}>
                  <Link href={x.href}>{x.text}</Link>
                  <span className={styles.muted}>{x.sub}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.dashCard}>
          <h3 className={styles.dashCardTitle}>Rounds</h3>
          <ul className={styles.attnList}>
            {d.byRound.map((r) => (
              <li key={r.round}>
                <span>
                  Round {r.round}: {plural(r.orders, 'order')}, {plural(r.items, 'item')}
                </span>
                <span className={styles.muted}>
                  {r.daysLeft == null ? `closed ${fmtDay(r.closes)}` : r.daysLeft === 0 ? `closes today, ${fmtDay(r.closes)}` : `closes ${fmtDay(r.closes)}, ${plural(r.daysLeft, 'day')} left`}
                </span>
              </li>
            ))}
          </ul>
          {t.cancelled > 0 && <p className={styles.muted}>{plural(t.cancelled, 'cancelled order')} not counted.</p>}
        </div>
      </div>

      <div className={`${styles.dashCard} ${styles.dashGap}`}>
        <h3 className={styles.dashCardTitle}>Sales by day</h3>
        {d.byDay.length === 0 ? (
          <p className={styles.muted}>No orders yet.</p>
        ) : (
          <ul className={styles.mixList}>
            {d.byDay.map((x) => (
              <li key={x.date}>
                <span className={styles.mixLabel}>{fmtDay(x.date)}</span>
                <Bar value={x.sales} of={dayMax} />
                <span className={styles.mixNum}>{x.orders || '—'}</span>
                <span className={styles.mixNum}>{x.sales ? fmtMoney2(x.sales) : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h3 className={`${styles.dashHeading} ${styles.dashGap}`}>Sellers</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Scout</th>
              <th className={styles.numCell}>Orders</th>
              <th className={styles.numCell}>Items</th>
              <th>Goal</th>
              <th className={styles.numCell}>Sales</th>
              <th className={styles.numCell}>Still owed</th>
              <th className={styles.numCell}>Scout earns (est.)</th>
            </tr>
          </thead>
          <tbody>
            {scouts.length === 0 && !store && (
              <tr>
                <td colSpan={7} className={styles.empty}>
                  No sellers yet. Add scouts on the Sellers tab.
                </td>
              </tr>
            )}
            {scouts.map((s) => (
              <tr key={s.personId}>
                <td>{s.name}</td>
                <td className={styles.numCell}>{s.orders || '—'}</td>
                <td className={styles.numCell}>{s.items || '—'}</td>
                <td>
                  {s.goal == null ? (
                    <span className={styles.muted}>—</span>
                  ) : (
                    <span className={styles.nowrap}>
                      <Bar value={Math.min(s.items, s.goal)} of={s.goal} /> {s.items} of {s.goal}
                    </span>
                  )}
                </td>
                <td className={styles.numCell}>{s.sales ? fmtMoney2(s.sales) : '—'}</td>
                <td className={styles.numCell}>{s.owed ? fmtMoney2(s.owed) : '—'}</td>
                <td className={styles.numCell}>{s.earnings ? fmtMoney2(s.earnings) : '—'}</td>
              </tr>
            ))}
            {store && (
              <tr>
                <td className={styles.muted}>Troop store (no scout)</td>
                <td className={styles.numCell}>{store.orders}</td>
                <td className={styles.numCell}>{store.items}</td>
                <td />
                <td className={styles.numCell}>{fmtMoney2(store.sales)}</td>
                <td className={styles.numCell}>{store.owed ? fmtMoney2(store.owed) : '—'}</td>
                <td className={styles.numCell}>—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className={`${styles.dashHeading} ${styles.dashGap}`}>Best sellers</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>No.</th>
              <th>Item</th>
              <th className={styles.numCell}>Sold</th>
              <th className={styles.numCell}>Donated</th>
              <th className={styles.numCell}>Sales</th>
              <th className={styles.numCell}>Profit</th>
            </tr>
          </thead>
          <tbody>
            {d.items.length === 0 && (
              <tr>
                <td colSpan={6} className={styles.empty}>
                  Nothing sold yet.
                </td>
              </tr>
            )}
            {d.items.map((i) => (
              <tr key={i.catalogNumber}>
                <td className={styles.mono}>{i.catalogNumber}</td>
                <td>{i.label}</td>
                <td className={styles.numCell}>{i.quantity}</td>
                <td className={styles.numCell}>{i.donated || '—'}</td>
                <td className={styles.numCell}>{fmtMoney2(i.sales)}</td>
                <td className={styles.numCell}>{fmtMoney2(i.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={`${styles.dashGrid3} ${styles.dashGap}`}>
        <Mix title="How customers paid" rows={d.byMethod.map((m) => ({ label: m.method === 'unpaid' ? 'Not paid yet' : (METHOD_LABEL[m.method as PaymentMethod] ?? m.method), orders: m.orders, amount: m.amount }))} />
        <Mix title="Where orders came from" rows={d.byChannel.map((c) => ({ label: SOURCE_LABEL[c.key], orders: c.orders, amount: c.amount }))} />
        <Mix title="How wreaths get there" rows={d.byFulfillment.map((c) => ({ label: FULFILLMENT_LABEL[c.key], orders: c.orders, amount: c.amount }))} />
      </div>

      <div className={`${styles.dashCard} ${styles.dashGap}`}>
        <h3 className={styles.dashCardTitle}>Other money</h3>
        <dl className={styles.moneyList}>
          <dt>Gifts to the troop</dt>
          <dd>{fmtMoney2(t.gifts)}</dd>
          <dt>Delivery fees</dt>
          <dd>{fmtMoney2(t.deliveryFees)}</dd>
          <dt>Card fees (Stripe)</dt>
          <dd>{fmtMoney2(t.cardFees)}</dd>
          <dt>Fees customers covered</dt>
          <dd>{fmtMoney2(t.feesCovered)}</dd>
          <dt>Card fees off the troop’s share</dt>
          <dd>{fmtMoney2(t.troopCardCost)}</dd>
        </dl>
        <p className={styles.muted}>Profit is each item&rsquo;s price less its cost from Rose, donated wreaths included. Card fees come off the shares, not the profit. The books at the sale&rsquo;s close are final.</p>
      </div>
    </>
  );
}

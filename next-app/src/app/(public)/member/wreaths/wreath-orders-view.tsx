/**
 * The body of /member/wreaths: one section per wreath-selling scout in the family — a totals strip, the orders
 * credited to the scout, and the delivery list for distribution day. Pure presentation of lib/wreaths/my-orders'
 * SellerViews: it renders no form and no write control, so the superuser proxy sees exactly what the family sees.
 *
 * Print: everything except the delivery list(s) is `.screenOnly`; globals.css drops the site chrome when this
 * page is on screen and printing ([data-wreath-orders]).
 */
import { Badge } from '@/app/_components/badge';
import { EmptyState } from '@/app/_components/empty-state';
import surface from '@/app/_components/card.module.css';
import { GoalBar } from '@/app/_components/goal-bar';
import Link from 'next/link';
import { fmtDate, fmtDay } from '@/lib/format-date';
import { fmtMoney, fmtMoney2, orderItemsText } from '@/lib/wreaths/rules';
import type { MyOrder, MyWreathOrders, SellerView } from '@/lib/wreaths/my-orders';
import { PrintDeliveryButton } from './print-button';
import { OrderNote } from './order-note';
import { ScoutOrderRow } from './scout-order-row';
import { ScoutSettings } from './scout-settings';
import styles from './wreaths.module.css';

const itemsText = (o: MyOrder) => orderItemsText(o);

function fulfillmentText(o: MyOrder, scoutName: string): string {
  switch (o.fulfillment) {
    case 'scout':
      return o.deliveringPersonId != null && o.deliveringPersonId === o.creditedPersonId ? `${scoutName} delivers` : 'A scout delivers';
    case 'delivery':
      return 'Troop delivers';
    case 'pickup':
      return 'Picks up';
    default:
      return o.lines.length === 0 ? 'Donation, nothing to deliver' : 'Donated to veterans';
  }
}

function PaidBadge({ o }: { o: MyOrder }) {
  if (o.status === 'cancelled') return <Badge tone="neutral">Cancelled</Badge>;
  if (o.paymentStatus === 'paid') return <Badge tone="success">{o.paidDifference ? `Paid · ${o.paidDifference}` : 'Paid'}</Badge>;
  if (o.paymentStatus === 'refunded') return <Badge tone="neutral">Refunded</Badge>;
  return (
    <>
      <Badge tone="warning">Owes {fmtMoney2(o.total)}</Badge>
      {o.cardUnfinished && <Badge tone="info">Card not finished</Badge>}
    </>
  );
}

function Totals({ seller, share, donationShare }: { seller: SellerView; share: number; donationShare: number }) {
  const s = seller.summary;
  const stats: [string, string][] = [
    ['Orders', String(s.orders)],
    ['Wreaths & items', String(s.items)],
    ['Sold', fmtMoney(s.sold)],
    ['Donations', fmtMoney2(s.donations)],
    ['Paid', fmtMoney2(s.paid)],
    ['Still owed', fmtMoney2(s.owed)],
    ['Earned so far', fmtMoney2(s.earnings)],
    // Money the scout handles on orders they entered (Patrick, 2026-10-13); online orders pay the troop directly.
    ...(s.hasScoutEntered
      ? ([
          ['Still to collect', fmtMoney2(s.toCollect)],
          ['Collected, to turn in', fmtMoney2(s.toTurnIn)]
        ] as [string, string][])
      : [])
  ];
  return (
    <>
      <dl className={styles.totals}>
        {stats.map(([label, value]) => (
          <div key={label} className={styles.stat}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.fine}>
        {seller.name.split(' ')[0]} earns {Math.round(share * 1000) / 10}% of the profit on every wreath sold
        {donationShare > 0 ? `, and ${Math.round(donationShare * 1000) / 10}% of every donation after card fees` : ''}. {fmtMoney2(s.earningsOnPaid)} of the{' '}
        {fmtMoney2(s.earnings)} is on orders that are already paid. It goes into the scout account when the sale closes.
      </p>
    </>
  );
}

function Orders({ seller, items, canEdit }: { seller: SellerView; items: MyWreathOrders['items']; canEdit: boolean }) {
  if (seller.orders.length === 0) {
    return <p className={styles.fine}>No orders yet. Orders placed through {seller.name.split(' ')[0]}&rsquo;s link show up here.</p>;
  }
  return (
    <ul className={styles.orderList}>
      {seller.orders.map((o) =>
        o.source === 'paper' ? (
          <ScoutOrderRow key={o.id} order={o} items={items} canEdit={canEdit} scoutFirstName={seller.name.split(' ')[0]} />
        ) : (
        <li key={o.id} className={`${surface.card} ${styles.order} ${o.status === 'cancelled' ? styles.cancelled : ''}`}>
          <div className={styles.orderHead}>
            <span className={styles.orderNo}>{o.orderNumber}</span>
            <span className={styles.orderDate}>{fmtDate(o.placedAt)}</span>
            <PaidBadge o={o} />
            <span className={styles.orderTotal}>{fmtMoney2(o.total)}</span>
          </div>
          <p className={styles.orderBody}>
            <strong>{o.customerName}</strong> &middot; {itemsText(o)}
          </p>
          <p className={styles.orderMeta}>{fulfillmentText(o, seller.name.split(' ')[0])}</p>
          <OrderNote order={o} canEdit={canEdit && o.status === 'placed'} />
        </li>
        )
      )}
    </ul>
  );
}

function DeliveryList({ seller, sale }: { seller: SellerView; sale: NonNullable<MyWreathOrders['sale']> }) {
  const when = [sale.distributionDate ? fmtDay(sale.distributionDate) : null, sale.distributionWindow, sale.distributionPlace]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className={styles.sheet} aria-label={`${seller.name} delivery list`}>
      <h3 className={styles.sheetTitle}>
        Delivery list &mdash; {seller.name}
        {sale.year ? ` (${sale.year} wreath sale)` : ''}
      </h3>
      {when && <p className={styles.sheetWhen}>Distribution day: {when}</p>}
      {seller.deliveries.length === 0 ? (
        <p className={styles.fine}>Nothing for {seller.name.split(' ')[0]} to deliver. Orders marked &ldquo;scout delivers&rdquo; will be listed here.</p>
      ) : (
        <>
          {/* A troop-delivered order credited to the scout looked "missing" here (Patrick, 2026-10-13). Screen only. */}
          <p className={`${styles.fine} ${styles.screenOnly}`}>
            {`Only orders ${seller.name.split(' ')[0]} delivers. Orders the troop delivers, or that customers pick up, aren’t on this list.`}
          </p>
          <div className={`${styles.screenOnly} ${styles.sheetActions}`}>
            <PrintDeliveryButton />
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Address</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Order</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Delivered</th>
                </tr>
              </thead>
              <tbody>
                {seller.deliveries.map((o) => (
                  <tr key={o.id}>
                    <th scope="row">{o.customerName}</th>
                    <td>
                      {o.contact!.address}
                      <br />
                      {[o.contact!.city, o.contact!.zip].filter(Boolean).join(' ')}
                    </td>
                    <td>{o.contact!.phone}</td>
                    <td>
                      {o.deliverLines.map((l) => `${l.quantity} × ${l.label}`).join(', ')}
                      <br />
                      <span className={styles.orderMeta}>{o.orderNumber}</span>
                    </td>
                    <td>{o.paymentStatus === 'paid' ? 'Paid' : o.collectedByScout ? 'Collected' : `Collect ${fmtMoney2(o.owed)}`}</td>
                    <td className={styles.tick} aria-label="Delivered?">
                      <span aria-hidden="true">&#9744;</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * `canEdit` is true only for the signed-in scout or a parent viewing their own family. The superuser proxy
 * (`?viewScout=`) passes false: the same page, with no form and no control that writes.
 */
/** `viewScout` carries the read-only Members proxy onto the Statement link. */
export function MyWreathOrdersView({ data, canEdit = false, viewScout = null }: { data: MyWreathOrders; canEdit?: boolean; viewScout?: number | null }) {
  const { sale, sellers } = data;
  if (!sale || sellers.length === 0) {
    return (
      <EmptyState>
        None of the scouts in this household are selling wreaths this year. If that looks wrong, ask a leader.
      </EmptyState>
    );
  }
  return (
    <div data-wreath-orders>
      {sellers.map((seller) => (
        <section key={seller.personId} className={styles.seller} aria-label={`${seller.name} wreath orders`}>
          <div className={styles.screenOnly}>
            <h2 className={styles.sellerName}>{seller.name}</h2>
            <GoalBar progress={seller.goalProgress} />
            {canEdit && sale.status === 'open' ? (
              <ScoutSettings personId={seller.personId} firstName={seller.name.split(' ')[0]} goal={seller.goal} deliveryMessage={seller.deliveryMessage} />
            ) : (
              seller.deliveryMessage && <p className={styles.fine}>Delivery message: {seller.deliveryMessage}</p>
            )}
            <Totals seller={seller} share={sale.scoutShare} donationShare={sale.donationShare} />
            <p className={styles.fine}>
              <Link href={`/member/wreaths/statement?scout=${seller.personId}${viewScout != null ? `&viewScout=${viewScout}` : ''}`}>
                Statement: every order, line by line
              </Link>
            </p>
            <h3 className={styles.subHead}>Orders</h3>
            <Orders seller={seller} items={data.items} canEdit={canEdit && sale.status === 'open'} />
            {canEdit && sale.status === 'open' && seller.slug && (
              <p className={styles.addOrder}>
                <Link href={`/wreaths/${seller.slug}?enter=1`}>+ Order for someone I know</Link>
              </p>
            )}
          </div>
          <DeliveryList seller={seller} sale={sale} />
        </section>
      ))}
    </div>
  );
}

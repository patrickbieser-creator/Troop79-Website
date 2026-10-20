/**
 * One scout's wreath-sale account, line by line (Patrick, 2026-10-19): rendered identically on Admin › Wreath Sale ›
 * Reconciliation and on the family Statement (Members › My wreath orders). A sanctioned crossing like ScoutAccordion:
 * styled on the public tokens, imported by admin (documented on /admin/styleguide/public, Shared contracts).
 *
 * Server component, read-only: every figure is lib/wreaths/reconciliation's — nothing is computed here. `printRoot`
 * marks the one section the print view keeps (wreath-statement.module.css drops everything else on paper).
 */
import { fmtDateTime } from '@/lib/format-date';
import { METHOD_LABEL, fmtMoney2, type PaymentMethod } from '@/lib/wreaths/rules';
import type { ReconOrder, ReconSection, Reconciliation } from '@/lib/wreaths/reconciliation';
import styles from './wreath-statement.module.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const share = (p: number, amount: number) => `${p}% · ${fmtMoney2(amount)}`;
/** "−$1.66" / "+$0.06" / "$0.00" — a line that adds to or comes off the troop's share. */
const signed = (n: number) => (n < 0 ? `−${fmtMoney2(-n)}` : n > 0 ? `+${fmtMoney2(n)}` : fmtMoney2(0));

/** "Profit: scout 30%, troop 70% · Donations: scout 15%, troop 85% · Card fee: 2.9% + $0.30". */
export function StatementSettings({ settings }: { settings: Reconciliation['settings'] }) {
  const s = settings;
  return (
    <p className={styles.settings}>
      Profit share: scout {s.scoutPct}%, troop {Math.round((100 - s.scoutPct) * 10) / 10}% · Donation share: scout {s.donationPct}%, troop{' '}
      {Math.round((100 - s.donationPct) * 10) / 10}% · Card fee: {s.feePercent}% + {fmtMoney2(s.feeFixed)} per card payment
    </p>
  );
}

function payText(o: ReconOrder): string {
  if (!o.counted) return `${o.notCountedReason}: not counted`;
  if (!o.paid) return 'Unpaid (pledged)';
  const method = o.paidMethod ? (METHOD_LABEL[o.paidMethod as PaymentMethod] ?? o.paidMethod) : null;
  return method ? `Paid · ${method}` : 'Paid';
}

function OrderRows({ o }: { o: ReconOrder }) {
  const struck = o.counted ? undefined : styles.struck;
  const contact = [o.customerPhone, o.customerEmail].filter(Boolean).join(' · ');
  return (
    <tbody className={struck}>
      <tr className={styles.orderHead}>
        <th colSpan={7} scope="rowgroup">
          <span className={styles.mono}>{o.orderNumber}</span> · {o.customerName}
          {contact && <span className={styles.meta}> · {contact}</span>}
          <span className={o.counted && !o.paid ? styles.unpaid : styles.meta}> · {payText(o)}</span>
        </th>
      </tr>
      {o.lines.map((l, i) => (
        <tr key={i}>
          <td>
            {l.quantity} × {l.label}
            {l.donated && <span className={styles.meta}> (donated to veterans)</span>}
          </td>
          <td className={styles.num}>{fmtMoney2(l.listPrice)}</td>
          <td className={styles.num}>{fmtMoney2(l.paid)}</td>
          <td className={styles.num}>{fmtMoney2(l.cost)}</td>
          <td className={styles.num}>{fmtMoney2(l.profit)}</td>
          <td className={styles.num}>{share(l.scoutPct, l.scout)}</td>
          <td className={styles.num}>{share(l.troopPct, l.troop)}</td>
        </tr>
      ))}
      {o.donation && (
        <tr>
          <td>
            Donation {fmtMoney2(o.donation.gift)}
            {o.donation.shortAbsorbed > 0 && <> − {fmtMoney2(o.donation.shortAbsorbed)} short</>}
            {o.donation.cardFee > 0 && <> − {fmtMoney2(o.donation.cardFee)} card fee</>} = {fmtMoney2(o.donation.net)} net
          </td>
          <td className={styles.num} />
          <td className={styles.num}>{fmtMoney2(o.donation.gift)}</td>
          <td className={styles.num} />
          <td className={styles.num}>{fmtMoney2(o.donation.net)}</td>
          <td className={styles.num}>{share(o.donation.scoutPct, o.donation.scout)}</td>
          <td className={styles.num}>{share(o.donation.troopPct, o.donation.troop)}</td>
        </tr>
      )}
      {o.deliveryFee > 0 && (
        <tr>
          <td>Delivery fee: troop income, not split</td>
          <td className={styles.num} />
          <td className={styles.num}>{fmtMoney2(o.deliveryFee)}</td>
          <td colSpan={4} />
        </tr>
      )}
      {(o.cardFee || o.feeCovered > 0) && (
        <tr>
          <td colSpan={6}>
            {/* The donation's part of the fee is on the donation row; this row is the part that comes off the troop. */}
            {o.cardFee ? (
              <>
                Card fee {fmtMoney2(o.cardFee.wreaths)}
                {o.feeCovered > 0 && <> − {fmtMoney2(o.feeCovered)} the customer covered</>}
              </>
            ) : (
              <>Card fee not in yet (the customer covered {fmtMoney2(o.feeCovered)})</>
            )}
          </td>
          <td className={styles.num}>{signed(-o.troopCardCost)}</td>
        </tr>
      )}
      {o.shortOnWreaths > 0 && (
        <tr>
          <td colSpan={6}>Paid short: the troop absorbs it</td>
          <td className={styles.num}>−{fmtMoney2(o.shortOnWreaths)}</td>
        </tr>
      )}
      <tr className={styles.orderFoot}>
        <td colSpan={5}>
          Order total {fmtMoney2(o.total)}
          {o.received != null && <> · received {fmtMoney2(o.received)}</>}
          {o.difference && <span className={styles.unpaid}> · {o.difference}</span>}
        </td>
        <td className={styles.num}>{fmtMoney2(o.scout)}</td>
        <td className={styles.num}>{fmtMoney2(o.troop)}</td>
      </tr>
    </tbody>
  );
}

/** One scout's (or Unassigned's) section: the header, every order, and the bottom line. */
export function WreathStatementSection({
  section,
  year,
  settings,
  asOf,
  printRoot = false
}: {
  section: ReconSection;
  year: number;
  settings: Reconciliation['settings'];
  /** The instant the figures were read. */
  asOf: string;
  printRoot?: boolean;
}) {
  const t = section.totals;
  return (
    <section className={styles.section} aria-label={`${section.name} wreath account`} data-statement-print={printRoot ? '' : undefined}>
      <header className={styles.head}>
        <h2 className={styles.name}>{section.name}</h2>
        <p className={styles.meta}>
          Wreath sale {year} · as of {fmtDateTime(asOf)}
        </p>
        {printRoot && <StatementSettings settings={settings} />}
      </header>
      <div className={styles.wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className={styles.num}>List price</th>
              <th scope="col" className={styles.num}>Price paid</th>
              <th scope="col" className={styles.num}>Cost</th>
              <th scope="col" className={styles.num}>Gross profit</th>
              <th scope="col" className={styles.num}>Scout</th>
              <th scope="col" className={styles.num}>Troop</th>
            </tr>
          </thead>
          {section.orders.map((o) => (
            <OrderRows key={o.id} o={o} />
          ))}
        </table>
      </div>
      <dl className={styles.bottom}>
        <dt>{section.personId == null ? 'Scout total (no scout credit)' : `${section.firstName}’s total`}</dt>
        <dd>{fmtMoney2(t.scout)}</dd>
        <dt>Troop total</dt>
        <dd>{fmtMoney2(t.troop)}</dd>
        {t.deliveryFees > 0 && (
          <>
            <dt>Delivery fees to the troop</dt>
            <dd>{fmtMoney2(t.deliveryFees)}</dd>
          </>
        )}
        <dt>Paid</dt>
        <dd>
          {plural(t.paidOrders, 'order')}, {fmtMoney2(t.collected)}
        </dd>
        <dt>Pledged (unpaid)</dt>
        <dd>
          {plural(t.unpaidOrders, 'order')}, {fmtMoney2(t.owed)}
        </dd>
      </dl>
      {t.notCounted > 0 && <p className={styles.meta}>{plural(t.notCounted, 'cancelled or refunded order')} listed, struck through, and not counted.</p>}
      {section.personId != null && <p className={styles.closing}>Moves to {section.firstName}’s scout account after the books close (December).</p>}
    </section>
  );
}

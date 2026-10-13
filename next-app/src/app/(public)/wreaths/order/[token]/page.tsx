import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageShell } from '@/app/_components/page-shell';
import { PageHeader } from '@/app/_components/page-header';
import { Notice } from '@/app/_components/notice';
import { Button } from '@/app/_components/button';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDateFull } from '@/lib/format-date';
import { arrivalParagraphs } from '@/lib/wreaths/copy';
import { loadConfirmation } from '@/lib/wreaths/public';
import { PAY_TREASURER, fmtMoney2 } from '@/lib/wreaths/rules';
import styles from '../../wreaths.module.css';

/**
 * /wreaths/order/<token> — the customer's confirmation. The token is an unguessable uuid; there is no list of orders
 * and no way to find one by number. Shows the order number, items, total, how to pay and when it arrives — never the
 * address, phone or email. Never indexed, never cached, never sent as a Referer (also set in next.config.ts).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Order placed — Troop 79 wreaths',
  robots: { index: false, follow: false },
  referrer: 'no-referrer'
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await loadConfirmation(createAdminClient(), token);
  if (!o) notFound();

  const arrival = arrivalParagraphs({
    fulfillment: o.fulfillment,
    scoutName: o.scoutName,
    scoutFirstName: o.scoutFirstName,
    outsideAreaRelative: o.outsideAreaRelative,
    hasDonated: o.items.some((i) => i.donated),
    distribution: o.distribution
  });

  return (
    <PageShell width="narrow">
      <PageHeader
        kicker={`Order ${o.orderNumber}`}
        title={`Thank you, ${o.firstName}. Your order is placed.`}
        lede={`We emailed a copy to the address you gave us.${o.scoutName ? ` ${o.scoutName} gets credit for it.` : ''}`}
      />
      {o.status === 'cancelled' ? (
        <Notice tone="info">This order was cancelled. Write bsatroop79bg@gmail.com if that is a surprise.</Notice>
      ) : o.paymentStatus === 'paid' ? (
        <Notice tone="success">
          <strong>Paid {fmtMoney2(o.total)}.</strong> Thank you!
        </Notice>
      ) : (
        <Notice tone="warning">
          <div className={styles.payHow}>
            <p>
              <strong>{fmtMoney2(o.total)} due.</strong> Please pay by Venmo or PayPal and put <strong>{o.orderNumber}</strong> in the payment note, so we can match it to your order.
            </p>
            <p>
              Venmo: <a href={PAY_TREASURER.venmoUrl}>{PAY_TREASURER.venmoHandle}</a>
            </p>
            <p>
              PayPal: <strong>{PAY_TREASURER.paypalEmail}</strong>, choosing Friends and family.
            </p>
            <p>{PAY_TREASURER.note}</p>
          </div>
        </Notice>
      )}

      <section className={`${styles.card} ${styles.pad} ${styles.step} ${styles.inset}`} aria-labelledby="hW">
        <h2 id="hW">What you ordered</h2>
        <ul className={styles.lines}>
          {o.items.map((i) => (
            <li key={`${i.label}-${i.donated}`} className={styles.line}>
              <span className={styles.lName}>
                {i.quantity} × {i.label} {i.donated && <span className={styles.tag}>Donated to veterans</span>}
              </span>
              <span className={styles.lAmt}>{fmtMoney2(i.amount)}</span>
            </li>
          ))}
        </ul>
        <dl className={styles.sumRows}>
          {o.deliveryFee > 0 && (
            <div>
              <dt>Delivery</dt>
              <dd>{fmtMoney2(o.deliveryFee)}</dd>
            </div>
          )}
          {o.gift > 0 && (
            <div>
              <dt>Gift to Troop 79</dt>
              <dd>{fmtMoney2(o.gift)}</dd>
            </div>
          )}
          {o.feeCovered > 0 && (
            <div>
              <dt>Processing fee</dt>
              <dd>{fmtMoney2(o.feeCovered)}</dd>
            </div>
          )}
          <div className={styles.sumTotal}>
            <dt>Total</dt>
            <dd>{fmtMoney2(o.total)}</dd>
          </div>
        </dl>
      </section>

      <section className={`${styles.card} ${styles.pad} ${styles.step}`} aria-labelledby="hA">
        <h2 id="hA">How it reaches you</h2>
        <div className={styles.prose}>
          {arrival.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </section>

      <section className={`${styles.card} ${styles.pad} ${styles.step}`} aria-labelledby="hQ">
        <h2 id="hQ">Questions or changes</h2>
        <p className={styles.prose}>
          Reply to your confirmation email, or write <a href="mailto:bsatroop79bg@gmail.com">bsatroop79bg@gmail.com</a>. Changes are possible until{' '}
          {o.changesBy ? fmtDateFull(o.changesBy) : 'the cutoff'}, when the troop places its order with the grower.
        </p>
      </section>
      <p>
        <Button variant="secondary" href="/wreaths">
          Order more
        </Button>
      </p>
    </PageShell>
  );
}

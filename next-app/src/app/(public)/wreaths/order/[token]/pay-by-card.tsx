'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { fmtMoney2, fromCents, toCents } from '@/lib/wreaths/rules';
import type { StartResult } from '@/lib/wreaths/card-payments';
import styles from '../../wreaths.module.css';

/**
 * The receipt page's card option (Release B, Plans/Wreath-Stripe-Checkout.md). It sits below the Venmo / PayPal
 * instructions — the no-fee way stays first. The total shown is a courtesy: the server recomputes the fee cover.
 * A customer who chose Venmo / PayPal sees only "Rather pay by card?" until they open it; then the fee box and the Pay
 * button appear (Patrick, 2026-10-19, W-1040). A card order shows the whole block at once.
 */
export function PayByCard({
  token,
  baseTotal,
  fee,
  initiallyCovered,
  cardChosen = true,
  startCard
}: {
  token: string;
  /** Items + gift + delivery, without any card fee. */
  baseTotal: number;
  fee: number;
  initiallyCovered: boolean;
  /** The customer chose card at checkout (lib/wreaths/public cardWasChosen); false = Venmo / PayPal, card behind a link. */
  cardChosen?: boolean;
  startCard: (token: string, coverFee: boolean) => Promise<StartResult>;
}) {
  const [open, setOpen] = useState(cardChosen);
  const [cover, setCover] = useState(initiallyCovered);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const total = fromCents(toCents(baseTotal) + (cover ? toCents(fee) : 0));

  if (!open) {
    return (
      <div className={styles.payHow}>
        <p>
          <button type="button" className={styles.linkBtn} onClick={() => setOpen(true)}>
            Rather pay by card? Pay by card, Apple Pay or Google Pay
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.payHow}>
      <p>
        <strong>Or pay by card</strong>, Apple Pay or Google Pay on Stripe’s secure page.
      </p>
      {fee > 0 && (
        <label className={styles.check}>
          <input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} />
          <span>Add {fmtMoney2(fee)} to cover the card fee, so the troop keeps the whole amount</span>
        </label>
      )}
      <p>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await startCard(token, cover).catch(() => null);
              if (res?.ok) window.location.assign(res.url);
              else setError(res?.error ?? 'Card payment isn’t working right now. Please try again, or pay by Venmo or PayPal.');
            })
          }
        >
          {pending ? 'Opening the card page…' : `Pay ${fmtMoney2(total)} by card`}
        </Button>
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/** Back from Stripe before the webhook landed: re-render every few seconds until the order shows paid (a minute at
 *  most — then the page says to check back, and the email receipt from Stripe is already on its way). */
export function CardReturnRefresh() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 20) return;
    const t = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, 3000);
    return () => clearTimeout(t);
  }, [tries, router]);
  return tries >= 20 ? <p>This is taking longer than usual. Stripe emails your receipt; this page will show the payment shortly.</p> : null;
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import type { CancelResult } from '@/lib/wreaths/customer-cancel';
import styles from '../../wreaths.module.css';

/**
 * "Cancel this order" on the receipt page (Patrick, 2026-10-16), offered only while lib/wreaths/customer-cancel says
 * the customer may. A quiet button that asks in place, naming what it costs, before anything is sent; the server
 * action re-checks everything and the page re-renders as Cancelled.
 */
export function CancelOrder({
  token,
  orderNumber,
  scoutFirstName,
  cancel
}: {
  token: string;
  orderNumber: string;
  scoutFirstName: string | null;
  cancel: (token: string) => Promise<CancelResult>;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <p>
        <Button variant="dangerGhost" onClick={() => setAsking(true)}>
          Cancel this order
        </Button>
      </p>
    );
  }
  return (
    <div className={styles.payHow} role="group" aria-label={`Cancel order ${orderNumber}`}>
      <p>
        <strong>Cancel order {orderNumber}?</strong> Nothing is charged{scoutFirstName ? `, and ${scoutFirstName} loses credit for it` : ''}. To order again, start a new order.
      </p>
      <p className={styles.cancelActions}>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await cancel(token).catch(() => null);
              if (res?.ok) router.refresh();
              else setError(res?.error ?? 'We couldn’t cancel the order just now. Please try again.');
            })
          }
        >
          {pending ? 'Cancelling…' : `Yes, cancel ${orderNumber}`}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setAsking(false)}>
          Keep my order
        </Button>
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

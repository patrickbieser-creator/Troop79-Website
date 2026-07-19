'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { enableSignup } from './actions';
import styles from './events-admin.module.css';

/** Enables signup seeded from the event's category preset. The preset is only
 *  a starting point — every block stays editable in the builder. */
export function EnableSignupButton({ calendarEntryId }: { calendarEntryId: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        className={styles.enableBtn}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await enableSignup(calendarEntryId);
            if (!res.ok) setError(res.error ?? 'Could not enable signup.');
            else router.refresh();
          })
        }
      >
        {pending ? 'Enabling…' : 'Enable signup'}
      </button>
      {error && <span className={styles.err}>{error}</span>}
    </>
  );
}

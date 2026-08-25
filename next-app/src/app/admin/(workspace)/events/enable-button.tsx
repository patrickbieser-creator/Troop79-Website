'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { enableSignup } from './actions';
import { Button } from '../../_components/button';
import styles from './events-admin.module.css';

/** Enables signup seeded from the event's category preset. The preset is only
 *  a starting point — every block stays editable in the builder. */
export function EnableSignupButton({ calendarEntryId }: { calendarEntryId: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <>
      <Button
        variant="primary"
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
      </Button>
      {error && <span className={styles.err}>{error}</span>}
    </>
  );
}

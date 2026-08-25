'use client';

/**
 * The roster's per-household "Resend" (Plans/Signup-Confirmation-Email.md):
 * the family receipt again, logged as a resend. A one-click action — not
 * dirty-gated; the click is its gate.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resendConfirmation } from '../../events/actions';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';

export function ResendConfirmation({ signupId, householdId }: { signupId: number; householdId: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await resendConfirmation(signupId, householdId);
            if (!res.ok) setError(res.error ?? 'Could not resend.');
            router.refresh();
          })
        }
      >
        {pending ? 'Sending…' : 'Resend'}
      </Button>
      {error && <Notice>{error}</Notice>}
    </>
  );
}

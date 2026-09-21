'use client';

/**
 * "Send for Review" — the one button on the proof form, disabled while the
 * submission is in flight.
 *
 * submitProofAction uploads media and sends the leader notification before
 * it redirects, so on a phone the form sits there for a second or two
 * looking like nothing happened. Scouts tapped again. The live Proof Queue
 * ended up holding one scout's claim five times over (Patrick, 2026-09-20).
 *
 * Scoped to this route on purpose: `@/app/_components/button` is
 * server-safe and shared across the whole public side, and useFormStatus
 * would make every consumer of it a client component. This wraps it
 * instead.
 *
 * useFormStatus only reports pending inside the <form> it is rendered in,
 * so this must stay a child of that form, never the form element itself.
 */

import { useFormStatus } from 'react-dom';
import { Button } from '@/app/_components/button';

export function SubmitProofButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button variant="primary" type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? 'Sending…' : children}
    </Button>
  );
}

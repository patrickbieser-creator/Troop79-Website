'use client';

/**
 * Client-side session poll for the shell.
 *
 * The public layout is deliberately NOT async and never reads cookies — doing
 * either would bail every public page out of static/ISR generation (caught in
 * build output 2026-08-06, see site-nav.tsx). So anything in the shell that
 * depends on who you are has to ask the server after hydration.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { SessionStatus } from '@/app/api/session-status/route';

const POLL_MS = 60_000;

export function useSessionStatus(): SessionStatus | null {
  const pathname = usePathname();
  const [status, setStatus] = useState<SessionStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    function check() {
      fetch('/api/session-status', { cache: 'no-store' })
        .then((res) => res.json())
        .then((data: SessionStatus) => {
          if (!cancelled) setStatus(data);
        })
        .catch(() => {
          // Network hiccup — leave the current state alone; the next poll or
          // trigger will catch up.
        });
    }
    check();
    const interval = setInterval(check, POLL_MS);
    // Re-check on focus so signing in or out in another tab shows up here.
    window.addEventListener('focus', check);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', check);
    };
  }, [pathname]);

  return status;
}

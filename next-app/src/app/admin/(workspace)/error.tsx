'use client';

/**
 * Error boundary for the Leader Workspace
 * (Plans/Unified-Identity-And-Capabilities.md Phase B2).
 *
 * WHY THIS EXISTS
 * Guards throw. `requireCapability()` and `requireRole()` both signal refusal
 * by throwing, which without a boundary renders as a raw 500 — found in
 * browser verification 2026-08-16, reaching /admin/access with a
 * partially-granted identity session.
 *
 * A refusal is a foreseeable, ordinary event: a bookmarked URL, a stale link,
 * a capability revoked since the tab was opened. It should read as "you can't
 * open this one", not as a crash. The nav already hides what an actor cannot
 * reach, so anyone landing here arrived by URL.
 *
 * This is NOT the access-control boundary — the guards are. It only decides
 * how a refusal is presented.
 *
 * The thrown messages are written for humans ("This action requires leader
 * access.", "Manage the roster is held by nobody...") so showing `error.message`
 * is deliberate rather than lazy. It leaks no data: it names a capability, not
 * a record. Anything that is NOT a guard refusal gets the generic branch, so an
 * unexpected bug is never dressed up as a permissions problem.
 */

import Link from 'next/link';
import { useEffect } from 'react';

function isRefusal(message: string): boolean {
  return (
    message.startsWith('This action requires') ||
    message === 'Not authenticated' ||
    message === 'This account does not have admin access.'
  );
}

export default function WorkspaceError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Refusals are expected; real failures are not, and still deserve a trace.
    if (!isRefusal(error.message)) console.error('[admin] unhandled error', error);
  }, [error]);

  const refused = isRefusal(error.message);

  return (
    <div style={{ maxWidth: '46rem', padding: '1rem 0' }}>
      <h1 style={{ marginTop: 0 }}>{refused ? 'You can’t open this page' : 'Something went wrong'}</h1>
      <p style={{ color: '#5b5347' }}>
        {refused
          ? error.message
          : 'That page failed to load. If it keeps happening, the details are in the server log.'}
      </p>
      {refused ? (
        <p style={{ color: '#857c6c', fontSize: '0.9rem' }}>
          If you should have access to this, ask a troop leader to grant it on the Access &amp;
          Permissions screen.
        </p>
      ) : null}
      <p style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
        <Link href="/admin/advancement/dashboard">← Back to the dashboard</Link>
        {!refused ? (
          <button type="button" onClick={reset} style={{ cursor: 'pointer' }}>
            Try again
          </button>
        ) : null}
      </p>
    </div>
  );
}

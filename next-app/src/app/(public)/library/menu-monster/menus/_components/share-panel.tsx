'use client';

/**
 * The owner's Share tab (Phase 3): Share with the troop / Stop sharing. What a
 * scout must know BEFORE sharing — that everyone, signed in or not, sees it
 * with their name as "Sam K." (Decision 12) — is said beside the button. A
 * shared menu keeps updating as they save (Decision 19). Sharing again after
 * stopping puts it back at the top of the shelf.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { shareMenuAction } from '../../../_tools/menu-monster/menu-actions';
import { ShareStatusLine, type ShareStatus } from './share-status';
import s from './workspace.module.css';

export function SharePanel({ menuId, credit, status }: { menuId: string; credit: string | null; status: ShareStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = status.sharedAt != null;

  async function toggle() {
    setBusy(true);
    setError(null);
    const res = await shareMenuAction(menuId, !shared);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <section className={s.hubSection}>
      <ShareStatusLine status={status} owner />
      {!shared && (
        <p className={s.foot}>
          Anyone who visits the site can see a shared menu, with your name as {credit ? `“${credit}”` : 'your first name and last initial'}. Changes you save show
          straight away.
        </p>
      )}
      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}
      <Button variant={shared ? 'secondary' : 'primary'} onClick={() => void toggle()} disabled={busy}>
        {busy ? (shared ? 'Stopping…' : 'Sharing…') : shared ? 'Stop sharing' : 'Share with the troop'}
      </Button>
    </section>
  );
}

'use client';

/**
 * Actions ▾ (2026-08-20) — same shape as Finance's (D-156). Replaces the
 * page's two standalone buttons: "Download .txt (N)" (was a plain <a
 * download>-style href; router.push to the same route still triggers the
 * browser download via the route's Content-Disposition header, same
 * mechanism as Finance's own Export CSV option) and "Mark N as Submitted"
 * (was mark-submitted-button.tsx, folded in here — same confirm+action).
 * Either option is omitted entirely when its count is 0, rather than shown
 * disabled with no explanation.
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bulkSetScoutbookSubmitted } from '../ledger/actions';
import styles from './scoutbook-export.module.css';

interface Props {
  downloadHref: string;
  downloadCount: number;
  unsubmittedIds: number[];
}

export function ScoutbookActions({ downloadHref, downloadCount, unsubmittedIds }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function markSubmitted() {
    if (unsubmittedIds.length === 0) return;
    const ok = window.confirm(
      `Mark ${unsubmittedIds.length} row${unsubmittedIds.length === 1 ? '' : 's'} as submitted to Scoutbook? ` +
        'Only do this after the .txt file has been uploaded and verified.'
    );
    if (!ok) return;
    const fd = new FormData();
    fd.set('ids', JSON.stringify(unsubmittedIds));
    startTransition(async () => {
      const res = await bulkSetScoutbookSubmitted(fd);
      if (!res.ok) {
        window.alert(res.error ?? 'Failed to mark as submitted');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.actionsBar}>
      <select
        value=""
        className={styles.select}
        aria-label="Scoutbook Export actions"
        disabled={isPending}
        onChange={(e) => {
          const v = e.target.value;
          e.target.value = '';
          if (v === 'download') router.push(downloadHref);
          else if (v === 'mark-submitted') markSubmitted();
        }}
      >
        <option value="">Actions…</option>
        {downloadCount > 0 && <option value="download">Download .txt ({downloadCount})</option>}
        {unsubmittedIds.length > 0 && (
          <option value="mark-submitted">
            {isPending ? 'Marking…' : `Mark ${unsubmittedIds.length} as Submitted`}
          </option>
        )}
      </select>
    </div>
  );
}

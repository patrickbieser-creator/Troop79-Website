'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bulkSetScoutbookSubmitted } from '../ledger/actions';
import styles from './scoutbook-export.module.css';

export function MarkSubmittedButton({ ids }: { ids: number[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run() {
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Mark ${ids.length} row${ids.length === 1 ? '' : 's'} as submitted to Scoutbook? ` +
        'Only do this after the .txt file has been uploaded and verified.'
    );
    if (!ok) return;
    const fd = new FormData();
    fd.set('ids', JSON.stringify(ids));
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
    <button
      type="button"
      className={`${styles.downloadBtn} ${ids.length === 0 ? styles.downloadBtnDisabled : ''}`}
      onClick={run}
      disabled={ids.length === 0 || isPending}
    >
      {isPending ? 'Marking…' : `Mark ${ids.length} as Submitted`}
    </button>
  );
}

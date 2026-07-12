'use client';

import { useState, useTransition } from 'react';
import { syncBunnyLibrary } from '../news/media/actions';
import styles from './utilities.module.css';

export function BunnySyncCard() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function runSync() {
    startTransition(async () => {
      const res = await syncBunnyLibrary();
      if (!res.ok) {
        setResult({ ok: false, message: res.error ?? 'Sync failed.' });
        return;
      }
      const parts = [`${res.added} new photo${res.added === 1 ? '' : 's'} indexed`];
      if (res.alreadyIndexed) parts.push(`${res.alreadyIndexed} already up to date`);
      setResult({ ok: true, message: parts.join(' · ') });
    });
  }

  return (
    <div className={styles.card}>
      <h3>Bunny Media Library Sync</h3>
      <p className={styles.cardSub}>
        Scans the whole Bunny storage zone and adds a media-library entry for any photo that isn&rsquo;t
        indexed yet — covers photos uploaded straight to Bunny outside the News CMS. Safe to re-run
        any time; already-indexed photos are skipped.
      </p>
      <button type="button" className={styles.syncBtn} disabled={isPending} onClick={runSync}>
        {isPending ? 'Syncing…' : 'Sync Bunny Library'}
      </button>
      {result && (
        <div className={`${styles.result} ${result.ok ? styles.resultOk : styles.resultError}`}>
          {result.message}
        </div>
      )}
    </div>
  );
}

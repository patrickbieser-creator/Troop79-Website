'use client';

/**
 * Keeps the This Sunday tab live (tech-lead review: polling, not Realtime, fits the service-role-only posture). Every
 * ~10 s, with jitter so open tabs don't poll in step, it asks for the board's version stamp and refreshes the page
 * only when the stamp changed. Paused while the browser tab is hidden; checks once on coming back.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { boardStampAction } from './actions';
import styles from './meeting-plan.module.css';

export const POLL_MS = 10_000;
export const JITTER_MS = 2_000;

export function BoardPoller({ entryId, stamp }: { entryId: number; stamp: string }) {
  const router = useRouter();
  const last = useRef(stamp);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    last.current = stamp;
  }, [stamp]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let failures = 0;

    const check = async () => {
      const res = await boardStampAction(entryId);
      if (stopped) return;
      if (!res.ok) {
        failures++;
        setStale(failures >= 3);
        return;
      }
      failures = 0;
      setStale(false);
      if (res.stamp !== last.current) {
        last.current = res.stamp;
        router.refresh();
      }
    };
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(async () => {
        if (!document.hidden) await check().catch(() => undefined);
        schedule();
      }, POLL_MS + Math.round((Math.random() * 2 - 1) * JITTER_MS));
    };
    const onVisible = () => {
      if (!document.hidden) void check().catch(() => undefined);
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [entryId, router]);

  return (
    <span className={styles.liveDot} role="status">
      {stale ? 'Updating… the last few checks failed' : 'Live · updates on every sign-up'}
    </span>
  );
}

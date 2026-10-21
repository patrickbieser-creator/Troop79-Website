'use client';

/**
 * Keeps the planner board live: the public twin of Admin's BoardPoller (same rules: ~10 s with jitter, paused while
 * the tab is hidden, refresh only when the board's stamp changed). Renders the header's "● Live" marker.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { plannerStampAction } from './actions';
import styles from './planner.module.css';

const POLL_MS = 10_000;
const JITTER_MS = 2_000;

export function PlannerPoller({ entryId, stamp }: { entryId: number; stamp: string }) {
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
      const res = await plannerStampAction(entryId);
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
    <span className={stale ? styles.liveStale : styles.live} role="status">
      {stale ? 'Updating… the last few checks failed' : '● Live'}
    </span>
  );
}

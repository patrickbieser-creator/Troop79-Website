'use client';

/**
 * Keeps the planner board live: the public twin of Admin's BoardPoller (same rules: ~10 s with jitter, paused while
 * the tab is hidden, refresh only when the board's stamp changed). Renders the header's "● Live" marker.
 *
 * P2a: inside the planner's provider it shares the page's stamp, skips a tick while a save is in flight, and takes the
 * stamp a save returned, so it never refreshes over a result the drawer already shows.
 *
 * P4: Meeting Live polls faster (pollMs 3 s, jitter 1 s): several leaders run it at once on their phones.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { plannerStampAction } from './actions';
import { usePlanner } from './planner-client';
import styles from './planner.module.css';

const POLL_MS = 10_000;
const JITTER_MS = 2_000;

export function PlannerPoller({ entryId, stamp, pollMs = POLL_MS, jitterMs = JITTER_MS }: { entryId: number; stamp: string; pollMs?: number; jitterMs?: number }) {
  const router = useRouter();
  const sync = usePlanner()?.sync;
  const own = useRef(stamp);
  const last = sync?.stamp ?? own;
  const [stale, setStale] = useState(false);

  useEffect(() => {
    last.current = stamp;
  }, [stamp, last]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let failures = 0;
    const check = async () => {
      if (sync?.busy()) return;
      const res = await plannerStampAction(entryId);
      if (stopped || sync?.busy()) return;
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
      }, pollMs + Math.round((Math.random() * 2 - 1) * jitterMs));
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
  }, [entryId, router, last, sync, pollMs, jitterMs]);

  return (
    <span className={stale ? styles.liveStale : styles.live} role="status">
      {stale ? 'Updating… the last few checks failed' : '● Live'}
    </span>
  );
}

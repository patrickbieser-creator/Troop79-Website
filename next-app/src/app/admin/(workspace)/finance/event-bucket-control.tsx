'use client';

/**
 * An event's bucket (Plans/Buckets-Lookup.md) — one control, used on the event's Money tab and on the calendar
 * workbench's Entry tab (Patrick, 2026-10-18), so an event with no sign-up (no Money tab) can have one too.
 * One-click: picking saves at once (setEventBucketAction) and moves the event's own linked rows into the
 * bucket, so it sits apart from any draft form and says so.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BucketPicker } from '../_components/bucket-picker';
import { createBucketAction, setEventBucketAction } from './bucket-actions';
import type { Bucket } from '@/lib/buckets';
import s from './event-bucket-control.module.css';

export function EventBucketControl({ calendarEntryId, bucketId, buckets }: { calendarEntryId: number; bucketId: number | null; buckets: Bucket[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(bucketId);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(id: number | null) {
    const before = value;
    setValue(id);
    setNote(null);
    setError(null);
    start(async () => {
      const res = await setEventBucketAction(calendarEntryId, id);
      if (!res.ok) {
        setValue(before);
        setError(res.error ?? 'Could not set the bucket.');
        return;
      }
      const n = res.moved ?? 0;
      setNote(id == null ? 'Bucket cleared.' : n > 0 ? `Saved — ${n} of this event’s transactions moved into it.` : 'Saved.');
      router.refresh();
    });
  }

  return (
    <div className={s.row}>
      <span className={s.label}>Bucket</span>
      <div className={s.picker}>
        <BucketPicker id={`event-bucket-${calendarEntryId}`} label="Bucket" buckets={buckets} value={value} onChange={pick} canCreate createBucket={createBucketAction} />
      </div>
      <span className={s.hint}>
        {pending ? 'Saving…' : 'Takes effect immediately. This event’s own payments and expenses move into it.'}
      </span>
      {note && (
        <p className={s.note} role="status">
          {note}
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

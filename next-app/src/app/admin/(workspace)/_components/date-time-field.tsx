'use client';

/**
 * DatePickerField plus a time input, for the one field in admin that needs a
 * moment rather than a day: the signup deadline.
 *
 * It also corrects a display bug in the `<input type="datetime-local">` it
 * replaces. That control was seeded with `deadline.slice(0, 16)` — the first
 * 16 characters of the stored timestamptz, which Postgres hands back in UTC —
 * but rendered them as if they were local, so a 6:00 PM Central deadline
 * showed as 11:00 PM. Saving then ran the value back through
 * `new Date(local).toISOString()`, shifting it another six hours every time
 * the field was touched. Here the stored instant is split into LOCAL date and
 * time for display and recombined as a local Date on the way out, so a
 * round-trip that changes nothing writes back the same instant.
 */

import { useState } from 'react';
import { DatePickerField } from './date-picker-field';
import styles from './date-time-field.module.css';

const pad = (n: number) => String(n).padStart(2, '0');

function splitLocal(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  };
}

function combineLocal(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  const combined = new Date(y, mo - 1, d, h, mi, 0, 0);
  return Number.isNaN(combined.getTime()) ? '' : combined.toISOString();
}

interface Props {
  /** Full ISO timestamp, or '' for none. */
  value: string;
  /** Fires with a full ISO timestamp, or '' when the date is cleared. */
  onChange: (iso: string) => void;
  disabled?: boolean;
  /** Time used when a date is picked but no time has been set yet. */
  defaultTime?: string;
}

export function DateTimeField({ value, onChange, disabled, defaultTime = '23:59' }: Props) {
  const initial = splitLocal(value);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);

  // Resync when the committed `value` prop changes underneath us — the same
  // guard DatePickerField carries, and the same defect that made the /profile
  // member switcher show the previous person's data: a useState initializer
  // runs ONCE, so a field seeded from props silently keeps showing stale
  // values when the parent hands it a different record. Adjusted during
  // render (React's documented "reset state when a prop changes" pattern)
  // rather than in an effect, so there is no flash of the old value.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    const next = splitLocal(value);
    setDate(next.date);
    setTime(next.time);
  }

  function commit(nextDate: string, nextTime: string) {
    setDate(nextDate);
    setTime(nextTime);
    onChange(nextDate ? combineLocal(nextDate, nextTime) : '');
  }

  return (
    <div className={styles.row}>
      <DatePickerField
        value={date}
        disabled={disabled}
        // Picking a date with no time yet fills in the default rather than
        // silently assuming midnight — a deadline of "the 20th" means the end
        // of the 20th, and the leader can see and change it.
        onChange={(d) => commit(d, d && !time ? defaultTime : time)}
      />
      <input
        type="time"
        className={styles.time}
        value={time}
        disabled={disabled || !date}
        onChange={(e) => commit(date, e.target.value)}
        aria-label="Time"
      />
    </div>
  );
}

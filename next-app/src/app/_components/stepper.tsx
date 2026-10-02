'use client';

/**
 * Shared public dialer — `− [n] +`, 32px tall with a 16px number
 * (Calm-Site-Restyle Decision 1). Promoted from the Menu Monster planner so the
 * workspace, event sign-up (guest counts, days, seats) and the planner all share
 * one control. Canonical rendering: /admin/styleguide/public → Stepper.
 *
 * Pieces:
 *   Stepper     − [n] + with a group label, per-button labels and an optional
 *               visible label ("People:") rendered to the left.
 *   NumberBox   the number input on its own. Commits on blur / Enter (clamped
 *               and rounded). While typing, a whole number inside min..max
 *               commits live; anything else waits for blur — typing "16" into
 *               a 2–50 field must not clamp "1" to 2 halfway through.
 *   AmountInput a plain framed number input for a native form field that is not
 *               a dial (dollars and cents).
 *
 * Prop changes (the +/− buttons, a restore) reset the draft during render —
 * React's derive-from-props pattern, no effect needed.
 */

import { useState, type ComponentProps, type ReactNode } from 'react';
import s from './stepper.module.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function NumberBox({
  id,
  value,
  min,
  max,
  step = 1,
  onCommit,
  ariaLabel,
  describedBy,
  invalid,
  framed
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (n: number) => void;
  ariaLabel?: string;
  describedBy?: string;
  invalid?: boolean;
  /** Stand-alone look (own border, left-aligned) instead of sitting inside a Stepper. */
  framed?: boolean;
}) {
  const cents = step < 1;
  const show = (n: number) => (cents ? n.toFixed(2) : String(n));
  const [prev, setPrev] = useState(value);
  const [draft, setDraft] = useState(() => show(value));
  if (prev !== value) {
    setPrev(value);
    setDraft(show(value));
  }
  function commit() {
    const raw = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(raw)) {
      setDraft(show(value));
      return;
    }
    const rounded = cents ? Math.round(raw * 100) / 100 : Math.round(raw);
    const next = Math.min(max, Math.max(min, rounded));
    setDraft(show(next));
    onCommit(next);
  }
  function type(text: string) {
    setDraft(text);
    // Whole-number boxes commit live once the number is already valid, so the
    // parent (and its Save button) follows the keyboard. Cents boxes wait: a
    // live commit would rewrite "3." to "3.00" under the cursor.
    if (cents || !/^-?\d+$/.test(text.trim())) return;
    const n = Number(text);
    if (n >= min && n <= max && n !== value) onCommit(n);
  }
  return (
    <input
      type="number"
      inputMode={cents ? 'decimal' : 'numeric'}
      id={id}
      className={framed ? s.box : s.input}
      value={draft}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      onChange={(e) => type(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

export function Stepper({
  id,
  value,
  min,
  max,
  onChange,
  groupLabel,
  lessLabel,
  moreLabel,
  label,
  inputLabel,
  describedBy,
  invalid
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  /** Names the − [n] + group for screen readers. */
  groupLabel: string;
  lessLabel: string;
  moreLabel: string;
  /** A visible label drawn to the left, ending in a colon ("People:"). It also names the number. */
  label?: ReactNode;
  /** The number's accessible name when no visible `label` or outside <label for> names it. */
  inputLabel?: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const dial = (
    <div className={cx(s.stepper, invalid && s.invalid)} role="group" aria-label={groupLabel}>
      <button type="button" className={s.btn} aria-label={lessLabel} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <NumberBox id={id} value={value} min={min} max={max} onCommit={onChange} describedBy={describedBy} invalid={invalid} ariaLabel={inputLabel} />
      <button type="button" className={s.btn} aria-label={moreLabel} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
  if (label == null) return dial;
  return (
    <span className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}:
      </label>
      {dial}
    </span>
  );
}

/** A framed plain number input for a native form field that is not a dial —
 *  dollars and cents. Same 32px / 16px look as the Stepper's number. */
export function AmountInput({ className, ...rest }: Omit<ComponentProps<'input'>, 'type'>) {
  return <input type="number" inputMode="decimal" className={cx(s.box, className)} {...rest} />;
}

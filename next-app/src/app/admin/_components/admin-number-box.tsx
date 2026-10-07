'use client';

/**
 * Admin number box — the admin twin of the shared NumberBox (src/app/_components/stepper.tsx). Same props and behaviour
 * (a whole number or cents; clamps to min/max; commits on blur and Enter, and live once a whole number is already valid;
 * an emptied box snaps back), painted only from --admin-* tokens so admin never reads the public palette.
 * Specimen: /admin/styleguide/admin → Number box.
 */
import { useState } from 'react';
import s from './admin-number-box.module.css';

export function AdminNumberBox({
  id,
  value,
  min,
  max,
  step = 1,
  onCommit,
  ariaLabel,
  describedBy,
  invalid
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
    if (cents || !/^-?\d+$/.test(text.trim())) return;
    const n = Number(text);
    if (n >= min && n <= max && n !== value) onCommit(n);
  }
  return (
    <input
      type="number"
      inputMode={cents ? 'decimal' : 'numeric'}
      id={id}
      className={s.input}
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
        // Commit without preventDefault: inside a form Enter must still submit.
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import s from './save-toast.module.css';

/**
 * A save's feedback where every tap can see it (Patrick, 2026-11-01: "users need more feedback that something has
 * changed and there is no further step needed"): a pill at the foot of the screen that says "Saving…" the moment a
 * save starts, then "✓ Saved. Nothing else to do." for a few seconds. A failed save just closes it: the form's own
 * error says what went wrong. Overlapping saves read as one.
 *
 *   const { track, toast } = useSaveToast();
 *   const res = await track(write(op), (r) => r.ok);
 *   return <>{form}{toast}</>;
 */
export const SAVED_TEXT = '✓ Saved. Nothing else to do.';
const SAVED_MS = 2500;

export type SaveToastPhase = 'idle' | 'saving' | 'saved';
type Phase = SaveToastPhase;

export function useSaveToast() {
  const [phase, setPhase] = useState<Phase>('idle');
  const inflight = useRef(0);
  const failed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const track = useCallback(async <T,>(save: Promise<T>, ok: (v: T) => boolean): Promise<T> => {
    if (timer.current) clearTimeout(timer.current);
    if (inflight.current === 0) failed.current = false;
    inflight.current++;
    setPhase('saving');
    let v: T;
    try {
      v = await save;
      if (!ok(v)) failed.current = true;
    } catch (e) {
      failed.current = true;
      throw e;
    } finally {
      inflight.current--;
      if (inflight.current === 0) {
        if (failed.current) setPhase('idle');
        else {
          setPhase('saved');
          timer.current = setTimeout(() => setPhase('idle'), SAVED_MS);
        }
      }
    }
    return v;
  }, []);

  return { track, toast: <SaveToast phase={phase} /> };
}

/** `inline` sits in the page's flow instead of over it (the styleguide specimen). */
export function SaveToast({ phase, inline = false }: { phase: Phase; inline?: boolean }) {
  return (
    <div className={inline ? s.inline : s.dock} aria-live="polite">
      {phase === 'idle' ? null : <span className={`${s.toast} ${phase === 'saved' ? s.saved : ''}`}>{phase === 'saving' ? 'Saving…' : SAVED_TEXT}</span>}
    </div>
  );
}

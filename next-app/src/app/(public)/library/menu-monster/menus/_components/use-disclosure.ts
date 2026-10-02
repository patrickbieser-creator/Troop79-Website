'use client';

/**
 * A plain disclosure: a trigger button with aria-expanded and a panel of
 * ordinary buttons or links. Escape closes it and returns focus to the
 * trigger; so does focus moving to something outside it (Tab away) or a press
 * outside. Shared by the ⋯ row menu and the Add-a-meal list.
 */

import { useEffect, useRef, useState, type FocusEvent } from 'react';

export function useDisclosure() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Focus-out to a known element outside the wrapper. A null relatedTarget
  // (Safari doesn't focus a clicked button) is left to the press-outside rule.
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && wrap.current && !wrap.current.contains(next)) setOpen(false);
  };

  return { open, wrapRef: wrap, triggerRef: trigger, onBlur, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}

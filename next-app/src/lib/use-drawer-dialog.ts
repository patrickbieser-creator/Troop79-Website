'use client';

/**
 * The behaviour of a side drawer, shared by the public Drawer (src/app/_components/drawer.tsx) and the admin
 * AdminDrawer (Plans/Admin-Health-Forms.md, Reuse → New). The two differ only in markup and tokens: the admin↔public
 * firewall forbids rendering one side's component on the other, so the behaviour lives here once.
 *
 * On mount: opens the native <dialog> as a modal (focus stays inside, Esc cancels), remembers what had focus and locks
 * the page behind from scrolling. On unmount: unlocks and returns focus to the opener. `dialogProps` wires Esc and a
 * click on the dimmed page to onClose.
 */
import { useEffect, useRef } from 'react';

export function useDrawerDialog(onClose: () => void) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  const dialogProps = {
    ref,
    onCancel: (e: React.SyntheticEvent<HTMLDialogElement>) => {
      e.preventDefault();
      onClose();
    },
    onClick: (e: React.MouseEvent<HTMLDialogElement>) => {
      // A click on the dialog box itself (outside the panel) is a click on the dimmed page.
      if (e.target === e.currentTarget) onClose();
    }
  };
  return dialogProps;
}

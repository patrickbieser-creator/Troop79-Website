'use client';

/**
 * useGuardedNav — navigate, unless a form on the page is dirty, in which case
 * ask first (Patrick, 2026-08-25: "When a form is dirty, the back control
 * should prompt discard changes"). BackNav uses it for the way back; the
 * calendar workbench uses it for its tab strip, since tabs became URL
 * navigations (each tab loads only its own data) and an unsaved Entry form
 * must not silently vanish on a tab click.
 *
 *   const { navigate, dialog } = useGuardedNav();
 *   <button onClick={() => navigate(href)}>…</button>
 *   {dialog}
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogActions, DialogBody, DialogHeader } from './dialog';
import { Button } from '../../_components/button';
import { useDirtyGuard } from './dirty-guard';

export function useGuardedNav(): { navigate: (href: string) => void; dialog: ReactNode } {
  const router = useRouter();
  const guard = useDirtyGuard();
  const [pending, setPending] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // The shared Dialog is a plain <dialog>; callers open it (the app-wide pattern).
  useEffect(() => {
    if (pending) dialogRef.current?.showModal();
  }, [pending]);

  function navigate(href: string) {
    if (guard?.isDirty()) {
      setPending(href);
      return;
    }
    router.push(href);
  }

  const dialog = pending ? (
    <Dialog ref={dialogRef} danger onClose={() => setPending(null)}>
      <DialogHeader title="Discard changes?" sub="This page has unsaved changes. Leaving now loses them." />
      <DialogBody>{null}</DialogBody>
      <DialogActions>
        <Button variant="secondary" size="sm" onClick={() => setPending(null)}>
          Keep editing
        </Button>
        <Button variant="dangerSolid" size="sm" onClick={() => router.push(pending)}>
          Discard changes
        </Button>
      </DialogActions>
    </Dialog>
  ) : null;

  return { navigate, dialog };
}

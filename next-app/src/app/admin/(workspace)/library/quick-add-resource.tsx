'use client';

/**
 * "+ Add Resource" quick-add — the same entry form as the Add Resource tab,
 * in a dialog over whatever shelf you're already looking at
 * (Plans/Library-Admin-Resource-Entry.md: both entry points, Patrick
 * 2026-08-12). Phase C (2026-08-21): converted onto the shared Dialog —
 * the documented Phase B exception that rode with the library workstation
 * scoped pass — gaining the spec chrome and Esc/backdrop close for free.
 * The trigger is the shared green AddButton (create = green, D-159).
 */

import { useEffect, useRef, useState } from 'react';
import { ResourceEntryForm, type TargetOptionGroup } from './resource-entry-form';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../_components/dialog';
import { AddButton } from '../_components/add-button';
import styles from './library.module.css';

interface Props {
  targetGroups: TargetOptionGroup[];
  onCreate: (fd: FormData) => Promise<void>;
  onUploadDocument: (
    fd: FormData
  ) => Promise<{ ok: boolean; error?: string; url?: string; filename?: string }>;
}

export function QuickAddResource({ targetGroups, onCreate, onUploadDocument }: Props) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>+ Add Resource</AddButton>

      <Dialog
        ref={dialogRef}
        className={styles.quickAddWide}
        onClose={() => setOpen(false)}
      >
        {open && (
          <>
            <DialogHeader title="Add a resource" />
            <DialogBody>
              {/* Remounted per open (the `open &&` guard) so a cancelled entry
                  never leaves half-typed fields behind for the next one. */}
              <ResourceEntryForm
                targetGroups={targetGroups}
                onCreate={onCreate}
                onUploadDocument={onUploadDocument}
                embedded
              />
            </DialogBody>
            <DialogActions>
              <button type="button" className={styles.btnSecondary} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}

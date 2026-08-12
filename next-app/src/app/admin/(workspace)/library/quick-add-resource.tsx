'use client';

/**
 * "+ Add Resource" quick-add — the same entry form as the Add Resource tab,
 * in a dialog over whatever shelf you're already looking at
 * (Plans/Library-Admin-Resource-Entry.md: both entry points, Patrick
 * 2026-08-12). Matches how the Events and Photo Albums editors open.
 */

import { useEffect, useRef, useState } from 'react';
import { ResourceEntryForm, type TargetOptionGroup } from './resource-entry-form';
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
      <button type="button" className={styles.btnPrimary} onClick={() => setOpen(true)}>
        + Add Resource
      </button>

      <dialog
        ref={dialogRef}
        className={styles.quickAddDialog}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false);
        }}
      >
        {open && (
          <div className={styles.quickAddInner}>
            <div className={styles.quickAddHead}>
              <h2>Add a resource</h2>
              <button type="button" className={styles.btnSecondary} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
            {/* Remounted per open (the `open &&` guard) so a cancelled entry
                never leaves half-typed fields behind for the next one. */}
            <ResourceEntryForm
              targetGroups={targetGroups}
              onCreate={onCreate}
              onUploadDocument={onUploadDocument}
              embedded
            />
          </div>
        )}
      </dialog>
    </>
  );
}

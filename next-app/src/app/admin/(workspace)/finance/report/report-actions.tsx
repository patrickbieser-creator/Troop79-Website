'use client';

/**
 * Actions ▾ (2026-08-20, D-156 shape) — replaces the "Rename or merge a
 * bucket" <details> disclosure with the same select+modal pattern as the
 * Financial Ledger. Only one option today; built as a real dropdown (not a
 * single button) so a second report-level action has somewhere to go later
 * without another one-off control.
 */

import { useEffect, useRef, useState } from 'react';
import type { RenameBucketPreview } from '../bucket-actions';
import type { Bucket } from '@/lib/buckets';
import { RenameBucketPanel } from './rename-bucket-panel';
import parentStyles from '../finance.module.css';
import { ActionsMenu } from '../../_components/actions-menu';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';
import { Button } from '../../../_components/button';

type ReportModal = 'rename';

export function ReportActions({
  buckets,
  previewRename,
  rename
}: {
  buckets: Bucket[];
  previewRename: (bucketId: number, newName: string) => Promise<RenameBucketPreview>;
  rename: (bucketId: number, newName: string) => Promise<{ ok: boolean; error?: string; affectedCount?: number; merged?: boolean }>;
}) {
  const [activeModal, setActiveModal] = useState<ReportModal | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (activeModal && !dlg.open) dlg.showModal();
    if (!activeModal && dlg.open) dlg.close();
  }, [activeModal]);

  return (
    <>
      <div className={parentStyles.actionsBar}>
        {/* Shared ActionsMenu — this select had been a leftover hand-rolled
            copy the Phase A sweep missed (it lived under finance/report, not
            the screens the audit listed). */}
        <ActionsMenu
          ariaLabel="Bucket Report actions"
          options={[{ value: 'rename', label: 'Rename or merge a bucket' }]}
          onAction={(v) => {
            if (v === 'rename') setActiveModal('rename');
          }}
        />
      </div>

      <Dialog
        ref={dialogRef}
        className={parentStyles.actionModal}
        onClose={() => setActiveModal(null)}
      >
        <DialogHeader title="Rename or merge a bucket" />
        <DialogBody>
          {activeModal === 'rename' && (
            <RenameBucketPanel buckets={buckets} previewRename={previewRename} rename={rename} />
          )}
        </DialogBody>
        <DialogActions>
          <Button variant="secondary" onClick={() => setActiveModal(null)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

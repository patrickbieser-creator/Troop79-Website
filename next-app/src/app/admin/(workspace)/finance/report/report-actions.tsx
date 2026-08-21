'use client';

/**
 * Actions ▾ (2026-08-20, D-156 shape) — replaces the "Rename or merge an
 * activity" <details> disclosure with the same select+modal pattern as the
 * Financial Ledger. Only one option today; built as a real dropdown (not a
 * single button) so a second report-level action has somewhere to go later
 * without another one-off control.
 */

import { useEffect, useRef, useState } from 'react';
import type { RenameActivityPreview } from '../actions';
import { RenameActivityPanel } from './rename-activity-panel';
import parentStyles from '../finance.module.css';
import { ActionsMenu } from '../../_components/actions-menu';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';

type ReportModal = 'rename';

export function ReportActions({
  activityLabels,
  previewRenameActivity,
  renameActivity
}: {
  activityLabels: string[];
  previewRenameActivity: (sourceLabel: string) => Promise<RenameActivityPreview>;
  renameActivity: (
    sourceLabel: string,
    targetLabel: string
  ) => Promise<{ ok: boolean; error?: string; affectedCount?: number }>;
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
          ariaLabel="Activity Report actions"
          options={[{ value: 'rename', label: 'Rename or merge an activity' }]}
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
        <DialogHeader title="Rename or merge an activity" />
        <DialogBody>
          {activeModal === 'rename' && (
            <RenameActivityPanel
              activityLabels={activityLabels}
              previewRenameActivity={previewRenameActivity}
              renameActivity={renameActivity}
            />
          )}
        </DialogBody>
        <DialogActions>
          <button type="button" className={parentStyles.saveBtnAlt} onClick={() => setActiveModal(null)}>
            Close
          </button>
        </DialogActions>
      </Dialog>
    </>
  );
}

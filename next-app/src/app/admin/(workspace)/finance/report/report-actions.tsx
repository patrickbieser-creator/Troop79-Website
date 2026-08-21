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
        <select
          value=""
          className={parentStyles.select}
          aria-label="Activity Report actions"
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = '';
            if (v === 'rename') setActiveModal('rename');
          }}
        >
          <option value="">Actions…</option>
          <option value="rename">Rename or merge an activity</option>
        </select>
      </div>

      <dialog ref={dialogRef} className={parentStyles.actionModal} onClose={() => setActiveModal(null)}>
        <div className={parentStyles.actionModalHeader}>
          <h3>Rename or merge an activity</h3>
          <button type="button" className={parentStyles.saveBtnAlt} onClick={() => setActiveModal(null)}>
            Close
          </button>
        </div>
        {activeModal === 'rename' && (
          <RenameActivityPanel
            activityLabels={activityLabels}
            previewRenameActivity={previewRenameActivity}
            renameActivity={renameActivity}
          />
        )}
      </dialog>
    </>
  );
}

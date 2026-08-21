'use client';

/**
 * Actions ▾ (2026-08-20) — same shape as Finance's (D-156). Replaces the
 * standalone "Print Roster" button (print-button.tsx). "+ Add Scout" /
 * "+ Add Adult" stay as visible per-tab buttons on purpose (Patrick,
 * 2026-08-20): they're frequent, primary actions, unlike Finance's rare
 * treasurer actions — burying them here would slow down the common case.
 *
 * Converted to the shared ActionsMenu (Phase A, 2026-08-21). This one is a
 * deliberate, visible normalization: the old markup reused roster's own
 * shorter, darker .select instead of the canonical D-156 shape, so this
 * screen's Actions ▾ looked different from the other screens'.
 */

import { ActionsMenu } from '../../_components/actions-menu';

export function RosterActions({ className }: { className?: string }) {
  return (
    <div className={className}>
      <ActionsMenu
        ariaLabel="Roster actions"
        options={[{ value: 'print', label: 'Print Roster' }]}
        onAction={(v) => {
          if (v === 'print') window.print();
        }}
      />
    </div>
  );
}

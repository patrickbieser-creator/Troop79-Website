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

import { useRouter } from 'next/navigation';
import { ActionsMenu } from '../../_components/actions-menu';

export function RosterActions({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <div className={className}>
      <ActionsMenu
        ariaLabel="Roster actions"
        options={[
          { value: 'patrols', label: 'Assign patrols…' },
          { value: 'family-roster', label: 'Family Roster (print / PDF)' }
        ]}
        onAction={(v) => {
          /* "Print Roster" used to be window.print() over whichever tab was
             open, which printed the working table — Edit buttons, tab strip
             and all (Patrick, 2026-08-22: "the print a roster is a mess").
             The real document lives at /admin/roster-print; "Print this
             screen" was retired 2026-08-25 (Patrick) — the browser's own
             print does the same thing without a menu item. */
          if (v === 'patrols') router.push('/admin/advancement/roster/patrols');
          if (v === 'family-roster') router.push('/admin/roster-print');
        }}
      />
    </div>
  );
}

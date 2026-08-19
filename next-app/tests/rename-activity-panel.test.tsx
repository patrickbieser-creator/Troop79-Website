import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RenameActivityPanel } from '../src/app/admin/(workspace)/finance/report/rename-activity-panel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
}));

/**
 * The rename/merge Activity feature (Patrick, 2026-08-19) — one feature
 * covers both asks, since a merge is just a rename whose target already
 * names another activity. Mock boundary is the two server actions (Tests/CLAUDE.md):
 * assert on what gets called and rendered, not on what the actions do —
 * that's finance.test.ts's job (validateActivityRename + the schema-level
 * RenameActivity_* tests).
 */
const LABELS = ['Can Drive', 'Wreath Sale'];

describe('RenameActivityPanel', () => {
  it('Panel_ShowsPreviewCount_BeforeApplying', async () => {
    const user = userEvent.setup();
    const previewRenameActivity = vi.fn().mockResolvedValue({ affectedCount: 5 });
    const renameActivity = vi.fn();
    render(
      <RenameActivityPanel
        activityLabels={LABELS}
        previewRenameActivity={previewRenameActivity}
        renameActivity={renameActivity}
      />
    );

    await user.selectOptions(screen.getByLabelText('Rename this activity'), 'Can Drive');
    await user.type(screen.getByLabelText('To'), 'Fall Fundraiser');
    await user.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => expect(screen.getByText(/5/)).toBeTruthy());
    expect(previewRenameActivity).toHaveBeenCalledWith('Can Drive');
    expect(renameActivity).not.toHaveBeenCalled();
  });

  it('Panel_AppliesOnlyAfterPreview_NotOnFirstClick', () => {
    // No "Apply" button exists until a preview has run — can't skip straight
    // to a bulk edit on money records sight-unseen.
    render(
      <RenameActivityPanel
        activityLabels={LABELS}
        previewRenameActivity={vi.fn()}
        renameActivity={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull();
  });

  it('Panel_CallsRenameActivity_WithSourceAndTarget_WhenApplied', async () => {
    const user = userEvent.setup();
    const previewRenameActivity = vi.fn().mockResolvedValue({ affectedCount: 3 });
    const renameActivity = vi.fn().mockResolvedValue({ ok: true, affectedCount: 3 });
    render(
      <RenameActivityPanel
        activityLabels={LABELS}
        previewRenameActivity={previewRenameActivity}
        renameActivity={renameActivity}
      />
    );

    await user.selectOptions(screen.getByLabelText('Rename this activity'), 'Can Drive');
    await user.type(screen.getByLabelText('To'), 'Wreath Sale');
    await user.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => screen.getByRole('button', { name: /^apply$/i }));
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(renameActivity).toHaveBeenCalledWith('Can Drive', 'Wreath Sale'));
  });

  it('Panel_ShowsServerError_WhenRenameFails', async () => {
    const user = userEvent.setup();
    const previewRenameActivity = vi.fn().mockResolvedValue({ affectedCount: 1 });
    const renameActivity = vi.fn().mockResolvedValue({ ok: false, error: 'Something went wrong.' });
    render(
      <RenameActivityPanel
        activityLabels={LABELS}
        previewRenameActivity={previewRenameActivity}
        renameActivity={renameActivity}
      />
    );

    await user.selectOptions(screen.getByLabelText('Rename this activity'), 'Can Drive');
    await user.type(screen.getByLabelText('To'), 'Wreath Sale');
    await user.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => screen.getByRole('button', { name: /^apply$/i }));
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(screen.getByText('Something went wrong.')).toBeTruthy());
  });

  it('Panel_ResetsThePreview_WhenTheSourceOrTargetChangesAfterward', async () => {
    // Stale preview counts must not survive an edit to source/target — the
    // regression this guards: previewing "A -> B" (count 5), then changing
    // the target to "C" without a fresh preview, must NOT let Apply fire
    // against the old count/label pair.
    const user = userEvent.setup();
    const previewRenameActivity = vi.fn().mockResolvedValue({ affectedCount: 5 });
    render(
      <RenameActivityPanel
        activityLabels={LABELS}
        previewRenameActivity={previewRenameActivity}
        renameActivity={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByLabelText('Rename this activity'), 'Can Drive');
    await user.type(screen.getByLabelText('To'), 'Wreath Sale');
    await user.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => screen.getByRole('button', { name: /^apply$/i }));

    await user.type(screen.getByLabelText('To'), ' Extra');
    expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RenameBucketPanel } from '../src/app/admin/(workspace)/finance/report/rename-bucket-panel';
import type { Bucket } from '../src/lib/buckets';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
}));

/**
 * Rename or merge a bucket (Patrick, 2026-08-19, on buckets since 2026-10-17) — one feature covers both
 * asks, since a merge is a rename whose new name already belongs to another bucket. Mock boundary is the
 * two server actions (Tests/CLAUDE.md); what they do is buckets-db.test.ts's job (merge_buckets, rename).
 */
const BUCKETS: Bucket[] = [
  { id: 1, name: 'Can Drive', isEvent: false, lastUsed: null },
  { id: 2, name: 'Wreath Sale', isEvent: false, lastUsed: null }
];

describe('RenameBucketPanel', () => {
  it('Panel_ShowsPreviewCount_BeforeApplying', async () => {
    const user = userEvent.setup();
    const previewRename = vi.fn().mockResolvedValue({ affectedCount: 5, mergesInto: null });
    const rename = vi.fn();
    render(
      <RenameBucketPanel
        buckets={BUCKETS}
        previewRename={previewRename}
        rename={rename}
      />
    );

    await user.selectOptions(screen.getByLabelText('Rename this bucket'), 'Can Drive');
    await user.type(screen.getByLabelText('To'), 'Fall Fundraiser');
    await user.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => expect(screen.getByText(/5/)).toBeTruthy());
    expect(previewRename).toHaveBeenCalledWith(1, 'Fall Fundraiser');
    expect(rename).not.toHaveBeenCalled();
  });

  it('Panel_AppliesOnlyAfterPreview_NotOnFirstClick', () => {
    // No "Apply" button exists until a preview has run — can't skip straight
    // to a bulk edit on money records sight-unseen.
    render(
      <RenameBucketPanel
        buckets={BUCKETS}
        previewRename={vi.fn()}
        rename={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull();
  });

  it('Panel_CallsRename_WithTheBucketAndNewName_WhenApplied', async () => {
    const user = userEvent.setup();
    const previewRename = vi.fn().mockResolvedValue({ affectedCount: 3, mergesInto: { id: 2, name: 'Wreath Sale' } });
    const rename = vi.fn().mockResolvedValue({ ok: true, affectedCount: 3 });
    render(
      <RenameBucketPanel
        buckets={BUCKETS}
        previewRename={previewRename}
        rename={rename}
      />
    );

    await user.selectOptions(screen.getByLabelText('Rename this bucket'), 'Can Drive');
    await user.type(screen.getByLabelText('To'), 'Wreath Sale');
    await user.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => screen.getByRole('button', { name: /^apply$/i }));
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(rename).toHaveBeenCalledWith(1, 'Wreath Sale'));
  });

  it('Panel_ShowsServerError_WhenRenameFails', async () => {
    const user = userEvent.setup();
    const previewRename = vi.fn().mockResolvedValue({ affectedCount: 1, mergesInto: null });
    const rename = vi.fn().mockResolvedValue({ ok: false, error: 'Something went wrong.' });
    render(
      <RenameBucketPanel
        buckets={BUCKETS}
        previewRename={previewRename}
        rename={rename}
      />
    );

    await user.selectOptions(screen.getByLabelText('Rename this bucket'), 'Can Drive');
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
    const previewRename = vi.fn().mockResolvedValue({ affectedCount: 5, mergesInto: null });
    render(
      <RenameBucketPanel
        buckets={BUCKETS}
        previewRename={previewRename}
        rename={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByLabelText('Rename this bucket'), 'Can Drive');
    await user.type(screen.getByLabelText('To'), 'Wreath Sale');
    await user.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => screen.getByRole('button', { name: /^apply$/i }));

    await user.type(screen.getByLabelText('To'), ' Extra');
    expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull();
  });

  it('Panel_SaysItWillMerge_WhenTheNewNameAlreadyBelongsToABucket', async () => {
    const user = userEvent.setup();
    const previewRename = vi.fn().mockResolvedValue({ affectedCount: 3, mergesInto: { id: 2, name: 'Wreath Sale' } });
    render(<RenameBucketPanel buckets={BUCKETS} previewRename={previewRename} rename={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Rename this bucket'), 'Can Drive');
    await user.type(screen.getByLabelText('To'), 'wreath sale');
    await user.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => expect(screen.getByText(/merge/i).textContent).toMatch(/into the existing bucket/));
  });
});

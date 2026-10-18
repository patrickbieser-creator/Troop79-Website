import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BucketManager } from '../src/app/admin/(workspace)/finance/report/bucket-manager';
import type { BucketUsage } from '../src/lib/buckets';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** Bucket Report › Buckets (Patrick, 2026-10-18): every bucket, empty ones too, with its events and use. */
const BUCKETS: BucketUsage[] = [
  { id: 18, name: "High Cliff Fall '26", isEvent: true, lastUsed: '2026-10-09', rowCount: 20, events: [{ id: 35, title: 'High Cliff Fall Campout', date: '2026-10-09' }] },
  { id: 40, name: 'Popcorn Sale', isEvent: false, lastUsed: null, rowCount: 0, events: [] }
];
const noop = vi.fn();

function renderManager(deleteBucket = vi.fn(async () => ({ ok: true }))) {
  render(<BucketManager buckets={BUCKETS} previewRename={noop} rename={noop} deleteBucket={deleteBucket} />);
  return deleteBucket;
}
const rowFor = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

describe('BucketManager', () => {
  it('Treasurer_SeesEveryBucket_IncludingEmptyOnes', () => {
    renderManager();
    expect([rowFor('High Cliff').textContent, rowFor('Popcorn').textContent]).toEqual([
      expect.stringContaining('High Cliff Fall Campout'),
      expect.stringContaining('Popcorn Sale')
    ]);
  });

  it('DeleteIsOffered_OnlyForABucketNothingUses', () => {
    renderManager();
    const options = (name: string) => within(rowFor(name)).getAllByRole('option').map((o) => o.textContent);
    expect([options('High Cliff').includes('Delete…'), options('Popcorn').includes('Delete…')]).toEqual([false, true]);
  });

  it('Treasurer_CanDeleteAnEmptyBucket_AfterConfirming', async () => {
    const user = userEvent.setup();
    const del = renderManager();
    await user.selectOptions(within(rowFor('Popcorn')).getByRole('combobox'), 'delete');
    expect(del).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete “Popcorn Sale”' }));
    expect(del).toHaveBeenCalledWith(40);
  });

  it('RenameOrMerge_OpensWithThatRowsBucketPicked', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.selectOptions(within(rowFor('High Cliff')).getByRole('combobox'), 'rename');
    expect((screen.getByLabelText('Rename this bucket') as HTMLSelectElement).value).toBe('18');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { BucketPicker } from '../src/app/admin/(workspace)/_components/bucket-picker';
import type { Bucket } from '../src/lib/buckets';

/**
 * The bucket picker (Plans/Buckets-Lookup.md): pick an existing bucket, or make a new one on the fly —
 * deliberately, with two confirmations and the near matches shown first (Patrick, 2026-10-17).
 */
const BUCKETS: Bucket[] = [
  { id: 1, name: "Summer Camp '26", isEvent: true, lastUsed: '2026-09-15' },
  { id: 2, name: 'Dividends', isEvent: false, lastUsed: '2026-07-31' }
];

function Harness({ create }: { create: (name: string) => Promise<{ ok: boolean; error?: string; bucket?: Bucket }> }) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <>
      <BucketPicker id="b" label="Bucket" buckets={BUCKETS} value={value} onChange={setValue} canCreate createBucket={create} />
      <output data-testid="value">{value ?? 'none'}</output>
    </>
  );
}

async function startNew(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: '+ New bucket…' }));
  await user.type(screen.getByLabelText('New bucket name'), name);
}

describe('BucketPicker', () => {
  it('Treasurer_CanPickAnExistingBucket', async () => {
    const user = userEvent.setup();
    render(<Harness create={vi.fn()} />);
    await user.click(screen.getByRole('combobox', { name: 'Bucket' }));
    await user.click(screen.getByRole('option', { name: /Dividends/ }));
    expect(screen.getByTestId('value').textContent).toBe('2');
  });

  it('Treasurer_SeesNearMatches_BeforeCreatingANewBucket', async () => {
    const user = userEvent.setup();
    render(<Harness create={vi.fn()} />);
    await startNew(user, 'Summer camp');
    expect(screen.getByRole('button', { name: "Use Summer Camp '26" })).toBeTruthy();
  });

  it('Treasurer_PickingANearMatch_EndsTheFlow_WithoutCreating', async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    render(<Harness create={create} />);
    await startNew(user, 'Summer camp');
    await user.click(screen.getByRole('button', { name: "Use Summer Camp '26" }));
    expect([screen.getByTestId('value').textContent, create.mock.calls.length]).toEqual(['1', 0]);
  });

  it('Treasurer_CanCreateABucket_InlineFromTheRecordForm_OnlyAfterTheSecondConfirm', async () => {
    const user = userEvent.setup();
    const create = vi.fn(async (name: string) => ({ ok: true, bucket: { id: 9, name, isEvent: false, lastUsed: null } }));
    render(<Harness create={create} />);
    await startNew(user, 'Popcorn Sale');
    await user.click(screen.getByRole('button', { name: 'Create a new bucket…' }));
    expect(create).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Create “Popcorn Sale”' }));
    expect([create.mock.calls[0][0], screen.getByTestId('value').textContent]).toEqual(['Popcorn Sale', '9']);
  });

  it('Treasurer_CancellingEitherConfirm_CreatesNothing', async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    render(<Harness create={create} />);
    await startNew(user, 'Popcorn Sale');
    await user.click(screen.getByRole('button', { name: 'Create a new bucket…' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect([create.mock.calls.length, screen.queryByLabelText('New bucket name')]).toEqual([0, null]);
  });

  it('NewBucket_NamedLikeAnExistingOne_OffersThatOne_InsteadOfCreate', async () => {
    const user = userEvent.setup();
    render(<Harness create={vi.fn()} />);
    await startNew(user, '  dividends ');
    expect([screen.queryByRole('button', { name: 'Create a new bucket…' }), screen.getByText(/already exists/)]).toEqual([
      null,
      expect.anything()
    ]);
  });

  it('NewBucket_ShowsTheServersError_AndKeepsTheName', async () => {
    const user = userEvent.setup();
    const create = vi.fn(async () => ({ ok: false, error: 'Not allowed.' }));
    render(<Harness create={create} />);
    await startNew(user, 'Popcorn Sale');
    await user.click(screen.getByRole('button', { name: 'Create a new bucket…' }));
    await user.click(screen.getByRole('button', { name: 'Create “Popcorn Sale”' }));
    expect(screen.getByRole('alert').textContent).toContain('Not allowed.');
  });
});

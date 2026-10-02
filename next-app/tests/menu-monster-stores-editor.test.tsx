import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoresEditor } from '../src/app/admin/(workspace)/advancement/lookups/stores-editor';
import type { Store } from '../src/lib/menu-monster/stores';

/**
 * Lookups & Admin -> Menu Monster stores. The mock boundary is the six
 * actions passed as props: assert on what the editor sent.
 */
const ok = async (...[]: [FormData]): Promise<{ ok: boolean; error?: string }> => ({ ok: true });
const onCreate = vi.fn(ok);
const onRename = vi.fn(ok);
const onRetire = vi.fn(ok);
const onRestore = vi.fn(ok);
const onDelete = vi.fn(ok);
const onMove = vi.fn(ok);

const ROWS: Store[] = [
  { id: 1, name: 'Costco', sortOrder: 10, retiredAt: null, packageCount: 13 },
  { id: 2, name: 'Kroger', sortOrder: 20, retiredAt: null, packageCount: 66 },
  { id: 3, name: 'Outpost', sortOrder: 40, retiredAt: null, packageCount: 0 },
  { id: 4, name: 'Aldi', sortOrder: 60, retiredAt: '2026-10-01T00:00:00Z', packageCount: 2 }
];

function mount(rows: Store[] = ROWS) {
  return render(
    <StoresEditor
      rows={rows}
      onCreate={onCreate}
      onRename={onRename}
      onRetire={onRetire}
      onRestore={onRestore}
      onDelete={onDelete}
      onMove={onMove}
    />
  );
}

const row = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}\\b`) });
const sent = (fn: typeof onCreate) => Object.fromEntries(fn.mock.calls[0]![0].entries());

beforeEach(() => {
  for (const f of [onCreate, onRename, onRetire, onRestore, onDelete, onMove]) f.mockClear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Stores editor', () => {
  it('Leader_SeesHowManyPackagesEachStoreHas', () => {
    mount();
    expect(within(row('Costco')).getByText('13')).toBeTruthy();
    expect(within(row('Kroger')).getByText('66')).toBeTruthy();
  });

  it('Leader_CanAddAStore_WithOneFieldAndAButton', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: '+ Add Store' }));
    await user.type(screen.getByLabelText('New store name'), '  Pick n Save ');
    await user.click(screen.getByRole('button', { name: 'Add Store' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(sent(onCreate)).toEqual({ name: 'Pick n Save' });
  });

  it('Leader_CannotAddAStore_WithABlankName', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: '+ Add Store' }));
    expect((screen.getByRole('button', { name: 'Add Store' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Leader_SeesTheReason_WhenAnAddIsRefused', async () => {
    onCreate.mockResolvedValueOnce({ ok: false, error: 'There is already a store called "Costco".' });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: '+ Add Store' }));
    await user.type(screen.getByLabelText('New store name'), 'costco');
    await user.click(screen.getByRole('button', { name: 'Add Store' }));
    expect(await screen.findByText('There is already a store called "Costco".')).toBeTruthy();
  });

  it('Leader_CannotSaveARename_UntilTheNameChanges', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(within(row('Kroger')).getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Name for Kroger');
    const save = screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(input, 's');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Leader_SendsTheRename_WhenSaving', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(within(row('Kroger')).getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Name for Kroger');
    await user.clear(input);
    await user.type(input, 'Roundy');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));
    expect(sent(onRename)).toEqual({ id: '2', name: 'Roundy' });
  });

  it('Leader_CanCancelARename_WithoutSaving', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(within(row('Kroger')).getByRole('button', { name: 'Rename' }));
    await user.type(screen.getByLabelText('Name for Kroger'), 'zzz');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Name for Kroger')).toBeNull();
    expect(screen.getByRole('row', { name: /^Kroger\b/ })).toBeTruthy();
  });

  it('Leader_CanRetireAStoreInUse_InOneClick', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(within(row('Kroger')).getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(onRetire).toHaveBeenCalledTimes(1));
    expect(sent(onRetire)).toEqual({ id: '2' });
  });

  it('Leader_SeesARetiredStoreMarked_AndCanRestoreIt', async () => {
    const user = userEvent.setup();
    mount();
    const aldi = row('Aldi');
    expect(within(aldi).getByText('Retired')).toBeTruthy();
    await user.click(within(aldi).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(sent(onRestore)).toEqual({ id: '4' });
  });

  it('Leader_IsNotOfferedDelete_ForAStoreInUse_ButIsForAnUnusedOne', () => {
    mount();
    expect(within(row('Kroger')).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(row('Aldi')).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(row('Outpost')).getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('Leader_CanDeleteAnUnusedStore_AfterConfirming', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(within(row('Outpost')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(sent(onDelete)).toEqual({ id: '3' });
  });

  it('Leader_CanMoveAStoreDown_AndTheEdgesAreGreyed', async () => {
    const user = userEvent.setup();
    mount();
    expect((screen.getByRole('button', { name: 'Move Costco up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move Outpost down' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Move Costco down' }));
    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
    expect(sent(onMove)).toEqual({ id: '1', direction: 'down' });
  });

  it('Leader_IsNotOfferedMove_ForARetiredStore', () => {
    mount();
    expect(within(row('Aldi')).queryByRole('button', { name: /Move Aldi/ })).toBeNull();
  });
});

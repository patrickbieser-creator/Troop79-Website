import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MbFocusModal } from '../src/app/admin/(workspace)/advancement/fast-entry/mb-focus-modal';
import {
  itemKey,
  type CatalogPayload,
  type CompletionMap,
  type ReqTreeNode
} from '../src/app/admin/(workspace)/advancement/fast-entry/picker-types';

/**
 * B-005 (Patrick, 2026-09-06): entering Henry Ellermann's Chemistry badge by
 * checking only the ★ "Full merit badge earned" row in the Scout-First focus
 * modal set an error and never added the award to the selection, so Save
 * stayed disabled. The v1.50.2 fix made the server accept a clean-slate award
 * on its own, but this modal's click gate (`awardBlocked`) still demanded
 * every requirement group be met first — the request never left the browser.
 *
 * Same rule as the server: clean slate → the ★ row is clickable and selects
 * the award; partial progress → the gate still explains what's missing.
 */

vi.mock('../src/app/admin/(workspace)/advancement/fast-entry/actions', () => ({
  addLedgerEntries: vi.fn(),
  undoCompletion: vi.fn()
}));

const MB_ID = 'chemistry';

function leaf(code: string): ReqTreeNode {
  return { code, label: `Req ${code}`, complete_rule: 'all', complete_n: null, children: [] };
}

const mb: CatalogPayload['mbs'][number] = {
  id: MB_ID,
  name: 'Chemistry',
  eagle: false,
  requirements: [
    {
      code: '1',
      label: 'Safety',
      complete_rule: 'all',
      complete_n: null,
      children: [leaf('1a'), leaf('1b')]
    },
    leaf('5'),
    leaf('6')
  ]
};

function renderModal(completion: CompletionMap) {
  return render(
    <MbFocusModal
      mb={mb}
      scoutId="henry"
      scoutName="Henry Ellermann"
      leaders={[{ code: 'PB', name: 'Patrick Bieser' }]}
      defaultDate="2026-09-06"
      defaultBy="PB"
      completion={completion}
      onClose={vi.fn()}
      onCompletionRemoved={vi.fn()}
      onSaved={vi.fn()}
    />
  );
}

function awardRow() {
  return screen.getByRole('button', { name: /full merit badge earned/i });
}

function saveClose() {
  return screen.getByRole('button', { name: /save & close/i }) as HTMLButtonElement;
}

describe('MbFocusModal ★ award row', () => {
  it('selects the award on a clean slate and enables Save', async () => {
    const user = userEvent.setup();
    renderModal(new Map());

    expect(saveClose().disabled).toBe(true);

    await user.click(awardRow());

    expect(screen.queryByText(/can't mark chemistry earned yet/i)).toBeNull();
    expect(screen.getByText('Selected (1)')).toBeTruthy();
    expect(saveClose().textContent).toMatch(/\(1\)/);
    expect(saveClose().disabled).toBe(false);
  });

  it('still gates the award when partial progress exists', async () => {
    const user = userEvent.setup();
    const completion: CompletionMap = new Map([
      [
        itemKey.mbReq(MB_ID, '1a'),
        { entryId: 1, date: '2026-09-01', by: 'PB', code: '1a' }
      ]
    ]);
    renderModal(completion);

    await user.click(awardRow());

    expect(
      screen.getByText(/can't mark chemistry earned yet — 0 of 3 requirement groups met/i)
    ).toBeTruthy();
    expect(screen.getByText('Selected (0)')).toBeTruthy();
    expect(saveClose().disabled).toBe(true);
  });
});

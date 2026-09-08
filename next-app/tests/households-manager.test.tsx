import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HouseholdsManager } from '../src/app/admin/(workspace)/advancement/lookups/households-manager';
import { setHousehold } from '../src/app/admin/(workspace)/advancement/roster/person-actions';

/**
 * Lookups & Admin → Households. The households themselves are managed here;
 * membership is edited on the person — except that, since 2026-09-08, each
 * member listed on a row can be REMOVED from here too (Patrick: "there is no
 * way that I can find to remove a person from a household"). The mock
 * boundary is the server action (Tests/CLAUDE.md).
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('../src/app/admin/(workspace)/advancement/lookups/household-actions', () => ({
  createHousehold: vi.fn(async () => ({ ok: true })),
  renameHousehold: vi.fn(async () => ({ ok: true })),
  deleteHousehold: vi.fn(async () => ({ ok: true }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/person-actions', () => ({
  setHousehold: vi.fn(async () => ({ ok: true }))
}));

beforeEach(() => {
  vi.mocked(setHousehold).mockClear().mockResolvedValue({ ok: true });
});

const rows = () => [
  {
    id: 1,
    label: 'Whitlock',
    members: [
      { personId: 401, name: 'Dana Whitlock' },
      { personId: 402, name: 'Marcus Whitlock' }
    ]
  },
  { id: 2, label: 'Raman', members: [] }
];

describe('HouseholdsManager — members', () => {
  it('Leader_SeesEachMemberNamed_PerHousehold', () => {
    render(<HouseholdsManager households={rows()} />);
    const row = screen.getByRole('row', { name: /Whitlock/ });
    expect(within(row).getByText('Dana Whitlock')).toBeTruthy();
    expect(within(row).getByText('Marcus Whitlock')).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /Raman/ })).getByText('empty')).toBeTruthy();
  });

  it('Leader_RemovesMemberFromHousehold_InLookups_WithUndo', async () => {
    const user = userEvent.setup();
    render(<HouseholdsManager households={rows()} />);

    await user.click(screen.getByRole('button', { name: 'Remove Marcus Whitlock from Whitlock' }));
    await waitFor(() => expect(setHousehold).toHaveBeenCalledWith(402, null));

    const notice = await screen.findByRole('status', { name: /Household changed/ });
    expect(notice.textContent).toMatch(/Removed Marcus Whitlock from Whitlock/);
    await user.click(within(notice).getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(setHousehold).toHaveBeenLastCalledWith(402, 1));
    expect(setHousehold).toHaveBeenCalledTimes(2);
  });

  it('Leader_SeesTheError_WhenRemovalFails', async () => {
    const user = userEvent.setup();
    vi.mocked(setHousehold).mockResolvedValueOnce({ ok: false, error: 'nope' });
    render(<HouseholdsManager households={rows()} />);

    await user.click(screen.getByRole('button', { name: 'Remove Dana Whitlock from Whitlock' }));
    expect(await screen.findByText('nope')).toBeTruthy();
    expect(screen.queryByRole('status', { name: /Household changed/ })).toBeNull();
  });
});

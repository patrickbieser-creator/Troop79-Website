import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PriceActivity } from '../src/app/admin/(workspace)/library/menu-monster/price-activity';
import { applyHeldPrice, approveHeldPackage, dismissHeldPrice, rejectHeldPackage, revertPriceChange } from '../src/app/admin/(workspace)/library/menu-monster/actions';
import type { HeldPrice, PriceChange } from '../src/lib/menu-monster/price-history';

/**
 * Menu Monster leader tools, scout-reported prices: "Needs attention" (held
 * prices) and "Price changes" (history with Revert). The mock boundary is the
 * actions module — assert on what the panel sent.
 */
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  applyHeldPrice: vi.fn(async (id: string) => ({ ok: true, outcome: 'applied', historyId: id })),
  dismissHeldPrice: vi.fn(async () => ({ ok: true, outcome: 'dismissed' })),
  revertPriceChange: vi.fn(async () => ({ ok: true, outcome: 'reverted' })),
  approveHeldPackage: vi.fn(async () => ({ ok: true })),
  rejectHeldPackage: vi.fn(async () => ({ ok: true }))
}));

beforeEach(() => {
  vi.mocked(applyHeldPrice).mockClear();
  vi.mocked(dismissHeldPrice).mockClear();
  vi.mocked(revertPriceChange).mockClear();
  refresh.mockClear();
});

const HELD: HeldPrice[] = [
  {
    id: 'h1', packageId: 'p-milk', packageName: 'Milk, gallon', reporter: 'Sam K.', menuName: 'Spring Camporee',
    createdAt: '2026-10-01T15:00:00Z', currentPrice: 4, proposedPrice: 9, unitChangePct: 1.25
  },
  {
    id: 'h2', packageId: 'p-oats', packageName: 'Oats, tub', reporter: 'Ava R.', menuName: null,
    createdAt: '2026-10-01T16:00:00Z', currentPrice: 3, proposedPrice: 3.5, unitChangePct: null
  }
];
const CHANGES: PriceChange[] = [
  {
    id: 'c1', status: 'applied', packageId: 'p-eggs', packageName: 'Eggs, dozen', reporter: 'Sam K.', oldPrice: 3, newPrice: 3.5,
    createdAt: '2026-10-02T15:00:00Z', decidedAt: null, canRevert: true
  },
  {
    id: 'c2', status: 'applied', packageId: 'p-eggs', packageName: 'Eggs, dozen', reporter: 'Ava R.', oldPrice: 2.5, newPrice: 3,
    createdAt: '2026-10-01T15:00:00Z', decidedAt: null, canRevert: false
  },
  {
    id: 'c3', status: 'reverted', packageId: 'p-rice', packageName: 'Rice, bag', reporter: 'Sam K.', oldPrice: 5, newPrice: 6,
    createdAt: '2026-09-30T15:00:00Z', decidedAt: '2026-10-01T10:00:00Z', canRevert: false
  }
];

const heldRow = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

describe('Needs attention', () => {
  it('Leader_SeesAHeldPrice_WithReporterMenuPricesAndUnitChange', () => {
    render(<PriceActivity held={HELD} changes={[]} />);
    const row = heldRow('Milk, gallon');
    expect(within(row).getByText('Sam K.')).toBeTruthy();
    expect(within(row).getByText('Spring Camporee')).toBeTruthy();
    expect(within(row).getByText('$4.00 → $9.00')).toBeTruthy();
    expect(within(row).getByText('+125%')).toBeTruthy();
  });

  it('Leader_SeesADashForUnitChange_WhenThePackageHasNoYield', () => {
    render(<PriceActivity held={HELD} changes={[]} />);
    expect(within(heldRow('Oats, tub')).getByText('Not comparable')).toBeTruthy();
  });

  it('Leader_SeesAnEmptyState_WhenNothingIsHeld', () => {
    render(<PriceActivity held={[]} changes={[]} />);
    expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy();
  });

  it('Leader_CanApplyAHeldPrice_AndUndoIt', async () => {
    const user = userEvent.setup();
    render(<PriceActivity held={HELD} changes={[]} />);
    await user.click(within(heldRow('Milk, gallon')).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(applyHeldPrice).toHaveBeenCalledWith('h1'));
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/Applied/);
    await user.click(within(status).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(revertPriceChange).toHaveBeenCalledWith('h1'));
  });

  it('Leader_CanDismissAHeldPrice', async () => {
    const user = userEvent.setup();
    render(<PriceActivity held={HELD} changes={[]} />);
    await user.click(within(heldRow('Oats, tub')).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(dismissHeldPrice).toHaveBeenCalledWith('h2'));
    expect((await screen.findByRole('status')).textContent).toMatch(/Dismissed/);
  });

  it('Leader_SeesTheError_WhenADecisionFails', async () => {
    vi.mocked(applyHeldPrice).mockResolvedValueOnce({ ok: false, error: 'Someone already decided that one.' });
    const user = userEvent.setup();
    render(<PriceActivity held={HELD} changes={[]} />);
    await user.click(within(heldRow('Milk, gallon')).getByRole('button', { name: 'Apply' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already decided/);
  });
});

describe('Price changes', () => {
  it('Leader_SeesChangesWithOldAndNewPrice', () => {
    render(<PriceActivity held={[]} changes={CHANGES} />);
    expect(within(screen.getByRole('row', { name: /Rice, bag/ })).getByText('$5.00 → $6.00')).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /Rice, bag/ })).getByText('Reverted')).toBeTruthy();
  });

  it('Leader_CanRevertTheLatestChange', async () => {
    const user = userEvent.setup();
    render(<PriceActivity held={[]} changes={CHANGES} />);
    const row = screen.getByRole('row', { name: /Sam K\..*\$3\.00 → \$3\.50/ });
    await user.selectOptions(within(row).getByRole('combobox', { name: 'More for Eggs, dozen' }), 'revert');
    await waitFor(() => expect(revertPriceChange).toHaveBeenCalledWith('c1'));
  });

  it('Leader_CannotRevertASupersededChange_AndSeesWhy', () => {
    render(<PriceActivity held={[]} changes={CHANGES} />);
    const row = screen.getByRole('row', { name: /Ava R\./ });
    const option = within(row).getByRole('option', { name: /Revert/ }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(within(row).getByRole('button', { name: /Why can.t this be reverted/ })).toBeTruthy();
  });

  it('Leader_SeesAnEmptyState_WhenThereAreNoChanges', () => {
    render(<PriceActivity held={[]} changes={[]} />);
    expect(screen.getByText('No price changes yet.')).toBeTruthy();
  });
});

describe('PriceActivity — packages waiting (release C)', () => {
  const PKG = {
    id: 'sp-0000beef', ingredientId: 'pancake-mix', ingredientName: 'Pancake mix', unitMany: 'cups', name: 'Big bag', store: 'Aldi',
    price: 9, size: 10, unitPrice: 0.9, cheapestUnitPrice: 0.5, addedBy: 'Sam K.', heldAt: '2026-10-03T12:00:00Z'
  };

  it('Packages_AreListed_WithTheComparisonBasis', () => {
    render(<PriceActivity held={[]} heldPackages={[PKG]} changes={[]} />);
    expect(screen.getByRole('heading', { name: 'Packages waiting' })).toBeTruthy();
    expect(screen.getByText('$0.90 (+80% vs $0.50)')).toBeTruthy();
  });

  it('Approve_SendsThePackageId', async () => {
    render(<PriceActivity held={[]} heldPackages={[PKG]} changes={[]} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveHeldPackage).toHaveBeenCalledWith('sp-0000beef'));
  });

  it('Reject_SendsThePackageId', async () => {
    render(<PriceActivity held={[]} heldPackages={[PKG]} changes={[]} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(rejectHeldPackage).toHaveBeenCalledWith('sp-0000beef'));
  });

  it('Section_IsAbsent_WhenNothingWaits', () => {
    render(<PriceActivity held={[]} changes={[]} />);
    expect(screen.queryByRole('heading', { name: 'Packages waiting' })).toBeNull();
  });
});

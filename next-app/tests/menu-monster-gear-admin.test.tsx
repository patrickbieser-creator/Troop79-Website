import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Admin › Menu Monster › Gear: merging one item into another (Patrick, 2026-10-05: "Charcoal and Charcoal briquettes"). */

const router = { refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const mergeGear = vi.fn();
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  createGear: vi.fn(async () => ({ ok: true })),
  updateGear: vi.fn(async () => ({ ok: true })),
  deleteGear: vi.fn(async () => ({ ok: true })),
  setGearRetired: vi.fn(async () => ({ ok: true })),
  mergeGear: (...a: unknown[]) => mergeGear(...a)
}));

import { GearAdmin } from '../src/app/admin/(workspace)/library/menu-monster/gear-admin';
import type { GearAdminRow } from '../src/lib/menu-monster/gear-store';

const row = (id: number, name: string, over: Partial<GearAdminRow> = {}): GearAdminRow => ({ id, name, home: 'trailer', perPerson: false, retiredAt: null, recipes: [], menus: 0, ...over });
const ITEMS = [row(1, 'Charcoal'), row(2, 'Charcoal briquettes', { recipes: ['Dutch-oven peach cobbler'] }), row(3, 'Tongs', { retiredAt: '2026-09-01T00:00:00Z' })];

beforeEach(() => {
  vi.clearAllMocks();
  mergeGear.mockResolvedValue({ ok: true, note: 'Merged “Charcoal briquettes” into “Charcoal” (1 recipe updated).' });
});

describe('GearAdmin — merge', () => {
  const open = async () => {
    const user = userEvent.setup();
    render(<GearAdmin items={ITEMS} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'More for Charcoal briquettes' }), 'merge');
    return { user, row: within(screen.getByRole('row', { name: 'Merge Charcoal briquettes' })) };
  };

  it('MergeInto_OffersEveryOtherItem_AndStaysGreyedUntilOneIsPicked', async () => {
    const { row } = await open();
    const pick = row.getByRole('combobox', { name: 'Merge “Charcoal briquettes” into' });
    expect(within(pick).getAllByRole('option').map((o) => o.textContent)).toEqual(['— pick —', 'Charcoal', 'Tongs (retired)']);
    expect((row.getByRole('button', { name: 'Merge' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Merge_SendsTheTwoIds_AndShowsTheNote', async () => {
    const { user, row } = await open();
    await user.selectOptions(row.getByRole('combobox', { name: 'Merge “Charcoal briquettes” into' }), '1');
    await user.click(row.getByRole('button', { name: 'Merge' }));
    expect(mergeGear).toHaveBeenCalledWith(2, 1);
    expect(await screen.findByText('Merged “Charcoal briquettes” into “Charcoal” (1 recipe updated).')).toBeTruthy();
  });

  it('Cancel_ClosesTheMergeRow', async () => {
    const { user, row } = await open();
    await user.click(row.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('row', { name: 'Merge Charcoal briquettes' })).toBeNull();
  });
});

// Release 2 (2026-10-06): the "Used in" cell and the Delete guard count menus too. The row helper above gained
// `menus: 0` because GearAdminRow now carries it.
describe('GearAdmin — menus that name an item', () => {
  const actionsFor = (name: string) => within(screen.getByRole('combobox', { name: `More for ${name}` })).getAllByRole('option').map((o) => o.textContent);

  it('UsedIn_CountsMenus_BesideTheRecipes', () => {
    render(<GearAdmin items={[row(1, 'Soap', { menus: 2 }), row(2, 'Tongs', { recipes: ['Bacon'], menus: 1 })]} />);
    expect(within(screen.getByRole('row', { name: /Soap/ })).getByText('2 menus')).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /Tongs/ })).getByText('Bacon, 1 menu')).toBeTruthy();
  });

  it('Delete_IsNotOffered_WhileAMenuNamesTheItem', () => {
    render(<GearAdmin items={[row(1, 'Soap', { menus: 1 }), row(2, 'Mop')]} />);
    expect(actionsFor('Soap')).not.toContain('Delete');
    expect(actionsFor('Mop')).toContain('Delete');
  });
});

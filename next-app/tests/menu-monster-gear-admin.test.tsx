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

const row = (id: number, name: string, over: Partial<GearAdminRow> = {}): GearAdminRow => ({ id, name, home: 'trailer', perPerson: false, retiredAt: null, description: null, recipes: [], recipeLinks: [], menus: 0, ...over });
const COBBLER = { id: 'cobbler', name: 'Dutch-oven peach cobbler' };
const ITEMS = [row(1, 'Charcoal'), row(2, 'Charcoal briquettes', { recipes: [COBBLER.name], recipeLinks: [COBBLER] }), row(3, 'Tongs', { retiredAt: '2026-09-01T00:00:00Z' })];

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

  // 2026-10-06: the row shows a count, not every recipe name (Patrick: the comma list was getting unruly).
  it('UsedIn_CountsMenus_BesideTheRecipes', () => {
    render(<GearAdmin items={[row(1, 'Soap', { menus: 2 }), row(2, 'Tongs', { recipes: ['Bacon'], recipeLinks: [{ id: 'bacon', name: 'Bacon' }], menus: 1 })]} />);
    expect(within(screen.getByRole('row', { name: /Soap/ })).getByText(/2 menus/)).toBeTruthy();
    const tongs = within(screen.getByRole('row', { name: /Tongs/ }));
    expect([tongs.getByRole('button', { name: 'Used in 1 food or recipe' }) != null, tongs.getByText(/1 menu/) != null]).toEqual([true, true]);
  });

  it('Delete_IsNotOffered_WhileAMenuNamesTheItem', () => {
    render(<GearAdmin items={[row(1, 'Soap', { menus: 1 }), row(2, 'Mop')]} />);
    expect(actionsFor('Soap')).not.toContain('Delete');
    expect(actionsFor('Mop')).toContain('Delete');
  });
});

/** Patrick, 2026-10-06: the comma list of recipes "is going to get long and unruly" — a count that opens a list; and a description per item. */
describe('GearAdmin — Used in, and a description', () => {
  it('UsedIn_IsACount_ThatOpensTheList_WithLinks', async () => {
    const user = userEvent.setup();
    render(<GearAdmin items={[row(2, 'Charcoal briquettes', { recipeLinks: [COBBLER, { id: 'chili', name: 'Campfire chili' }], recipes: ['x', 'y'], menus: 1 })]} />);
    expect(screen.queryByText('Dutch-oven peach cobbler')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Used in 2 foods or recipes' }));
    const list = within(screen.getByRole('list', { name: 'Foods and recipes that use Charcoal briquettes' }));
    expect(list.getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Dutch-oven peach cobbler', '/admin/library/menu-monster/recipes/cobbler'],
      ['Campfire chili', '/admin/library/menu-monster/recipes/chili']
    ]);
    expect(screen.getByText(/1 menu/)).toBeTruthy();
  });

  it('ADescription_ShowsUnderTheName_AndIsEdited', async () => {
    const updateGear = (await import('../src/app/admin/(workspace)/library/menu-monster/actions')).updateGear as unknown as ReturnType<typeof vi.fn>;
    const user = userEvent.setup();
    render(<GearAdmin items={[row(4, 'Chef kit', { description: 'Knives, spatula, tongs — in the blue tub, 4th floor.' })]} />);
    expect(screen.getByText(/Knives, spatula, tongs/)).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'More for Chef kit' }), 'edit');
    const desc = screen.getByLabelText(/Description \(optional\)/);
    await user.clear(desc);
    await user.type(desc, 'Knives and a cutting board. Blue tub.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateGear).toHaveBeenCalledWith(4, { name: 'Chef kit', home: 'trailer', perPerson: false, description: 'Knives and a cutting board. Blue tub.' });
  });
});

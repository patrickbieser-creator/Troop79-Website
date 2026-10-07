import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { GearChips, GearPicker } from '../src/app/(public)/library/menu-monster/_components/gear-picker';
import type { GearItem } from '../src/lib/menu-monster/gear';

/**
 * The public gear picker (2026-10-05, release 1 of "gear is picked from the master list"): the options are the
 * list's live items A to Z minus what is taken, nothing ever offers to create one, and the picked chips carry a
 * count dial and a remove. The matching rules themselves are proven in menu-monster-gear.test.ts.
 */
const item = (id: number, name: string, retiredAt: string | null = null): GearItem => ({ id, name, home: 'trailer', perPerson: false, retiredAt });
const LIST = [item(1, 'Tongs'), item(2, 'Skillet'), item(3, 'Griddle'), item(4, 'Old whisk', '2026-09-01T00:00:00Z')];
const names = () => screen.queryAllByRole('option').map((o) => o.textContent);

describe('public GearPicker', () => {
  it('Options_AreAToZ_WithoutRetiredItems', async () => {
    render(<GearPicker list={LIST} taken={[]} onPick={() => {}} />);
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Search gear' }));
    expect(names()).toEqual(['Griddle', 'Skillet', 'Tongs']);
  });

  it('Options_LeaveOutWhatIsTaken_WhateverItsCount', async () => {
    render(<GearPicker list={LIST} taken={['Skillet × 2']} onPick={() => {}} />);
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Search gear' }));
    expect(names()).toEqual(['Griddle', 'Tongs']);
  });

  it('Picking_GivesTheListsSpelling', async () => {
    const onPick = vi.fn();
    render(<GearPicker list={LIST} taken={[]} onPick={onPick} />);
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Search gear' }), 'SKIL{Enter}');
    expect(onPick).toHaveBeenCalledWith('Skillet');
  });

  it('NoMatch_SaysSo_AndNeverOffersToCreate', async () => {
    const onPick = vi.fn();
    render(<GearPicker list={LIST} taken={[]} onPick={onPick} />);
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Search gear' }), 'spork{Enter}');
    expect([names(), onPick.mock.calls.length, screen.queryByText(/^(Add|Create)/)]).toEqual([[], 0, null]);
    expect(screen.getByText(/Nothing on the gear list matches “spork”/)).toBeTruthy();
  });
});

describe('public GearPicker descriptions', () => {
  it('Result_ShowsTheDescriptionAsAMutedLine_WhenTheItemHasOne', async () => {
    const list = [{ ...item(1, 'Chef Kit'), description: 'Skillets, spatula; 4th floor shelf' }, item(2, 'Tongs')];
    render(<GearPicker list={list} taken={[]} onPick={() => {}} />);
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Search gear' }));
    const opts = screen.getAllByRole('option');
    expect([opts[0].textContent, opts[1].textContent]).toEqual(['Chef KitSkillets, spatula; 4th floor shelf', 'Tongs']);
  });

  it('Picking_StillGivesJustTheName_WhenTheItemHasADescription', async () => {
    const onPick = vi.fn();
    render(<GearPicker list={[{ ...item(1, 'Chef Kit'), description: 'Skillets' }]} taken={[]} onPick={onPick} />);
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Search gear' }), 'chef{Enter}');
    expect(onPick).toHaveBeenCalledWith('Chef Kit');
  });
});

describe('public GearChips', () => {
  function Harness({ start }: { start: string[] }) {
    const [gear, setGear] = useState(start);
    return <GearChips gear={gear} onChange={setGear} />;
  }
  const chipNames = () => within(screen.getByRole('list', { name: 'Gear' })).getAllByRole('listitem').map((c) => c.querySelector('span')?.textContent);

  it('Chips_AreAToZ', () => {
    render(<Harness start={['Tongs', 'Griddle × 2', 'Skillet']} />);
    expect(chipNames()).toEqual(['Griddle × 2', 'Skillet', 'Tongs']);
  });

  it('CountStepper_MovesTheCount_AndTheChipSaysNameTimesN', async () => {
    const user = userEvent.setup();
    render(<Harness start={['Skillet']} />);
    const box = screen.getByRole('spinbutton', { name: 'Skillet count' });
    await user.clear(box);
    await user.type(box, '2');
    await user.tab();
    expect(chipNames()).toEqual(['Skillet × 2']);
    await user.clear(box);
    await user.type(box, '1');
    await user.tab();
    expect(chipNames()).toEqual(['Skillet']);
  });

  it('GearCount_IsANumberBox', () => {
    render(<Harness start={['Skillet × 3']} />);
    expect((screen.getByRole('spinbutton', { name: 'Skillet count' }) as HTMLInputElement).value).toBe('3');
    expect(screen.queryByRole('button', { name: 'More Skillet' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fewer Skillet' })).toBeNull();
  });

  it('GearCount_BelowOne_ComesBackToOneOnBlur', async () => {
    const user = userEvent.setup();
    render(<Harness start={['Skillet × 3']} />);
    const box = screen.getByRole('spinbutton', { name: 'Skillet count' });
    await user.clear(box);
    await user.type(box, '0');
    await user.tab();
    expect(chipNames()).toEqual(['Skillet']);
  });

  it('Remove_TakesTheChipOff', async () => {
    render(<Harness start={['Skillet', 'Tongs']} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove Skillet' }));
    expect(chipNames()).toEqual(['Tongs']);
  });
});

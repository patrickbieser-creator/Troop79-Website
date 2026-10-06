import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { GearPicker } from '../src/app/admin/(workspace)/library/menu-monster/gear-picker';
import type { GearItem } from '../src/lib/menu-monster/gear';

/**
 * The admin gear picker (2026-10-05): a type-to-filter box over the master list's live items, A to Z, minus
 * what is picked; the picked items as A-to-Z chips with a − n + count and a remove. There is no "add" row.
 */
const item = (id: number, name: string, retiredAt: string | null = null): GearItem => ({ id, name, home: 'trailer', perPerson: false, retiredAt });
const LIST = [item(1, 'Tongs'), item(2, 'Skillet'), item(3, 'Griddle'), item(4, 'Old whisk', '2026-09-01T00:00:00Z')];
const options = () => screen.queryAllByRole('option').map((o) => o.textContent);
const chipText = () => within(screen.getByRole('list', { name: 'Selected gear' })).getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent);

function Harness({ start = [] as string[] }) {
  const [gear, setGear] = useState(start);
  return (
    <>
      <span id="lbl">Gear</span>
      <GearPicker labelledBy="lbl" gear={gear} list={LIST} onChange={setGear} />
      <output aria-label="stored">{JSON.stringify(gear)}</output>
    </>
  );
}
const stored = () => JSON.parse(screen.getByLabelText('stored').textContent ?? '[]') as string[];

describe('admin GearPicker', () => {
  it('Options_AreAToZ_WithoutRetiredItems', async () => {
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Search gear' }));
    expect(options()).toEqual(['Griddle', 'Skillet', 'Tongs']);
  });

  it('Typing_FiltersTheOptions', async () => {
    render(<Harness />);
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Search gear' }), 'il');
    expect(options()).toEqual(['Skillet']);
  });

  it('NoMatch_NeverOffersToAdd', async () => {
    render(<Harness />);
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Search gear' }), 'spork{Enter}');
    expect([options(), stored(), screen.queryByRole('button', { name: /add/i })]).toEqual([[], [], null]);
    expect(screen.getByText(/Nothing on the gear list matches “spork”/)).toBeTruthy();
  });

  it('Picking_AddsAChip_AToZ_AndTheItemLeavesTheOptions', async () => {
    const user = userEvent.setup();
    render(<Harness start={['Tongs']} />);
    await user.type(screen.getByRole('combobox', { name: 'Search gear' }), 'gri{Enter}');
    expect(stored()).toEqual(['Griddle', 'Tongs']);
    await user.click(screen.getByRole('combobox', { name: 'Search gear' }));
    expect(options()).toEqual(['Skillet']);
  });

  it('CountStepper_SaysNameTimesN_AndFewerIsGreyedAtOne', async () => {
    const user = userEvent.setup();
    render(<Harness start={['Skillet']} />);
    expect((screen.getByRole('button', { name: 'Fewer Skillet' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'More Skillet' }));
    expect(stored()).toEqual(['Skillet × 2']);
    expect(chipText()).toEqual(['Skillet × 2']);
  });

  it('Remove_TakesTheChipOff', async () => {
    render(<Harness start={['Skillet × 3', 'Tongs']} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove Skillet' }));
    expect(stored()).toEqual(['Tongs']);
  });

  it('Enter_DoesNotSubmitTheSurroundingForm', async () => {
    let submitted = false;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted = true;
        }}
      >
        <Harness />
      </form>
    );
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Search gear' }), 'gri{Enter}');
    expect(submitted).toBe(false);
  });
});

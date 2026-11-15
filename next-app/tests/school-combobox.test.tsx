import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchoolCombobox } from '../src/app/admin/(workspace)/_components/school-combobox';
import { SchoolPicker } from '../src/app/_components/school-picker';
import type { School } from '../src/lib/schools';

/**
 * The school pick list (Plans/Person-Record-One-Save.md, Schools). Leaders pick or add a school row
 * (SchoolCombobox, admin tokens); families pick a name and their "+ Add" only fills the change request
 * (SchoolPicker, public tokens). addSchool is the mock boundary.
 */
const SCHOOLS: School[] = [
  { id: 1, name: 'Shorewood High School', short_name: null, active: true },
  { id: 2, name: 'Shorewood Intermediate School', short_name: 'SIS', active: true },
  { id: 3, name: 'Rufus King High School', short_name: null, active: true },
  { id: 4, name: 'Old Closed Academy', short_name: null, active: false }
];

function Leader({ initial = null, onAdd }: { initial?: number | null; onAdd?: (name: string) => Promise<{ ok: boolean; school?: School; error?: string }> }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <SchoolCombobox id="school" label="School" schools={SCHOOLS} value={value} onChange={setValue} onAddSchool={onAdd ?? vi.fn()} />
      <output aria-label="picked">{value ?? 'none'}</output>
    </>
  );
}

const box = () => screen.getByRole('combobox', { name: 'School' });
const options = () => within(screen.getByRole('listbox')).queryAllByRole('option');

describe('SchoolCombobox (leaders)', () => {
  it('Leader_PicksExistingSchool_WhenTypingPartOfName', async () => {
    const user = userEvent.setup();
    render(<Leader />);
    await user.type(box(), 'king');
    await user.click(screen.getByRole('option', { name: 'Rufus King High School' }));
    expect(screen.getByLabelText('picked').textContent).toBe('3');
  });

  it('Combobox_BoldsTheMatchingText_InEachOption', async () => {
    const user = userEvent.setup();
    render(<Leader />);
    await user.type(box(), 'wood h');
    const bold = screen.getByRole('option', { name: 'Shorewood High School' }).querySelector('strong');
    expect(bold?.textContent).toBe('wood H');
  });

  it('Combobox_PicksWithTheKeyboard', async () => {
    const user = userEvent.setup();
    render(<Leader />);
    await user.type(box(), 'shorewood{ArrowDown}{Enter}');
    expect(screen.getByLabelText('picked').textContent).toBe('2');
  });

  it('Combobox_OffersNoAdd_WhenTypedTextMatchesASchoolExactly', async () => {
    const user = userEvent.setup();
    render(<Leader />);
    await user.type(box(), 'shorewood high school');
    expect(options().map((o) => o.textContent)).toEqual(['Shorewood High School']);
  });

  it('Combobox_OffersAddAsTheLastOption_WhenNothingMatchesExactly', async () => {
    const user = userEvent.setup();
    render(<Leader />);
    await user.type(box(), 'Shorewood');
    expect(options().at(-1)?.textContent).toBe('+ Add “Shorewood” as a new school');
  });

  it('Combobox_DoesNotOfferHiddenSchools', async () => {
    const user = userEvent.setup();
    render(<Leader />);
    await user.type(box(), 'academy');
    expect(options().map((o) => o.textContent)).toEqual(['+ Add “academy” as a new school']);
  });

  it('Combobox_StillShowsAScoutsHiddenSchool', () => {
    render(<Leader initial={4} />);
    expect((box() as HTMLInputElement).value).toBe('Old Closed Academy');
  });

  it('Combobox_ClearsThePick_WithTheX', async () => {
    const user = userEvent.setup();
    render(<Leader initial={1} />);
    await user.click(screen.getByRole('button', { name: 'Clear School' }));
    expect(screen.getByLabelText('picked').textContent).toBe('none');
  });

  it('Leader_AddsANewSchool_ThroughTheDialog_AndItIsPicked', async () => {
    const user = userEvent.setup();
    const made: School = { id: 9, name: 'Golda Meir School', short_name: null, active: true };
    const onAdd = vi.fn(async (name: string) => ({ ok: name !== '', school: made }));
    render(<Leader onAdd={onAdd} />);
    await user.type(box(), 'Golda Meir');
    await user.click(screen.getByRole('option', { name: '+ Add “Golda Meir” as a new school' }));
    const name = screen.getByLabelText('Full school name');
    expect((name as HTMLInputElement).value).toBe('Golda Meir');
    await user.type(name, ' School');
    await user.click(screen.getByRole('button', { name: 'Add school' }));
    expect([onAdd.mock.calls[0][0], screen.getByLabelText('picked').textContent]).toEqual(['Golda Meir School', '9']);
  });
});

function Family({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="pf-school">School</label>
      <SchoolPicker id="pf-school" names={SCHOOLS.filter((s) => s.active).map((s) => s.name)} value={value} onChange={setValue} />
      <output aria-label="picked">{value || 'none'}</output>
    </>
  );
}

describe('SchoolPicker (families)', () => {
  it('Family_PicksASchoolFromTheList', async () => {
    const user = userEvent.setup();
    render(<Family />);
    await user.type(screen.getByRole('combobox', { name: 'School' }), 'rufus');
    await user.click(screen.getByRole('option', { name: 'Rufus King High School' }));
    expect(screen.getByLabelText('picked').textContent).toBe('Rufus King High School');
  });

  it('Family_AddsATypedSchool_IntoTheRequestOnly', async () => {
    const user = userEvent.setup();
    render(<Family />);
    await user.type(screen.getByRole('combobox', { name: 'School' }), 'Golda Meir School');
    await user.click(screen.getByRole('option', { name: '+ Add “Golda Meir School” as a new school' }));
    expect(screen.getByLabelText('picked').textContent).toBe('Golda Meir School');
  });

  it('Family_SeesTheirCurrentSchool_EvenWhenItIsNotOnTheList', () => {
    render(<Family initial="Riverside" />);
    expect((screen.getByRole('combobox', { name: 'School' }) as HTMLInputElement).value).toBe('Riverside');
  });
});

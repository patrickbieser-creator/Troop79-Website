import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const createPerson = vi.fn<(fd: FormData) => Promise<{ ok: true; personId: number }>>(async () => ({ ok: true, personId: 1 }));
vi.mock('../src/app/admin/(workspace)/advancement/roster/person-actions', () => ({ createPerson: (fd: FormData) => createPerson(fd) }));

import { AdultForm } from '../src/app/admin/(workspace)/advancement/roster/adult-form';

/**
 * Add adult into a household with scouts asks how the adult relates to each one (lib/household-links). Without the
 * answer the adult landed in the household with no parent link and couldn't see the child's health forms (Kevin
 * Greene, 2026-11-14).
 */
const households = [
  { id: 49, label: 'Greene', scouts: [{ personId: 173, name: 'Miren Greene' }] },
  { id: 50, label: 'No scouts here' }
];

async function fillAndPick(householdLabel: string) {
  const user = userEvent.setup();
  render(<AdultForm households={households} onClose={() => {}} onCreated={() => {}} />);
  const [first, last] = screen.getAllByPlaceholderText('Required');
  await user.type(first, 'Kevin');
  await user.type(last, 'Greene');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Household' }), householdLabel);
  return user;
}

beforeEach(() => createPerson.mockClear());

describe('AdultForm household links', () => {
  it('Leader_PickingAHouseholdWithAScout_IsAskedHowTheAdultIsRelated', async () => {
    await fillAndPick('Greene');
    expect(screen.getByRole('radiogroup', { name: 'How this adult is related to Miren Greene' })).toBeTruthy();
  });

  it('Leader_AddingWithoutAnswering_IsToldWhichScoutAndNothingIsCreated', async () => {
    const user = await fillAndPick('Greene');
    await user.click(screen.getByRole('button', { name: 'Add adult' }));
    expect([createPerson.mock.calls.length, screen.getByRole('alert').textContent]).toEqual([0, 'Can’t add yet: say how they’re related to Miren Greene']);
  });

  it('Leader_ChoosingParent_SendsTheParentLink', async () => {
    const user = await fillAndPick('Greene');
    await user.click(screen.getByRole('radio', { name: 'Parent' }));
    await user.click(screen.getByRole('button', { name: 'Add adult' }));
    expect(createPerson.mock.calls[0][0].get('relation_173')).toBe('parent_of');
  });

  it('Leader_PickingAHouseholdWithNoScouts_IsAskedNothing', async () => {
    await fillAndPick('No scouts here');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

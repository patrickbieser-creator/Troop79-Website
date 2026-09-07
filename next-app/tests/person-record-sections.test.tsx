import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonRecord } from '../src/app/admin/(workspace)/advancement/roster/[personId]/person-record';
import type { PersonRecord as PersonRecordData } from '../src/app/admin/(workspace)/advancement/roster/[personId]/record-types';
import { setHousehold, updatePersonDemographics } from '../src/app/admin/(workspace)/advancement/roster/person-actions';

/**
 * Person Editor Rethink, Phase 2 (Plans/Person-Editor-Rethink.md) — the
 * section forms. Every section is read-only until its ONE Edit; Edit turns
 * that section (and only that section) into a form with a dirty-gated Save
 * and a Cancel that restores the LAST SAVED values; a Save sends only that
 * section's fields; opening a second section while the first is dirty asks
 * before discarding; the Family section's household change offers Undo.
 *
 * The mock boundary is the server action (Tests/CLAUDE.md): assert on what
 * the component sent, not on what the DB did with it.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/advancement/roster/401',
  useSearchParams: () => new URLSearchParams('')
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/person-actions', () => ({
  setPersonActive: vi.fn(async () => ({ ok: true })),
  setHousehold: vi.fn(async () => ({ ok: true })),
  updatePersonDemographics: vi.fn(async () => ({ ok: true }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/[personId]/scout-status-actions', () => ({
  setScoutActive: vi.fn(async () => ({ ok: true }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/lookups/actions', () => ({
  updateScoutIdentity: vi.fn(async () => ({ ok: true })),
  updateScoutFields: vi.fn(async () => ({ ok: true }))
}));

beforeEach(() => {
  vi.mocked(updatePersonDemographics).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(setHousehold).mockClear().mockResolvedValue({ ok: true });
});

function adultRecord(): PersonRecordData {
  return {
    personId: 401,
    displayName: 'Dana Whitlock',
    kind: 'adult',
    tab: 'adult',
    detail: {
      active: true,
      inactiveReason: null,
      tab: 'adult',
      householdId: 1,
      roles: [],
      relationships: [],
      fields: {
        first_name: 'Dana',
        last_name: 'Whitlock',
        birthdate: '1981-03-14',
        primary_email: 'dana@example.com',
        primary_phone: '(414) 555-0142',
        address_line1: '2210 N Prospect Ave',
        address_line2: null,
        city: 'Milwaukee',
        state: 'WI',
        zip: '53202',
        bsa_member_id: '137204418',
        ypt_completed: '2025-02-11',
        health_form_date: '2026-05-30',
        things_we_should_know: null
      }
    },
    emails: [],
    scout: null,
    gender: null,
    leader: null,
    rankLabel: null,
    household: { id: 1, label: 'Whitlock', members: [] },
    households: [
      { id: 1, label: 'Whitlock' },
      { id: 2, label: 'Raman' }
    ],
    status: { active: true, reason: null },
    pendingUpdate: false,
    today: '2026-09-07'
  };
}

const section = (name: string) => screen.getByRole('region', { name });
const fdKeys = (fd: FormData) => Array.from(fd.keys()).sort();

describe('Person record sections — read → Edit → Save/Cancel, one at a time', () => {
  it('Leader_EditsDetailsSection_SavesOnlyThatSection', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const details = section('Details');

    // Read mode: values shown, no inputs, one Edit.
    expect(within(details).getByText('Dana')).toBeTruthy();
    expect(within(details).queryByRole('textbox')).toBeNull();
    await user.click(within(details).getByRole('button', { name: 'Edit' }));

    // Fresh form: Save is greyed until something changes.
    const save = within(details).getByRole('button', { name: 'Saved' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    const first = within(details).getByLabelText(/First name/);
    await user.clear(first);
    await user.type(first, 'Dee');
    await user.click(within(details).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updatePersonDemographics).toHaveBeenCalledTimes(1));
    const [personId, fd] = vi.mocked(updatePersonDemographics).mock.calls[0];
    expect(personId).toBe(401);
    expect(fd.get('first_name')).toBe('Dee');
    expect(fd.get('last_name')).toBe('Whitlock');
    // ONLY the Details fields — no phone, address or household keys.
    expect(fdKeys(fd)).toEqual([
      'birthdate',
      'bsa_member_id',
      'first_name',
      'health_form_date',
      'last_name',
      'things_we_should_know',
      'ypt_completed'
    ]);
    // Back to the read row, stamped, showing the new value.
    await within(details).findByText('Saved just now');
    expect(within(details).getByText('Dee')).toBeTruthy();
    expect(within(details).queryByRole('textbox')).toBeNull();
  });

  it('Leader_CancelsSectionEdit_RestoresLastSavedValues_NotPageLoadValues', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const details = section('Details');

    await user.click(within(details).getByRole('button', { name: 'Edit' }));
    const first = within(details).getByLabelText(/First name/);
    await user.clear(first);
    await user.type(first, 'Dee');
    await user.click(within(details).getByRole('button', { name: 'Save changes' }));
    await within(details).findByText('Saved just now');

    // Edit again, type something else, Cancel → the SAVED value ('Dee'),
    // not what the page loaded with ('Dana').
    await user.click(within(details).getByRole('button', { name: 'Edit' }));
    const again = within(details).getByLabelText(/First name/);
    expect((again as HTMLInputElement).value).toBe('Dee');
    await user.clear(again);
    await user.type(again, 'Zed');
    await user.click(within(details).getByRole('button', { name: 'Cancel' }));

    expect(within(details).queryByRole('textbox')).toBeNull();
    expect(within(details).getByText('Dee')).toBeTruthy();
    expect(within(details).queryByText('Dana')).toBeNull();
    expect(within(details).queryByText('Zed')).toBeNull();
    expect(updatePersonDemographics).toHaveBeenCalledTimes(1);
  });

  it('Leader_OpensSecondSectionWhileFirstIsDirty_IsPromptedToDiscard', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const details = section('Details');
    const contact = section('Contact & sign-in');

    await user.click(within(details).getByRole('button', { name: 'Edit' }));
    await user.type(within(details).getByLabelText(/First name/), 'x');
    await user.click(within(contact).getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog', { name: /Discard unsaved changes\?/ });
    expect(within(dialog).getByText(/Details/)).toBeTruthy();

    // Keep editing: Details stays open with the edit, Contact stays read-only.
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect((within(details).getByLabelText(/First name/) as HTMLInputElement).value).toBe('Danax');
    expect(within(contact).queryByLabelText(/Phone/)).toBeNull();

    // Discard: Details returns to its saved values, Contact opens.
    await user.click(within(contact).getByRole('button', { name: 'Edit' }));
    const dialog2 = await screen.findByRole('dialog', { name: /Discard unsaved changes\?/ });
    await user.click(within(dialog2).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(within(contact).getByLabelText(/Phone/)).toBeTruthy());
    expect(within(details).queryByRole('textbox')).toBeNull();
    expect(within(details).getByText('Dana')).toBeTruthy();
    expect(updatePersonDemographics).not.toHaveBeenCalled();
  });

  it('Leader_BlanksRequiredName_SaveStaysDisabledWithReason', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const details = section('Details');

    await user.click(within(details).getByRole('button', { name: 'Edit' }));
    await user.clear(within(details).getByLabelText(/Last name/));

    // Dirty, but blocked: the label says "Save changes", the button is off,
    // and the title says why.
    const save = within(details).getByRole('button', { name: 'Save changes' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(save.getAttribute('title')).toBe('First and last name are required');
    await user.click(save);
    expect(updatePersonDemographics).not.toHaveBeenCalled();

    // Typing a name again unblocks it.
    await user.type(within(details).getByLabelText(/Last name/), 'W');
    expect((within(details).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Leader_ChangesHousehold_ToastOffersUndo', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const family = section('Household & family');

    await user.click(within(family).getByRole('button', { name: 'Edit' }));
    const select = within(family).getByLabelText(/Household/);
    expect(select.tagName).toBe('SELECT');
    expect((select as HTMLSelectElement).value).toBe('1');
    await user.selectOptions(select, '2');
    await user.click(within(family).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(setHousehold).toHaveBeenCalledWith(401, 2));
    // The toast names what changed and offers a way back.
    const toast = await within(family).findByRole('status', { name: /Household changed/ });
    expect(toast.textContent).toMatch(/Household: Whitlock → Raman/);
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(setHousehold).toHaveBeenLastCalledWith(401, 1));
    expect(setHousehold).toHaveBeenCalledTimes(2);
    // Undo put the saved value back — the read row shows the old household.
    await waitFor(() => expect(within(family).getByText('Whitlock')).toBeTruthy());
    expect(within(family).queryByText('Raman')).toBeNull();
  });
});

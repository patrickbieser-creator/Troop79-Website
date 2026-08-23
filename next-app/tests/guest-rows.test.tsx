import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuestRowsEditor, GuestCountField } from '../src/app/(public)/events/[id]/guest-rows';

/**
 * Named guest rows on the public sign-up forms (Plans/Participant-
 * Classification.md, decision 3/4): "Bringing anyone else?" — each guest is a
 * name + class (Webelos / Cub Scout / Youth Guest / Adult Guest). Replaces the
 * "+N guests" count for new sign-ups. The list travels as one hidden JSON
 * field (`guests`) the server action normalizes (lib/event-signup).
 */
describe('GuestRowsEditor', () => {
  it('StartsEmpty_AndAddsANamedRow_WithAClassSelect', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GuestRowsEditor guests={[]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /add a guest/i }));
    expect(onChange).toHaveBeenLastCalledWith([{ personId: null, name: '', cls: 'youth_guest', phone: '', attending: true }]);
  });

  it('RendersEachRow_WithNameInputAndClassSelect_AndRemoves', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <GuestRowsEditor
        guests={[
          { personId: null, name: 'Sam Lee', cls: 'webelos', phone: '', attending: true },
          { personId: null, name: 'Aunt Jo', cls: 'adult_guest', phone: '', attending: true }
        ]}
        onChange={onChange}
      />
    );
    const names = screen.getAllByRole('textbox', { name: /guest name/i }) as HTMLInputElement[];
    expect(names.map((n) => n.value)).toEqual(['Sam Lee', 'Aunt Jo']);
    const classes = screen.getAllByRole('combobox', { name: /guest class/i }) as HTMLSelectElement[];
    expect(classes[0].value).toBe('webelos');
    expect([...classes[0].options].map((o) => o.value)).toEqual(['webelos', 'cub_scout', 'youth_guest', 'adult_guest']);
    await user.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    expect(onChange).toHaveBeenLastCalledWith([{ personId: null, name: 'Aunt Jo', cls: 'adult_guest', phone: '', attending: true }]);
  });

  it('GuestRow_HasTheSameAttendingToggleAsAMember_AndCarriesItInTheHiddenField', async () => {
    // Patrick, 2026-08-23: "add the Attending-style toggle to the guest rows.
    // The consistency will be a better UX." A guest row is a .personRow with
    // Attending / Can't make it; toggling flips `attending` in the JSON.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <GuestRowsEditor
        guests={[{ personId: null, name: 'Fred Pike', cls: 'adult_guest', phone: '', attending: true }]}
        onChange={onChange}
      />
    );
    const attending = screen.getByRole('button', { name: /guest 1 attending/i });
    const cant = screen.getByRole('button', { name: /guest 1 can’t make it/i });
    expect(attending.getAttribute('aria-pressed')).toBe('true');
    expect(cant.getAttribute('aria-pressed')).toBe('false');
    await user.click(cant);
    expect(onChange).toHaveBeenLastCalledWith([{ personId: null, name: 'Fred Pike', cls: 'adult_guest', phone: '', attending: false }]);
    // Name, class and phone stay editable beside the toggle.
    expect(screen.getByRole('textbox', { name: /guest name 1/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /guest class 1/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /guest phone 1/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /add another guest/i })).toBeTruthy();
  });

  it('AdultGuestRow_OffersAPhone_YouthRowDoesNot', () => {
    render(
      <GuestRowsEditor
        guests={[
          { personId: null, name: 'Sam Lee', cls: 'webelos', phone: '', attending: true },
          { personId: null, name: 'Aunt Jo', cls: 'adult_guest', phone: '', attending: true }
        ]}
        onChange={() => {}}
      />
    );
    expect(screen.queryByRole('textbox', { name: /guest phone 1/i })).toBeNull();
    expect(screen.getByRole('textbox', { name: /guest phone 2/i })).toBeTruthy();
  });

  it('PreviousGuests_AreOfferedAsOneClickPicks_AndVanishOncePicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const grandma = { personId: 501, name: 'Grandma Pat', cls: 'adult_guest' as const, phone: '414-555-0100' };
    const { rerender } = render(<GuestRowsEditor guests={[]} onChange={onChange} previousGuests={[grandma]} />);
    await user.click(screen.getByRole('button', { name: 'Add Grandma Pat again' }));
    expect(onChange).toHaveBeenLastCalledWith([{ personId: 501, name: 'Grandma Pat', cls: 'adult_guest', phone: '414-555-0100', attending: true }]);
    rerender(
      <GuestRowsEditor
        guests={[{ personId: 501, name: 'Grandma Pat', cls: 'adult_guest', phone: '414-555-0100', attending: true }]}
        onChange={onChange}
        previousGuests={[grandma]}
      />
    );
    expect(screen.queryByRole('button', { name: 'Add Grandma Pat again' })).toBeNull();
    // A re-picked row is the person on record — the name is not editable.
    expect((screen.getByRole('textbox', { name: /guest name 1/i }) as HTMLInputElement).readOnly).toBe(true);
  });

  it('TypedNameMatchingAGuestOnRecord_AsksToUseThemAgain_NeverMergesSilently', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const grandma = { personId: 501, name: 'Grandma Pat', cls: 'adult_guest' as const, phone: null };
    render(
      <GuestRowsEditor
        guests={[{ personId: null, name: 'grandma pat', cls: 'youth_guest', phone: '', attending: true }]}
        onChange={onChange}
        previousGuests={[grandma]}
      />
    );
    // The hidden field still carries the typed row (no personId) until confirmed.
    const hidden = document.querySelector('input[type="hidden"][name="guests"]') as HTMLInputElement;
    expect(JSON.parse(hidden.value)[0].personId).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Use Grandma Pat again' }));
    expect(onChange).toHaveBeenLastCalledWith([{ personId: 501, name: 'Grandma Pat', cls: 'youth_guest', phone: '', attending: true }]);
  });

  it('CarriesTheListAsOneHiddenJsonField_NamedGuests', () => {
    const { container } = render(
      <GuestRowsEditor guests={[{ personId: null, name: 'Sam Lee', cls: 'cub_scout', phone: '', attending: true }]} onChange={() => {}} />
    );
    const hidden = container.querySelector('input[type="hidden"][name="guests"]') as HTMLInputElement;
    expect(JSON.parse(hidden.value)).toEqual([{ personId: null, name: 'Sam Lee', cls: 'cub_scout', phone: '', attending: true }]);
  });
});

describe('GuestCountField (count mode)', () => {
  it('CarriesANumberAndANote_BoundedTo0To200', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Controlled with a mock parent: the value never re-renders, so type into
    // the initial '0' — '05' is still 5.
    render(<GuestCountField count={0} note="" onChange={onChange} />);
    const n = screen.getByRole('spinbutton', { name: /number of guests/i }) as HTMLInputElement;
    expect(n.value).toBe('0');
    await user.type(n, '5');
    expect(onChange).toHaveBeenLastCalledWith({ count: 5, note: '' });
    await user.type(screen.getByRole('textbox', { name: /who are the guests/i }), 'g');
    expect(onChange).toHaveBeenLastCalledWith({ count: 0, note: 'g' });
  });
});

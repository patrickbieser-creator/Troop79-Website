import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuestRowsEditor } from '../src/app/(public)/events/[id]/guest-rows';

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
    expect(onChange).toHaveBeenLastCalledWith([{ name: '', cls: 'youth_guest' }]);
  });

  it('RendersEachRow_WithNameInputAndClassSelect_AndRemoves', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <GuestRowsEditor
        guests={[
          { name: 'Sam Lee', cls: 'webelos' },
          { name: 'Aunt Jo', cls: 'adult_guest' }
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
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Aunt Jo', cls: 'adult_guest' }]);
  });

  it('CarriesTheListAsOneHiddenJsonField_NamedGuests', () => {
    const { container } = render(
      <GuestRowsEditor guests={[{ name: 'Sam Lee', cls: 'cub_scout' }]} onChange={() => {}} />
    );
    const hidden = container.querySelector('input[type="hidden"][name="guests"]') as HTMLInputElement;
    expect(JSON.parse(hidden.value)).toEqual([{ name: 'Sam Lee', cls: 'cub_scout' }]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';

/** The "Add a package you bought" form: an incomplete Add saves nothing and marks what is missing in place (D-331). */

const addScoutPackageAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  addScoutPackageAction: (...a: unknown[]) => addScoutPackageAction(...a)
}));

import { AddPackageForm } from '../src/app/(public)/library/menu-monster/menus/_components/add-package-form';

const ING = CATALOG.ingredients[0];
const form = () => {
  render(<AddPackageForm ingredient={ING} conversions={CATALOG.conversions} onAdded={vi.fn()} onCancel={vi.fn()} />);
  return screen.getByRole('group', { name: `New package of ${ING.name}` });
};

beforeEach(() => vi.clearAllMocks());

describe('AddPackageForm', () => {
  it('Scout_SeesWhichFieldIsBad_WhenAddingAnIncompletePackage', async () => {
    const user = userEvent.setup();
    const g = form();
    const add = within(g).getByRole('button', { name: 'Add package' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    await user.click(add);
    expect(within(g).getByRole('textbox', { name: 'Name on the label' }).getAttribute('aria-invalid')).toBe('true');
    expect(within(g).getByRole('textbox', { name: 'One package holds' }).getAttribute('aria-invalid')).toBe('true');
    expect(within(g).getByRole('textbox', { name: 'Price' }).getAttribute('aria-invalid')).toBe('true');
    expect(within(g).getByRole('alert').textContent).toBe('Can’t add yet: give the package a name (+2 more)');
    expect(document.activeElement).toBe(within(g).getByRole('textbox', { name: 'Name on the label' }));
    expect(addScoutPackageAction).not.toHaveBeenCalled();
  });

  it('Scout_LosesTheMark_WhenTheFieldIsFixed', async () => {
    const user = userEvent.setup();
    const g = form();
    await user.click(within(g).getByRole('button', { name: 'Add package' }));
    await user.type(within(g).getByRole('textbox', { name: 'Name on the label' }), 'Store brand');
    expect(within(g).getByRole('textbox', { name: 'Name on the label' }).getAttribute('aria-invalid')).toBeNull();
    expect(within(g).getByRole('alert').textContent).toBe('Can’t add yet: say how much one package holds (+1 more)');
  });
});

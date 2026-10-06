import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Admin › Menu Monster › a brand's rename: Save greys only when nothing changed; an emptied name is marked in place. */

const renameBrand = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  renameBrand: (...a: unknown[]) => renameBrand(...a),
  mergeBrand: vi.fn(async () => ({ ok: true })),
  moveBrand: vi.fn(async () => ({ ok: true })),
  removeBrand: vi.fn(async () => ({ ok: true })),
  setBrandDiets: vi.fn(async () => ({ ok: true }))
}));

import { BrandHead } from '../src/app/admin/(workspace)/library/menu-monster/brands-block';
import type { Brand, Catalog, Ingredient } from '../src/lib/menu-monster/types';

const ING: Ingredient = { id: 'cereal', name: 'Cereal', unit: { key: 'cup', one: 'cup', many: 'cups', kind: 'volume' }, section: 'dry', staple: false, avoid: [], retiredAt: null };
const BRAND = { id: 7, ingredientId: 'cereal', name: 'Rice Chex', retiredAt: null, avoid: null } as unknown as Brand;
const CATALOG = { ingredients: [ING], packages: [], conversions: [], recipes: [], brands: [BRAND] } as unknown as Catalog;

beforeEach(() => {
  renameBrand.mockReset().mockResolvedValue({ ok: true });
});

describe('BrandHead — rename', () => {
  it('Leader_SeesTheNameMarked_WhenSavingAnEmptiedBrandName', async () => {
    const user = userEvent.setup();
    render(<BrandHead brand={BRAND} ing={ING} catalog={CATALOG} priced={0} headingId="h" onChanged={vi.fn()} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'More for Rice Chex' }), 'rename');
    const box = screen.getByRole('textbox', { name: 'New name for Rice Chex' });
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(box);
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await user.click(save);
    expect(renameBrand).not.toHaveBeenCalled();
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('It needs a name.')).toBeTruthy();
    expect(document.activeElement).toBe(box);
  });
});

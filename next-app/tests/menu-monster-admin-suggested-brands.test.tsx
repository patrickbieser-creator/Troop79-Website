import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG as BASE } from './helpers/menu-monster-fixture';
import type { Catalog } from '../src/lib/menu-monster/types';

/** Release 6: admin › Menu Monster › a recipe's Suggested brands — one select per ingredient that has brands, saved at once. */

const suggestRecipeBrand = vi.fn();
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({ suggestRecipeBrand: (...a: unknown[]) => suggestRecipeBrand(...a) }));

import { SuggestedBrands } from '../src/app/admin/(workspace)/library/menu-monster/suggested-brands';

const CATALOG: Catalog = {
  ...BASE,
  brands: [
    { id: 'b-kirk', ingredientId: 'bacon', name: 'Kirkland', avoid: null },
    { id: 'b-om', ingredientId: 'bacon', name: 'Oscar Mayer', avoid: null },
    { id: 'b-old', ingredientId: 'bacon', name: 'Gone', avoid: null, retiredAt: '2026-10-01T00:00:00Z' }
  ]
};
const withSuggestion: Catalog = { ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'B003' ? { ...r, brandSuggestions: { bacon: 'b-om' } } : r)) };
const onChanged = vi.fn();
const select = () => screen.getByRole('combobox', { name: 'Bacon' }) as HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
  suggestRecipeBrand.mockResolvedValue({ ok: true });
});

describe('SuggestedBrands', () => {
  it('OffersTheIngredientsLiveBrands_AndNoSuggestion', () => {
    render(<SuggestedBrands recipeId="B003" catalog={CATALOG} onChanged={onChanged} />);
    expect([...select().options].map((o) => o.textContent)).toEqual(['No suggestion (any brand)', 'Kirkland', 'Oscar Mayer']);
  });

  it('ShowsTheSavedSuggestion', () => {
    render(<SuggestedBrands recipeId="B003" catalog={withSuggestion} onChanged={onChanged} />);
    expect(select().value).toBe('b-om');
  });

  it('ARecipeWhoseIngredientsHaveNoBrands_ShowsNothing', () => {
    const { container } = render(<SuggestedBrands recipeId="B001" catalog={CATALOG} onChanged={onChanged} />);
    expect(container.textContent).toBe('');
  });

  it('PickingABrand_SavesAtOnce', async () => {
    render(<SuggestedBrands recipeId="B003" catalog={CATALOG} onChanged={onChanged} />);
    await userEvent.setup().selectOptions(select(), 'b-kirk');
    expect(suggestRecipeBrand).toHaveBeenCalledWith('B003', 'bacon', 'b-kirk');
    await waitFor(() => expect(select().value).toBe('b-kirk'));
  });

  it('PickingNoSuggestion_ClearsIt', async () => {
    render(<SuggestedBrands recipeId="B003" catalog={withSuggestion} onChanged={onChanged} />);
    await userEvent.setup().selectOptions(select(), '');
    expect(suggestRecipeBrand).toHaveBeenCalledWith('B003', 'bacon', null);
  });

  it('ARefusal_IsShown_AndTheSelectStaysPut', async () => {
    suggestRecipeBrand.mockResolvedValue({ ok: false, error: 'That recipe is gone. Reload the page.' });
    render(<SuggestedBrands recipeId="B003" catalog={withSuggestion} onChanged={onChanged} />);
    await userEvent.setup().selectOptions(select(), 'b-kirk');
    await waitFor(() => expect(screen.getByText('That recipe is gone. Reload the page.')).toBeTruthy());
    expect(select().value).toBe('b-om');
  });
});

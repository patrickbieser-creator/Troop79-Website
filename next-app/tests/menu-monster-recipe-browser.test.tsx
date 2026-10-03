import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Catalog } from '../src/lib/menu-monster/types';
import { RecipeBrowser } from '../src/app/(public)/library/menu-monster/_components/recipe-browser';

/** Phase 4A: the library names who wrote a shared scout recipe, and marks the viewer's own draft. */

const PLAN = { headcount: 8, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 } };
const withScout: Catalog = {
  ...CATALOG,
  recipes: [
    ...CATALOG.recipes,
    { ...CATALOG.recipes[0], id: 'S-0000aaaa', name: 'Sam chili', credit: 'Sam K.' },
    { ...CATALOG.recipes[0], id: 'S-0000bbbb', name: 'My stir-fry', status: 'draft', credit: null }
  ]
};
const rowOf = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li') as HTMLElement;

describe('RecipeBrowser credits', () => {
  it('SharedScoutRecipe_SaysWhoWroteIt', () => {
    render(<RecipeBrowser catalog={withScout} plan={PLAN} />);
    expect(rowOf('Sam chili').textContent).toContain('Recipe by Sam K.');
  });

  it('OwnDraft_IsMarkedAsYours', () => {
    render(<RecipeBrowser catalog={withScout} plan={PLAN} />);
    expect(rowOf('My stir-fry').textContent).toContain('Your draft recipe');
  });

  it('TroopRecipe_HasNoCredit', () => {
    render(<RecipeBrowser catalog={withScout} plan={PLAN} />);
    expect(rowOf('Pancakes').textContent).not.toContain('Recipe by');
  });
});

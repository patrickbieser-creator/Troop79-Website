import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CATALOG } from './helpers/menu-monster-fixture';
import { seedPlan } from '../src/lib/menu-monster/engine';
import { ingredientRows } from '../src/lib/menu-monster/ingredient-rows';
import type { Plan, Recipe } from '../src/lib/menu-monster/types';
import { IngredientList } from '../src/app/(public)/library/menu-monster/_components/ingredient-list';

/**
 * IngredientList, read mode (slice 4b): rows of ingredient name, the amount for
 * the view, and a quiet note on diet lines. author is a reserved
 * mode and falls back to the same read rows until Phase 4 lands (menu-edit: menu-monster-menu-edit-list.test.tsx).
 */

const pancakes = CATALOG.recipes.find((r) => r.id === 'B001') as Recipe;
const plan = (gf: number): Plan => ({ ...seedPlan(CATALOG), headcount: 8, restrictions: { gf, nut: 0, dairy: 0, veg: 0 } });
const list = (view: 'total' | 'person', gf = 1) => (
  <IngredientList mode="read" ariaLabel="Pancakes ingredients" rows={ingredientRows(pancakes, CATALOG, plan(gf), view)} />
);
const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('IngredientList (read)', () => {
  it('List_IsALabelledList', () => {
    render(list('total'));
    expect(screen.getByRole('list', { name: 'Pancakes ingredients' })).toBeTruthy();
  });

  it('Row_ShowsTheNameAndTheTotalForThePeople', () => {
    render(list('total'));
    expect(within(row('Pancake mix')).getByText('3½ cups')).toBeTruthy();
  });

  it('Row_ShowsOnePersonsShare_InPerPersonView', () => {
    render(list('person'));
    expect(within(row('Pancake mix')).getByText('½ cup')).toBeTruthy();
  });

  it('DietSwap_ShowsWhoItIsFor', () => {
    render(list('total'));
    expect(row('Almond flour').textContent).toContain('gluten-free only');
  });

  it('BaseLine_SaysEveryoneElse_WhenADietSwapExists', () => {
    render(list('total'));
    expect(row('Pancake mix').textContent).toContain('everyone else');
  });

  it('DietSwap_IsAbsent_WhenNobodyNeedsIt', () => {
    render(list('total', 0));
    expect(screen.queryByText('Almond flour')).toBeNull();
  });

  it('List_ShowsTheEmptyText_WhenThereAreNoRows', () => {
    render(<IngredientList mode="read" ariaLabel="Nothing" rows={[]} emptyText="No ingredients." />);
    expect(screen.getByText('No ingredients.')).toBeTruthy();
  });

  it('AmountColumn_IsReadableAsPartOfTheRow', () => {
    render(list('total'));
    expect(row('Pancake mix').textContent).toMatch(/Pancake mix.*3½ cups/);
  });

  it('AuthorMode_RendersTheReadRows_UntilPhase4Lands', () => {
    render(<IngredientList mode="author" ariaLabel="Edit" rows={ingredientRows(pancakes, CATALOG, plan(1), 'total')} />);
    expect(screen.getByText('Almond flour')).toBeTruthy();
  });
});

describe('IngredientList (read) with scout markers', () => {
  const base = { note: null as string | null, amount: '' };
  const marked = [
    { ...base, key: 'a', name: 'Bacon', marker: { kind: 'out' as const } },
    { ...base, key: 'b', name: 'Eggs', amount: '2 eggs', marker: { kind: 'changed' as const, was: '3 eggs' } },
    { ...base, key: 'c', name: 'Jam', amount: '1 jar', marker: { kind: 'added' as const } },
    { ...base, key: 'd', name: 'Rye', amount: '8 slices', marker: { kind: 'swapped' as const, was: 'Bread' } }
  ];
  const shown = () => render(<IngredientList mode="read" ariaLabel="Marked" rows={marked} />);

  it('Leader_SeesLeftOut_OnADroppedIngredient', () => {
    shown();
    expect(within(row('Bacon')).getByText('Left out')).toBeTruthy();
  });

  it('Leader_SeesAdded_OnAnIngredientTheScoutAdded', () => {
    shown();
    expect(within(row('Jam')).getByText('Added')).toBeTruthy();
  });

  it('Leader_SeesTheTroopsAmountStruck_OnAChangedAmount', () => {
    shown();
    const was = within(row('Eggs')).getByText('3 eggs');
    expect(was.closest('s')).toBeTruthy();
    expect(row('Eggs').textContent).toContain('was 3 eggs');
  });

  it('Leader_SeesTheTroopsIngredientStruck_OnASwap', () => {
    shown();
    expect(within(row('Rye')).getByText('Bread').closest('s')).toBeTruthy();
  });

  it('Leader_SeesNoMarkers_OnAPlainRow', () => {
    render(list('total'));
    expect(screen.queryByText(/Added|Left out/)).toBeNull();
    expect(document.querySelector('s')).toBeNull();
  });
});


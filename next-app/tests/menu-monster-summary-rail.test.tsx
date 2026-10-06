import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu, MenuMeal } from '../src/lib/menu-monster/menus';
import { mealUnpricedItems, planProgress } from '../src/lib/menu-monster/menu-view';
import { SummaryRail, fixHref, type RailHrefs } from '../src/app/(public)/library/menu-monster/menus/_components/summary-rail';

const meal = (id: string, over: Partial<MenuMeal> = {}): MenuMeal => ({ id, day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {}, ...over });
const menu = (meals: MenuMeal[], over: Partial<Menu> = {}): Menu => ({
  name: 'Fall Camporee',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 2, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals,
  ...over
});

const HREFS: RailHrefs = { people: '/m/1/people', plan: '/m/1', gear: '/m/1/gear', shopping: '/m/1/shopping' };
// One empty meal (b) and one unpriced food (orange juice, B023 in the fixture).
const m = menu([meal('a', { recipeIds: ['B003', 'B023'] }), meal('b', { slot: 'lunch', recipeIds: [] })]);
const progress = () => planProgress(m, CATALOG);
const open = () => fireEvent.click(screen.getByRole('button', { name: /people/ }));

describe('SummaryRail', () => {
  it('Rail_ReadsHeadcountCostPerPersonAndThingsToFix_OnOneLine', () => {
    render(<SummaryRail progress={progress()} hrefs={HREFS} />);
    expect(screen.getByRole('button', { name: /people/ }).textContent).toMatch(/^8 people · \$\d+\.\d\d\/person\/meal · 2 to fix›$/);
  });

  it('Rail_LeavesOutCost_UntilAMealHasFood', () => {
    render(<SummaryRail progress={planProgress(menu([meal('a', { recipeIds: [] })]), CATALOG)} hrefs={HREFS} />);
    expect(screen.getByRole('button', { name: /people/ }).textContent).toBe('8 people · 1 to fix›');
  });

  it('Rail_SaysNothingToFix_WhenAllIsDone', () => {
    render(<SummaryRail progress={planProgress(menu([meal('a')]), CATALOG)} hrefs={HREFS} />);
    expect(screen.getByRole('button', { name: /people/ }).textContent).toContain('nothing to fix');
  });

  it('Rail_SaysUnsaved_OnlyWhenTheDraftDiffers', () => {
    const { unmount } = render(<SummaryRail progress={progress()} hrefs={HREFS} />);
    expect(screen.queryByText('unsaved')).toBeNull();
    unmount();
    render(<SummaryRail progress={progress()} hrefs={HREFS} unsaved />);
    expect(screen.getByText('unsaved')).toBeTruthy();
  });

  it('Rail_HoldsTheOnePrimaryAtItsRightEnd', () => {
    render(
      <SummaryRail progress={progress()} hrefs={HREFS}>
        <a href="/m/1/gear">Next: Gear ›</a>
      </SummaryRail>
    );
    expect(screen.getByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
  });

  it('Sheet_IsClosedUntilTheTextIsTapped_AndClosesAgain', () => {
    render(<SummaryRail progress={progress()} hrefs={HREFS} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(screen.getByRole('dialog', { name: 'This menu' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Sheet_ListsHeadcountDietsTotalAndBudget', () => {
    render(<SummaryRail progress={progress()} hrefs={HREFS} />);
    open();
    const facts = within(screen.getByRole('dialog')).getAllByRole('term').map((t) => t.textContent);
    expect(facts).toEqual(['People', 'Gluten-free', 'Total', 'Budget']);
    expect(within(screen.getByRole('dialog')).getByText('$4.00 a person, per meal')).toBeTruthy();
  });

  it('SummaryRail_ListsThingsToFix_AsLinks', () => {
    render(<SummaryRail progress={progress()} hrefs={HREFS} />);
    open();
    const dialog = screen.getByRole('dialog');
    const ing = mealUnpricedItems(m, m.meals[0], CATALOG).B023[0].id;
    expect(within(dialog).getByRole('link', { name: /^1 meal empty/ }).getAttribute('href')).toBe('/m/1#meal-b');
    expect(within(dialog).getByRole('link', { name: /^1 not priced/ }).getAttribute('href')).toBe(`/m/1/shopping?item=${ing}`);
  });

  it('WhosEatingFixes_LinkToThePeopleStep_NotTheMealsPage', () => {
    render(<SummaryRail progress={planProgress(menu([meal('a')], { name: ' ', headcount: 0 }), CATALOG)} hrefs={HREFS} />);
    open();
    const dialog = screen.getByRole('dialog');
    expect([within(dialog).getByRole('link', { name: /^Name the menu/ }).getAttribute('href'), within(dialog).getByRole('link', { name: /^Set how many are eating/ }).getAttribute('href')]).toEqual(['/m/1/people', '/m/1/people']);
  });

  it('AddAMealFix_LinksToTheMealsRoute_WithNoHashAnchor', () => {
    render(<SummaryRail progress={planProgress(menu([]), CATALOG)} hrefs={HREFS} />);
    open();
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: /^Add a meal/ }).getAttribute('href')).toBe('/m/1');
  });

  it('Sheet_SaysNothingToFix_WhenThereIsNone', () => {
    render(<SummaryRail progress={planProgress(menu([meal('a')]), CATALOG)} hrefs={HREFS} />);
    open();
    expect(within(screen.getByRole('dialog')).getByText('Nothing to fix.')).toBeTruthy();
  });

  it('Sheet_RowsAreText_WhereThereIsNoPageToLinkTo', () => {
    render(<SummaryRail progress={progress()} hrefs={{ people: null, plan: '', gear: null, shopping: null }} />);
    open();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: /^1 meal empty/ }).getAttribute('href')).toBe('#meal-b');
    expect(within(dialog).queryByRole('link', { name: /not priced/ })).toBeNull();
    expect(within(dialog).getByText('1 not priced')).toBeTruthy();
  });

  it('Sheet_ClosesWhenARowIsFollowed', () => {
    render(<SummaryRail progress={progress()} hrefs={HREFS} />);
    open();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /^1 meal empty/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('FixLink_ToThisPage_SetsTheHashInsteadOfRouting', () => {
    window.history.replaceState(null, '', '/m/1');
    render(<SummaryRail progress={progress()} hrefs={HREFS} />);
    open();
    const ev = fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /^1 meal empty/ }));
    expect(ev).toBe(false);
    expect(window.location.hash).toBe('#meal-b');
    window.history.replaceState(null, '', '/');
  });

  it('FixLink_ToAnotherPage_StaysAPlainLink', () => {
    window.history.replaceState(null, '', '/m/1');
    render(<SummaryRail progress={progress()} hrefs={HREFS} />);
    open();
    const ev = fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /^1 not priced/ }));
    expect(ev).toBe(true);
    expect(window.location.hash).toBe('');
    window.history.replaceState(null, '', '/');
  });

  it('FixHref_PointsEachStepAtItsRoute', () => {
    expect(fixHref({ step: 'eating' }, HREFS)).toBe('/m/1/people');
    expect(fixHref({ step: 'meals' }, HREFS)).toBe('/m/1');
    expect(fixHref({ step: 'meals', mealId: 'b' }, HREFS)).toBe('/m/1#meal-b');
    expect(fixHref({ step: 'gear' }, HREFS)).toBe('/m/1/gear');
    expect(fixHref({ step: 'shopping' }, HREFS)).toBe('/m/1/shopping');
  });
});

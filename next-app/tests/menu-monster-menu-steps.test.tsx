import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';

/**
 * The server pieces that replace MenuTabs (planner part b, 2026-10-06): the step strip's routes and ticks for a
 * saved menu, and the summary rail's next-step link. Server-only imports are stubbed; nothing here reads a database.
 */

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => null, requireVerifiedScoutIdentity: async () => ({}) }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => null }));
vi.mock('@/lib/household-scope', () => ({ resolveFamilyScope: async () => [] }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => ({}) }));
vi.mock('@/lib/menu-monster/menus-store', () => ({ loadMenuWith: async () => null, ownerCreditNamesWith: async () => new Map() }));
vi.mock('@/lib/identity-session', () => ({ isEpochCurrent: async () => true }));
vi.mock('@/lib/dates', () => ({ centralToday: () => '2026-10-12' }));

import { MenuRail, MenuSteps, stepConfig } from '../src/app/(public)/library/menu-monster/menus/_components/scout-menus';

const ID = 'menu-1';
const base = '/library/menu-monster/menus/menu-1';
const menu = (over: Partial<Menu> = {}): Menu => ({
  name: 'Fall Camporee',
  context: 'camp',
  calendarEntryId: null,
  startDate: '2026-10-09',
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 3,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} }],
  ...over
});
const steps = () => within(screen.getByRole('navigation', { name: 'Menu steps' })).getAllByRole('link');

describe('stepConfig', () => {
  it('Routes_AreTheSameOnesTheTabsHad', () => {
    expect(stepConfig(ID, 'owner', menu({ startDate: null }), 'plan', '2026-10-06')).toMatchObject({ people: `${base}/people`, plan: base, gear: `${base}/gear`, shopping: `${base}/shopping` });
  });

  it('WhatWeBought_JoinsOnlyAfterTheOutingsLastDay', () => {
    // 3 days from Oct 9 ends Oct 11.
    expect(stepConfig(ID, 'owner', menu(), 'plan', '2026-10-11').bought).toBeUndefined();
    expect(stepConfig(ID, 'owner', menu(), 'plan', '2026-10-12').bought).toBe(`${base}/bought`);
  });

  it('WhatWeBought_IsNeverLost_WhileYouAreOnIt', () => {
    expect(stepConfig(ID, 'owner', menu({ startDate: null }), 'bought', '2026-10-06').bought).toBe(`${base}/bought`);
  });

  it('WhatWeBought_Joins_OnceWereDoneShoppingIsTicked_EvenBeforeTheOutingEnds', () => {
    expect(stepConfig(ID, 'owner', menu(), 'plan', '2026-10-06', true).bought).toBe(`${base}/bought`);
    expect(stepConfig(ID, 'owner', menu(), 'plan', '2026-10-06', false).bought).toBeUndefined();
    expect(stepConfig(ID, 'shared', menu(), 'plan', '2026-10-06', true).bought).toBeUndefined();
  });

  // v1.208.0: the Receipt step shows to everyone who can open the menu, once the menu has a receipt.
  it('Receipt_JoinsOnlyWhenTheMenuHasOne_ForEveryone_AndIsNeverLostOnItsOwnPage', () => {
    expect(stepConfig(ID, 'owner', menu(), 'plan', '2026-10-06').receipt).toBeUndefined();
    expect(stepConfig(ID, 'owner', menu(), 'plan', '2026-10-06', false, true).receipt).toBe(`${base}/receipt`);
    expect(stepConfig(ID, 'shared', menu(), 'plan', '2026-10-06', false, true).receipt).toBe(`${base}/receipt`);
    expect(stepConfig(ID, 'parent', menu(), 'receipt', '2026-10-06').receipt).toBe(`${base}/receipt`);
  });

  it('Receipt_IsAStepInTheStrip_AfterWhatWeBought_WhenTheMenuHasOne', () => {
    const { unmount } = render(<MenuSteps menuId={ID} active="receipt" menu={menu()} catalog={CATALOG} hasReceipt />);
    expect(steps().map((a) => a.textContent?.replace(/✓|\(done\)/g, '').trim())).toEqual(['Who’s eating', 'Meals', 'Gear', 'Shopping', 'What we bought', 'Receipt', 'Share']);
    expect(screen.getByRole('link', { name: 'Receipt' }).getAttribute('aria-current')).toBe('step');
    unmount();
    render(<MenuSteps menuId={ID} active="plan" menu={menu()} catalog={CATALOG} />);
    expect(screen.queryByRole('link', { name: 'Receipt' })).toBeNull();
  });

  it('WhatWeBought_IsNeverShown_ToASharedViewer', () => {
    expect(stepConfig(ID, 'shared', menu(), 'plan', '2026-10-12').bought).toBeUndefined();
  });

  it('Share_IsAQuietAction_ForTheOwnerOnly', () => {
    expect([
      stepConfig(ID, 'owner', menu(), 'plan', '2026-10-06').share?.label,
      stepConfig(ID, 'admin', menu(), 'plan', '2026-10-06').share,
      stepConfig(ID, 'parent', menu(), 'plan', '2026-10-06').share,
      stepConfig(ID, 'shared', menu(), 'plan', '2026-10-06').share
    ]).toEqual(['Share', undefined, undefined, undefined]);
  });

  // Patrick, 2026-10-06: "Add Review as a 5th step ... only show it to those who are authorized."
  it('Review_IsALeadersFifthStep_AndNobodyElses', () => {
    expect([
      stepConfig(ID, 'admin', menu(), 'plan', '2026-10-06').review,
      stepConfig(ID, 'owner', menu(), 'plan', '2026-10-06').review,
      stepConfig(ID, 'parent', menu(), 'plan', '2026-10-06').review,
      stepConfig(ID, 'shared', menu(), 'plan', '2026-10-06').review
    ]).toEqual([`/library/menu-monster/menus/${ID}/review`, undefined, undefined, undefined]);
  });
});

describe('MenuSteps', () => {
  it('WhosEatingPage_MarksOnlyWhosEatingCurrent_OnItsOwnRoute', () => {
    render(<MenuSteps menuId={ID} active="people" menu={menu()} catalog={CATALOG} />);
    expect(steps().filter((a) => a.getAttribute('aria-current') === 'step').map((a) => a.textContent?.replace(/✓| \(done\)/g, ''))).toEqual(['Who’s eating']);
    expect(steps().slice(0, 2).map((a) => a.getAttribute('href'))).toEqual([`${base}/people`, base]);
  });

  it('MealsPage_MarksOnlyMealsCurrent', () => {
    render(<MenuSteps menuId={ID} active="plan" menu={menu()} catalog={CATALOG} />);
    expect(steps().filter((a) => a.getAttribute('aria-current') === 'step').map((a) => a.textContent?.replace(/✓| \(done\)/g, ''))).toEqual(['Meals']);
  });

  it('Strip_ReplacesTheTabs_OnEveryPage', () => {
    render(<MenuSteps menuId={ID} active="gear" menu={menu()} catalog={CATALOG} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(steps().map((a) => a.textContent?.replace(/✓| \(done\)/g, ''))).toEqual(['Who’s eating', 'Meals', 'Gear', 'Shopping', 'What we bought', 'Share']);
  });

  it('Strip_MarksTheCurrentStep', () => {
    render(<MenuSteps menuId={ID} active="gear" menu={menu()} catalog={CATALOG} />);
    expect(steps().filter((a) => a.getAttribute('aria-current') === 'step').map((a) => a.textContent)).toEqual(['✓Gear (done)']);
  });

  it('Conversions_BelongsToTheShoppingStep', () => {
    render(<MenuSteps menuId={ID} active="conversions" menu={menu()} catalog={CATALOG} />);
    expect(steps().filter((a) => a.getAttribute('aria-current') === 'step').map((a) => a.textContent?.replace(/✓| \(done\)/g, ''))).toEqual(['Shopping']);
  });

  it('Strip_TicksFromTheSavedMenu_AnEmptyMealIsNotDone', () => {
    render(<MenuSteps menuId={ID} active="shopping" menu={menu({ meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: [], recipeEdits: {} }] })} catalog={CATALOG} />);
    expect(steps().map((a) => a.textContent)).toContain('Meals');
  });

  it('ShoppingTick_IsDone_WhenNothingIsLeftToPrice', () => {
    render(<MenuSteps menuId={ID} active="plan" menu={menu()} catalog={CATALOG} />);
    expect(steps().map((a) => a.textContent)).toContain('✓Shopping (done)');
  });

  it('ShoppingTick_IsAbsent_WhenAFoodHasNoPrice', () => {
    const meals = [{ id: 'm1', day: 0, slot: 'breakfast' as const, headcount: null, recipeIds: ['B003', 'B014', 'B023'], recipeEdits: {} }];
    render(<MenuSteps menuId={ID} active="plan" menu={menu({ meals })} catalog={CATALOG} />);
    expect(steps().map((a) => a.textContent)).toContain('Shopping');
  });

  it('ReadOnlyViewer_GetsTheSameStrip_WithoutShare', () => {
    render(<MenuSteps menuId={ID} active="plan" access="parent" menu={menu()} catalog={CATALOG} />);
    expect(steps().map((a) => a.textContent?.replace(/✓| \(done\)/g, ''))).toEqual(['Who’s eating', 'Meals', 'Gear', 'Shopping', 'What we bought']);
  });

  it('Bought_AppearsAsAFifthStep_OnceTheDateHasPassed', () => {
    render(<MenuSteps menuId={ID} active="plan" menu={menu()} catalog={CATALOG} />);
    expect(steps().map((a) => a.textContent?.replace(/✓| \(done\)/g, ''))).toContain('What we bought');
  });
});

describe('MenuRail', () => {
  it('WhosEating_EndsInNextMeals', () => {
    render(<MenuRail menuId={ID} active="people" menu={menu()} catalog={CATALOG} />);
    expect(screen.getByRole('link', { name: 'Next: Meals ›' }).getAttribute('href')).toBe(base);
  });

  it('Rail_ShowsTheSavedMenusHeadcountAndCost', () => {
    render(<MenuRail menuId={ID} active="gear" menu={menu()} catalog={CATALOG} />);
    expect(screen.getByRole('region', { name: 'Menu summary' }).textContent).toMatch(/^8 people · \$\d+\.\d\d\/person\/meal · nothing to fix›/);
  });

  it('Gear_EndsInNextShopping', () => {
    render(<MenuRail menuId={ID} active="gear" menu={menu()} catalog={CATALOG} />);
    expect(screen.getByRole('link', { name: 'Next: Shopping ›' }).getAttribute('href')).toBe(`${base}/shopping`);
  });

  it('Shopping_HasNoNext_ForTheOwner_BecauseShareLivesOnTheFinishingLine', () => {
    render(<MenuRail menuId={ID} active="shopping" menu={menu()} catalog={CATALOG} />);
    expect(screen.queryByRole('link', { name: /^Next:/ })).toBeNull();
  });

  it('Shopping_EndsInNextReview_ForALeader_AtTheReviewStep', () => {
    render(<MenuRail menuId={ID} active="shopping" access="admin" menu={menu()} catalog={CATALOG} />);
    expect(screen.getByRole('link', { name: 'Next: Review ›' }).getAttribute('href')).toBe(`${base}/review`);
  });

  it('Shopping_HasNoNext_ForAReadOnlyViewer', () => {
    render(<MenuRail menuId={ID} active="shopping" access="parent" menu={menu()} catalog={CATALOG} />);
    expect(screen.queryByRole('link', { name: /^Next:/ })).toBeNull();
  });

  it('Bought_HasNoNext', () => {
    render(<MenuRail menuId={ID} active="bought" menu={menu()} catalog={CATALOG} />);
    expect(screen.queryByRole('link', { name: /^Next:/ })).toBeNull();
  });
});

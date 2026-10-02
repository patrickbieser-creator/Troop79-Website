import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuMonsterPlanner, PLAN_STORAGE_KEY } from '../src/app/(public)/library/_tools/menu-monster/planner';
import { seedPlan } from '../src/lib/menu-monster/engine';
import type { Plan } from '../src/lib/menu-monster/types';
import { CATALOG } from './helpers/menu-monster-fixture';

/**
 * Scout Workspace slice 4: the planner run CONTROLLED, as one meal of a saved
 * menu. The menu owns people, diets, budget and the slot, so those controls
 * and the browser-draft plumbing are gone; the anonymous planner is covered by
 * menu-monster-planner.test.tsx and must not change.
 */

const plan = (over: Partial<Plan> = {}): Plan => ({ ...seedPlan(CATALOG), meal: 'breakfast', headcount: 10, recipeIds: ['B001'], ...over });

describe('MenuMonsterPlanner (controlled)', () => {
  beforeEach(() => window.localStorage.clear());

  it('Controlled_RendersTheGivenPlan', () => {
    render(<MenuMonsterPlanner catalog={CATALOG} plan={plan()} onPlanChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Pancakes' })).toHaveProperty('checked', true);
  });

  it('Controlled_CallsOnPlanChange_WhenAnItemIsTicked', async () => {
    const onPlanChange = vi.fn();
    render(<MenuMonsterPlanner catalog={CATALOG} plan={plan()} onPlanChange={onPlanChange} />);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Bacon' }));
    expect(onPlanChange.mock.calls[0][0].recipeIds).toEqual(['B001', 'B003']);
  });

  it('Controlled_DoesNotWriteTheBrowserDraft', async () => {
    render(<MenuMonsterPlanner catalog={CATALOG} plan={plan()} onPlanChange={() => {}} />);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Bacon' }));
    expect(window.localStorage.getItem(PLAN_STORAGE_KEY)).toBeNull();
  });

  it('Controlled_DoesNotReadTheBrowserDraft', () => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ ...plan(), recipeIds: ['B003'] }));
    render(<MenuMonsterPlanner catalog={CATALOG} plan={plan()} onPlanChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Bacon' })).toHaveProperty('checked', false);
  });

  it('Controlled_HidesTheStartOverButton', () => {
    render(<MenuMonsterPlanner catalog={CATALOG} plan={plan()} onPlanChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /Start over/ })).toBeNull();
  });

  it('Controlled_HidesThePeopleControlsTheMenuOwns', () => {
    render(<MenuMonsterPlanner catalog={CATALOG} plan={plan()} onPlanChange={() => {}} />);
    expect(screen.queryByRole('spinbutton', { name: /People eating/ })).toBeNull();
  });

  it('Controlled_HidesTheMealChips_BecauseTheSlotIsFixed', () => {
    render(<MenuMonsterPlanner catalog={CATALOG} plan={plan()} onPlanChange={() => {}} />);
    expect(screen.queryByRole('radio', { name: 'Lunch' })).toBeNull();
  });

  it('Controlled_ShowsTheMealsOwnSlotItems', () => {
    render(<MenuMonsterPlanner catalog={CATALOG} plan={plan({ meal: 'lunch', recipeIds: [] })} onPlanChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Sandwiches' })).toBeTruthy();
  });

  it('Anonymous_StillWritesTheBrowserDraft', async () => {
    render(<MenuMonsterPlanner catalog={CATALOG} />);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Bacon' }));
    expect(JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY) ?? 'null')?.recipeIds).toEqual(['B003']);
  });
});

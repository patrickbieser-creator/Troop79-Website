'use client';

/**
 * The meal drill-in (Plans/Menu-Monster-Scout-Workspace.md, Phase 1; prototype
 * concept-e-scout-workspace/meal.html). One meal of a saved menu runs through
 * the anonymous planner in CONTROLLED mode — same item picker, package choices
 * and shopping list, but the menu owns the people, diets, budget and slot.
 *
 * Save model: an explicit, dirty-gated Save + Discard changes on this page's
 * title line (the public save-button standard), not save-on-leave. Save writes
 * this meal back into menu.meals[i] through saveMenuAction with the version
 * token; every other meal and menu field is sent back exactly as loaded. A
 * meal may override the menu's People; "Reset to N" clears the override.
 */

import { useState } from 'react';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { Stepper } from '@/app/_components/stepper';
import type { Catalog, Plan } from '@/lib/menu-monster/types';
import { MEALS, RESTRICTIONS } from '@/lib/menu-monster/units';
import { MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import { composePlan, type Menu, type MenuMeal } from '@/lib/menu-monster/menus';
import { dayLabel } from '@/lib/menu-monster/menu-view';
import { MenuMonsterPlanner } from '../../../_tools/menu-monster/planner';
import { saveMenuAction } from '../../../_tools/menu-monster/menu-actions';
import { SaveBar } from './save-bar';
import s from './workspace.module.css';

/** The planner's edits folded back onto the stored meal; People equal to the menu's is "no override". */
function mealFromPlan(meal: MenuMeal, plan: Plan, menuHeadcount: number): MenuMeal {
  return {
    ...meal,
    headcount: plan.headcount === menuHeadcount ? null : plan.headcount,
    recipeIds: plan.recipeIds,
    packageChoice: plan.packageChoice,
    qtyOverride: plan.qtyOverride,
    lineSource: plan.lineSource
  };
}

export function MealEditor({
  catalog,
  menuId,
  menu,
  mealId,
  updatedAt
}: {
  catalog: Catalog;
  menuId: string;
  menu: Menu;
  mealId: string;
  updatedAt: string;
}) {
  const meal = menu.meals.find((m) => m.id === mealId);
  const [plan, setPlan] = useState<Plan>(() => composePlan(menu, meal as MenuMeal));
  const [saved, setSaved] = useState<{ plan: Plan; key: string }>(() => {
    const p = composePlan(menu, meal as MenuMeal);
    return { plan: p, key: JSON.stringify(p) };
  });
  const [version, setVersion] = useState(updatedAt);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(plan) !== saved.key;

  // Reloads, tab closes and in-app links ask before dropping unsaved picks.
  useLeaveGuard(dirty);

  if (!meal) return null;
  const slot = MEALS.find((m) => m.key === meal.slot)?.label ?? meal.slot;
  const overridden = plan.headcount !== menu.headcount;
  const diets = RESTRICTIONS.filter((r) => (menu.restrictions[r.key] || 0) > 0);

  const change = (next: Plan) => {
    setPlan(next);
    setJustSaved(false);
    setError(null);
  };
  const setPeople = (n: number) => change({ ...plan, headcount: Math.min(MAX_HEADCOUNT, Math.max(MIN_HEADCOUNT, Math.round(n) || MIN_HEADCOUNT)) });

  async function save() {
    setSaving(true);
    setError(null);
    const sent = plan;
    const next: Menu = { ...menu, meals: menu.meals.map((m) => (m.id === mealId ? mealFromPlan(m, sent, menu.headcount) : m)) };
    let res: Awaited<ReturnType<typeof saveMenuAction>>;
    try {
      res = await saveMenuAction(menuId, next, version);
    } catch {
      res = { ok: false, error: 'Something went wrong saving your meal. Try again.' };
    }
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved({ plan: sent, key: JSON.stringify(sent) });
    setVersion(res.updatedAt);
    setJustSaved(true);
  }

  return (
    <div>
      <div className={s.titleLine}>
        <h1 className={s.menuTitle}>
          {slot} <span className={s.muted}>· {dayLabel(menu.startDate, meal.day)}</span>
        </h1>
        <SaveBar
          isNew={false}
          dirty={dirty}
          saving={saving}
          saved={justSaved}
          onSave={() => void save()}
          onDiscard={() => {
            setPlan(saved.plan);
            setError(null);
          }}
        />
      </div>

      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}

      <div className={s.mealBar}>
        <div className={s.line}>
          <Stepper
            id="mm-meal-people"
            label="People"
            value={plan.headcount}
            min={MIN_HEADCOUNT}
            max={MAX_HEADCOUNT}
            onChange={setPeople}
            groupLabel="People for this meal"
            lessLabel="One fewer person"
            moreLabel="One more person"
          />
          {overridden && (
            <Button variant="ghost" onClick={() => setPeople(menu.headcount)}>
              Reset to {menu.headcount}
            </Button>
          )}
          {diets.length > 0 && (
            <span className={s.muted}>· {diets.map((r) => `${r.label}: ${menu.restrictions[r.key]}`).join(' · ')} (from the menu)</span>
          )}
        </div>
      </div>

      <MenuMonsterPlanner catalog={catalog} plan={plan} onPlanChange={change} />
    </div>
  );
}

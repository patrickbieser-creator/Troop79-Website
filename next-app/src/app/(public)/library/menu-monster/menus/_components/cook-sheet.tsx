/**
 * The cook sheet (Patrick, 2026-10-08: "Print out the meal plan for an event including the meals, gear, recipe
 * steps, etc. Reasonably compact. Fewer pages — multiple columns."): ONE menu on paper — every day and meal, each
 * food's ingredients by name, its steps, the meal's gear on one line and its diet notes. The big picture only
 * (Patrick, later the same day): no quantities and no brands — the shopping list carries those — and no prices; a
 * single food (Chips, Hot Chocolate) is just its name, never "Chips: Chips". A meal's steps print at its end, after
 * its foods and gear, each group naming its food (2026-10-09); a food's steps print the first time it appears and
 * later meals point back to it. Pure and server-safe: the page wraps it, the browser's Print button prints it.
 */
import type { ReactNode } from 'react';
import type { Catalog, MealSlot, Recipe, RestrictionKey } from '@/lib/menu-monster/types';
import { effectiveRestrictions, restrictionWarnings } from '@/lib/menu-monster/engine';
import { menuEditRows, scopeLabel, type IngredientRow } from '@/lib/menu-monster/ingredient-rows';
import { addDays, composePlan, mealCatalog, type Menu, type MenuMeal } from '@/lib/menu-monster/menus';
import { DIET_ORDER, dayLabel } from '@/lib/menu-monster/menu-view';
import { stepsFromText } from '@/lib/menu-monster/scout-recipes';
import { gearText, mealGearEntries } from '@/lib/menu-monster/gear';
import { MEALS, RESTRICTION_BY_KEY } from '@/lib/menu-monster/units';
import { fmtDay } from '@/lib/format-date';
import s from './cook-sheet.module.css';

const slotLabel = (slot: MealSlot) => MEALS.find((m) => m.key === slot)?.label ?? slot;
const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();
const dietName = (k: RestrictionKey) => RESTRICTION_BY_KEY[k].label.toLowerCase();
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const dietCounts = (counts: Record<RestrictionKey, number>, joiner: string) =>
  DIET_ORDER.filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${dietName(k)}`)
    .join(joiner);

/** 'Fri, Oct 9 – Sun, Oct 11', one day alone, or 'N days' without a first date. */
function datesText(menu: Menu): string {
  if (!menu.startDate) return `${menu.dayCount} ${menu.dayCount === 1 ? 'day' : 'days'}`;
  return menu.dayCount > 1 ? `${fmtDay(menu.startDate)} – ${fmtDay(addDays(menu.startDate, menu.dayCount - 1))}` : fmtDay(menu.startDate);
}

/** The quiet words after an ingredient's name: its diet rule, then what this menu did to it. */
function rowNotes(row: IngredientRow): string[] {
  const out: string[] = [];
  // "everyone else" is the troop's default line: on paper it says nothing (Patrick, 2026-10-09). Diet notes stay.
  const note = row.note?.replace(/^everyone else( · )?/, '');
  if (note) out.push(note);
  if (row.scope) out.push(scopeLabel(row.scope));
  const m = row.marker;
  if (m?.kind === 'out') out.push('left out');
  else if (m?.kind === 'swapped') out.push(m.was ? `instead of ${m.was}` : 'swapped');
  else if (m?.kind === 'added') out.push('added');
  else if (m?.kind === 'changed' && m.was) out.push(`was ${m.was}`);
  return out;
}

export function CookSheet({ menu, catalog, plannedBy }: { menu: Menu; catalog: Catalog; plannedBy: string | null }) {
  const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
  const patrol = (menu.patrol ?? '').trim();
  const meta = [patrol, plannedBy ? `Planned by ${plannedBy}` : '', datesText(menu), people(menu.headcount), dietCounts(menu.restrictions, ' · ')].filter(Boolean);

  const order = new Map(MEALS.map((m, i) => [m.key, i]));
  const meals = [...menu.meals].sort((a, b) => a.day - b.day || (order.get(a.slot) ?? 0) - (order.get(b.slot) ?? 0));
  const days = [...new Set(meals.map((m) => m.day))];
  /** Where each recipe's steps printed in full, so a repeat can point back. */
  const stepsAt = new Map<string, string>();

  function food(meal: MenuMeal, rid: string, recipe: Recipe | undefined, plan: ReturnType<typeof composePlan>): ReactNode {
    if (!recipe) {
      return (
        <section key={rid} className={s.food}>
          <h4 className={s.foodName}>A recipe that isn’t available</h4>
        </section>
      );
    }
    const ops = meal.recipeEdits?.[rid] ?? [];
    // A single food is its own one ingredient: the name says it all (Patrick: "Chips … repeated twice"). Judged on
    // what would print, not on the authoring shape — a one-line food with a diet variant still lists both lines.
    const rows = menuEditRows(recipe, ops, catalog, plan, 'total');
    const single = rows.length === 1 && sameName(rows[0].name, recipe.name);
    return (
      <section key={rid} className={s.food}>
        <h4 className={s.foodName}>
          {recipe.name}
          {ops.length > 0 && <em className={s.note}> · this menu’s version</em>}
        </h4>
        {!single &&
          (rows.length === 0 ? (
            <p className={s.none}>No ingredients listed.</p>
          ) : (
            <ul className={s.ingredients} aria-label={`${recipe.name} ingredients`}>
              {rows.map((row) => {
                const notes = rowNotes(row);
                return (
                  <li key={row.key} className={row.marker?.kind === 'out' ? s.out : undefined}>
                    {row.name}
                    {notes.length > 0 && <em className={s.note}> · {notes.join(' · ')}</em>}
                  </li>
                );
              })}
            </ul>
          ))}
      </section>
    );
  }

  /** A meal's steps, after its foods and gear (Patrick, 2026-10-09: the big picture first): each group names its
   *  food; a food whose steps already printed points back. */
  function mealSteps(meal: MenuMeal): ReactNode {
    const groups = meal.recipeIds.flatMap((rid) => {
      const recipe = byId.get(rid);
      const steps = recipe ? stepsFromText(recipe.stepsMd) : [];
      if (!recipe || steps.length === 0) return [];
      const where = stepsAt.get(rid);
      if (!where) stepsAt.set(rid, `${dayLabel(menu.startDate, meal.day)} · ${slotLabel(meal.slot)}`);
      return [{ rid, recipe, steps, where }];
    });
    if (groups.length === 0) return null;
    return (
      <section className={s.stepsBlock}>
        <h4 className={s.stepsHead}>Steps</h4>
        {groups.map(({ rid, recipe, steps, where }) =>
          where ? (
            <p key={rid} className={s.stepsRef}>
              {recipe.name}: see {where}
            </p>
          ) : (
            <div key={rid} className={s.stepsGroup}>
              <p className={s.stepsFor} data-cook-steps-for>
                {recipe.name}
              </p>
              <ol className={s.steps} aria-label={`How to make ${recipe.name}`}>
                {steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          )
        )}
      </section>
    );
  }

  function mealBlock(meal: MenuMeal): ReactNode {
    const plan = composePlan(menu, meal);
    const diets = dietCounts(effectiveRestrictions(plan), ', ');
    const warnings = restrictionWarnings(plan, mealCatalog(catalog, meal));
    const gear = mealGearEntries(meal, catalog);
    // The header already says how many people: a meal repeats it only when its own count differs.
    const ownCount = meal.headcount != null && meal.headcount !== menu.headcount;
    return (
      <div key={meal.id} className={s.meal}>
        <h3 className={s.mealName}>
          {slotLabel(meal.slot)}
          {ownCount && <span className={s.people}> · {people(plan.headcount)}</span>}
        </h3>
        {diets && <p className={s.diets}>Diets: {diets}</p>}
        {warnings.map((w) => (
          <p key={`${w.recipe.id}:${w.restriction.key}`} className={s.warn}>
            ⚠ {w.count} {dietName(w.restriction.key)}: {w.recipe.name} {w.ingredients.length > 0 ? `has ${w.ingredients.join(', ')}` : 'is not suitable'}
          </p>
        ))}
        {meal.recipeIds.map((rid) => food(meal, rid, byId.get(rid), plan))}
        {gear.length > 0 && (
          <p className={s.gear} data-cook-gear>
            Gear: {gear.map((g) => gearText(g.name, g.count)).join(' · ')}
          </p>
        )}
        {mealSteps(meal)}
      </div>
    );
  }

  return (
    <article className={s.sheet}>
      <header>
        <h1 className={s.title}>{menu.name.trim() || 'Untitled menu'}</h1>
        <p className={s.meta} data-cook-meta>
          {meta.join(' · ')}
        </p>
      </header>
      {days.map((day) => (
        <section key={day} className={s.day}>
          <h2 className={s.dayName}>{dayLabel(menu.startDate, day)}</h2>
          <div className={s.meals}>{meals.filter((m) => m.day === day).map(mealBlock)}</div>
        </section>
      ))}
    </article>
  );
}

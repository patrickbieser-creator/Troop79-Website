'use client';

/**
 * Menu Monster leader tools — the two kinds of row the Food & recipes list carries besides menu items
 * (Patrick, 2026-10-06, after "hot chocolate" and "hot cocoa" could not be found here):
 *
 *  - IngredientListRow: a Price book food with no menu item of its own, always listed, with one quiet
 *    "Put it on the menu by itself" that opens the same two questions the Price book asks (how much each person
 *    gets, which meals) and calls the same action.
 *  - ScoutFoodListRow: a scout's own new single food (typed in at the meal planner), shown only when searched for,
 *    with "Keep for the troop": the ingredient joins the Price book and the troop gets its own item for it.
 *
 * Neither opens an editor. They report what happened in words through `onDone`; the list refreshes behind it.
 */
import { useState, useTransition } from 'react';
import { Button } from '../../../_components/button';
import { FormPanel } from '../../../_components/form-panel';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { fmtDate } from '@/lib/format-date';
import { MEALS, fracText } from '@/lib/menu-monster/units';
import type { IngredientRow } from '@/lib/menu-monster/food-list';
import type { ScoutFood } from '@/lib/menu-monster/scout-recipes-store';
import type { MealSlot } from '@/lib/menu-monster/types';
import { keepScoutFood, putFoodOnMenu } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

const toggle = (list: MealSlot[], key: MealSlot, on: boolean): MealSlot[] => (on ? (list.includes(key) ? list : [...list, key]) : list.filter((k) => k !== key));

/** `colSpan` is the table's column count, for the form row under an ingredient. */
export function IngredientListRow({ row, colSpan, onDone }: { row: IngredientRow; colSpan: number; onDone: (note: string) => void }) {
  const { ingredient: ing } = row;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('1');
  const [meals, setMeals] = useState<MealSlot[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = `mm-list-onmenu-${ing.id}`;

  function submit() {
    setProblem(null);
    // A form that cannot save yet says why in place; the server checks the amount itself.
    if (meals.length === 0) {
      setProblem('Pick at least one meal it fits.');
      return;
    }
    start(async () => {
      const res = await putFoodOnMenu(ing.id, { amount: amount.trim(), mealFit: meals, foodGroups: [] });
      if (!res.ok) {
        setProblem(res.error ?? 'Something went wrong.');
        return;
      }
      setOpen(false);
      onDone(`Put “${ing.name}” on the menu by itself.${res.note ? ` ${res.note}` : ''}`);
    });
  }

  return (
    <>
      <tr>
        <td>
          {ing.name}
          <div>
            <Button variant="quiet" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              Put it on the menu by itself
            </Button>
          </div>
        </td>
        <td>Ingredient</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td className={styles.numCell}>—</td>
        <td>
          <span className={styles.muted}>In the Price book</span>
        </td>
      </tr>
      {open && (
        <tr className={styles.detailRow}>
          <td colSpan={colSpan}>
            <FormPanel aria-label={`Put ${ing.name} on the menu`}>
              <div className={lib.fieldGrid}>
                <div>
                  <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${id}-amount`}>
                    Each person gets
                  </label>
                  <div className={styles.inlineForm}>
                    <input id={`${id}-amount`} className={`${lib.textInput} ${styles.narrow}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <span className={styles.cardMeta}>{ing.unit.many}</span>
                  </div>
                </div>
                <fieldset className={styles.fieldset}>
                  <legend className={`adminLabel ${lib.fieldLabel}`}>Meal fit</legend>
                  {MEALS.map((m) => (
                    <label key={m.key} className={styles.listRow}>
                      <input type="checkbox" checked={meals.includes(m.key)} onChange={(e) => setMeals((d) => toggle(d, m.key, e.target.checked))} /> {m.label}
                    </label>
                  ))}
                </fieldset>
              </div>
              {problem && <Notice>{problem}</Notice>}
              <div className={lib.actionsRow}>
                <Button variant="secondary" disabled={pending} onClick={submit}>
                  {pending ? 'Saving…' : 'Put it on the menu'}
                </Button>
                <Button variant="quiet" disabled={pending} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </FormPanel>
          </td>
        </tr>
      )}
    </>
  );
}

export function ScoutFoodListRow({ food, onDone }: { food: ScoutFood; onDone: (note: string) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const meals = MEALS.filter((m) => food.mealFit.includes(m.key)).map((m) => m.label).join(', ');

  function keep() {
    setProblem(null);
    start(async () => {
      const res = await keepScoutFood(food.id);
      if (!res.ok) {
        setProblem(res.error ?? 'Something went wrong.');
        return;
      }
      onDone(res.note ?? `Kept “${food.name}” for the troop.`);
    });
  }

  return (
    <tr>
      <td>
        {food.name}
        <div>
          <Button variant="quiet" size="sm" disabled={pending} onClick={keep}>
            Keep for the troop
          </Button>
        </div>
        <p className={styles.hint}>
          {food.owner} · {fmtDate(food.createdAt)}
        </p>
        {problem && <Notice>{problem}</Notice>}
      </td>
      <td>Food</td>
      <td>{meals || '—'}</td>
      <td>{`${fracText(food.amount)} ${food.amount === 1 ? food.unit.one : food.unit.many}`}</td>
      <td>—</td>
      <td className={styles.numCell}>—</td>
      <td>
        <Badge variant="warning">Scout’s — waiting for a leader</Badge>
      </td>
    </tr>
  );
}

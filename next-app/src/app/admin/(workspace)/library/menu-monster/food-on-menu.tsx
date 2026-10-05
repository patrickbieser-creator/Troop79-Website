'use client';

/**
 * Menu Monster leader tools — "On the menu by itself", on a food in the Price book
 * (Plans/Menu-Monster-Single-Food-Entry.md, release 2).
 *
 * A single food used to need two entries: the food here, and a one-line menu item made on the Food & recipes
 * tab. They are tied now (mm_recipes.food_ingredient_id), so this is the one place a leader says whether the
 * food can be picked for a meal on its own — cookies and apples, yes; salt and flour, no — how many each
 * person gets, and which meals it fits. Steps, gear and diet answers stay in the short form one link away.
 *
 * Off by default (Patrick, 2026-10-05). Taking it off the menu retires the menu item: saved menus that use
 * it keep it, and putting it back restores the same one.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '../../../_components/button';
import { FormPanel } from '../../../_components/form-panel';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { SaveButton } from '../../_components/save-state';
import { FOOD_GROUPS, MEALS, fracText, parseQty } from '@/lib/menu-monster/units';
import type { Catalog, FoodGroup, Ingredient, MealSlot } from '@/lib/menu-monster/types';
import { putFoodOnMenu, takeFoodOffMenu } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

const toggle = <T,>(list: T[], key: T, on: boolean): T[] => (on ? (list.includes(key) ? list : [...list, key]) : list.filter((k) => k !== key));

export function FoodOnMenu({ ing, catalog, onChanged }: { ing: Ingredient; catalog: Catalog; onChanged: () => void }) {
  const item = catalog.recipes.find((r) => r.foodIngredientId === ing.id) ?? null;
  const on = item != null && item.status !== 'retired';
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const saved = {
    amount: item?.lines[0] ? fracText(item.lines[0].qtyPerPerson) : '1',
    mealFit: item?.mealFit ?? ([] as MealSlot[]),
    foodGroups: item?.foodGroups ?? ([] as FoodGroup[])
  };
  const [draft, setDraft] = useState(saved);
  const amountOk = parseQty(draft.amount) > 0;
  const ready = amountOk && draft.mealFit.length > 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  function run(fn: () => Promise<{ ok: boolean; error?: string; note?: string }>, after?: () => void) {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      setNote(res.note ?? null);
      after?.();
      onChanged();
    });
  }

  const each = on && item?.lines[0] ? `${fracText(item.lines[0].qtyPerPerson)} ${item.lines[0].qtyPerPerson === 1 ? ing.unit.one : ing.unit.many} each` : null;
  const meals = on && item ? MEALS.filter((m) => item.mealFit.includes(m.key)).map((m) => m.label).join(', ') : '';
  const idp = `mm-onmenu-${ing.id}`;

  return (
    <section aria-label={`${ing.name} on the menu by itself`} className={styles.brands}>
      <div className={styles.detailHead}>
        <h3 className={styles.cardName}>On the menu by itself</h3>
        {on && item ? (
          <>
            <span className={styles.cardMeta}>{[each, meals].filter(Boolean).join(' · ')}</span>
            <Badge variant={item.status === 'published' ? 'success' : 'warning'}>{item.status === 'published' ? 'Published' : 'Draft'}</Badge>
          </>
        ) : (
          <span className={styles.cardMeta}>No. It is only an ingredient in recipes.</span>
        )}
        <span className={styles.spacer} />
        {!editing && (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => {
              setDraft(saved);
              setEditing(true);
            }}
          >
            {on ? 'Edit' : 'Put it on the menu'}
          </Button>
        )}
        {on && !editing && (
          <Button variant="quiet" size="sm" disabled={pending} onClick={() => run(() => takeFoodOffMenu(ing.id))}>
            Take it off the menu
          </Button>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {note && <Notice variant="success">{note}</Notice>}
      {on && item && !editing && (
        <p className={styles.hint}>
          <Link href={`/admin/library/menu-monster?tab=recipes&recipe=${encodeURIComponent(item.id)}`}>Steps, gear and diets for {ing.name.toLowerCase()} →</Link>
        </p>
      )}

      {editing && (
        <FormPanel aria-label={`Put ${ing.name} on the menu`}>
          <div className={lib.fieldGrid}>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-amount`}>
                Each person gets
              </label>
              <div className={styles.inlineForm}>
                <input id={`${idp}-amount`} className={`${lib.textInput} ${styles.narrow}`} value={draft.amount} placeholder="2" onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} />
                <span className={styles.cardMeta}>{ing.unit.many}</span>
              </div>
            </div>
            <fieldset className={styles.fieldset}>
              <legend className={`adminLabel ${lib.fieldLabel}`}>Meal fit</legend>
              {MEALS.map((m) => (
                <label key={m.key} className={styles.listRow}>
                  <input type="checkbox" checked={draft.mealFit.includes(m.key)} onChange={(e) => setDraft((d) => ({ ...d, mealFit: toggle(d.mealFit, m.key, e.target.checked) }))} /> {m.label}
                </label>
              ))}
            </fieldset>
            <fieldset className={styles.fieldset}>
              <legend className={`adminLabel ${lib.fieldLabel}`}>Food groups (MyPlate)</legend>
              {FOOD_GROUPS.map((g) => (
                <label key={g.key} className={styles.listRow}>
                  <input type="checkbox" checked={draft.foodGroups.includes(g.key)} onChange={(e) => setDraft((d) => ({ ...d, foodGroups: toggle(d.foodGroups, g.key, e.target.checked) }))} /> {g.label}
                </label>
              ))}
            </fieldset>
          </div>
          <div className={lib.actionsRow}>
            {on ? (
              <SaveButton dirty={dirty} pending={pending} blocked={!ready} blockedReason={amountOk ? 'Pick at least one meal' : 'Type how many each person gets'} onClick={() => run(() => putFoodOnMenu(ing.id, draft), () => setEditing(false))} />
            ) : (
              <Button variant="primary" disabled={pending || !ready} title={ready ? undefined : amountOk ? 'Pick at least one meal' : 'Type how many each person gets'} onClick={() => run(() => putFoodOnMenu(ing.id, draft), () => setEditing(false))}>
                {pending ? 'Saving…' : 'Put it on the menu'}
              </Button>
            )}
            <Button variant="secondary" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </FormPanel>
      )}
    </section>
  );
}

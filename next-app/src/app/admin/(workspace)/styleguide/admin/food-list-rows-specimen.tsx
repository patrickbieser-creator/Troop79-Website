'use client';

/**
 * Food & recipes list, the row kinds beside a plain menu item (v1.190.0), rendered from the LIVE
 * list-extra-rows components inside the list's own table classes. Display-only: the actions run the
 * real server actions if clicked, so the demo handlers are no-ops and the specimen ids match nothing.
 */
import { Badge } from '../../_components/badge';
import { IngredientListRow, ScoutFoodListRow } from '../../library/menu-monster/list-extra-rows';
import styles from '../../library/menu-monster/menu-monster.module.css';
import type { ScoutFood } from '@/lib/menu-monster/scout-recipes-store';
import type { Ingredient } from '@/lib/menu-monster/types';

const INGREDIENT: Ingredient = {
  id: 'sg-hot-cocoa',
  name: 'Hot cocoa mix',
  unit: { key: 'cup', one: 'cup', many: 'cups', kind: 'volume' },
  section: 'dry',
  staple: false,
  avoid: []
};

const SCOUT_FOOD: ScoutFood = {
  id: 'sg-scout-food',
  name: 'Hot chocolate',
  status: 'draft',
  owner: 'Sam K.',
  createdAt: '2026-10-05',
  mealFit: ['breakfast'],
  amount: 1,
  ingredientId: 'sg-hot-chocolate',
  ingredientName: 'Hot chocolate',
  section: 'beverage',
  avoid: [],
  unit: { key: 'cup', one: 'cup', many: 'cups', kind: 'volume' },
  pkg: null
};

export function FoodListRowsSpecimen() {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label="Food and recipes row kinds (specimen)">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Meals</th>
            <th>Each person gets</th>
            <th>Variations</th>
            <th className={styles.numCell}>Cost / person</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className={styles.rowBtn}>Pancakes</span>
            </td>
            <td>Recipe</td>
            <td>Breakfast</td>
            <td>—</td>
            <td>—</td>
            <td className={styles.numCell}>
              <span className={styles.muted}>No price yet</span>
            </td>
            <td>
              <Badge variant="warning">Draft</Badge>
            </td>
          </tr>
          <IngredientListRow row={{ ingredient: INGREDIENT }} colSpan={7} onDone={() => {}} />
          <ScoutFoodListRow food={SCOUT_FOOD} onDone={() => {}} />
        </tbody>
      </table>
    </div>
  );
}

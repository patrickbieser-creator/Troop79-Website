'use client';

/**
 * "Add “x” as a new ingredient" on a saved menu's meal (release C): the recipe
 * editor's form (4B NewIngredientForm — name, how it's measured, one package,
 * what it contains), but saved straight away as the scout's own typed-in
 * (addMenuIngredientAction) so the meal can add it like any other ingredient.
 * It stays private until the menu is shared; a leader checks it after that.
 * A refusal (the 10-ingredient cap, a name the price book has) shows under the
 * form and leaves it open.
 */

import { useContext, useState } from 'react';
import type { Catalog } from '@/lib/menu-monster/types';
import type { NewIngredient } from '@/lib/menu-monster/scout-ingredients';
import { NewIngredientForm } from '../../recipes/_components/new-ingredient-form';
import { addMenuIngredientAction } from '../../../_tools/menu-monster/menu-actions';
import { HelperMenu } from './helper-menu';
import s from './workspace.module.css';

export function MenuNewIngredient({
  name,
  catalog,
  onAdded,
  onCancel
}: {
  name: string;
  catalog: Catalog;
  /** The saved typed-in, keyed by its real x- id. */
  onAdded: (n: NewIngredient) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A leader on a scout's menu: the new ingredient is filed under the scout (helper-menu.ts).
  const onMenu = useContext(HelperMenu);

  async function add(n: NewIngredient) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await (onMenu ? addMenuIngredientAction(n, onMenu) : addMenuIngredientAction(n));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onAdded({ ...n, key: res.id });
  }

  return (
    <div aria-busy={busy}>
      <NewIngredientForm initialName={name} catalog={catalog} onAdd={(n) => void add(n)} onCancel={onCancel} />
      {error && (
        <p className={s.foot} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

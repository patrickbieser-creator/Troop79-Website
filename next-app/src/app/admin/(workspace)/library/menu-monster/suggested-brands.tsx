'use client';

/**
 * Menu Monster leader tools — a recipe's suggested brands (Plans/Menu-Monster-Brands-Gear.md, release 6).
 *
 * Patrick, 2026-10-03: "Recipes can have a brand suggestion, but a person using that recipe would be able to
 * overwrite it." One select per ingredient of the SAVED recipe that has brands. A change takes effect at once
 * (its own block, outside the recipe's draft form): a menu that adds the recipe starts with the suggestion
 * wherever it has not chosen a brand yet. A recipe's author can also suggest from their own menu.
 */
import { useState, useTransition } from 'react';
import type { Catalog } from '@/lib/menu-monster/types';
import { recipeSuggestions } from '@/lib/menu-monster/engine';
import { FormPanel } from '../../../_components/form-panel';
import { Notice } from '../../_components/notice';
import { suggestRecipeBrand } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

export function SuggestedBrands({ recipeId, catalog, onChanged }: { recipeId: string; catalog: Catalog; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [line, setLine] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  /** Changes made this visit: the catalog prop catches up on the next load. */
  const [changed, setChanged] = useState<Readonly<Record<string, string>>>({});

  const recipe = catalog.recipes.find((r) => r.id === recipeId);
  if (!recipe) return null;
  const saved = new Map(recipeSuggestions(recipe, catalog).map(([id, brand]) => [id, brand.id]));
  const rows = [...new Set(recipe.lines.map((l) => l.ingredientId))].flatMap((id) => {
    const ing = catalog.ingredients.find((i) => i.id === id);
    const brands = (catalog.brands ?? []).filter((b) => b.ingredientId === id && !b.retiredAt).sort((a, b) => a.name.localeCompare(b.name));
    return ing && brands.length > 0 ? [{ ing, brands }] : [];
  });
  if (rows.length === 0) return null;

  function set(ingredientId: string, name: string, brandId: string) {
    setLine(null);
    start(async () => {
      const res = await suggestRecipeBrand(recipeId, ingredientId, brandId || null);
      if (!res.ok) {
        setLine({ kind: 'error', text: res.error ?? 'Something went wrong.' });
        return;
      }
      setChanged((cur) => ({ ...cur, [ingredientId]: brandId }));
      setLine({ kind: 'ok', text: brandId ? `Menus that add this recipe now start with that brand of ${name.toLowerCase()}.` : `No brand is suggested for ${name.toLowerCase()} any more.` });
      onChanged();
    });
  }

  return (
    <FormPanel>
      <div className={styles.activityHead}>
        <h3 className={styles.activityTitle}>Suggested brands</h3>
        <span className={styles.cardMeta}>Takes effect immediately</span>
      </div>
      <p className={styles.hint}>A menu that adds this recipe starts with the brand suggested here; whoever plans the menu can change it.</p>
      {line && (line.kind === 'error' ? <Notice>{line.text}</Notice> : <Notice variant="success">{line.text}</Notice>)}
      <ul className={styles.list} aria-label="Suggested brands">
        {rows.map(({ ing, brands }) => (
          <li key={ing.id} className={styles.listRow}>
            <label className={styles.grow} htmlFor={`mm-sb-${ing.id}`}>
              {ing.name}
            </label>
            <select
              id={`mm-sb-${ing.id}`}
              className={`${lib.selectInput} ${styles.suggestSelect}`}
              disabled={pending}
              value={ing.id in changed ? changed[ing.id] : (saved.get(ing.id) ?? '')}
              onChange={(e) => set(ing.id, ing.name, e.target.value)}
            >
              <option value="">No suggestion (any brand)</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </FormPanel>
  );
}

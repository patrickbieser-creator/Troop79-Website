'use client';

/**
 * "Add “Kool-Aid” as a new food…" under a meal's search (Patrick, 2026-10-06: a scout planning a Friday
 * snack found no way to add Kool-Aid on the fly — "only require the name and if it's a beverage or meat or
 * the appropriate classification ... a clear background color treatment so it's clear that this is a
 * modal-like dialog that needs to be resolved and saved or cancelled").
 *
 * An inline, tinted, bordered panel (role=dialog, aria-modal=false: the rest of the page stays reachable)
 * that is resolved by Add food or Cancel. REQUIRED: the name (prefilled with what was typed) and the Kind of
 * food (a store section, nothing preselected). Everything under "More, if you know it" is optional — how
 * much each person gets, a price and package size, the store, the diets it doesn't suit — because only the
 * basics are needed to list it on the meal; a leader cleans the rest up from Needs attention.
 *
 * Add food is never greyed for "not valid yet" (AGENTS.md): an incomplete form marks the missing field in
 * place (red outline, aria-invalid, a note) and says "Can’t save yet: …" beside the button.
 * A name the price book already has swaps the form for "<name> is already on the list" with one button
 * that adds the existing food instead. The save is addFoodToMealAction (the owner's typed-in + a
 * one-line recipe); the meal adds the returned recipe like any other.
 */

import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/app/_components/button';
import { Field, SelectInput, TextInput } from '@/app/_components/form';
import type { Catalog, MealSlot, Recipe, RestrictionKey, Section } from '@/lib/menu-monster/types';
import { MAX_PRICE, MIN_PRICE, SIZE_UNITS, newIngredientKey, sizeInRecipeUnit, type NewIngredient, type NewIngredientKind } from '@/lib/menu-monster/scout-ingredients';
import { foodProblems, singleFoodRecipe, type FoodField } from '@/lib/menu-monster/single-food';
import { RESTRICTIONS, SECTIONS, SECTION_ORDER, parseQty } from '@/lib/menu-monster/units';
import { isPickable } from '@/lib/menu-monster/scout-recipes';
import { addFoodToMealAction } from '../../../_tools/menu-monster/menu-actions';
import { HelperMenu } from './helper-menu';
import s from './meal-new-food.module.css';

/** How one person's share is counted; decides how the food is measured. */
const EACH_UNITS: { key: string; label: string; kind: NewIngredientKind; one: string; many: string }[] = [
  { key: 'each', label: 'each', kind: 'count', one: 'each', many: 'each' },
  { key: 'packet', label: 'packet', kind: 'count', one: 'packet', many: 'packets' },
  { key: 'cup', label: 'cup', kind: 'volume', one: '', many: '' },
  { key: 'oz', label: 'oz', kind: 'weight', one: '', many: '' }
];

export interface FoodAdded {
  name: string;
  /** The menu item to put on the meal (the planner shows it at once). */
  recipe: Recipe;
  /** The new typed-in, keyed by its real x- id; null when the food was already on the list. */
  ingredient: NewIngredient | null;
}

/** The price-book food (not someone's unchecked typed-in) a name already is, ignoring case. */
const bookFood = (catalog: Catalog, name: string) => {
  const n = name.trim().toLowerCase();
  return n ? catalog.ingredients.find((i) => i.name.toLowerCase() === n && !i.needsMatch && !i.retiredAt) : undefined;
};

export function MealNewFood({
  name: typed,
  slot,
  meal,
  catalog,
  onAdded,
  onPickRecipe,
  onCancel
}: {
  /** What the scout typed in the search. */
  name: string;
  slot: MealSlot;
  /** The recipe ids already on the meal (an existing food that is on it says so). */
  meal: { recipeIds: readonly string[] };
  catalog: Catalog;
  onAdded: (r: FoodAdded) => void;
  /** The price book already has a menu item for that food: add it as it is. */
  onPickRecipe: (r: Recipe) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  // A leader on a scout's menu: the food is filed under the scout (helper-menu.tsx).
  const onMenu = useContext(HelperMenu);
  const [name, setName] = useState(typed);
  const [section, setSection] = useState<Section | ''>('');
  const [each, setEach] = useState('1');
  const [eachUnit, setEachUnit] = useState('each');
  const [size, setSize] = useState('');
  const [sizeUnit, setSizeUnit] = useState('count');
  const [price, setPrice] = useState('');
  const [store, setStore] = useState('');
  const [avoid, setAvoid] = useState<RestrictionKey[]>([]);
  /** The details: open on a computer, closed on a phone (the canon 640px breakpoint). */
  const [more, setMore] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 640px)').matches : true));
  /** After the first click on an incomplete form the marks show (and clear as each is fixed). */
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The price-book food the name is, when the panel has switched to "already on the list". */
  const [dup, setDup] = useState(() => bookFood(catalog, typed)?.id ?? null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** A field of the form, found by its data-field mark (no refs read while rendering). */
  const fieldEl = (f: string) => panelRef.current?.querySelector<HTMLElement>(`[data-field="${f}"]`);

  useEffect(() => {
    // Name is prefilled, so the next thing to answer is the kind of food.
    if (!dup) panelRef.current?.querySelector<HTMLElement>('[data-field="section"]')?.focus();
  }, [dup]);

  const unit = EACH_UNITS.find((u) => u.key === eachUnit) ?? EACH_UNITS[0];
  const pickUnit = (key: string) => {
    const u = EACH_UNITS.find((x) => x.key === key) ?? EACH_UNITS[0];
    setEachUnit(u.key);
    setSizeUnit(SIZE_UNITS[u.kind][0].key);
  };

  /** Everything wrong, in form order, with the field it belongs to. */
  function problems(): { field: FoodField | 'each' | 'size' | 'price'; reason: string; note: string }[] {
    const out: { field: FoodField | 'each' | 'size' | 'price'; reason: string; note: string }[] = [];
    for (const p of foodProblems({ name, section })) out.push({ field: p.field, reason: p.reason, note: p.field === 'name' ? 'Give it a name.' : 'Pick what kind of food it is.' });
    if (!(parseQty(each) > 0)) out.push({ field: 'each', reason: 'say how much each person gets', note: 'Enter how much each person gets.' });
    // A price and a package size go together; both empty is fine (priced later).
    if (size.trim() || price.trim()) {
      if (!(sizeInRecipeUnit(unit.kind, parseQty(size), sizeUnit) ?? 0)) out.push({ field: 'size', reason: 'say how much one package holds', note: 'How much does one package hold?' });
      const p = Number(price.replace(/[$,\s]/g, ''));
      if (!(p >= MIN_PRICE && p <= MAX_PRICE)) out.push({ field: 'price', reason: 'enter what one package costs', note: `Enter what one package costs, from $${MIN_PRICE.toFixed(2)} to $${MAX_PRICE}.` });
    }
    return out;
  }
  const found = tried ? problems() : [];
  const noteFor = (f: FoodField | 'each' | 'size' | 'price') => found.find((p) => p.field === f)?.note;

  async function save(existingId: string | null) {
    if (busy) return;
    setFailure(null);
    const now = problems();
    if (!existingId && now.length > 0) {
      setTried(true);
      // Move to the first thing to fix (open the details first when it lives in there).
      const first = now[0].field;
      if (now.some((p) => p.field === 'each' || p.field === 'size' || p.field === 'price')) setMore(true);
      requestAnimationFrame(() => fieldEl(first)?.focus());
      return;
    }
    const book = existingId ? null : bookFood(catalog, name);
    if (book) return setDup(book.id);
    const qty = parseQty(each) > 0 ? parseQty(each) : 1;
    const hasPackage = !existingId && size.trim() !== '' && price.trim() !== '';
    const ingredient: NewIngredient = {
      key: newIngredientKey(),
      name: name.trim(),
      kind: unit.kind,
      one: unit.one,
      many: unit.many,
      avoid,
      section: (section || 'dry') as Section,
      size: hasPackage ? (sizeInRecipeUnit(unit.kind, parseQty(size), sizeUnit) ?? 0) : 0,
      price: hasPackage ? Number(price.replace(/[$,\s]/g, '')) : 0,
      store: store.trim() || null
    };
    setBusy(true);
    const payload = existingId ? { existingIngredientId: existingId, eachPerson: 1, mealSlot: slot } : { ingredient, eachPerson: qty, mealSlot: slot };
    const res = await (onMenu ? addFoodToMealAction(payload, onMenu) : addFoodToMealAction(payload));
    setBusy(false);
    if (!res.ok) {
      if ('existingIngredientId' in res && res.existingIngredientId) setDup(res.existingIngredientId);
      return setFailure(res.error);
    }
    const ing = existingId ? null : { ...ingredient, key: res.ingredientId };
    onAdded({ name: res.name, recipe: singleFoodRecipe(res.recipeId, res.name, slot, res.ingredientId, existingId ? 1 : qty, null), ingredient: ing });
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }

  // ---- The price book already has it ----
  if (dup) {
    const have = catalog.ingredients.find((i) => i.id === dup);
    const label = have?.name ?? name.trim();
    // The menu item for that food, if the price book has one.
    const item = catalog.recipes.find((r) => isPickable(r) && (r.foodIngredientId === dup || r.name.toLowerCase() === label.toLowerCase()));
    const onMeal = item != null && meal.recipeIds.includes(item.id);
    return (
      <div className={s.panel} role="dialog" aria-modal="false" aria-labelledby={`${uid}-h`} onKeyDown={onKey}>
        <h3 id={`${uid}-h`} className={s.head}>
          {label} is already on the list
        </h3>
        <p className={s.lead}>{onMeal ? `${label} is already on this meal.` : 'No need to make a new one.'}</p>
        {failure && (
          <p className={s.problem} role="alert">
            {failure}
          </p>
        )}
        <div className={s.actions}>
          {!onMeal && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => (item ? onPickRecipe(item) : void save(dup))}>
              {busy ? 'Adding…' : `Add ${label} to this meal`}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>
            {onMeal ? 'Close' : 'Cancel'}
          </Button>
        </div>
      </div>
    );
  }

  const invalid = (f: FoodField | 'each' | 'size' | 'price') => (noteFor(f) ? true : undefined);

  return (
    <div ref={panelRef} className={s.panel} role="dialog" aria-modal="false" aria-labelledby={`${uid}-h`} aria-busy={busy} onKeyDown={onKey}>
      <h3 id={`${uid}-h`} className={s.head}>
        Add “{typed.trim() || 'a food'}” as a new food
      </h3>
      <p className={s.lead}>Just the name and the kind of food are needed. A leader will check the rest later.</p>
      <div className={s.pair}>
        <Field label="Name" error={noteFor('name')}>
          <TextInput data-field="name" value={name} maxLength={60} autoComplete="off" aria-invalid={invalid('name')} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Kind of food" error={noteFor('section')}>
          <SelectInput data-field="section" value={section} aria-invalid={invalid('section')} onChange={(e) => setSection(e.target.value as Section | '')}>
            <option value="">Pick one…</option>
            {SECTION_ORDER.map((k) => (
              <option key={k} value={k}>
                {SECTIONS[k]}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>

      <button type="button" className={s.moreBtn} aria-expanded={more} aria-controls={`${uid}-more`} onClick={() => setMore((v) => !v)}>
        More, if you know it
      </button>
      <div id={`${uid}-more`} className={s.more} hidden={!more}>
        <div className={s.pair}>
          <Field label="Each person gets" error={noteFor('each')}>
            <span className={s.sizeRow}>
              <TextInput data-field="each" value={each} inputMode="decimal" autoComplete="off" aria-invalid={invalid('each')} onChange={(e) => setEach(e.target.value)} />
              <SelectInput value={eachUnit} aria-label="Unit for each person" onChange={(e) => pickUnit(e.target.value)}>
                {EACH_UNITS.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </SelectInput>
            </span>
          </Field>
          <Field label="Store (optional)">
            <TextInput value={store} maxLength={40} autoComplete="off" onChange={(e) => setStore(e.target.value)} />
          </Field>
        </div>
        <div className={s.pair}>
          <Field label="One package holds" error={noteFor('size')}>
            <span className={s.sizeRow}>
              <TextInput data-field="size" value={size} inputMode="decimal" autoComplete="off" aria-invalid={invalid('size')} onChange={(e) => setSize(e.target.value)} />
              <SelectInput value={sizeUnit} aria-label="Package size unit" onChange={(e) => setSizeUnit(e.target.value)}>
                {SIZE_UNITS[unit.kind].map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </SelectInput>
            </span>
          </Field>
          <Field label="Estimated price" error={noteFor('price')}>
            <TextInput data-field="price" value={price} inputMode="decimal" placeholder="$" autoComplete="off" aria-invalid={invalid('price')} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <div className={s.choice} role="group" aria-label="Not suitable for">
          <span className={s.choiceLabel} aria-hidden="true">
            Not suitable for
          </span>
          <div className={s.chips}>
            {RESTRICTIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                className={s.chip}
                aria-pressed={avoid.includes(d.key)}
                onClick={() => setAvoid((a) => (a.includes(d.key) ? a.filter((x) => x !== d.key) : [...a, d.key]))}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {failure && (
        <p className={s.problem} role="alert">
          {failure}
        </p>
      )}
      <div className={s.actions}>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void save(null)}>
          {busy ? 'Adding…' : 'Add food'}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        {found.length > 0 && (
          <span className={s.problem} role="alert">
            Can’t save yet: {found[0].reason}
            {found.length > 1 && <span className={s.problemMore}> (+{found.length - 1} more)</span>}
          </span>
        )}
      </div>
    </div>
  );
}

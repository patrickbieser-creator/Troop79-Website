'use client';

/**
 * The inline "new ingredient" form under the recipe editor's ingredient search
 * (Phase 4B): something the price book doesn't have yet. Name, how it's
 * measured, one package (size + price, store optional) and what it contains —
 * the diet ticks a leader confirms when matching it. Validation is
 * newIngredientProblem(); the package size is stored in the recipe unit
 * (sizeInRecipeUnit; the package is required here — the meal's on-the-fly food, MealNewFood, does not
 * need one). Escape or Cancel closes it. The store section is always asked (Dry goods unless changed). The
 * Ingredients tab reuses it: `busy` / `failure` show the request it then makes.
 */

import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '@/app/_components/button';
import { Field, SelectInput, TextInput } from '@/app/_components/form';
import type { Catalog, RestrictionKey, Section } from '@/lib/menu-monster/types';
import { SIZE_UNITS, newIngredientKey, newIngredientProblem, sizeInRecipeUnit, type NewIngredient, type NewIngredientKind } from '@/lib/menu-monster/scout-ingredients';
import { SECTIONS, SECTION_ORDER, parseQty } from '@/lib/menu-monster/units';
import w from '../../menus/_components/workspace.module.css';
import s from './recipe-editor.module.css';

const KINDS: { key: NewIngredientKind; label: string }[] = [
  { key: 'count', label: 'Count' },
  { key: 'weight', label: 'Weight' },
  { key: 'volume', label: 'Volume' }
];
const CONTAINS: { key: RestrictionKey; label: string }[] = [
  { key: 'gf', label: 'Gluten' },
  { key: 'nut', label: 'Nuts' },
  { key: 'dairy', label: 'Dairy' },
  { key: 'veg', label: 'Meat' }
];

export function NewIngredientForm({
  initialName,
  catalog,
  busy = false,
  failure = null,
  onAdd,
  onCancel
}: {
  initialName: string;
  catalog: Catalog;
  /** The caller is saving it: the buttons wait. */
  busy?: boolean;
  /** What the caller's save said went wrong. */
  failure?: string | null;
  onAdd: (n: NewIngredient, section: Section) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<NewIngredientKind>('count');
  const [one, setOne] = useState('');
  const [many, setMany] = useState('');
  const [size, setSize] = useState('');
  const [sizeUnit, setSizeUnit] = useState('count');
  const [price, setPrice] = useState('');
  const [store, setStore] = useState('');
  const [avoid, setAvoid] = useState<RestrictionKey[]>([]);
  const [section, setSection] = useState<Section>('dry');
  const [error, setError] = useState<string | null>(null);

  const pickKind = (k: NewIngredientKind) => {
    setKind(k);
    setSizeUnit(SIZE_UNITS[k][0].key);
    setError(null);
  };

  function submit() {
    const inUnit = sizeInRecipeUnit(kind, parseQty(size), sizeUnit) ?? NaN;
    const n: NewIngredient = {
      key: newIngredientKey(),
      name: name.trim(),
      kind,
      one: kind === 'count' ? one.trim() : '',
      many: kind === 'count' ? many.trim() || '' : '',
      avoid,
      size: inUnit,
      price: Number(price.replace(/[$,\s]/g, '')),
      section,
      store: store.trim() || null
    };
    const problem = newIngredientProblem(n, catalog, { requirePackage: true });
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    onAdd(n, section);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className={s.newForm} role="group" aria-labelledby={`${uid}-h`} onKeyDown={onKey}>
      <h3 id={`${uid}-h`} className={s.newHead}>
        New ingredient
      </h3>
      <Field label="Name">
        <TextInput value={name} maxLength={60} autoComplete="off" autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className={w.choice} role="group" aria-label="Measured by">
        <span className={w.choiceLabel} aria-hidden="true">
          Measured by
        </span>
        <div className={w.chips}>
          {KINDS.map((k) => (
            <button key={k.key} type="button" className={w.chip} aria-pressed={kind === k.key} onClick={() => pickKind(k.key)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {kind === 'count' && (
        <div className={s.pair}>
          <Field label="One is called">
            <TextInput value={one} maxLength={20} placeholder="tortilla" autoComplete="off" onChange={(e) => setOne(e.target.value)} />
          </Field>
          <Field label="Several are called">
            <TextInput value={many} maxLength={20} placeholder="tortillas" autoComplete="off" onChange={(e) => setMany(e.target.value)} />
          </Field>
        </div>
      )}
      <div className={s.pair}>
        <Field label="One package holds">
          <span className={s.sizeRow}>
            <TextInput value={size} inputMode="decimal" autoComplete="off" onChange={(e) => setSize(e.target.value)} />
            <SelectInput value={sizeUnit} aria-label="Package size unit" onChange={(e) => setSizeUnit(e.target.value)}>
              {SIZE_UNITS[kind].map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </SelectInput>
          </span>
        </Field>
        <Field label="Price">
          <TextInput value={price} inputMode="decimal" placeholder="$" autoComplete="off" onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      <Field label="Store (optional)">
        <TextInput value={store} maxLength={40} autoComplete="off" onChange={(e) => setStore(e.target.value)} />
      </Field>
      <Field label="Store section">
        <SelectInput value={section} onChange={(e) => setSection(e.target.value as Section)}>
          {SECTION_ORDER.map((k) => (
            <option key={k} value={k}>
              {SECTIONS[k]}
            </option>
          ))}
        </SelectInput>
      </Field>
      <div className={w.choice} role="group" aria-label="Contains">
        <span className={w.choiceLabel} aria-hidden="true">
          Contains
        </span>
        <div className={w.chips}>
          {CONTAINS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={w.chip}
              aria-pressed={avoid.includes(c.key)}
              onClick={() => setAvoid((a) => (a.includes(c.key) ? a.filter((x) => x !== c.key) : [...a, c.key]))}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {(error ?? failure) && (
        <p className={s.formError} role="alert">
          {error ?? failure}
        </p>
      )}
      <div className={w.noticeActions}>
        <Button size="sm" variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Adding…' : 'Add ingredient'}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

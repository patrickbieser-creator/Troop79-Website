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

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/app/_components/button';
import { Field, SaveProblem, SelectInput, TextInput } from '@/app/_components/form';
import type { Catalog, RestrictionKey, Section } from '@/lib/menu-monster/types';
import { MAX_PRICE, MIN_PRICE, SIZE_UNITS, newIngredientKey, newIngredientProblem, sizeInRecipeUnit, type NewIngredient, type NewIngredientKind } from '@/lib/menu-monster/scout-ingredients';
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
  const [tried, setTried] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const pickKind = (k: NewIngredientKind) => {
    setKind(k);
    setSizeUnit(SIZE_UNITS[k][0].key);
  };

  const draftOf = (): NewIngredient => ({
    key: newIngredientKey(),
    name: name.trim(),
    kind,
    one: kind === 'count' ? one.trim() : '',
    many: kind === 'count' ? many.trim() || '' : '',
    avoid,
    size: sizeInRecipeUnit(kind, parseQty(size), sizeUnit) ?? NaN,
    price: Number(price.replace(/[$,\s]/g, '')),
    section,
    store: store.trim() || null
  });

  type FieldKey = 'name' | 'one' | 'size' | 'price';
  /** Everything wrong, in form order, with the field it belongs to (an incomplete Add marks these, D-331). */
  function problems(): { field: FieldKey; reason: string; note: string }[] {
    const n = draftOf();
    const out: { field: FieldKey; reason: string; note: string }[] = [];
    if (!n.name) out.push({ field: 'name', reason: 'give it a name', note: 'Give the ingredient a name.' });
    else {
      const dup = newIngredientProblem({ ...n, one: n.one || 'x', size: 1, price: 1 }, catalog, { requirePackage: true });
      if (dup) out.push({ field: 'name', reason: 'pick it from the search instead', note: dup });
    }
    if (kind === 'count' && !one.trim()) out.push({ field: 'one', reason: 'say what one is called', note: 'Say what one is called (can, tortilla…).' });
    if (!(Number.isFinite(n.size) && n.size > 0)) out.push({ field: 'size', reason: 'say how much one package holds', note: 'How big is one package?' });
    if (!(Number.isFinite(n.price) && n.price >= MIN_PRICE && n.price <= MAX_PRICE)) {
      out.push({ field: 'price', reason: 'enter what one package costs', note: `Enter what one package costs, from $${MIN_PRICE.toFixed(2)} to $${MAX_PRICE}.` });
    }
    // Anything else the shared check refuses (a package past the size cap) lands on the size.
    if (out.length === 0) {
      const rest = newIngredientProblem(n, catalog, { requirePackage: true });
      if (rest) out.push({ field: 'size', reason: 'check the package size', note: rest });
    }
    return out;
  }
  const found = tried ? problems() : [];
  const noteFor = (f: FieldKey) => found.find((p) => p.field === f)?.note;

  function submit() {
    const now = problems();
    if (now.length > 0) {
      setTried(true);
      rootRef.current?.querySelector<HTMLElement>(`[data-field="${now[0].field}"]`)?.focus();
      return;
    }
    onAdd(draftOf(), section);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div ref={rootRef} className={s.newForm} role="group" aria-labelledby={`${uid}-h`} onKeyDown={onKey}>
      <h3 id={`${uid}-h`} className={s.newHead}>
        New ingredient
      </h3>
      <Field label="Name" problem={noteFor('name')}>
        <TextInput data-field="name" value={name} maxLength={60} autoComplete="off" autoFocus onChange={(e) => setName(e.target.value)} />
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
          <Field label="One is called" problem={noteFor('one')}>
            <TextInput data-field="one" value={one} maxLength={20} placeholder="tortilla" autoComplete="off" onChange={(e) => setOne(e.target.value)} />
          </Field>
          <Field label="Several are called">
            <TextInput value={many} maxLength={20} placeholder="tortillas" autoComplete="off" onChange={(e) => setMany(e.target.value)} />
          </Field>
        </div>
      )}
      <div className={s.pair}>
        <Field label="One package holds" problem={noteFor('size')}>
          <span className={s.sizeRow}>
            <TextInput data-field="size" value={size} inputMode="decimal" autoComplete="off" onChange={(e) => setSize(e.target.value)} />
            <SelectInput value={sizeUnit} aria-label="Package size unit" onChange={(e) => setSizeUnit(e.target.value)}>
              {SIZE_UNITS[kind].map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </SelectInput>
          </span>
        </Field>
        <Field label="Price" problem={noteFor('price')}>
          <TextInput data-field="price" value={price} inputMode="decimal" placeholder="$" autoComplete="off" onChange={(e) => setPrice(e.target.value)} />
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
      {failure && (
        <p className={s.formError} role="alert">
          {failure}
        </p>
      )}
      <div className={w.noticeActions}>
        <Button size="sm" variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Adding…' : 'Add ingredient'}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <SaveProblem action="add" reason={found[0]?.reason} more={found.length - 1} />
      </div>
    </div>
  );
}

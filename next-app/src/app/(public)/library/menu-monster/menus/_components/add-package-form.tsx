'use client';

/**
 * "Add a package you bought" under a Shopping line (release C, P2.3a): what
 * the scout found on the shelf that the price book doesn't list. Name, store
 * (optional), the size on the label in any unit the ingredient converts from,
 * and the price. Saved straight away (addScoutPackageAction): inside the price
 * band it joins the troop price book; outside, it prices only this scout's
 * menus until a leader checks it. Escape or Cancel closes it.
 *
 * Dialog mode (`brand`, Plans/Menu-Monster-Brand-Detail.md): the body of the brand detail dialog. The brand is the
 * name on the label, so there is no Name field; Size, Unit, Price and a Store pull-down of the approved stores
 * (no free text; hidden when there are none); the package is filed under the brand. Save is greyed only while
 * nothing has been typed; a Save with no size marks Size in place and saves nothing.
 */

import { useContext, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/app/_components/button';
import { Field, SaveProblem, SelectInput, TextInput } from '@/app/_components/form';
import type { Conversion, Ingredient, Package } from '@/lib/menu-monster/types';
import { MAX_PACKAGE_SIZE, packageSizeLabel, packageSizeUnits, packageYield } from '@/lib/menu-monster/scout-packages';
import { MAX_PRICE, MIN_PRICE } from '@/lib/menu-monster/scout-ingredients';
import { parseQty } from '@/lib/menu-monster/units';
import { addScoutPackageAction } from '../../../_tools/menu-monster/menu-actions';
import { HelperMenu } from './helper-menu';
import { StoreNames } from './store-names';
import s from './workspace.module.css';

export type AddedPackage = { pkg: Package; status: 'live' | 'held' | 'same' };

export function AddPackageForm({
  ingredient,
  conversions,
  onAdded,
  onCancel,
  compact = false,
  defaultName,
  brand,
  stores
}: {
  ingredient: Ingredient;
  conversions: readonly Conversion[];
  onAdded: (a: AddedPackage) => void;
  onCancel: () => void;
  /** Mounted inside a meal (the "No price yet" badge): no Store, a hint that a guess will do. */
  compact?: boolean;
  /** The name the form starts with: the chosen brand, else the ingredient. */
  defaultName?: string;
  /** Dialog mode: the brand this package is a size of. Its name is the package's name. */
  brand?: { id: string; name: string };
  /** Dialog mode: the approved store names for the Store pull-down. */
  stores?: readonly string[];
}) {
  // A leader on a scout's menu: the package is filed under the scout (helper-menu.ts).
  const onMenu = useContext(HelperMenu);
  // The store is a pull-down of the troop's approved names (never free text); none approved = no field.
  const approved = useContext(StoreNames);
  const storeList = stores ?? approved;
  const units = packageSizeUnits(ingredient, conversions);
  const [name, setName] = useState(brand?.name ?? defaultName ?? '');
  const [store, setStore] = useState('');
  const [size, setSize] = useState('');
  const [unit, setUnit] = useState(units[0].key);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /** Everything wrong, in form order, with the field it belongs to (an incomplete Add marks these, D-331). */
  function problems(): { field: 'name' | 'size' | 'price'; reason: string; note: string }[] {
    const out: { field: 'name' | 'size' | 'price'; reason: string; note: string }[] = [];
    const yld = packageYield(ingredient, conversions, parseQty(size), unit);
    if (!brand && !name.trim()) out.push({ field: 'name', reason: 'give the package a name', note: 'Give the package a name, like the label says.' });
    if (!(parseQty(size) > 0) || yld == null || !(yld > 0)) out.push({ field: 'size', reason: 'say how much one package holds', note: 'Enter how much one package holds — check the label.' });
    else if (yld > MAX_PACKAGE_SIZE) out.push({ field: 'size', reason: 'check the package size', note: 'That package is too big. Check the size.' });
    const p = Number(price.replace(/^\$/, ''));
    if (!(p >= MIN_PRICE && p <= MAX_PRICE)) out.push({ field: 'price', reason: 'enter what one package costs', note: `Enter what one package costs, from $${MIN_PRICE.toFixed(2)} to $${MAX_PRICE}.` });
    return out;
  }
  const found = tried ? problems() : [];
  // Dialog mode: Save is greyed only while nothing has been typed (never "not valid yet").
  const touched = size.trim() !== '' || price.trim() !== '' || store !== '';
  const noteFor = (f: 'name' | 'size' | 'price') => found.find((x) => x.field === f)?.note;

  async function add() {
    if (busy) return;
    const now = problems();
    if (now.length > 0) {
      setTried(true);
      rootRef.current?.querySelector<HTMLElement>(`[data-field="${now[0].field}"]`)?.focus();
      return;
    }
    const n = parseQty(size);
    const p = Number(price.replace(/^\$/, ''));
    const yld = packageYield(ingredient, conversions, n, unit);
    if (yld == null) return;
    setBusy(true);
    setError(null);
    const payload = { ingredientId: ingredient.id, name, store, size: n, sizeUnit: unit, price: p, ...(brand ? { brandId: brand.id } : {}) };
    const res = await (onMenu ? addScoutPackageAction(payload, onMenu) : addScoutPackageAction(payload));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const pkg: Package = {
      id: res.id,
      ingredientId: ingredient.id,
      name: name.trim(),
      store: store.trim() || null,
      price: Math.round(p * 100) / 100,
      anchorPrice: Math.round(p * 100) / 100,
      yield: yld,
      yieldUnitLabel: null,
      ...(brand ? { brandId: brand.id, sizeLabel: packageSizeLabel(n, unit, ingredient) } : {}),
      noun: 'pack',
      soldSize: null,
      soldUnit: null,
      note: null,
      asOf: null,
      ...(res.status === 'held' ? { held: true as const } : {})
    };
    onAdded({ pkg, status: res.status });
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault(); // so a dialog's native cancel does not ask to close a second time
      onCancel();
    }
  };

  const storePicker =
    storeList.length > 0 ? (
      <Field label="Store (optional)">
        <SelectInput value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="">—</option>
          {storeList.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectInput>
      </Field>
    ) : null;
  const showHint = compact || brand != null;
  const sizeAndUnit = (
    <div className={s.noteRow}>
      <Field label={brand ? 'Size' : 'One package holds'} problem={noteFor('size')}>
        <TextInput data-field="size" value={size} inputMode="decimal" autoComplete="off" onChange={(e) => setSize(e.target.value)} />
      </Field>
      <Field label="Unit">
        <SelectInput value={unit} onChange={(e) => setUnit(e.target.value)}>
          {units.map((u) => (
            <option key={u.key} value={u.key}>
              {u.label}
            </option>
          ))}
        </SelectInput>
      </Field>
    </div>
  );
  const priceField = (
    <Field label="Price" hint={showHint ? 'A best guess is fine.' : undefined} problem={noteFor('price')}>
      <TextInput data-field="price" value={price} inputMode="decimal" autoComplete="off" onChange={(e) => setPrice(e.target.value)} />
    </Field>
  );
  const actions = (
    <div className={s.noticeActions}>
      <Button variant="primary" size="sm" onClick={() => void add()} disabled={busy || (brand != null && !touched)}>
        {brand ? (busy ? 'Saving…' : 'Save') : busy ? 'Adding…' : 'Add package'}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <SaveProblem action={brand ? 'save' : 'add'} reason={found[0]?.reason} more={found.length - 1} />
    </div>
  );
  const errorLine = error && (
    <p className={s.foot} role="alert">
      {error}
    </p>
  );

  if (brand) {
    return (
      <div ref={rootRef} className={s.detailForm} role="group" aria-label={`Size and price for ${brand.name}`} onKeyDown={onKey}>
        {sizeAndUnit}
        {priceField}
        {storePicker}
        {errorLine}
        {actions}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={s.choice} role="group" aria-label={compact ? `Price for ${ingredient.name}` : `New package of ${ingredient.name}`} onKeyDown={onKey}>
      <Field label="Name on the label" problem={noteFor('name')}>
        <TextInput data-field="name" value={name} maxLength={60} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </Field>
      {!compact && storePicker}
      {sizeAndUnit}
      {priceField}
      {errorLine}
      {actions}
    </div>
  );
}

'use client';

/**
 * "Add a package you bought" under a Shopping line (release C, P2.3a): what
 * the scout found on the shelf that the price book doesn't list. Name, store
 * (optional), the size on the label in any unit the ingredient converts from,
 * and the price. Saved straight away (addScoutPackageAction): inside the price
 * band it joins the troop price book; outside, it prices only this scout's
 * menus until a leader checks it. Escape or Cancel closes it.
 */

import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '@/app/_components/button';
import { Field, SelectInput, TextInput } from '@/app/_components/form';
import type { Conversion, Ingredient, Package } from '@/lib/menu-monster/types';
import { packageSizeUnits, packageYield, scoutPackageProblem } from '@/lib/menu-monster/scout-packages';
import { parseQty } from '@/lib/menu-monster/units';
import { addScoutPackageAction } from '../../../_tools/menu-monster/menu-actions';
import s from './workspace.module.css';

export type AddedPackage = { pkg: Package; status: 'live' | 'held' | 'same' };

export function AddPackageForm({
  ingredient,
  conversions,
  onAdded,
  onCancel
}: {
  ingredient: Ingredient;
  conversions: readonly Conversion[];
  onAdded: (a: AddedPackage) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const units = packageSizeUnits(ingredient, conversions);
  const [name, setName] = useState('');
  const [store, setStore] = useState('');
  const [size, setSize] = useState('');
  const [unit, setUnit] = useState(units[0].key);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const n = parseQty(size);
    const p = Number(price.replace(/^\$/, ''));
    const yld = packageYield(ingredient, conversions, n, unit);
    const problem = scoutPackageProblem({ name, size: n, price: p, yield: yld });
    if (problem || yld == null) return setError(problem ?? 'Enter how much one package holds — check the label.');
    setBusy(true);
    setError(null);
    const res = await addScoutPackageAction({ ingredientId: ingredient.id, name, store, size: n, sizeUnit: unit, price: p });
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
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className={s.choice} role="group" aria-label={`New package of ${ingredient.name}`} onKeyDown={onKey}>
      <Field label="Name on the label">
        <TextInput value={name} maxLength={60} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Store (optional)">
        <TextInput value={store} maxLength={40} autoComplete="off" onChange={(e) => setStore(e.target.value)} />
      </Field>
      <div className={s.noteRow}>
        <Field label="One package holds">
          <TextInput value={size} inputMode="decimal" autoComplete="off" onChange={(e) => setSize(e.target.value)} />
        </Field>
        <Field label="Unit">
          <SelectInput id={`${uid}-unit`} value={unit} onChange={(e) => setUnit(e.target.value)}>
            {units.map((u) => (
              <option key={u.key} value={u.key}>
                {u.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Field label="Price">
        <TextInput value={price} inputMode="decimal" autoComplete="off" onChange={(e) => setPrice(e.target.value)} />
      </Field>
      {error && (
        <p className={s.foot} role="alert">
          {error}
        </p>
      )}
      <div className={s.noticeActions}>
        <Button variant="primary" size="sm" onClick={() => void add()} disabled={busy}>
          {busy ? 'Adding…' : 'Add package'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

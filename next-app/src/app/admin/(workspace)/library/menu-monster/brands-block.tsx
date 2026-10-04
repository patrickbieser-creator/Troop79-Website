'use client';

/**
 * Menu Monster leader tools — an ingredient's brands (Plans/Menu-Monster-Brands-Gear.md, release 3).
 *
 * Ingredient → brands → packages. A brand is a brand or a varietal (Chips Ahoy, Fuji, Whole); a package is a
 * size of it at a store. Anyone signed in can type a new brand on a menu and it joins this list at once, so
 * this is where a leader tidies: rename one, merge a duplicate ("Chips Ahoy Original" into "Chips Ahoy" —
 * menus that chose it follow), move one typed under the wrong ingredient, set a brand's own diet flags
 * (Rice Chex is gluten-free; cereal is not), or remove it (menus that chose it go back to any brand).
 * Below the brands: which brand each package is a size of, and its size without the brand.
 */
import { useState, useTransition } from 'react';
import { Button } from '../../../_components/button';
import { ActionsMenu } from '../../_components/actions-menu';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { money } from '@/lib/event-money';
import { RESTRICTIONS, RESTRICTION_BY_KEY } from '@/lib/menu-monster/units';
import type { Brand, Catalog, Ingredient, Package, RestrictionKey } from '@/lib/menu-monster/types';
import { createBrand, mergeBrand, moveBrand, removeBrand, renameBrand, setBrandDiets, setPackageBrand } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

type Mode = 'rename' | 'diets' | 'merge' | 'move';

export function BrandsBlock({ ing, catalog, onChanged }: { ing: Ingredient; catalog: Catalog; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [line, setLine] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [open, setOpen] = useState<{ id: string; mode: Mode } | null>(null);
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [diets, setDiets] = useState<RestrictionKey[] | null>(null);
  const [adding, setAdding] = useState('');

  const brands = (catalog.brands ?? []).filter((b) => b.ingredientId === ing.id).sort((a, b) => Number(a.retiredAt != null) - Number(b.retiredAt != null) || a.name.localeCompare(b.name));
  const live = brands.filter((b) => !b.retiredAt);
  const packages = catalog.packages.filter((p) => p.ingredientId === ing.id && !p.retiredAt);
  const others = catalog.ingredients.filter((i) => i.id !== ing.id && !i.retiredAt && !i.needsMatch).sort((a, b) => a.name.localeCompare(b.name));

  function run(action: () => Promise<{ ok: boolean; error?: string; note?: string }>, okText: string) {
    setLine(null);
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setLine({ kind: 'error', text: res.error ?? 'Something went wrong.' });
        return;
      }
      setOpen(null);
      setLine({ kind: 'ok', text: res.note ?? okText });
      onChanged();
    });
  }

  function start_(b: Brand, mode: Mode) {
    setOpen({ id: b.id, mode });
    setText(b.name);
    setTarget('');
    setDiets(b.avoid);
  }

  const dietText = (b: Brand) =>
    b.avoid == null ? null : b.avoid.length === 0 ? 'Suits every diet' : b.avoid.map((k) => `Not ${RESTRICTION_BY_KEY[k].label.toLowerCase()}`).join(', ');

  return (
    <section aria-label={`${ing.name} brands`} className={styles.brands}>
      <div className={styles.detailHead}>
        <h3 className={styles.cardName}>Brands</h3>
        <span className={styles.cardMeta}>A brand a scout types on a menu joins this list at once.</span>
      </div>
      {line && (line.kind === 'error' ? <Notice>{line.text}</Notice> : <Notice variant="success">{line.text}</Notice>)}

      {brands.length === 0 ? (
        <p className={styles.muted}>No brands yet. Menus ask for {ing.name.toLowerCase()} with any brand.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Brand</th>
                <th>Packages</th>
                <th className={styles.actionsCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => {
                const own = packages.filter((p) => p.brandId === b.id);
                const mergeTargets = live.filter((x) => x.id !== b.id);
                return (
                  <tr key={b.id}>
                    <td>
                      {b.name} {b.retiredAt ? <Badge variant="muted">Removed</Badge> : b.isNew ? <Badge variant="warning">New · no price yet</Badge> : null}
                      {dietText(b) && <div className={styles.muted}>{dietText(b)}</div>}
                      {open?.id === b.id && open.mode === 'rename' && (
                        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); run(() => renameBrand(b.id, text), `Renamed to “${text.trim()}”.`); }}>
                          <input className={lib.textInput} aria-label={`New name for ${b.name}`} value={text} maxLength={60} autoFocus onChange={(e) => setText(e.target.value)} />
                          <Button type="submit" size="sm" variant="primary" disabled={pending || !text.trim() || text.trim() === b.name} title={text.trim() === b.name ? 'No changes to save yet' : undefined}>
                            Save changes
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(null)}>
                            Cancel
                          </Button>
                        </form>
                      )}
                      {open?.id === b.id && open.mode === 'diets' && (
                        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); run(() => setBrandDiets(b.id, diets), `Saved ${b.name}’s diets.`); }}>
                          <label className={styles.listRow}>
                            <input type="checkbox" checked={diets == null} onChange={(e) => setDiets(e.target.checked ? null : [...ing.avoid])} /> Same as {ing.name.toLowerCase()}
                          </label>
                          {diets != null &&
                            RESTRICTIONS.map((r) => (
                              <label key={r.key} className={styles.listRow}>
                                <input
                                  type="checkbox"
                                  checked={diets.includes(r.key)}
                                  onChange={(e) => setDiets((cur) => (e.target.checked ? [...(cur ?? []), r.key] : (cur ?? []).filter((k) => k !== r.key)))}
                                />{' '}
                                Not {r.label.toLowerCase()}
                              </label>
                            ))}
                          <Button type="submit" size="sm" variant="primary" disabled={pending}>
                            Save changes
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(null)}>
                            Cancel
                          </Button>
                        </form>
                      )}
                      {open?.id === b.id && open.mode === 'merge' && (
                        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); run(() => mergeBrand(b.id, target), `Merged “${b.name}” into “${live.find((x) => x.id === target)?.name ?? ''}”.`); }}>
                          <select className={lib.selectInput} aria-label={`Merge ${b.name} into`} value={target} onChange={(e) => setTarget(e.target.value)}>
                            <option value="">Merge into…</option>
                            {mergeTargets.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                          {target && (
                            <span className={styles.muted}>
                              {b.name}’s packages move to {live.find((x) => x.id === target)?.name}, and menus that chose {b.name} will show it instead. This can’t be undone.
                            </span>
                          )}
                          <Button type="submit" size="sm" variant="primary" disabled={pending || !target}>
                            Merge
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(null)}>
                            Cancel
                          </Button>
                        </form>
                      )}
                      {open?.id === b.id && open.mode === 'move' && (
                        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); run(() => moveBrand(b.id, target), `Moved “${b.name}” to ${others.find((x) => x.id === target)?.name ?? ''}.`); }}>
                          <select className={lib.selectInput} aria-label={`Move ${b.name} to`} value={target} onChange={(e) => setTarget(e.target.value)}>
                            <option value="">Move to…</option>
                            {others.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                          {target && <span className={styles.muted}>Menus that chose it under {ing.name} go back to any brand.</span>}
                          <Button type="submit" size="sm" variant="primary" disabled={pending || !target}>
                            Move
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(null)}>
                            Cancel
                          </Button>
                        </form>
                      )}
                    </td>
                    <td>
                      {own.length === 0 ? (
                        <span className={styles.muted}>—</span>
                      ) : (
                        own.map((p) => (
                          <div key={p.id}>
                            {[p.sizeLabel ?? p.name, p.store, money(p.price)].filter(Boolean).join(' · ')}
                          </div>
                        ))
                      )}
                    </td>
                    <td className={styles.actionsCell}>
                      {!b.retiredAt && (
                        <ActionsMenu
                          ariaLabel={`More for ${b.name}`}
                          placeholder="⋯"
                          disabled={pending}
                          options={[
                            { value: 'rename', label: 'Rename…' },
                            { value: 'diets', label: 'Diets…' },
                            ...(mergeTargets.length > 0 ? [{ value: 'merge', label: 'Merge into…' }] : []),
                            // A package's size is in this ingredient's unit, so a priced brand cannot follow.
                            ...(own.length === 0 ? [{ value: 'move', label: 'Move to another ingredient…' }] : []),
                            { value: 'remove', label: 'Remove' }
                          ]}
                          onAction={(v) => {
                            if (v === 'remove') run(() => removeBrand(b.id), `Removed “${b.name}”. Menus that chose it go back to any brand.`);
                            else start_(b, v as Mode);
                          }}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!ing.retiredAt && (
        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); run(() => createBrand(ing.id, adding), `Added “${adding.trim()}”.`); setAdding(''); }}>
          <div>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-brand-new-${ing.id}`}>
              New brand
            </label>
            <input id={`mm-brand-new-${ing.id}`} className={lib.textInput} value={adding} maxLength={60} onChange={(e) => setAdding(e.target.value)} />
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !adding.trim()}>
            Add brand
          </Button>
        </form>
      )}

      {packages.length > 0 && live.length > 0 && (
        <div className={styles.brandPackages}>
          <p className={`adminLabel ${lib.fieldLabel}`}>Which brand each package is</p>
          <ul className={styles.list}>
            {packages.map((p) => (
              <PackageBrandRow key={`${p.id}:${p.brandId ?? ''}:${p.sizeLabel ?? ''}`} pkg={p} brands={live} pending={pending} onSave={(brandId, size) => run(() => setPackageBrand(p.id, brandId, size), `Saved ${p.name}.`)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function PackageBrandRow({ pkg, brands, pending, onSave }: { pkg: Package; brands: Brand[]; pending: boolean; onSave: (brandId: string | null, size: string) => void }) {
  const [brandId, setBrandId] = useState(pkg.brandId ?? '');
  const [size, setSize] = useState(pkg.sizeLabel ?? '');
  const dirty = brandId !== (pkg.brandId ?? '') || size !== (pkg.sizeLabel ?? '');
  return (
    <li className={styles.brandPackageRow}>
      <span>{pkg.name}</span>
      <select className={lib.selectInput} aria-label={`Brand of ${pkg.name}`} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
        <option value="">No brand</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <input className={lib.textInput} aria-label={`Size of ${pkg.name}`} value={size} maxLength={60} placeholder="12 oz" onChange={(e) => setSize(e.target.value)} />
      <Button size="sm" variant="primary" disabled={pending || !dirty} title={dirty ? undefined : 'No changes to save yet'} onClick={() => onSave(brandId || null, size)}>
        {dirty ? 'Save changes' : 'Saved'}
      </Button>
    </li>
  );
}

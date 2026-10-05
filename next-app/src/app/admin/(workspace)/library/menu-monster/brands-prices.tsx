'use client';

/**
 * Menu Monster leader tools — an ingredient's brands and what is priced under each (regrouped 2026-10-05).
 *
 * Patrick, looking at Salt in the Price book: "What is the link between the brand list and the information
 * below? … How is adding a package different than adding a brand? This UX is confusing, both to me and I
 * helped design it." The model was sound (ingredient → brand → package) but the screen showed it three ways:
 * a brands table, a "which brand each package is" list, and a wall of always-open package cards. It is now
 * ONE list that reads the way the shelf does:
 *
 *   Morton                                        ⋯
 *     26 oz · Metro Market · $1.99 · $0.02 per tsp        Edit
 *     + Add a size or store
 *   No brand yet
 *     …
 *   [ Add what you bought ]
 *
 * - A brand is a heading (brands-block.tsx BrandHead: rename, diets, merge, move, remove).
 * - A package is one line under its brand — size, store, price — and opens to edit; its brand and label size
 *   are fields of that editor, not a second list.
 * - Adding is one act: brand (pick or type), size, store, price (actions.ts addBought). The word "package"
 *   never has to be learned.
 *
 * Used by the Price book and by the single-food short form in Food & recipes.
 */
import { useId, useState, useTransition } from 'react';
import { Button } from '../../../_components/button';
import { FormPanel } from '../../../_components/form-panel';
import { Notice } from '../../_components/notice';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { fmtDate } from '@/lib/format-date';
import { money } from '@/lib/event-money';
import { SOLD_UNITS, learnedConversion, learnedText, priceChange, staleText, suggestYield, unusableText } from '@/lib/menu-monster/authoring';
import type { Brand, Catalog, Conversion, Ingredient, Package } from '@/lib/menu-monster/types';
import { addBought, restorePackage, retirePackage, setPackageBrand, updatePackage, type PackageEdit } from './actions';
import { BrandHead, brandsOf } from './brands-block';
import { useArmed } from './use-armed';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

const NEW_BRAND = '__new';

/** "26 oz", "1 gallon", "12 eggs" — a label size as a person says it; null when the label has none. */
export function sizeText(size: number | null, soldUnit: string | null, ing: Ingredient): string | null {
  if (size == null || !Number.isFinite(size) || size <= 0 || !soldUnit) return null;
  const one = size === 1;
  if (soldUnit === 'count') return `${size} ${one ? ing.unit.one : ing.unit.many}`;
  const u = SOLD_UNITS.find((s) => s.key === soldUnit);
  return `${size} ${u ? (one ? u.one : u.many) : soldUnit}`;
}

export function BrandsAndPrices({
  ing,
  catalog,
  today,
  stores,
  onChanged
}: {
  ing: Ingredient;
  catalog: Catalog;
  /** 'YYYY-MM-DD'; null (a caller that has no clock) hides the price-age flags. */
  today: string | null;
  stores: readonly string[];
  onChanged: () => void;
}) {
  const uid = useId();
  /** null = the add form is closed; otherwise the brand it opens on ('' = none chosen). */
  const [adding, setAdding] = useState<string | null>(null);

  const brands = brandsOf(catalog, ing.id);
  const live = brands.filter((b) => !b.retiredAt);
  const removed = brands.filter((b) => b.retiredAt);
  const all = catalog.packages.filter((p) => p.ingredientId === ing.id);
  const active = all.filter((p) => !p.retiredAt);
  const retired = all.filter((p) => p.retiredAt);
  const conversions = catalog.conversions.filter((c) => c.ingredientId === ing.id);
  const unbranded = active.filter((p) => !p.brandId || !live.some((b) => b.id === p.brandId));

  const rows = (packages: Package[], label: string) => (
    <ul className={styles.pkgList} aria-label={label}>
      {packages.map((p) => (
        <PackageRow key={p.id} pkg={p} ing={ing} brands={live} today={today} stores={stores} onChanged={onChanged} />
      ))}
    </ul>
  );

  return (
    <section aria-label={`${ing.name} brands and prices`} className={styles.brands}>
      {live.length === 0 && active.length === 0 && (
        <p className={styles.muted}>Nothing priced yet. Add what you bought so recipes can cost {ing.name.toLowerCase()} out.</p>
      )}

      {live.map((b) => {
        const own = active.filter((p) => p.brandId === b.id);
        const hid = `${uid}-b-${b.id}`;
        return (
          <section key={b.id} className={styles.group} aria-labelledby={hid}>
            <BrandHead brand={b} ing={ing} catalog={catalog} priced={own.length} headingId={hid} onChanged={onChanged} />
            {own.length > 0 && rows(own, `${b.name} sizes and prices`)}
            {!ing.retiredAt && (
              <button type="button" className={`${styles.rowBtn} ${styles.groupAdd}`} aria-label={`Add a size or store for ${b.name}`} onClick={() => setAdding(b.id)}>
                + Add a size or store
              </button>
            )}
          </section>
        );
      })}

      {unbranded.length > 0 && (
        <section className={styles.group} aria-labelledby={`${uid}-none`}>
          <div className={styles.groupHead}>
            <h3 id={`${uid}-none`} className={styles.cardName}>
              No brand yet
            </h3>
          </div>
          {rows(unbranded, 'No brand yet')}
        </section>
      )}

      {retired.length > 0 && (
        <section className={`${styles.group} ${styles.cardRetired}`} aria-labelledby={`${uid}-retired`}>
          <div className={styles.groupHead}>
            <h3 id={`${uid}-retired`} className={styles.cardName}>
              Retired
            </h3>
          </div>
          {rows(retired, 'Retired')}
        </section>
      )}

      {removed.length > 0 && <p className={styles.muted}>Removed brands: {removed.map((b) => b.name).join(', ')}</p>}

      {!ing.retiredAt &&
        (adding != null ? (
          <AddBoughtForm
            key={adding}
            ing={ing}
            brands={live}
            presetBrandId={adding}
            conversions={conversions}
            today={today}
            stores={stores}
            onClose={() => setAdding(null)}
            onChanged={onChanged}
          />
        ) : (
          <div>
            <Button variant="primary" onClick={() => setAdding('')}>
              Add what you bought
            </Button>
          </div>
        ))}
    </section>
  );
}

/* ── One priced thing: a line that opens to edit ─────────────────────────── */

interface PackageDraft {
  name: string;
  store: string;
  price: string;
  asOf: string;
  note: string;
  yield: string;
  brandId: string;
  size: string;
}

function PackageRow({ pkg, ing, brands, today, stores, onChanged }: { pkg: Package; ing: Ingredient; brands: Brand[]; today: string | null; stores: readonly string[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const panel = useId();

  const usable = pkg.yield != null && pkg.yield > 0;
  const size = pkg.sizeLabel?.trim() || sizeText(pkg.soldSize, pkg.soldUnit, ing);
  const stale = today && !pkg.retiredAt ? staleText(pkg.asOf, today) : null;

  return (
    <li className={styles.pkgRow} aria-label={pkg.name}>
      <div className={styles.pkgLine}>
        <span className={styles.grow}>
          <strong>{size ?? pkg.name}</strong>
          {' · '}
          {pkg.store ?? 'store not set'}
          {' · '}
          {money(pkg.price)}
          {usable && (
            <span className={styles.muted}>
              {' · '}
              {money(pkg.price / (pkg.yield as number))} per {ing.unit.one}
            </span>
          )}
          {size && <span className={styles.muted}> · {pkg.name}</span>}
        </span>
        {pkg.asOf && <span className={styles.cardMeta}>{fmtDate(pkg.asOf)}</span>}
        {pkg.retiredAt ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            aria-label={`Restore ${pkg.name}`}
            onClick={() =>
              start(async () => {
                const res = await restorePackage(pkg.id);
                if (!res.ok) setError(res.error ?? 'Could not restore it.');
                else onChanged();
              })
            }
          >
            Restore
          </Button>
        ) : (
          <Button variant="secondary" size="sm" aria-label={`${open ? 'Close' : 'Edit'} ${pkg.name}`} aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => setOpen((v) => !v)}>
            {open ? 'Close' : 'Edit'}
          </Button>
        )}
      </div>
      {!usable && !pkg.retiredAt && <p className={`${styles.readout} ${styles.readoutWarn}`}>{unusableText(pkg, ing)}</p>}
      {stale && <p className={`${styles.readout} ${styles.readoutWarn}`}>{stale}</p>}
      {error && <Notice>{error}</Notice>}
      {open && !pkg.retiredAt && (
        <div id={panel} className={styles.pkgEditor}>
          <PackageEditor pkg={pkg} ing={ing} brands={brands} today={today} stores={stores} onChanged={onChanged} />
        </div>
      )}
    </li>
  );
}

function PackageEditor({ pkg, ing, brands, today, stores, onChanged }: { pkg: Package; ing: Ingredient; brands: Brand[]; today: string | null; stores: readonly string[]; onChanged: () => void }) {
  const initial: PackageDraft = {
    name: pkg.name,
    store: pkg.store ?? '',
    price: pkg.price.toFixed(2),
    asOf: pkg.asOf ?? '',
    note: pkg.note ?? '',
    yield: pkg.yield == null ? '' : String(pkg.yield),
    brandId: brands.some((b) => b.id === pkg.brandId) ? (pkg.brandId as string) : '',
    size: pkg.sizeLabel ?? ''
  };
  const [draft, setDraft] = useState<PackageDraft>(initial);
  const snap = useDraftSnapshot(draft);
  const feedback = useSavePhase();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const retire = useArmed();

  const savedPrice = Number(snap.saved.price);
  const newPrice = Number(draft.price);
  const change = Number.isFinite(newPrice) ? priceChange(savedPrice, newPrice, draft.asOf !== snap.saved.asOf) : null;
  const usable = pkg.yield != null;
  const yieldNum = Number(draft.yield);
  const blocked = !draft.name.trim() || !Number.isFinite(newPrice) || newPrice < 0 || (draft.yield.trim() !== '' && !(yieldNum > 0));
  const idp = `mm-pkg-${pkg.id}`;

  function save() {
    setError(null);
    feedback.start();
    start(async () => {
      const edit: PackageEdit = {
        name: draft.name,
        store: draft.store || null,
        price: newPrice,
        asOf: draft.asOf || null,
        note: draft.note || null,
        yield: draft.yield.trim() === '' ? null : yieldNum,
        yieldUnitLabel: draft.yield.trim() === '' ? (pkg.yieldUnitLabel ?? pkg.soldUnit ?? 'label size') : null,
        soldSize: pkg.soldSize,
        soldUnit: pkg.soldUnit,
        noun: pkg.noun
      };
      let res: { ok: boolean; error?: string } = await updatePackage(pkg.id, edit);
      // Which brand it is and the size on its label live beside the package, saved in the same click.
      if (res.ok && (draft.brandId !== snap.saved.brandId || draft.size !== snap.saved.size)) {
        res = await setPackageBrand(pkg.id, draft.brandId || null, draft.size);
      }
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      snap.markSaved();
      feedback.done();
      onChanged();
    });
  }

  return (
    <>
      {error && <Notice>{error}</Notice>}
      <div className={lib.fieldGrid}>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-price`}>
            Price
          </label>
          <input
            id={`${idp}-price`}
            className={lib.textInput}
            inputMode="decimal"
            value={draft.price}
            onChange={(e) => {
              const price = e.target.value;
              // A new price is a price as of today unless the leader says otherwise.
              setDraft((d) => ({ ...d, price, asOf: today && Number(price) !== savedPrice ? today : d.asOf }));
            }}
          />
          {change?.text && <p className={`${styles.readout}${change.big ? ` ${styles.readoutWarn}` : ''}`}>{change.text}</p>}
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-asof`}>
            Price as of
          </label>
          <input
            id={`${idp}-asof`}
            type="date"
            max={today ?? undefined}
            className={lib.textInput}
            value={draft.asOf}
            onChange={(e) => setDraft((d) => ({ ...d, asOf: e.target.value }))}
          />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-store`}>
            Store
          </label>
          <select id={`${idp}-store`} className={lib.selectInput} value={draft.store} onChange={(e) => setDraft((d) => ({ ...d, store: e.target.value }))}>
            <option value="">— not set —</option>
            {/* A package keeps its store even after the store is retired. */}
            {(pkg.store && !stores.includes(pkg.store) ? [...stores, pkg.store] : stores).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-brand`}>
            Brand
          </label>
          <select id={`${idp}-brand`} className={lib.selectInput} value={draft.brandId} onChange={(e) => setDraft((d) => ({ ...d, brandId: e.target.value }))}>
            <option value="">No brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-size`}>
            Size on the label
          </label>
          <input id={`${idp}-size`} className={lib.textInput} value={draft.size} maxLength={60} placeholder="12 oz" onChange={(e) => setDraft((d) => ({ ...d, size: e.target.value }))} />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-yield`}>
            How many {ing.unit.many} it makes
          </label>
          <input
            id={`${idp}-yield`}
            className={lib.textInput}
            inputMode="decimal"
            value={draft.yield}
            placeholder={usable ? undefined : 'Type it so menus can use this'}
            onChange={(e) => setDraft((d) => ({ ...d, yield: e.target.value }))}
          />
        </div>
        <div className={lib.fieldFull}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-name`}>
            Product name
          </label>
          <input id={`${idp}-name`} className={lib.textInput} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </div>
        <div className={lib.fieldFull}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-note`}>
            Note
          </label>
          <input id={`${idp}-note`} className={lib.textInput} value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
        </div>
      </div>
      <div className={lib.actionsRow}>
        <SaveButton dirty={snap.dirty} pending={pending} blocked={blocked} blockedReason="Name, a price, and a yield above zero (or blank) are needed" onClick={save} />
        <DiscardButton dirty={snap.dirty} pending={pending} onClick={() => setDraft(snap.saved)} />
        <SaveFeedback phase={feedback.phase} />
        <span className={styles.spacer} />
        <Button
          variant="quiet"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (retire.arm())
              start(async () => {
                const res = await retirePackage(pkg.id);
                if (!res.ok) setError(res.error ?? 'Could not retire it.');
                else onChanged();
              });
          }}
        >
          {retire.armed ? 'Click again to retire' : 'Retire'}
        </Button>
      </div>
    </>
  );
}

/* ── Add what you bought (create-once): brand + size + store + price ─────── */

function AddBoughtForm({
  ing,
  brands,
  presetBrandId,
  conversions,
  today,
  stores,
  onClose,
  onChanged
}: {
  ing: Ingredient;
  brands: Brand[];
  presetBrandId: string;
  conversions: Conversion[];
  today: string | null;
  stores: readonly string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [brandId, setBrandId] = useState(presetBrandId);
  const [newBrand, setNewBrand] = useState('');
  const [name, setName] = useState('');
  const [store, setStore] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [soldUnit, setSoldUnit] = useState('');
  const [yieldText, setYieldText] = useState('');
  const [yieldTouched, setYieldTouched] = useState(false);
  const [asOf, setAsOf] = useState(today ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const feedback = useSavePhase();

  const typingBrand = brandId === NEW_BRAND;
  const brandName = typingBrand ? newBrand.trim() : (brands.find((b) => b.id === brandId)?.name ?? '');
  const sizeNum = size.trim() === '' ? null : Number(size);
  const validSize = sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : null;
  const label = sizeText(validSize, soldUnit || null, ing);
  // The product name is optional: brand + food + size says it ("Morton Salt, 26 oz").
  const autoName = [[brandName, ing.name].filter(Boolean).join(' '), label].filter(Boolean).join(', ');
  const productName = name.trim() || autoName;
  const suggestion = suggestYield(ing, validSize, soldUnit || null, conversions);
  const effectiveYield = yieldTouched ? yieldText : suggestion.value == null ? '' : String(suggestion.value);
  const yieldNum = effectiveYield.trim() === '' ? null : Number(effectiveYield);
  const priceNum = Number(price);
  const ready = price.trim() !== '' && Number.isFinite(priceNum) && priceNum >= 0 && (yieldNum == null || yieldNum > 0) && (!typingBrand || brandName.length > 0);
  const perUnit = yieldNum != null && yieldNum > 0 && Number.isFinite(priceNum) ? priceNum / yieldNum : null;
  // A typed yield with nothing on file to suggest it IS the conversion; saving
  // saves it too (actions.ts rememberConversion) — said before the click.
  const learned = learnedConversion(ing, validSize, soldUnit || null, yieldNum != null && Number.isFinite(yieldNum) ? yieldNum : null, conversions, productName);
  const idp = `mm-add-${ing.id}`;

  function submit() {
    setError(null);
    feedback.start();
    start(async () => {
      const res = await addBought({
        ingredientId: ing.id,
        name: productName,
        store: store || null,
        price: priceNum,
        soldSize: validSize,
        soldUnit: soldUnit || null,
        yield: yieldNum,
        yieldUnitLabel: yieldNum == null ? soldUnit || 'label size' : null,
        noun: soldUnit === 'dozen' ? 'dozen' : soldUnit === 'each' ? 'each' : 'pack',
        asOf: asOf || null,
        note: note || null,
        brandId: typingBrand ? null : brandId || null,
        newBrand: typingBrand ? brandName : null,
        sizeLabel: label
      });
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Something went wrong.');
        // The package may have landed even though its brand did not: show it.
        if (res.id) onChanged();
        return;
      }
      feedback.done();
      onChanged();
      onClose();
    });
  }

  return (
    <FormPanel title="Add what you bought" aria-label="Add what you bought" actions={<SaveFeedback phase={feedback.phase} />}>
      {error && <Notice>{error}</Notice>}
      <div className={lib.fieldGrid}>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-brand`}>
            Brand
          </label>
          <select id={`${idp}-brand`} className={lib.selectInput} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">No brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            <option value={NEW_BRAND}>A new brand…</option>
          </select>
        </div>
        <div>
          {typingBrand && (
            <>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-newbrand`}>
                New brand
              </label>
              <input id={`${idp}-newbrand`} className={lib.textInput} value={newBrand} maxLength={60} autoFocus onChange={(e) => setNewBrand(e.target.value)} />
            </>
          )}
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-size`}>
            Package size
          </label>
          <input id={`${idp}-size`} className={lib.textInput} inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 26" />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-sold`}>
            Sold by
          </label>
          <select id={`${idp}-sold`} className={lib.selectInput} value={soldUnit} onChange={(e) => setSoldUnit(e.target.value)}>
            <option value="">— pick —</option>
            {SOLD_UNITS.map((u) => (
              <option key={u.key} value={u.key}>
                {u.key === 'count' ? `${ing.unit.many} (count)` : u.one === u.many ? u.one : `${u.one} / ${u.many}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-store`}>
            Store
          </label>
          <select id={`${idp}-store`} className={lib.selectInput} value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">— pick —</option>
            {stores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-price`}>
            Price
          </label>
          <input id={`${idp}-price`} className={lib.textInput} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </div>
        <div className={lib.fieldFull}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-yield`}>
            How many {ing.unit.many} it makes
          </label>
          <input
            id={`${idp}-yield`}
            className={lib.textInput}
            inputMode="decimal"
            value={effectiveYield}
            onChange={(e) => {
              setYieldTouched(true);
              setYieldText(e.target.value);
            }}
          />
          <p className={styles.hint}>
            <span>{learned ? `Saves ${learnedText(learned, ing)} as the conversion for ${ing.name}.` : suggestion.text}</span>
            {suggestion.sub ? <span className={styles.muted}> {suggestion.sub}</span> : null}
            {yieldTouched && suggestion.value != null && String(suggestion.value) !== yieldText ? (
              <>
                {' '}
                <button
                  type="button"
                  className={styles.rowBtn}
                  onClick={() => {
                    setYieldTouched(false);
                    setYieldText('');
                  }}
                >
                  Use {suggestion.value}
                </button>
              </>
            ) : null}
            {perUnit != null ? <> · {money(perUnit)} per {ing.unit.one}</> : null}
          </p>
        </div>
        <div className={lib.fieldFull}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-name`}>
            Product name (optional)
          </label>
          <input id={`${idp}-name`} className={lib.textInput} value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName} />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-asof`}>
            Price as of
          </label>
          <input id={`${idp}-asof`} type="date" max={today ?? undefined} className={lib.textInput} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-note`}>
            Note
          </label>
          <input id={`${idp}-note`} className={lib.textInput} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </div>
      </div>
      <div className={lib.actionsRow}>
        <Button variant="primary" disabled={pending || !ready} title={ready ? undefined : typingBrand && !brandName ? 'Name the new brand' : 'A price is needed'} onClick={submit}>
          {pending ? 'Adding…' : 'Add'}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </FormPanel>
  );
}

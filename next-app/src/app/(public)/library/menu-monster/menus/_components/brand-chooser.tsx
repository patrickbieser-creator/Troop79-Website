'use client';

/**
 * The brand chooser for one ingredient on a menu (Plans/Menu-Monster-Brands-Gear.md, release 3; prototype
 * concept-f-kinds/plan.html). A meal plan can ask for cookies with any brand, name one, or name several
 * (Rice Chex, Frosted Flakes and Cheerios) — one set per ingredient for the whole menu.
 *
 *   - chips: "Any brand" first (pressing it clears the rest), then the known brands, cheapest first, each with
 *     its price; a brand nobody has priced yet is tagged New. Multi-select toggle buttons (aria-pressed).
 *   - a dashed "Type a brand" field: Enter adds it. A typed brand joins the troop's list at once (Patrick,
 *     2026-10-03) and gets its first price when someone records buying it. Only when `onType` is given
 *     (a signed-in person).
 *   - with two or more brands chosen: one line per brand with how many packages of it, and what the menu needs
 *     against what it is buying. Buying extra is never blocked; buying short is said.
 *
 * Brand detail (Plans/Menu-Monster-Brand-Detail.md): a chip tap still only picks. A dialog for a brand's size,
 * price and store opens when a brand is typed and from the size control in the brand's quantity row ("size?" while
 * it has no package of its own, else its size). Only when `onPackageAdded` is given (a signed-in person).
 *
 * It holds no menu state: `picks` in, `onChange` out. `line` is the menu's priced line for the ingredient
 * (lib/menu-monster/engine priceNeeds), which carries each brand's package and count.
 */

import { useContext, useId, useState, useTransition, type KeyboardEvent } from 'react';
import { NumberBox } from '@/app/_components/stepper';
import type { Brand, BrandPick, Catalog, Ingredient, ShoppingLine } from '@/lib/menu-monster/types';
import { isUsable, livePicks, packCount, MAX_BRANDS_PER_INGREDIENT } from '@/lib/menu-monster/engine';
import { priceText as money, qtyText } from '@/lib/menu-monster/units';
import { BrandDetailDialog } from './brand-detail-dialog';
import type { AddedPackage } from './add-package-form';
import { StoreNames } from './store-names';
import s from './workspace.module.css';

export interface BrandChooserProps {
  ingredient: Ingredient;
  catalog: Catalog;
  picks: readonly BrandPick[];
  /** The menu's priced line for this ingredient, when it is on the list. */
  line?: ShoppingLine;
  onChange: (next: BrandPick[]) => void;
  /** Add a typed brand; resolves to the brand to select, or an error to show. Absent = brands cannot be typed here. */
  onType?: (name: string) => Promise<{ ok: true; brand: Brand } | { ok: false; error: string }>;
  onAnnounce?: (text: string) => void;
  /** A size and price saved for a brand (it joins the page's catalog). Absent = brands cannot be sized here. */
  onPackageAdded?: (a: AddedPackage) => void;
}

/** A brand's cheapest usable package price, or null when nobody has priced it. */
export function brandPrice(brand: Brand, catalog: Catalog): number | null {
  const prices = catalog.packages.filter((p) => p.brandId === brand.id && isUsable(p) && !p.retiredAt).map((p) => p.price);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/** The ingredient's live brands as the chooser lists them: priced ones cheapest first, then unpriced A to Z. */
export function brandsFor(ingredientId: string, catalog: Catalog): { brand: Brand; price: number | null }[] {
  return (catalog.brands ?? [])
    .filter((b) => b.ingredientId === ingredientId && !b.retiredAt)
    .map((brand) => ({ brand, price: brandPrice(brand, catalog) }))
    .sort((a, b) => Number(a.price == null) - Number(b.price == null) || (a.price ?? 0) - (b.price ?? 0) || a.brand.name.localeCompare(b.brand.name));
}

/** "any brand", "Rice Chex", "Rice Chex, Frosted Flakes +2" — the quiet text beside an ingredient's name. */
export function brandSummary(picks: readonly BrandPick[] | undefined, ingredientId: string, catalog: Catalog): string | null {
  const live = livePicks(picks, ingredientId, catalog);
  if (live.length === 0) return (catalog.brands ?? []).some((b) => b.ingredientId === ingredientId && !b.retiredAt) ? 'any brand' : null;
  const names = live.map((x) => x.brand.name);
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

export function BrandChooser({ ingredient, catalog, picks, line, onChange, onType, onAnnounce, onPackageAdded }: BrandChooserProps) {
  const uid = useId();
  const stores = useContext(StoreNames);
  /** The brand whose detail dialog is open, and the control that opened it (focus goes back there). */
  const [detail, setDetail] = useState<{ brand: Brand; opener: 'chip' | 'noun' } | null>(null);
  const chipId = (b: Brand) => `${uid}-chip-${b.id}`;
  const nounId = (b: Brand) => `${uid}-noun-${b.id}`;
  const closeDetail = () => {
    const d = detail;
    setDetail(null);
    if (d) requestAnimationFrame(() => (document.getElementById(d.opener === 'noun' ? nounId(d.brand) : chipId(d.brand)) ?? document.getElementById(chipId(d.brand)))?.focus());
  };
  const packageSaved = (a: AddedPackage) => {
    const d = detail;
    onPackageAdded?.(a);
    closeDetail();
    if (!d) return;
    onAnnounce?.(
      a.status === 'held'
        ? `${d.brand.name} saved: ${a.pkg.sizeLabel ?? 'size'} at ${money(a.pkg.price)}. A leader checks it first.`
        : a.status === 'same'
          ? 'That package is already in the price book.'
          : `${d.brand.name} saved: ${a.pkg.sizeLabel ?? 'size'} at ${money(a.pkg.price)}.`
    );
  };
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const all = brandsFor(ingredient.id, catalog);
  const live = livePicks(picks, ingredient.id, catalog);
  const chosen = new Set(live.map((x) => x.brand.id));
  const full = live.length >= MAX_BRANDS_PER_INGREDIENT;
  const cheapest = all.find((x) => x.price != null)?.price ?? null;

  const toggle = (brand: Brand) => {
    setError(null);
    if (chosen.has(brand.id)) {
      onChange(live.filter((x) => x.brand.id !== brand.id).map((x) => ({ brandId: x.brand.id, qty: null })));
      onAnnounce?.(`${brand.name} taken off ${ingredient.name}.`);
    } else if (!full) {
      // A changed set starts from an even split again: the old counts were for the old set.
      onChange([...live.map((x) => ({ brandId: x.brand.id, qty: null })), { brandId: brand.id, qty: null }]);
      onAnnounce?.(`${brand.name} chosen for ${ingredient.name}.`);
    }
  };
  const anyBrand = () => {
    setError(null);
    onChange([]);
    onAnnounce?.(`${ingredient.name}: any brand.`);
  };
  const setQty = (brandId: string, qty: number | null) => onChange(live.map((x) => ({ brandId: x.brand.id, qty: x.brand.id === brandId ? qty : x.qty })));

  function submitTyped() {
    const name = typed.trim();
    if (!name || !onType || busy) return;
    const existing = all.find((x) => x.brand.name.toLowerCase().replace(/[^a-z0-9]+/g, '') === name.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (existing) {
      setTyped('');
      if (!chosen.has(existing.brand.id)) toggle(existing.brand);
      return;
    }
    setError(null);
    start(async () => {
      const res = await onType(name);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTyped('');
      if (!chosen.has(res.brand.id) && !full) onChange([...live.map((x) => ({ brandId: x.brand.id, qty: null })), { brandId: res.brand.id, qty: null }]);
      onAnnounce?.(`${res.brand.name} added and chosen for ${ingredient.name}.`);
      // The facts are at hand right now: ask for them (Plans/Menu-Monster-Brand-Detail.md, decision 4).
      if (onPackageAdded) setDetail({ brand: res.brand, opener: 'chip' });
    });
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitTyped();
    }
  }

  const parts = line?.parts ?? [];
  const covered = parts.reduce((n, x) => n + x.qty * (x.pkg.yield ?? 0), 0);
  const unpriced = live.filter((x) => x.brand.isNew);

  return (
    <div className={s.brandChooser}>
      {all.length > 0 && (
        <div className={s.chips} role="group" aria-label={`Brand for ${ingredient.name}`}>
          <button type="button" className={s.chip} aria-pressed={live.length === 0} onClick={anyBrand}>
            Any brand
          </button>
          {all.map(({ brand, price }) => (
            <button key={brand.id} id={chipId(brand)} type="button" className={s.chip} aria-pressed={chosen.has(brand.id)} disabled={full && !chosen.has(brand.id)} onClick={() => toggle(brand)}>
              {brand.name}
              {price != null ? <span className={s.chipMeta}> {money(price)}</span> : <span className={s.chipMeta}> New</span>}
            </button>
          ))}
        </div>
      )}
      {onType && (
        <input
          type="text"
          className={`${s.addInput} ${s.brandType}`}
          value={typed}
          maxLength={60}
          autoComplete="off"
          disabled={busy}
          aria-label={`Type a brand of ${ingredient.name}`}
          placeholder="Type a brand"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={onKey}
        />
      )}
      {error && (
        <p className={s.fieldError} role="alert">
          {error}
        </p>
      )}

      {parts.length >= 2 && line && (
        <>
          <ul className={s.plainList} aria-label={`How many of each brand of ${ingredient.name}`}>
            {parts.map((x) => (
              <li key={x.brand.id} className={s.brandLine}>
                <label className={s.brandLineName} htmlFor={`${uid}-q-${x.brand.id}`}>
                  {x.brand.name}
                </label>
                <span className={s.qtyBox}>
                  <NumberBox
                    id={`${uid}-q-${x.brand.id}`}
                    value={x.qty}
                    min={0}
                    max={99}
                    onCommit={(n) => setQty(x.brand.id, n === x.autoQty ? null : n)}
                    ariaLabel={`Packages of ${x.brand.name}`}
                  />
                </span>
                {onPackageAdded ? (
                  <button
                    type="button"
                    id={nounId(x.brand)}
                    className={`${s.meta} ${s.nounBtn}`}
                    aria-label={x.estimated ? `Add size and price for ${x.brand.name}` : `Change size or price for ${x.brand.name}`}
                    onClick={() => setDetail({ brand: x.brand, opener: 'noun' })}
                  >
                    {x.estimated ? 'size?' : (x.pkg.sizeLabel ?? x.pkg.name)}
                  </button>
                ) : (
                  // Never the ingredient's name: a brand with no package of its own has no size to say yet.
                  !x.estimated && <span className={s.meta}>{x.pkg.sizeLabel ?? x.pkg.name}</span>
                )}
              </li>
            ))}
          </ul>
          <p className={s.insetMuted}>
            Need {qtyText(line.need, ingredient.unit)} · buying {qtyText(covered, ingredient.unit)}
            {line.status === 'short' ? ` · ${qtyText(line.shortQty, ingredient.unit)} short` : ''}
          </p>
        </>
      )}
      {parts.length === 1 && onPackageAdded && (
        <p className={s.insetMuted}>
          Size:{' '}
          <button
            type="button"
            id={nounId(parts[0].brand)}
            className={s.nounBtn}
            aria-label={parts[0].estimated ? `Add size and price for ${parts[0].brand.name}` : `Change size or price for ${parts[0].brand.name}`}
            onClick={() => setDetail({ brand: parts[0].brand, opener: 'noun' })}
          >
            {parts[0].estimated ? 'size?' : (parts[0].pkg.sizeLabel ?? parts[0].pkg.name)}
          </button>
        </p>
      )}
      {parts.length === 1 && line && line.status === 'short' && (
        <p className={s.insetMuted}>
          {packCount(parts[0].qty, parts[0].pkg)} is {qtyText(line.shortQty, ingredient.unit)} short.
        </p>
      )}
      {unpriced.length > 0 && cheapest != null && <p className={s.insetMuted}>No price yet — about {money(cheapest)}, cheapest known.</p>}
      {(all.length > 0 || onType) && <p className={s.insetMuted}>For this whole menu.</p>}
      {detail && onPackageAdded && (
        <BrandDetailDialog ingredient={ingredient} brand={detail.brand} conversions={catalog.conversions} stores={stores} onAdded={packageSaved} onClose={closeDetail} />
      )}
    </div>
  );
}

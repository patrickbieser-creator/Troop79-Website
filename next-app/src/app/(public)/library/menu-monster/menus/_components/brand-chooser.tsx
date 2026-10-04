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
 * It holds no menu state: `picks` in, `onChange` out. `line` is the menu's priced line for the ingredient
 * (lib/menu-monster/engine priceNeeds), which carries each brand's package and count.
 */

import { useId, useState, useTransition, type KeyboardEvent } from 'react';
import { Stepper } from '@/app/_components/stepper';
import type { Brand, BrandPick, Catalog, Ingredient, ShoppingLine } from '@/lib/menu-monster/types';
import { isUsable, livePicks, packCount, MAX_BRANDS_PER_INGREDIENT } from '@/lib/menu-monster/engine';
import { priceText as money, qtyText } from '@/lib/menu-monster/units';
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

export function BrandChooser({ ingredient, catalog, picks, line, onChange, onType, onAnnounce }: BrandChooserProps) {
  const uid = useId();
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
            <button key={brand.id} type="button" className={s.chip} aria-pressed={chosen.has(brand.id)} disabled={full && !chosen.has(brand.id)} onClick={() => toggle(brand)}>
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
                <span className={s.brandLineName}>{x.brand.name}</span>
                <Stepper
                  id={`${uid}-q-${x.brand.id}`}
                  value={x.qty}
                  min={0}
                  max={99}
                  onChange={(n) => setQty(x.brand.id, n === x.autoQty ? null : n)}
                  groupLabel={`Packages of ${x.brand.name}`}
                  inputLabel={`Packages of ${x.brand.name}`}
                  lessLabel={`One fewer ${x.brand.name}`}
                  moreLabel={`One more ${x.brand.name}`}
                />
                <span className={s.meta}>{x.pkg.sizeLabel ?? x.pkg.name}</span>
              </li>
            ))}
          </ul>
          <p className={s.insetMuted}>
            Need {qtyText(line.need, ingredient.unit)} · buying {qtyText(covered, ingredient.unit)}
            {line.status === 'short' ? ` · ${qtyText(line.shortQty, ingredient.unit)} short` : ''}
          </p>
        </>
      )}
      {parts.length === 1 && line && line.status === 'short' && (
        <p className={s.insetMuted}>
          {packCount(parts[0].qty, parts[0].pkg)} is {qtyText(line.shortQty, ingredient.unit)} short.
        </p>
      )}
      {unpriced.length > 0 && cheapest != null && <p className={s.insetMuted}>No price yet — about {money(cheapest)}, cheapest known.</p>}
      {(all.length > 0 || onType) && <p className={s.insetMuted}>For this whole menu.</p>}
    </div>
  );
}

'use client';

/**
 * "What we bought" — a menu's fourth tab (Plans/Menu-Monster-Brands-Gear.md, release 4; prototype
 * concept-f-kinds/bought.html). It replaces "What you paid".
 *
 * The checklist is PREFILLED: every line the menu buys starts checked, "as planned", with the expected price
 * already in the box. Whoever has the receipt — often not the planner, and up to a week later — touches only
 * what differed: type a price, or open the row (its name is a disclosure; several stay open) for the choices,
 * which sit right there: Didn't buy it, Different brand, Add another brand. Each row shows who recorded it.
 *
 *   - Enter in a price box moves to the next row's price; it never submits. Save is the button.
 *   - a line nobody touched reads "not confirmed" until someone ticks "We're done shopping"; after that it
 *     counts as bought as planned, and the total stops saying "projected".
 *   - a price far from the troop's (±30%) is kept on the menu and held for a leader — the row says so after Save.
 *   - a food with NO PRICE YET is on the list too (most start that way — Patrick, 2026-10-05): nothing is
 *     prefilled, the row says "No price yet", and ticking it asks what was bought. Naming the brand and the
 *     size gives the price book its first price for that food; "Just the price" records the spend only.
 *
 * `canRecord`: the owner, any signed-in scout on an outing's menu, a leader. Everyone else who may open the
 * menu reads the same rows as text.
 */

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { fmtDate } from '@/lib/format-date';
import type { Catalog, Conversion, Ingredient } from '@/lib/menu-monster/types';
import type { Menu } from '@/lib/menu-monster/menus';
import { buildMenuList, mealTitle } from '@/lib/menu-monster/menu-view';
import { boughtRows, boughtTotals, brandPackage, itemBrand, recorders, type Bought, type BoughtItem, type BoughtRow } from '@/lib/menu-monster/bought';
import { packageSizeUnits } from '@/lib/menu-monster/scout-packages';
import { priceText as money, qtyText } from '@/lib/menu-monster/units';
import { saveBoughtAction, setShoppingDoneAction, type LineOutcome } from '../../../_tools/menu-monster/bought-actions';
import { brandsFor } from './brand-chooser';
import { SaveBar } from './save-bar';
import s from './workspace.module.css';

/** An item as the scout is editing it: the price is text until Save; "something else" carries the new brand. */
interface DraftItem {
  brandId: string | null;
  packageId: string | null;
  qty: number;
  price: string;
  /** The price this box showed before the scout touched it: only a changed price reaches the price book. */
  seen?: number;
  newBrand?: { name: string; size: string; sizeUnit: string };
}
type DraftLine = { status: 'bought'; items: DraftItem[] } | { status: 'not_bought' };

const toDraft = (items: readonly BoughtItem[]): DraftItem[] => items.map((x) => ({ brandId: x.brandId, packageId: x.packageId, qty: x.qty, price: x.pricePaid.toFixed(2), seen: x.pricePaid }));
/** Dollars and cents only: "5", "5.", "5.4", "$5.49". No commas ("5,50" is not 550), no exponents. */
const PRICE = /^\$?\s*\d{1,4}(\.\d{0,2})?$/;
const priceOf = (text: string) => Number(text.trim().replace(/^\$\s*/, ''));
const validPrice = (text: string) => {
  if (!PRICE.test(text.trim())) return false;
  const n = priceOf(text);
  return Number.isFinite(n) && n >= 0.01 && n <= 9999.99;
};

export interface BoughtTabProps {
  catalog: Catalog;
  menuId: string;
  menu: Menu;
  bought: Bought;
  /** The old "What you paid" entries, shown for a line until it is recorded the new way. */
  legacy?: Bought['lines'];
  canRecord: boolean;
  tabs?: ReactNode;
  aside?: ReactNode;
}

export function BoughtTab({ catalog, menuId, menu, bought: initial, legacy, canRecord, tabs, aside }: BoughtTabProps) {
  const uid = useId();
  const [stored, setBought] = useState<Bought>(initial);
  // A stored line wins over an old entry; the old ones never go back to the server.
  const bought: Bought = legacy ? { ...stored, lines: { ...legacy, ...stored.lines } } : stored;
  const [edits, setEdits] = useState<Record<string, DraftLine>>({});
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  /** Which row is choosing a brand: replacing its (first) brand, or adding one. */
  const [choosing, setChoosing] = useState<{ ing: string; mode: 'different' | 'another' } | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [outcomes, setOutcomes] = useState<Record<string, LineOutcome>>({});
  const listRef = useRef<HTMLFieldSetElement>(null);

  const list = buildMenuList(menu, catalog);
  const rows = boughtRows(list.lines, bought);
  const totals = boughtTotals(rows, bought.done != null);
  const who = recorders(bought);
  const dirty = Object.keys(edits).length > 0;
  const mealOf = new Map(menu.meals.map((m) => [m.id, m]));

  const draftOf = (r: BoughtRow): DraftLine => edits[r.line.ing.id] ?? (r.state === 'not_bought' ? { status: 'not_bought' } : { status: 'bought', items: toDraft(r.items) });
  /** A food with no price yet: start recording it. With brands on file the scout picks one; otherwise the row
   *  opens on "which brand, what size" — the food's first price. */
  const startUnpriced = (r: BoughtRow) => {
    const ing = r.line.ing;
    const known = brandsFor(ing.id, catalog).length > 0;
    setLine(ing.id, { status: 'bought', items: known ? [] : [{ brandId: null, packageId: null, qty: 1, price: '', newBrand: { name: '', size: '', sizeUnit: ing.unit.key } }] });
    setOpen((cur) => new Set(cur).add(ing.id));
    setChoosing(known ? { ing: ing.id, mode: 'different' } : null);
  };
  const setLine = (ing: string, line: DraftLine) => {
    setEdits((cur) => ({ ...cur, [ing]: line }));
    setJustSaved(false);
    setError(null);
    setStatus('');
  };
  const setItems = (r: BoughtRow, f: (items: DraftItem[]) => DraftItem[]) => {
    const d = draftOf(r);
    setLine(r.line.ing.id, { status: 'bought', items: f(d.status === 'bought' ? d.items : toDraft(r.planned)) });
  };
  const toggleOpen = (ing: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(ing)) next.add(ing);
      return next;
    });

  const brandName = (item: Pick<DraftItem, 'brandId' | 'packageId' | 'newBrand'>) =>
    item.newBrand ? item.newBrand.name || 'New brand' : (itemBrand({ brandId: item.brandId, packageId: item.packageId, qty: 0, pricePaid: 0 }, catalog)?.name ?? 'any brand');

  /** Enter in a price box: on to the next price box; never a submit. */
  function onPriceKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const boxes = [...(listRef.current?.querySelectorAll<HTMLInputElement>('input[data-price]') ?? [])];
    const at = boxes.indexOf(e.currentTarget);
    boxes[at + 1]?.focus();
    boxes[at + 1]?.select();
  }

  /** What stops Save, or null. */
  const problem = (() => {
    for (const [ing, d] of Object.entries(edits)) {
      if (d.status !== 'bought') continue;
      const name = rows.find((r) => r.line.ing.id === ing)?.line.ing.name ?? ing;
      if (d.items.length === 0) return `Say what was bought for ${name.toLowerCase()}, or undo it.`;
      for (const it of d.items) {
        if (!validPrice(it.price)) return `Enter what ${name} cost.`;
        if (it.newBrand && (!it.newBrand.name.trim() || !(Number(it.newBrand.size) > 0))) return `Say which brand of ${name.toLowerCase()} it was and how much one package holds.`;
      }
    }
    return null;
  })();

  async function save() {
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {};
    for (const [ing, d] of Object.entries(edits)) {
      payload[ing] =
        d.status === 'not_bought'
          ? { status: 'not_bought' }
          : {
              status: 'bought',
              items: d.items.map((it) => ({
                brandId: it.brandId,
                packageId: it.packageId,
                qty: it.qty,
                pricePaid: Math.round(priceOf(it.price) * 100) / 100,
                ...(it.seen != null ? { seen: it.seen } : {}),
                ...(it.newBrand
                  ? { newBrand: { name: it.newBrand.name.trim(), size: Number(it.newBrand.size), sizeUnit: it.newBrand.sizeUnit, sizeLabel: sizeUnitLabel(rows.find((r) => r.line.ing.id === ing)?.line.ing, it.newBrand.sizeUnit, catalog.conversions) } }
                  : {})
              }))
            };
    }
    let res: Awaited<ReturnType<typeof saveBoughtAction>>;
    try {
      res = await saveBoughtAction(menuId, payload);
    } catch {
      res = { ok: false, error: 'Something went wrong saving this. Try again.' };
    }
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBought(res.bought);
    setOutcomes((cur) => ({ ...cur, ...res.results }));
    setEdits({});
    setChoosing(null);
    setJustSaved(true);
    const held = Object.values(res.results).filter((o) => o === 'held').length;
    setStatus(held > 0 ? `Saved. ${held === 1 ? 'One price is' : `${held} prices are`} a long way from the troop’s, so a leader will check ${held === 1 ? 'it' : 'them'}.` : 'Saved.');
  }

  function discard() {
    setEdits({});
    setChoosing(null);
    setError(null);
    setStatus('');
  }

  async function setDone(done: boolean) {
    setError(null);
    const res = await setShoppingDoneAction(menuId, done);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBought(res.bought);
    setStatus(done ? 'Shopping is marked done.' : 'Shopping is open again.');
  }

  return (
    <div>
      <div className={s.titleLine}>
        <h1 className={s.menuTitle}>{menu.name.trim() || 'Untitled menu'}</h1>
        {canRecord && <SaveBar isNew={false} dirty={dirty} saving={saving} saved={justSaved} onSave={() => void save()} onDiscard={discard} />}
      </div>
      {aside}
      {tabs != null && <div className={s.tabs}>{tabs}</div>}

      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}

      {rows.length === 0 ? (
        <p className={s.foot}>Nothing to buy yet. Food on the Plan tab shows up here.</p>
      ) : (
        <section aria-labelledby={`${uid}-h`}>
          <div className={s.secHead}>
            <h2 id={`${uid}-h`} className={s.heading}>
              What we bought
            </h2>
            <span className={s.meta}>Price each</span>
          </div>
          <p className={s.shopLine}>
            <strong>{money(totals.paid)}</strong>{' '}
            <span className={s.muted}>
              {totals.projected ? 'projected' : 'paid'} · planned {money(totals.planned)} · {totals.bought + totals.notBought} of {totals.total} recorded
              {totals.noPrice > 0 ? ` · ${totals.noPrice} with no price yet` : ''}
            </span>
          </p>
          {who.names.length > 0 && who.latest && (
            <p className={s.foot}>
              Recorded by {who.names.length <= 2 ? who.names.join(' and ') : `${who.names.slice(0, -1).join(', ')} and ${who.names[who.names.length - 1]}`} · {fmtDate(who.latest)}
            </p>
          )}

          {/* While a save is in flight nothing can be typed that the save's result would wipe. */}
          <fieldset ref={listRef} className={s.plainFieldset} disabled={saving}>
            <ul className={s.card} aria-label="What we bought">
              {rows.map((r) => {
                const ing = r.line.ing;
                const d = draftOf(r);
                const edited = ing.id in edits;
                const isOpen = open.has(ing.id);
                const panel = `${uid}-b-${ing.id}`;
                const items = d.status === 'bought' ? d.items : [];
                const notBought = d.status === 'not_bought';
                // No price yet and nobody has started recording it: nothing is prefilled.
                const waiting = r.state === 'no_price' && !edited;
                const meals = r.line.sources.length > 0 ? mealsOf(list, ing.id, mealOf, menu) : [];
                const stateText = edited
                  ? 'changed, not saved'
                  : r.state === 'no_price'
                    ? 'not recorded'
                    : r.state === 'unconfirmed'
                      ? 'not confirmed'
                      : r.state === 'as_planned'
                        ? 'as planned'
                        : r.state === 'not_bought'
                          ? 'not bought'
                          : r.planned.length === 0
                            ? 'recorded'
                            : 'changed';
                const sum = items.reduce((n, x) => n + x.qty * (validPrice(x.price) ? priceOf(x.price) : 0), 0);
                return (
                  <li key={ing.id} className={`${s.row} ${notBought ? s.rowDim : ''}`}>
                    <div className={s.rowMain}>
                      {canRecord && (
                        <input
                          type="checkbox"
                          className={s.gearCheck}
                          checked={!notBought && !waiting}
                          aria-label={`${ing.name} bought`}
                          onChange={(e) => {
                            if (!e.target.checked) setLine(ing.id, { status: 'not_bought' });
                            else if (r.items.length === 0 && r.planned.length === 0) startUnpriced(r);
                            else setLine(ing.id, { status: 'bought', items: toDraft(r.items.length > 0 ? r.items : r.planned) });
                          }}
                        />
                      )}
                      <button type="button" className={s.rowName} aria-expanded={isOpen} aria-controls={isOpen ? panel : undefined} onClick={() => toggleOpen(ing.id)}>
                        {ing.name}
                        <span className={s.chev} aria-hidden="true">
                          ›
                        </span>
                      </button>
                      {r.planned.length === 0 && r.state !== 'not_bought' && <span className={s.tag}>No price yet</span>}
                      {!notBought && items.length > 0 && <span className={s.meta}>{items.map((x) => `${x.qty} × ${brandName(x)}`).join(', ')}</span>}
                      <span className={s.meta}>
                        {notBought && <span aria-hidden="true">✕ </span>}
                        {stateText}
                        {!edited && r.stamp?.by ? ` · ${r.stamp.by}` : ''}
                      </span>
                      {!edited && outcomes[ing.id] === 'held' && <span className={s.tag}>⚑ Held for a leader</span>}
                    </div>
                    <div className={s.rcol}>
                      {notBought ? (
                        r.planned.length > 0 && <s className={s.muted}>{money(r.planned.reduce((n, x) => n + x.qty * x.pricePaid, 0))}</s>
                      ) : items.length === 0 ? null : items.length === 1 && canRecord ? (
                        <span className={s.moneyIn}>
                          <span aria-hidden="true">$</span>
                          <input
                            data-price
                            className={s.priceBox}
                            inputMode="decimal"
                            autoComplete="off"
                            value={items[0].price}
                            aria-label={`Price for ${ing.name}, dollars`}
                            aria-invalid={!validPrice(items[0].price) || undefined}
                            onChange={(e) => setItems(r, (cur) => [{ ...cur[0], price: e.target.value }, ...cur.slice(1)])}
                            onKeyDown={onPriceKey}
                            onFocus={(e) => e.currentTarget.select()}
                          />
                        </span>
                      ) : (
                        money(items.length === 1 ? priceOf(items[0].price) : sum)
                      )}
                    </div>

                    {isOpen && (
                      <div id={panel} className={s.inset}>
                        <p className={s.insetLine}>
                          {r.planned.length > 0 ? `Planned: ${r.planned.map((x) => `${x.qty} × ${brandName(x)}`).join(', ')}` : 'No price yet, so nothing was planned'}
                          {meals.length > 0 ? `, for ${meals.join(', ')}` : ''}. Needs {qtyText(r.line.need, ing.unit)}.
                        </p>
                        {waiting && canRecord && (
                          <div className={s.noticeActions}>
                            <Button size="sm" variant="secondary" onClick={() => startUnpriced(r)}>
                              Record what was bought
                            </Button>
                          </div>
                        )}
                        {!notBought && (items.length > 1 || isOpen) && canRecord && (
                          <ul className={s.plainList} aria-label={`What was bought for ${ing.name}`}>
                            {items.map((it, i) => (
                              <li key={i} className={s.brandLine}>
                                <span className={s.brandLineName}>{brandName(it)}</span>
                                <label className={s.meta}>
                                  How many{' '}
                                  <input
                                    className={s.qtyBox}
                                    inputMode="numeric"
                                    value={String(it.qty)}
                                    aria-label={`How many ${brandName(it)} ${ing.name}`}
                                    onChange={(e) => {
                                      const n = Math.min(99, Math.max(0, Math.round(Number(e.target.value) || 0)));
                                      setItems(r, (cur) => cur.map((x, j) => (j === i ? { ...x, qty: n } : x)));
                                    }}
                                  />
                                </label>
                                {items.length > 1 && (
                                  <span className={s.moneyIn}>
                                    <span aria-hidden="true">$</span>
                                    <input
                                      data-price
                                      className={s.priceBox}
                                      inputMode="decimal"
                                      autoComplete="off"
                                      value={it.price}
                                      aria-label={`Price for ${brandName(it)} ${ing.name}, dollars`}
                                      aria-invalid={!validPrice(it.price) || undefined}
                                      onChange={(e) => setItems(r, (cur) => cur.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                                      onKeyDown={onPriceKey}
                                      onFocus={(e) => e.currentTarget.select()}
                                    />
                                  </span>
                                )}
                                {it.newBrand && (
                                  <NewBrandFields
                                    ingredient={ing}
                                    conversions={catalog.conversions}
                                    value={it.newBrand}
                                    onChange={(nb) => setItems(r, (cur) => cur.map((x, j) => (j === i ? { ...x, newBrand: nb } : x)))}
                                  />
                                )}
                                {/* No brand or size to hand: the spend still counts, the price book just learns nothing from it. */}
                                {it.newBrand && r.planned.length === 0 && (
                                  <button type="button" className={s.linkBtn} onClick={() => setItems(r, (cur) => cur.map((x, j) => (j === i ? { brandId: null, packageId: null, qty: x.qty, price: x.price } : x)))}>
                                    Just the price
                                  </button>
                                )}
                                {items.length > 1 && (
                                  <button type="button" className={s.linkBtn} onClick={() => setItems(r, (cur) => cur.filter((_, j) => j !== i))}>
                                    Remove
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {canRecord && !waiting && (
                          <div className={s.noticeActions}>
                            {notBought ? (
                              <Button size="sm" variant="secondary" onClick={() => (r.items.length === 0 && r.planned.length === 0 ? startUnpriced(r) : setLine(ing.id, { status: 'bought', items: toDraft(r.items.length > 0 ? r.items : r.planned) }))}>
                                We did buy it
                              </Button>
                            ) : (
                              <>
                                <Button size="sm" variant="secondary" onClick={() => setLine(ing.id, { status: 'not_bought' })}>
                                  Didn’t buy it
                                </Button>
                                <Button size="sm" variant="secondary" aria-expanded={choosing?.ing === ing.id && choosing.mode === 'different'} onClick={() => setChoosing(choosing?.ing === ing.id && choosing.mode === 'different' ? null : { ing: ing.id, mode: 'different' })}>
                                  Different brand
                                </Button>
                                <Button size="sm" variant="secondary" aria-expanded={choosing?.ing === ing.id && choosing.mode === 'another'} onClick={() => setChoosing(choosing?.ing === ing.id && choosing.mode === 'another' ? null : { ing: ing.id, mode: 'another' })}>
                                  Add another brand
                                </Button>
                              </>
                            )}
                            {edited && (
                              <button
                                type="button"
                                className={s.linkBtn}
                                onClick={() =>
                                  setEdits((cur) => {
                                    const { [ing.id]: dropped, ...rest } = cur;
                                    void dropped;
                                    return rest;
                                  })
                                }
                              >
                                Undo
                              </button>
                            )}
                          </div>
                        )}
                        {canRecord && choosing?.ing === ing.id && !notBought && (
                          <div className={s.chips} role="group" aria-label={choosing.mode === 'different' ? `Which brand of ${ing.name} was bought` : `Another brand of ${ing.name}`}>
                            {brandsFor(ing.id, catalog)
                              .filter(({ brand }) => !items.some((x) => x.brandId === brand.id && !x.newBrand))
                              .map(({ brand, price }) => (
                                <button
                                  key={brand.id}
                                  type="button"
                                  className={s.chip}
                                  onClick={() => {
                                    const pkg = brandPackage(brand.id, catalog);
                                    const first = items[0];
                                    // A brand nobody has priced yet gets its first price here: it needs a size too.
                                    const next: DraftItem = pkg
                                      ? { brandId: brand.id, packageId: pkg.id, qty: choosing.mode === 'different' ? (first?.qty ?? 1) : 1, price: pkg.price.toFixed(2) }
                                      : { brandId: null, packageId: null, qty: choosing.mode === 'different' ? (first?.qty ?? 1) : 1, price: '', newBrand: { name: brand.name, size: '', sizeUnit: ing.unit.key } };
                                    setItems(r, (cur) => (choosing.mode === 'different' ? [next, ...cur.slice(1)] : [...cur, next]));
                                    setChoosing(null);
                                  }}
                                >
                                  {brand.name}
                                  <span className={s.chipMeta}> {price != null ? money(price) : 'New'}</span>
                                </button>
                              ))}
                            <button
                              type="button"
                              className={s.chip}
                              onClick={() => {
                                const first = items[0];
                                const next: DraftItem = { brandId: null, packageId: null, qty: choosing.mode === 'different' ? (first?.qty ?? 1) : 1, price: '', newBrand: { name: '', size: '', sizeUnit: ing.unit.key } };
                                setItems(r, (cur) => (choosing.mode === 'different' ? [next, ...cur.slice(1)] : [...cur, next]));
                                setChoosing(null);
                              }}
                            >
                              Something else…
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>

          {canRecord && (
            <label className={s.doneLine}>
              <input type="checkbox" className={s.gearCheck} checked={bought.done != null} disabled={saving || dirty} onChange={(e) => void setDone(e.target.checked)} /> We’re done shopping
              {bought.done?.by ? <span className={s.meta}> · {bought.done.by}</span> : null}
              {dirty && <span className={s.meta}> · save your changes first</span>}
            </label>
          )}
          {!canRecord && bought.done && <p className={s.foot}>Shopping is done{bought.done.by ? ` · ${bought.done.by}` : ''}.</p>}
          <p className={status ? s.statusLine : s.srOnly} role="status">
            {status}
          </p>
        </section>
      )}
    </div>
  );
}

/** "Something else": which brand, and how much one package holds (its first real price needs a size). */
function NewBrandFields({
  ingredient,
  conversions,
  value,
  onChange
}: {
  ingredient: Ingredient;
  conversions: readonly Conversion[];
  value: { name: string; size: string; sizeUnit: string };
  onChange: (v: { name: string; size: string; sizeUnit: string }) => void;
}) {
  const units = packageSizeUnits(ingredient, conversions);
  return (
    <span className={s.newBrand}>
      <input className={s.textBox} value={value.name} maxLength={60} autoComplete="off" aria-label={`Brand of ${ingredient.name}`} placeholder="Brand" onChange={(e) => onChange({ ...value, name: e.target.value })} />
      <input className={s.qtyBox} value={value.size} inputMode="decimal" autoComplete="off" aria-label="How much one package holds" placeholder="Size" onChange={(e) => onChange({ ...value, size: e.target.value })} />
      <select className={s.unitBox} value={value.sizeUnit} aria-label="Size unit" onChange={(e) => onChange({ ...value, sizeUnit: e.target.value })}>
        {units.map((u) => (
          <option key={u.key} value={u.key}>
            {u.label}
          </option>
        ))}
      </select>
    </span>
  );
}

function sizeUnitLabel(ingredient: Ingredient | undefined, unitKey: string, conversions: readonly Conversion[]): string {
  if (!ingredient) return '';
  return packageSizeUnits(ingredient, conversions).find((u) => u.key === unitKey)?.label ?? '';
}

/** The meals a line is for, as titles ("Saturday breakfast"). */
function mealsOf(list: ReturnType<typeof buildMenuList>, ingredientId: string, mealOf: ReadonlyMap<string, Menu['meals'][number]>, menu: Menu): string[] {
  const line = list.lines.find((l) => l.ing.id === ingredientId);
  return (line?.usedBy ?? [])
    .map((u) => mealOf.get(u.mealId))
    .filter((m): m is NonNullable<typeof m> => m != null)
    .map((m) => mealTitle(menu.startDate, m.day, m.slot));
}

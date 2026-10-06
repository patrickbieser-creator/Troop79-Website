'use client';

/**
 * The Shopping tab of a scout's menu (Plans/Menu-Monster-Scout-Workspace.md,
 * Phase 1 slice 5; prototype concept-e-scout-workspace/shopping.html, first
 * section). One merged list for the whole menu: every meal's needs are added
 * up by ingredient BEFORE packages are chosen (buildMenuList), so two egg
 * meals buy one flat.
 *
 * Rows are grouped by store section. A row is quiet — name, "2 × Krusteaz
 * Pancake Mix, 10 lb", the dollar amount in a fixed right column — and a click
 * anywhere on it opens an inset (aria-expanded on the name button): which meals
 * use it, the package in effect, and the choices — another package, a quantity,
 * or "Bringing from home" / "From the troop pantry" with a short note. Those
 * choices are the menu's `shopping` field; they follow the public save-button
 * standard (dirty-gated Save + Discard changes on the title line, unsaved
 * changes guarded) and save through saveMenuAction with the version token.
 *
 * "Prices have changed" lives here as a quiet line under the list (never a
 * warning box): the snapshot stored at the last save vs. today's price book.
 * Update prices re-saves the LAST SAVED menu — which makes the server build a
 * fresh snapshot — and leaves any unsaved draft alone.
 *
 * `readOnly` (a leader looking at a scout's menu): the list, totals, Print and the
 * row insets stay; the package / quantity / source choices show as text, and there is
 * no Save / Discard, Update prices or leave guard.
 *
 * What was really bought, and for how much, is recorded on the "What we bought" tab
 * (bought-tab.tsx, release 4 of Plans/Menu-Monster-Brands-Gear.md); it replaced the
 * "What you paid" section that sat below this list.
 *
 * Totals: the old planner's Spent / Used / Leftover / Budget panel sits above the list as a
 * quiet card (shoppingPanel in menu-view.ts); the budget is edited on the Plan tab.
 *
 * Print: the title line's Print button, a print-only sheet at the foot of this page (menu
 * name, dates, People + diets, the panel numbers, the list by aisle with a box to tick and
 * blanks for quantity bought and price paid) and a print stylesheet (workspace.module.css)
 * that hides the screen version; the `#mm-shopping-page` hook in globals.css hides the site chrome.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { priceText as money } from '@/lib/menu-monster/units';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { Notice } from '@/app/_components/notice';
import { Button } from '@/app/_components/button';
import { Stepper } from '@/app/_components/stepper';
import { TextInput } from '@/app/_components/form';
import type { Brand, BrandPick, Catalog, Conversion, LineSource, Package } from '@/lib/menu-monster/types';
import { RESTRICTION_BY_KEY, SECTIONS, SECTION_ORDER, qtyText } from '@/lib/menu-monster/units';
import { fmtRange } from '@/lib/format-date';
import { MAX_QTY, lineSentence } from '@/lib/menu-monster/engine';
import { addDays, type Menu, type MenuShopping } from '@/lib/menu-monster/menus';
import { DIET_ORDER, budgetState, buildMenuList, lineUpdated, mealTitle, needsLabelCheck, shoppingPanel, type MenuLine } from '@/lib/menu-monster/menu-view';
import { BrandChooser } from './brand-chooser';
import { addBrandAction } from '../../../_tools/menu-monster/brand-actions';
import type { MenuStore, SaveResult } from '@/lib/menu-monster/menu-store';
import { buildSnapshot, snapshotDrift, type MenuSnapshot } from '@/lib/menu-monster/menu-snapshot';
import { serverMenuStore } from './server-menu-store';
import { ReadOnlyLine } from './read-only-line';
import { AddPackageForm, type AddedPackage } from './add-package-form';
import { SaveBar } from './save-bar';
import s from './workspace.module.css';
import { menuGear } from '@/lib/menu-monster/scout-recipes';
import type { GearItem } from '@/lib/menu-monster/gear';

const NOTE_MAX = 120; // matches restorePlan's note cap
const keyOf = (sh: MenuShopping) => JSON.stringify(sh);
const SOURCES: readonly { key: LineSource; label: string }[] = [
  { key: 'buy', label: 'Buying it' },
  { key: 'home', label: 'Bringing from home' },
  { key: 'pantry', label: 'From the troop store room' }
];

export interface ShoppingTabProps {
  catalog: Catalog;
  /** The saved menu's id (server store). A local menu passes `store` instead. */
  menuId?: string;
  menu: Menu;
  /** The version token the menu was loaded at (null for a local menu). */
  updatedAt: string | null;
  /** The priced snapshot stored at the last save (null for a row that never had one). */
  snapshot: MenuSnapshot | null;
  /** The Plan / Shopping tab strip, rendered under the title line. */
  tabs?: ReactNode;
  /** A leader's view of a scout's menu: choices shown as text, nothing edits or saves. */
  readOnly?: boolean;
  /** Credit name of the scout who planned it (read-only view). */
  plannedBy?: string | null;
  /** A leader working on someone else's menu. Nothing differs here: choices save as the owner's, and a package added from this tab is filed under the owner (HelperMenu, set by the page). */
  helper?: boolean;
  /** What the page says about who is looking (menu name credit, copy, review note…); replaces the read-only line. */
  aside?: ReactNode;
  /** Where the menu is kept. Omitted = the signed-in scout's saved menu (server). */
  store?: MenuStore;
  /** For the printed sheet's gear line (same roll-up as the Gear tab): the troop's list (names the per-person items) and the menu's own extras. */
  gearList?: readonly GearItem[];
  gearExtras?: readonly string[];
  /** An ingredient to open on load (?item=): the Plan tab's "N not priced" and the meal panel's "No price yet" land here, on that row's "Add a package you bought" form. */
  openItem?: string | null;
}

export function ShoppingTab({ catalog: catalogProp, menuId, menu: initial, updatedAt, snapshot: initialSnapshot, tabs, readOnly = false, plannedBy = null, aside, store: storeProp, gearList = [], gearExtras = [], openItem = null }: ShoppingTabProps) {
  const uid = useId();
  const store = useMemo(() => storeProp ?? serverMenuStore(menuId ?? null), [storeProp, menuId]);
  const { canSave, canPay, canReport } = store.caps;
  // The price book as this page knows it: the server's, plus prices this scout just applied.
  const [catalog, setCatalog] = useState<Catalog>(catalogProp);
  const [saved, setSaved] = useState<{ menu: Menu; key: string }>(() => ({ menu: initial, key: keyOf(initial.shopping) }));
  const [draft, setDraft] = useState<MenuShopping>(initial.shopping);
  const [snapshot, setSnapshot] = useState<MenuSnapshot | null>(initialSnapshot);
  const [version, setVersion] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'total' | 'person'>('total');
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(openItem ? [openItem] : []));
  const [showWhy, setShowWhy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const dirty = keyOf(draft) !== saved.key;
  useLeaveGuard(dirty && !readOnly);

  const menu: Menu = { ...saved.menu, shopping: draft };
  const list = buildMenuList(menu, catalog);
  // Every recipe's gear across the menu's meals, for the paper sheet; on screen it is the Gear tab's.
  const gear = menuGear(menu, catalog, gearList, gearExtras);
  const { totals } = list;
  const people = menu.headcount;
  const budget = budgetState({ perSpent: list.perPersonMeal }, menu.budgetPerPersonMeal);
  const panel = shoppingPanel(list);
  const drift = snapshotDrift(snapshot, saved.menu, catalog);
  const mealOf = new Map(menu.meals.map((m) => [m.id, m]));

  /* ---- Edits to the menu's shopping choices ---- */
  const edit = (f: (d: MenuShopping) => MenuShopping) => {
    setDraft(f);
    setJustSaved(false);
    setError(null);
    setStatus('');
  };
  const pickPackage = (l: MenuLine, pkgId: string) =>
    edit((d) => {
      const packageChoice = { ...d.packageChoice };
      // The recommendation is the default: choosing it again is no choice at all.
      if (pkgId === l.rec?.id) delete packageChoice[l.ing.id];
      else packageChoice[l.ing.id] = pkgId;
      const qtyOverride = { ...d.qtyOverride };
      delete qtyOverride[l.ing.id];
      return { ...d, packageChoice, qtyOverride };
    });
  /** The brands for one ingredient, for the whole menu (none = any brand: the key goes away). */
  const setBrands = (ingredientId: string, picks: BrandPick[]) =>
    edit((d) => {
      const brands = { ...(d.brands ?? {}) };
      if (picks.length > 0) brands[ingredientId] = picks;
      else delete brands[ingredientId];
      const { brands: _old, ...rest } = d;
      void _old;
      // A count typed for the old package choice is not the new brands' count.
      const qtyOverride = { ...rest.qtyOverride };
      delete qtyOverride[ingredientId];
      const next = { ...rest, qtyOverride };
      return Object.keys(brands).length > 0 ? { ...next, brands } : next;
    });
  const typeBrand = async (ingredientId: string, name: string) => {
    const res = await addBrandAction(ingredientId, name);
    if (res.ok) setCatalog((c) => ((c.brands ?? []).some((b) => b.id === res.brand.id) ? c : { ...c, brands: [...(c.brands ?? []), res.brand] }));
    return res;
  };
  const setQty = (l: MenuLine, n: number) =>
    edit((d) => {
      // One brand chosen: the count is that brand's (the engine reads it from the pick, not the override).
      if (l.parts?.length === 1) {
        const part = l.parts[0];
        const q = Math.min(MAX_QTY, Math.max(0, n));
        return { ...d, brands: { ...(d.brands ?? {}), [l.ing.id]: [{ brandId: part.brand.id, qty: q === part.autoQty ? null : q }] } };
      }
      const qtyOverride = { ...d.qtyOverride };
      if (!l.pkg || n === l.autoQty) delete qtyOverride[l.ing.id];
      else qtyOverride[l.ing.id] = { packageId: l.pkg.id, qty: Math.min(MAX_QTY, Math.max(0, n)) };
      return { ...d, qtyOverride };
    });
  const setSource = (l: MenuLine, source: LineSource, note: string) =>
    edit((d) => {
      const lineSource = { ...d.lineSource };
      // A staple's default is the store room (no entry); "Buying it" must be said out loud for it.
      if (l.ing.staple) {
        if (source === 'pantry') delete lineSource[l.ing.id];
        else lineSource[l.ing.id] = { source, note: source === 'buy' ? '' : note.slice(0, NOTE_MAX) };
      } else if (source === 'buy') delete lineSource[l.ing.id];
      else lineSource[l.ing.id] = { source, note: note.slice(0, NOTE_MAX) };
      return { ...d, lineSource };
    });

  /* ---- Save / discard / update prices ---- */
  async function persist(toSave: Menu): Promise<boolean> {
    setSaving(true);
    setError(null);
    let res: SaveResult;
    try {
      res = await store.save(toSave, version);
    } catch {
      res = { ok: false, error: 'Something went wrong saving your menu. Try again.' };
    }
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setVersion(res.updatedAt);
    // Display only: the stored snapshot is built by the server from the same pure function.
    if (canReport) setSnapshot(buildSnapshot(toSave, catalog));
    return true;
  }

  async function save() {
    if (!(await persist(menu))) return;
    setSaved({ menu, key: keyOf(draft) });
    setJustSaved(true);
  }

  function discard() {
    setDraft(saved.menu.shopping);
    setError(null);
    setStatus('');
  }

  async function updatePrices() {
    if (!(await persist(saved.menu))) return;
    setStatus('Prices updated to today’s price book.');
    // The button goes with its line; keep keyboard focus on the page.
    headingRef.current?.focus();
  }

  // Release C: a package the scout just added joins this page's catalog and is picked for its line.
  const packageAdded = (l: MenuLine, { pkg, status: st }: AddedPackage) => {
    if (st !== 'same') setCatalog((c) => ({ ...c, packages: [...c.packages, pkg] }));
    pickPackage(l, pkg.id);
    setStatus(
      st === 'held'
        ? `${pkg.name} added to your menu. A leader checks the price before the rest of the troop sees it.`
        : st === 'same'
          ? `${pkg.name} is already in the price book, so it’s picked for you.`
          : `${pkg.name} added to the troop price book.`
    );
  };

  const toggle = (id: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** A badge that asks for something opens its row (never closes it). */
  const openRow = (id: string) => setOpenIds((cur) => (cur.has(id) ? cur : new Set(cur).add(id)));

  const costOf = (l: MenuLine) => (view === 'total' ? l.spent : l.spent / people);
  const sections = SECTION_ORDER.filter((sec) => list.lines.some((l) => l.ing.section === sec));
  const priced = list.lines.length > 0;

  return (
    <div id="mm-shopping-page">
      <div className={s.screenOnly}>
      <div className={s.titleLine}>
        <h1 className={s.menuTitle}>{menu.name.trim() || 'Untitled menu'}</h1>
        <div className={s.titleActions}>
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
          {!readOnly && (
            <SaveBar
              isNew={false}
              labels={canSave ? undefined : { clean: 'Saved on this computer' }}
              dirty={dirty}
              saving={saving}
              saved={justSaved}
              onSave={() => void save()}
              onDiscard={discard}
            />
          )}
        </div>
      </div>
      {aside ?? (readOnly && <ReadOnlyLine plannedBy={plannedBy} />)}
      {tabs != null && <div className={s.tabs}>{tabs}</div>}

      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}

      {priced && (
        <div className={s.totalsCard} role="group" aria-label="Menu totals">
          <dl className={s.totalsGrid}>
            <div className={s.totalsCol}>
              <dt className={s.totalsLabel}>Spent</dt>
              <dd className={s.totalsAmount}>{money(panel.spent)}</dd>
              <dd className={s.totalsSub}>{money(panel.perSpent)} a person per meal</dd>
              <dd className={s.totalsWhy}>What you pay at the register, divided by everyone eating.</dd>
            </div>
            <div className={s.totalsCol}>
              <dt className={s.totalsLabel}>Budget</dt>
              <dd className={s.totalsAmount}>{money(menu.budgetPerPersonMeal)} a person per meal</dd>
              <dd className={s.totalsSub}>
                <span role="status">
                  <span aria-hidden="true">{budget.icon}</span> {budget.msg}
                </span>
              </dd>
              {!readOnly && (
                <dd className={s.totalsWhy}>
                  <Link href={store.hrefs.plan}>Change the budget on the Plan tab</Link>
                </dd>
              )}
            </div>
          </dl>
          {panel.notes.length > 0 && (
            <p className={s.totalsNote}>
              {panel.notes.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </p>
          )}
          {/* Used and Leftover answer "where did the difference go?": there when a scout asks, not on every visit. */}
          <button type="button" className={s.linkBtn} aria-expanded={showWhy} aria-controls={`${uid}-why`} onClick={() => setShowWhy((v) => !v)}>
            Show how this is worked out
          </button>
          {showWhy && (
            <dl id={`${uid}-why`} className={s.totalsGrid}>
              <div className={s.totalsCol}>
                <dt className={s.totalsLabel}>Used</dt>
                <dd className={s.totalsAmount}>{money(panel.used)}</dd>
                <dd className={s.totalsSub}>{money(panel.perUsed)} a person per meal</dd>
                <dd className={s.totalsWhy}>The true cost of what the recipes eat.</dd>
              </div>
              <div className={s.totalsCol}>
                <dt className={s.totalsLabel}>Leftover</dt>
                <dd className={s.totalsAmount}>{money(panel.left)}</dd>
                <dd className={s.totalsSub}>{money(panel.perLeft)} a person per meal</dd>
                <dd className={s.totalsWhy}>Spent minus Used. Goes home or into the patrol box.</dd>
              </div>
              <div className={s.totalsNote}>
                <span>Spent − Used = Leftover. Both totals include adults eating with the patrol.</span>
              </div>
            </dl>
          )}
        </div>
      )}

      <section aria-labelledby={`${uid}-list-h`}>
        <div className={s.secHead}>
          <h2 id={`${uid}-list-h`} ref={headingRef} tabIndex={-1} className={s.heading}>
            Shopping list
          </h2>
          <div className={s.seg} role="group" aria-label="Show cost as">
            {(
              [
                ['total', 'Total to buy'],
                ['person', 'Per person']
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className={s.segBtn} aria-pressed={view === k} onClick={() => setView(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {priced && (
          <p className={s.shopLine}>
            <strong>{money(view === 'total' ? totals.spent : totals.spent / people)}</strong>{' '}
            <span className={s.muted}>
              {view === 'total' ? 'for' : 'a person, for'} {people} people · {money(list.perPersonMeal)} a person per meal
              {totals.unpriced.length > 0 ? ` · not counting ${totals.unpriced.length} without a price` : ''} ·
            </span>{' '}
            <span aria-hidden="true">{budget.icon}</span> {budget.msg}
          </p>
        )}

        {!priced && (
          <p className={s.foot}>
            Add a meal on the <Link href={store.hrefs.plan}>Plan tab</Link> and pick what you’re cooking, and the list builds itself.
          </p>
        )}

        {sections.map((sec) => (
          <div key={sec} className={s.dayBlock}>
            <h3 className={s.dayHead}>{SECTIONS[sec]}</h3>
            <ul className={s.card} aria-label={SECTIONS[sec]}>
              {list.lines
                .filter((l) => l.ing.section === sec)
                .map((l) => (
                  <ShoppingRow
                    key={l.ing.id}
                    line={l}
                    menu={menu}
                    mealOf={mealOf}
                    open={openIds.has(l.ing.id)}
                    onToggle={() => toggle(l.ing.id)}
                    onOpen={() => openRow(l.ing.id)}
                    autoAdd={l.ing.id === openItem}
                    cost={costOf(l)}
                    onPackage={(id) => pickPackage(l, id)}
                    onQty={(n) => setQty(l, n)}
                    onSource={(src, note) => setSource(l, src, note)}
                    panelId={`${uid}-ing-${l.ing.id}`}
                    readOnly={readOnly}
                    conversions={catalog.conversions}
                    onPackageAdded={canReport && !readOnly ? (added) => packageAdded(l, added) : undefined}
                    catalog={catalog}
                    picks={draft.brands?.[l.ing.id] ?? []}
                    onBrands={(picks) => setBrands(l.ing.id, picks)}
                    onTypeBrand={!storeProp && !readOnly ? (name) => typeBrand(l.ing.id, name) : undefined}
                    labelCheck={needsLabelCheck(l, menu.restrictions, catalog)}
                  />
                ))}
            </ul>
          </div>
        ))}

        {list.saving > 0 && (
          <p className={s.foot}>
            Shopping once for every meal saves {money(list.saving)}: items used in more than one meal share packages.
          </p>
        )}

        {drift && (
          <p className={s.foot}>
            Prices in the troop price book changed since you saved: {money(drift.saved)} → {money(drift.live)}.{' '}
            {!readOnly && canReport && (
              <button type="button" className={s.linkBtn} disabled={saving} onClick={() => void updatePrices()}>
                Update prices
              </button>
            )}
          </p>
        )}

        <p className={s.statusLine} role="status">
          {status}
        </p>
      </section>


      {canPay && menuId && !readOnly && (
        <p className={s.foot}>
          After the trip, record prices and what was really bought on the{' '}
          <Link className={s.link} href={`/library/menu-monster/menus/${menuId}/bought`}>
            What we bought
          </Link>{' '}
          tab.
        </p>
      )}
      {/* Conversions is a reference page, not a step (2026-10-06): a quiet link here, for everyone who can open the menu. */}
      {canPay && menuId && (
        <p className={s.foot}>
          Wondering how cups become ounces?{' '}
          <Link className={s.link} href={`/library/menu-monster/menus/${menuId}/conversions`}>
            Conversions
          </Link>
        </p>
      )}
      </div>

      <PrintSheet menu={menu} list={list} panel={panel} gear={gear} />
    </div>
  );
}

/** Print-only: the menu as a paper shopping sheet (hidden on screen; see @media print in workspace.module.css). */
function PrintSheet({ menu, list, panel, gear }: { menu: Menu; list: ReturnType<typeof buildMenuList>; panel: ReturnType<typeof shoppingPanel>; gear: string[] }) {
  const dates = menu.startDate
    ? fmtRange(menu.startDate, addDays(menu.startDate, Math.max(0, menu.dayCount - 1)))
    : `${menu.dayCount} day${menu.dayCount === 1 ? '' : 's'}`;
  const diets = DIET_ORDER.filter((k) => (menu.restrictions[k] || 0) > 0).map((k) => `${RESTRICTION_BY_KEY[k].label}: ${menu.restrictions[k]}`);
  const buyable = list.lines.filter((l) => l.status === 'ok' || l.status === 'short' || l.status === 'unpriced');
  const aisles = SECTION_ORDER.filter((sec) => buyable.some((l) => l.ing.section === sec));
  return (
    <section className={s.printSheet} data-testid="print-sheet" aria-hidden="true">
      <h1 className={s.printTitle}>{menu.name.trim() || 'Untitled menu'}</h1>
      <p className={s.printMeta}>{dates}</p>
      <p className={s.printMeta}>{[`People: ${menu.headcount}`, ...diets].join(' · ')}</p>
      <p className={s.printMeta}>
        Spent {money(panel.spent)} · Used {money(panel.used)} · Leftover {money(panel.left)} · Budget {money(menu.budgetPerPersonMeal)} a person per meal
      </p>
      {aisles.map((sec) => (
        <table key={sec} className={s.printTable}>
          <caption>{SECTIONS[sec]}</caption>
          <thead>
            <tr>
              <th scope="col">Got it</th>
              <th scope="col">Item</th>
              <th scope="col">Buy</th>
              <th scope="col">Est.</th>
              <th scope="col">Qty bought</th>
              <th scope="col">Price paid</th>
            </tr>
          </thead>
          <tbody>
            {buyable
              .filter((l) => l.ing.section === sec)
              .map((l) => (
                <tr key={l.ing.id}>
                  <td>☐</td>
                  <th scope="row">{l.ing.name}</th>
                  <td>
                    {l.status === 'unpriced'
                      ? 'Not priced yet'
                      : l.parts && l.parts.length > 0
                        ? l.parts.map((x) => `${x.qty} × ${x.brand.name}${x.estimated ? '' : `, ${x.pkg.sizeLabel ?? x.pkg.name}`}`).join('; ')
                        : l.estimated
                          ? `any brand · ${l.qty} × ${l.pkg?.sizeLabel ?? l.pkg?.name ?? ''} · brand bought: ________`
                          : `${l.qty} × ${l.pkg?.name ?? ''}`}
                    {lineUpdated(l) ? ' (updated)' : ''}
                  </td>
                  <td>{l.status === 'unpriced' ? '' : <EstPrice estimated={l.estimated} amount={money(l.spent)} />}</td>
                  <td className={s.printBlank} />
                  <td className={s.printBlank} />
                </tr>
              ))}
          </tbody>
        </table>
      ))}
      {gear.length > 0 && <p className={s.printMeta}>Gear: {gear.join(' · ')}</p>}
      {panel.notes.length > 0 && <p className={s.printMeta}>{panel.notes.join(' ')}</p>}
    </section>
  );
}

/** An estimated price reads "~$18.15"; the tilde is not read aloud, so the estimate is also said (title and screen reader text). */
function EstPrice({ estimated, amount }: { estimated?: boolean; amount: string }) {
  if (!estimated) return <>{amount}</>;
  return (
    <span title="Estimated — cheapest known brand">
      ~{amount}
      <span className={s.srOnly}> (estimated)</span>
    </span>
  );
}

function ShoppingRow({
  line: l,
  menu,
  mealOf,
  open,
  onToggle,
  onOpen,
  autoAdd,
  cost,
  onPackage,
  onQty,
  onSource,
  panelId,
  readOnly,
  conversions,
  onPackageAdded,
  catalog,
  picks,
  onBrands,
  onTypeBrand,
  labelCheck
}: {
  /** Release 3: the brand chooser's catalog, the menu's picks for this ingredient and their writers. */
  catalog: Catalog;
  picks: readonly BrandPick[];
  onBrands: (picks: BrandPick[]) => void;
  onTypeBrand?: (name: string) => Promise<{ ok: true; brand: Brand } | { ok: false; error: string }>;
  labelCheck: boolean;
  line: MenuLine;
  menu: Menu;
  mealOf: ReadonlyMap<string, Menu['meals'][number]>;
  open: boolean;
  onToggle: () => void;
  /** Opens the row without closing it: the "No price yet" badge's first move. */
  onOpen: () => void;
  /** Arrived by ?item=: the add-a-package form starts open. */
  autoAdd: boolean;
  cost: number;
  onPackage: (pkgId: string) => void;
  onQty: (n: number) => void;
  onSource: (source: LineSource, note: string) => void;
  panelId: string;
  readOnly: boolean;
  conversions: readonly Conversion[];
  /** Set only where the scout may add a package (their saved menu, release C). */
  onPackageAdded?: (a: AddedPackage) => void;
}) {
  const [adding, setAdding] = useState(autoAdd && !readOnly);
  const formRef = useRef<HTMLDivElement>(null);
  // The form just opened (from the badge, or by arriving on ?item=): bring it into view and put focus in it.
  useEffect(() => {
    if (!adding) return;
    formRef.current?.scrollIntoView?.({ block: 'nearest' });
    formRef.current?.querySelector('input')?.focus();
  }, [adding]);
  const buying = l.status === 'ok' || l.status === 'short';
  const pkg = l.pkg;
  const mealNames = l.usedBy
    .map((u) => mealOf.get(u.mealId))
    .filter((m): m is NonNullable<typeof m> => m != null)
    .map((m) => mealTitle(menu.startDate, m.day, m.slot));
  const sourceNote = l.note ? ` · ${l.note}` : '';

  const parts = l.parts ?? [];
  const hasBrands = (catalog.brands ?? []).some((b) => b.ingredientId === l.ing.id && !b.retiredAt);
  const sizeOf = (p: Package) => p.sizeLabel ?? p.name;
  let meta: string;
  if (l.status === 'staple') meta = 'From the troop store room';
  else if (l.status === 'bring') meta = `${l.source === 'pantry' ? 'From the troop store room' : 'Bringing from home'}${sourceNote}`;
  else if (l.status === 'unpriced') meta = '';
  // One brand: "2 × Rice Chex, 18 oz". Several: their names (each has its own line under the row).
  else if (parts.length === 1) meta = `${parts[0].qty} × ${parts[0].brand.name}${parts[0].estimated ? '' : `, ${sizeOf(parts[0].pkg)}`}`;
  else if (parts.length > 1) meta = parts.map((x) => x.brand.name).join(', ');
  // Any brand: the shopper's choice — say how much, in the cheapest known package.
  else if (l.estimated && pkg) meta = `any brand · ${l.qty} × ${sizeOf(pkg)}`;
  else meta = `${l.qty} × ${pkg?.name ?? ''}`;
  const updated = lineUpdated(l);

  const noteId = `${panelId}-note`;
  // The form is offered only where a scout may add a package to this line.
  const canAddPackage = !readOnly && !!onPackageAdded && l.source === 'buy' && !l.ing.needsMatch;
  return (
    <li className={s.row}>
      {/* The whole row opens the inset; the name button is the keyboard and screen-reader target. */}
      <div className={`${s.rowMain} ${s.clickRow}`} onClick={onToggle}>
        <button type="button" className={s.rowName} aria-expanded={open} aria-controls={open ? panelId : undefined}>
          {l.ing.name}
          <span className={s.chev} aria-hidden="true">
            ›
          </span>
        </button>
        {meta && <span className={s.meta}>{meta}</span>}
        {/* A badge that asks for something is the button that answers it (guideline 4): it opens this row's add-a-package form. */}
        {l.status === 'unpriced' &&
          (canAddPackage ? (
            <button
              type="button"
              className={`${s.tag} ${s.tagBtn}`}
              aria-label="No price yet — add one"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
                setAdding(true);
              }}
            >
              No price yet
            </button>
          ) : (
            <span className={s.tag}>No price yet</span>
          ))}
        {l.status === 'short' && <span className={s.tag}>Short {qtyText(l.shortQty, l.ing.unit)}</span>}
        {/* A scout's typed-in no leader has checked yet: its price is the scout's own entry (Phase 4B). */}
        {l.ing.needsMatch && l.status !== 'unpriced' && <span className={s.meta}>Scout’s price</span>}
        {parts.some((x) => x.estimated) && <span className={s.meta}>New brand</span>}
        {labelCheck && <span className={s.meta}>check the label</span>}
        {updated && (
          <span className={s.meta} aria-label={`${l.ing.name}, updated`}>
            Updated
          </span>
        )}
      </div>
      <div className={s.cost}>{l.status === 'staple' || l.status === 'bring' ? '—' : l.status === 'unpriced' ? '' : <EstPrice estimated={l.estimated} amount={money(cost)} />}</div>
      {parts.length > 1 && (
        <ul className={s.brandSubs} aria-label={`${l.ing.name} brands`}>
          {parts.map((x) => (
            <li key={x.brand.id} className={s.brandSub}>
              <span>
                {x.qty} × {x.brand.name}
                {x.estimated ? '' : `, ${sizeOf(x.pkg)}`}
              </span>
              <span className={s.brandSubCost}>
                <EstPrice estimated={x.estimated} amount={money(x.spent)} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div id={panelId} className={s.inset}>
          <p className={s.insetLine}>
            Needs {qtyText(l.need, l.ing.unit)}
            {mealNames.length > 0 ? ` for ${mealNames.join(', ')}` : ''}.
          </p>
          {buying && pkg && parts.length < 2 && <p className={s.insetMuted}>{lineSentence(l)}</p>}
          {readOnly && l.status === 'staple' && <p className={s.insetMuted}>It comes from the troop’s store room, so it isn’t bought.</p>}

          {readOnly && buying && l.overridden && <p className={s.insetMuted}>Quantity changed from {l.autoQty} to {l.qty}.</p>}
          {readOnly && l.status !== 'staple' && (
            <p className={s.insetMuted}>
              Where it comes from: {SOURCES.find((o) => o.key === l.source)?.label ?? 'Buying it'}
              {l.source !== 'buy' && l.note ? ` · ${l.note}` : ''}
            </p>
          )}

          {l.status === 'staple' && !readOnly && (
            <div className={s.choice}>
              <div className={s.choiceLabel} id={`${panelId}-src`}>
                Where it comes from
              </div>
              <div className={s.chips} role="group" aria-labelledby={`${panelId}-src`}>
                <button type="button" className={s.chip} aria-pressed onClick={() => onSource('pantry', '')}>
                  From the troop store room
                </button>
                <button type="button" className={s.chip} aria-pressed={false} onClick={() => onSource('buy', '')}>
                  Buying it
                </button>
              </div>
            </div>
          )}
          {l.status !== 'staple' && !readOnly && (
            <>
              {/* Brands (release 3): chosen here or on the Plan tab — one set per ingredient for the menu. */}
              {l.source === 'buy' && (hasBrands || onTypeBrand) && (
                <BrandChooser ingredient={l.ing} catalog={catalog} picks={picks} line={l} onChange={onBrands} onType={onTypeBrand} />
              )}
              {l.usable.length > 1 && l.source === 'buy' && !hasBrands && (
                <div className={s.choice}>
                  <div className={s.choiceLabel} id={`${panelId}-pkg`}>
                    Package
                  </div>
                  <div className={s.chips} role="group" aria-labelledby={`${panelId}-pkg`}>
                    {l.usable.map((p) => (
                      <button key={p.id} type="button" className={s.chip} aria-pressed={pkg?.id === p.id} onClick={() => onPackage(p.id)}>
                        {p.name} · {money(p.price)}
                        {p.held ? ' · waiting for a leader' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {canAddPackage &&
                (adding ? (
                  <div ref={formRef}>
                    <AddPackageForm
                      ingredient={l.ing}
                      conversions={conversions}
                      onCancel={() => setAdding(false)}
                      onAdded={(a) => {
                        setAdding(false);
                        onPackageAdded?.(a);
                      }}
                    />
                  </div>
                ) : (
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    Add a package you bought
                  </Button>
                ))}

              {buying && pkg && parts.length < 2 && (
                <div className={s.choice}>
                  <Stepper
                    id={`${panelId}-qty`}
                    label="How many"
                    value={l.qty}
                    min={0}
                    max={MAX_QTY}
                    onChange={onQty}
                    groupLabel={`How many ${l.ing.name} packages`}
                    lessLabel={`One fewer ${l.ing.name} package`}
                    moreLabel={`One more ${l.ing.name} package`}
                  />
                  {l.overridden && (
                    <Button variant="ghost" onClick={() => onQty(l.autoQty)}>
                      Reset to {l.autoQty}
                    </Button>
                  )}
                </div>
              )}

              <div className={s.choice}>
                <div className={s.choiceLabel} id={`${panelId}-src`}>
                  Where it comes from
                </div>
                <div className={s.chips} role="group" aria-labelledby={`${panelId}-src`}>
                  {SOURCES.map((o) => (
                    <button key={o.key} type="button" className={s.chip} aria-pressed={l.source === o.key} onClick={() => onSource(o.key, l.note)}>
                      {o.label}
                    </button>
                  ))}
                </div>
                {l.source !== 'buy' && (
                  <div className={s.noteRow}>
                    <label htmlFor={noteId} className={s.choiceLabel}>
                      Note
                    </label>
                    <TextInput
                      id={noteId}
                      value={l.note}
                      maxLength={NOTE_MAX}
                      autoComplete="off"
                      placeholder="Who is bringing it?"
                      onChange={(e) => onSource(l.source, e.target.value)}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

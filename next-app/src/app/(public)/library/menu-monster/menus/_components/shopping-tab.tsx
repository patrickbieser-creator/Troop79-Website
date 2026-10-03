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
 * Below the list, "What you paid" (paid-section.tsx) is its own section with its own
 * Save: what the scout bought, how many and the price paid each. An applied price
 * changes the price book, so this tab folds it into its own copy of the catalog and
 * snapshot — the scout's own change never shows up as "prices changed".
 *
 * Totals: the old planner's Spent / Used / Leftover / Budget panel sits above the list as a
 * quiet card (shoppingPanel in menu-view.ts); the budget is edited on the Plan tab.
 *
 * Print: the title line's Print button, a print-only sheet at the foot of this page (menu
 * name, dates, People + diets, the panel numbers, the list by aisle with a box to tick and
 * blanks for quantity bought and price paid) and a print stylesheet (workspace.module.css)
 * that hides the screen version; the `#mm-shopping-page` hook in globals.css hides the site chrome.
 */

import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { priceText as money } from '@/lib/menu-monster/units';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { Notice } from '@/app/_components/notice';
import { Button } from '@/app/_components/button';
import { Stepper } from '@/app/_components/stepper';
import { TextInput } from '@/app/_components/form';
import type { Catalog, LineSource } from '@/lib/menu-monster/types';
import { RESTRICTION_BY_KEY, SECTIONS, SECTION_ORDER, qtyText } from '@/lib/menu-monster/units';
import { fmtRange } from '@/lib/format-date';
import { MAX_QTY, lineSentence } from '@/lib/menu-monster/engine';
import { addDays, type Menu, type MenuShopping } from '@/lib/menu-monster/menus';
import { DIET_ORDER, budgetState, buildMenuList, mealTitle, shoppingPanel, type MenuLine } from '@/lib/menu-monster/menu-view';
import type { MenuStore, SaveResult } from '@/lib/menu-monster/menu-store';
import { buildSnapshot, snapshotDrift, type MenuSnapshot } from '@/lib/menu-monster/menu-snapshot';
import { serverMenuStore } from './server-menu-store';
import { PaidSection, type PaidSavedInfo } from './paid-section';
import { ReadOnlyLine } from './read-only-line';
import { SaveBar } from './save-bar';
import s from './workspace.module.css';
import { menuGear } from '@/lib/menu-monster/scout-recipes';

const NOTE_MAX = 120; // matches restorePlan's note cap
const keyOf = (sh: MenuShopping) => JSON.stringify(sh);
const SOURCES: readonly { key: LineSource; label: string }[] = [
  { key: 'buy', label: 'Buying it' },
  { key: 'home', label: 'Bringing from home' },
  { key: 'pantry', label: 'From the troop pantry' }
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
  /** What the page says about who is looking (menu name credit, copy, review note…); replaces the read-only line. */
  aside?: ReactNode;
  /** Where the menu is kept. Omitted = the signed-in scout's saved menu (server). */
  store?: MenuStore;
}

export function ShoppingTab({ catalog: catalogProp, menuId, menu: initial, updatedAt, snapshot: initialSnapshot, tabs, readOnly = false, plannedBy = null, aside, store: storeProp }: ShoppingTabProps) {
  const uid = useId();
  const store = useMemo(() => storeProp ?? serverMenuStore(menuId ?? null), [storeProp, menuId]);
  const { canSave, canPay, canReport } = store.caps;
  // The price book as this page knows it: the server's, plus prices this scout just applied.
  const [catalog, setCatalog] = useState<Catalog>(catalogProp);
  const [paidDirty, setPaidDirty] = useState(false);
  const [saved, setSaved] = useState<{ menu: Menu; key: string }>(() => ({ menu: initial, key: keyOf(initial.shopping) }));
  const [draft, setDraft] = useState<MenuShopping>(initial.shopping);
  const [snapshot, setSnapshot] = useState<MenuSnapshot | null>(initialSnapshot);
  const [version, setVersion] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'total' | 'person'>('total');
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const dirty = keyOf(draft) !== saved.key;
  useLeaveGuard((dirty || paidDirty) && !readOnly);

  const menu: Menu = { ...saved.menu, shopping: draft };
  const list = buildMenuList(menu, catalog);
  // Gear you'll need (4C): every recipe's gear across the menu's meals.
  const gear = menuGear(menu, catalog);
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
  const setQty = (l: MenuLine, n: number) =>
    edit((d) => {
      const qtyOverride = { ...d.qtyOverride };
      if (!l.pkg || n === l.autoQty) delete qtyOverride[l.ing.id];
      else qtyOverride[l.ing.id] = { packageId: l.pkg.id, qty: Math.min(MAX_QTY, Math.max(0, n)) };
      return { ...d, qtyOverride };
    });
  const setSource = (l: MenuLine, source: LineSource, note: string) =>
    edit((d) => {
      const lineSource = { ...d.lineSource };
      if (source === 'buy') delete lineSource[l.ing.id];
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

  // Prices the server just applied: fold them into this page's catalog and re-snapshot, as the server did.
  const paidSaved = useCallback(
    ({ actuals, results }: PaidSavedInfo) => {
      const applied = Object.entries(results).filter(([, st]) => st === 'applied');
      if (applied.length === 0) return;
      const next: Catalog = {
        ...catalog,
        packages: catalog.packages.map((p) => {
          const hit = applied.find(([ing]) => actuals[ing]?.packageId === p.id);
          return hit ? { ...p, price: actuals[hit[0]].pricePaid } : p;
        })
      };
      setCatalog(next);
      setSnapshot(buildSnapshot(saved.menu, next));
    },
    [catalog, saved.menu]
  );

  const toggle = (id: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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
        <dl className={s.totalsCard} role="group" aria-label="Menu totals">
          <div className={s.totalsCol}>
            <dt className={s.totalsLabel}>Spent</dt>
            <dd className={s.totalsAmount}>{money(panel.spent)}</dd>
            <dd className={s.totalsSub}>{money(panel.perSpent)} a person per meal</dd>
            <dd className={s.totalsWhy}>What you pay at the register, divided by everyone eating.</dd>
          </div>
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
          <dd className={s.totalsNote}>
            {panel.notes.length ? panel.notes.map((n) => <span key={n}>{n}</span>) : <span>Spent − Used = Leftover. Both totals include adults eating with the patrol.</span>}
          </dd>
        </dl>
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
                    cost={costOf(l)}
                    onPackage={(id) => pickPackage(l, id)}
                    onQty={(n) => setQty(l, n)}
                    onSource={(src, note) => setSource(l, src, note)}
                    panelId={`${uid}-ing-${l.ing.id}`}
                    readOnly={readOnly}
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

      {gear.length > 0 && (
        <section className={s.section} aria-labelledby={`${uid}-gear-h`}>
          <h2 id={`${uid}-gear-h`} className={s.heading}>
            Gear you’ll need
          </h2>
          <p className={s.foot}>{gear.join(' · ')}</p>
        </section>
      )}

      {canPay && menuId && (
      <PaidSection
        menuId={menuId}
        lines={list.lines.filter((l) => l.status === 'ok' || l.status === 'short')}
        catalog={catalog}
        initial={initial.actuals}
        plannedTotal={totals.spent}
        readOnly={readOnly}
        plannedBy={plannedBy}
        onDirtyChange={setPaidDirty}
        onSaved={paidSaved}
      />
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
                  <td>{l.status === 'unpriced' ? 'Not priced yet' : `${l.qty} × ${l.pkg?.name ?? ''}`}</td>
                  <td>{l.status === 'unpriced' ? '' : money(l.spent)}</td>
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

function ShoppingRow({
  line: l,
  menu,
  mealOf,
  open,
  onToggle,
  cost,
  onPackage,
  onQty,
  onSource,
  panelId,
  readOnly
}: {
  line: MenuLine;
  menu: Menu;
  mealOf: ReadonlyMap<string, Menu['meals'][number]>;
  open: boolean;
  onToggle: () => void;
  cost: number;
  onPackage: (pkgId: string) => void;
  onQty: (n: number) => void;
  onSource: (source: LineSource, note: string) => void;
  panelId: string;
  readOnly: boolean;
}) {
  const buying = l.status === 'ok' || l.status === 'short';
  const pkg = l.pkg;
  const mealNames = l.usedBy
    .map((u) => mealOf.get(u.mealId))
    .filter((m): m is NonNullable<typeof m> => m != null)
    .map((m) => mealTitle(menu.startDate, m.day, m.slot));
  const sourceNote = l.note ? ` · ${l.note}` : '';

  let meta: string;
  if (l.status === 'staple') meta = 'Troop staple, no need to buy';
  else if (l.status === 'bring') meta = `${l.source === 'pantry' ? 'From the troop pantry' : 'Bringing from home'}${sourceNote}`;
  else if (l.status === 'unpriced') meta = '';
  else meta = `${l.qty} × ${pkg?.name ?? ''}`;

  const noteId = `${panelId}-note`;
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
        {l.status === 'unpriced' && <span className={s.tag}>No price yet</span>}
        {l.status === 'short' && <span className={s.tag}>Short {qtyText(l.shortQty, l.ing.unit)}</span>}
        {/* A scout's typed-in no leader has checked yet: its price is the scout's own entry (Phase 4B). */}
        {l.ing.needsMatch && l.status !== 'unpriced' && <span className={s.tag}>Scout’s price</span>}
      </div>
      <div className={s.cost}>{l.status === 'staple' || l.status === 'bring' ? '—' : l.status === 'unpriced' ? '' : money(cost)}</div>
      {open && (
        <div id={panelId} className={s.inset}>
          <p className={s.insetLine}>
            Needs {qtyText(l.need, l.ing.unit)}
            {mealNames.length > 0 ? ` for ${mealNames.join(', ')}` : ''}.
          </p>
          {buying && pkg && <p className={s.insetMuted}>{lineSentence(l)}</p>}

          {readOnly && buying && l.overridden && <p className={s.insetMuted}>Quantity changed from {l.autoQty} to {l.qty}.</p>}
          {readOnly && l.status !== 'staple' && (
            <p className={s.insetMuted}>
              Where it comes from: {SOURCES.find((o) => o.key === l.source)?.label ?? 'Buying it'}
              {l.source !== 'buy' && l.note ? ` · ${l.note}` : ''}
            </p>
          )}

          {l.status !== 'staple' && !readOnly && (
            <>
              {l.usable.length > 1 && l.source === 'buy' && (
                <div className={s.choice}>
                  <div className={s.choiceLabel} id={`${panelId}-pkg`}>
                    Package
                  </div>
                  <div className={s.chips} role="group" aria-labelledby={`${panelId}-pkg`}>
                    {l.usable.map((p) => (
                      <button key={p.id} type="button" className={s.chip} aria-pressed={pkg?.id === p.id} onClick={() => onPackage(p.id)}>
                        {p.name} · {money(p.price)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {buying && pkg && (
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

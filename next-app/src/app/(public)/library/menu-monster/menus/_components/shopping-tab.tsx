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
 * Phase 2 seam: the "What you paid" section renders below the list section
 * (see the marker at the end of the component); nothing of it is built.
 *
 * Print: a print stylesheet on this page (workspace.module.css) plus the
 * `#mm-shopping-page` hook in globals.css that hides the site chrome; the
 * anonymous planner's print sheet is a single-meal form with a counselor
 * summary and doesn't take a merged, menu-wide list.
 */

import { useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { priceText as money } from '@/lib/menu-monster/units';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { Notice } from '@/app/_components/notice';
import { Button } from '@/app/_components/button';
import { Stepper } from '@/app/_components/stepper';
import { TextInput } from '@/app/_components/form';
import type { Catalog, LineSource } from '@/lib/menu-monster/types';
import { SECTIONS, SECTION_ORDER, qtyText } from '@/lib/menu-monster/units';
import { MAX_QTY, lineSentence } from '@/lib/menu-monster/engine';
import type { Menu, MenuShopping } from '@/lib/menu-monster/menus';
import { buildMenuList, mealTitle, type MenuLine } from '@/lib/menu-monster/menu-view';
import { buildSnapshot, snapshotDrift, type MenuSnapshot } from '@/lib/menu-monster/menu-snapshot';
import { budgetState } from '../../../_tools/menu-monster/planner';
import { saveMenuAction } from '../../../_tools/menu-monster/menu-actions';
import { ReadOnlyLine } from './read-only-line';
import { SaveBar } from './save-bar';
import s from './workspace.module.css';

const MENUS_HREF = '/library/menu-monster/menus';
const NOTE_MAX = 120; // matches restorePlan's note cap
const keyOf = (sh: MenuShopping) => JSON.stringify(sh);
const SOURCES: readonly { key: LineSource; label: string }[] = [
  { key: 'buy', label: 'Buying it' },
  { key: 'home', label: 'Bringing from home' },
  { key: 'pantry', label: 'From the troop pantry' }
];

export interface ShoppingTabProps {
  catalog: Catalog;
  menuId: string;
  menu: Menu;
  /** The version token the menu was loaded at. */
  updatedAt: string;
  /** The priced snapshot stored at the last save (null for a row that never had one). */
  snapshot: MenuSnapshot | null;
  /** The Plan / Shopping tab strip, rendered under the title line. */
  tabs?: ReactNode;
  /** A leader's view of a scout's menu: choices shown as text, nothing edits or saves. */
  readOnly?: boolean;
  /** Credit name of the scout who planned it (read-only view). */
  plannedBy?: string | null;
}

export function ShoppingTab({ catalog, menuId, menu: initial, updatedAt, snapshot: initialSnapshot, tabs, readOnly = false, plannedBy = null }: ShoppingTabProps) {
  const uid = useId();
  const [saved, setSaved] = useState<{ menu: Menu; key: string }>(() => ({ menu: initial, key: keyOf(initial.shopping) }));
  const [draft, setDraft] = useState<MenuShopping>(initial.shopping);
  const [snapshot, setSnapshot] = useState<MenuSnapshot | null>(initialSnapshot);
  const [version, setVersion] = useState(updatedAt);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'total' | 'person'>('total');
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const dirty = keyOf(draft) !== saved.key;
  useLeaveGuard(dirty && !readOnly);

  const menu: Menu = { ...saved.menu, shopping: draft };
  const list = buildMenuList(menu, catalog);
  const { totals } = list;
  const people = menu.headcount;
  const budget = budgetState({ perSpent: list.perPersonMeal }, menu.budgetPerPersonMeal);
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
    let res: { ok: true; updatedAt: string } | { ok: false; error: string };
    try {
      res = await saveMenuAction(menuId, toSave, version);
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
    setSnapshot(buildSnapshot(toSave, catalog));
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
      <div className={s.titleLine}>
        <h1 className={s.menuTitle}>{menu.name.trim() || 'Untitled menu'}</h1>
        {!readOnly && <SaveBar isNew={false} dirty={dirty} saving={saving} saved={justSaved} onSave={() => void save()} onDiscard={discard} />}
      </div>
      {readOnly && <ReadOnlyLine plannedBy={plannedBy} />}
      {tabs != null && <div className={s.tabs}>{tabs}</div>}

      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
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
            <span aria-hidden="true">{budget.icon}</span> {budget.msg}{' '}
            <button type="button" className={s.linkBtn} onClick={() => window.print()}>
              Print
            </button>
          </p>
        )}

        {!priced && (
          <p className={s.foot}>
            Add a meal on the <Link href={`${MENUS_HREF}/${menuId}`}>Plan tab</Link> and pick what you’re cooking, and the list builds itself.
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
            {!readOnly && (
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

      {/* Phase 2 seam: the "What you paid" section (planned vs. paid, what you bought, price paid each)
          goes here as a second <section> under the list, on the same Save. Not built in Phase 1. */}
    </div>
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

'use client';

/**
 * Menu Monster leader tools — Price book (Plans/Menu-Monster-Leader-Tools.md).
 *
 * One table of ingredients, one selected at a time; under it that
 * ingredient's title line (Edit fixes its name, aisle and flags), its brands
 * with what is priced under each (brands-prices.tsx — one list, one "Add what
 * you bought" form), its unit conversions folded away, and Change unit behind
 * a dialog that previews the consequences before anything is written.
 * Every number and every line of copy comes from lib/menu-monster/authoring
 * — this file only lays them out.
 *
 * Status is never colour-only: the pill text says Unpriced / Stale / OK /
 * Retired, and the flags beside a price are sentences.
 */
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { FormPanel } from '../../../_components/form-panel';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { ActionsMenu } from '../../_components/actions-menu';
import { SaveButton, SaveProblem } from '../../_components/save-state';
import { fmtDate } from '@/lib/format-date';
import { money } from '@/lib/event-money';
import { changeUnitPlan, staleText } from '@/lib/menu-monster/authoring';
import { RESTRICTIONS, SECTIONS, UNITS } from '@/lib/menu-monster/units';
import type { Catalog, Conversion, Ingredient, Package, Section, Unit, UnitKind } from '@/lib/menu-monster/types';
import { addConversion, changeIngredientUnit, deleteConversion, restoreIngredient, retireIngredient, updateIngredient } from './actions';
import { NewFoodForm } from './new-food-form';
import { BrandsAndPrices } from './brands-prices';
import { FoodOnMenu } from './food-on-menu';
import { useAttempt } from './use-attempt';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

type Status = 'Unpriced' | 'Stale' | 'OK' | 'Retired';
const STATUS_VARIANT: Record<Status, 'danger' | 'warning' | 'success' | 'muted'> = {
  Unpriced: 'danger',
  Stale: 'warning',
  OK: 'success',
  Retired: 'muted'
};

const VOLUME_UNITS = ['cup', 'tbsp', 'tsp', 'oz'];
const WEIGHT_UNITS = ['gram', 'ozw', 'lb'];

interface Row {
  ing: Ingredient;
  active: Package[];
  usable: Package[];
  cheapest: number | null;
  newest: string | null;
  status: Status;
}

function buildRows(catalog: Catalog, today: string): Row[] {
  return catalog.ingredients.map((ing) => {
    const active = catalog.packages.filter((p) => p.ingredientId === ing.id && !p.retiredAt);
    const usable = active.filter((p) => p.yield != null && p.yield > 0);
    const perUnit = usable.map((p) => p.price / (p.yield as number));
    const cheapest = perUnit.length ? Math.min(...perUnit) : null;
    const dates = active.map((p) => p.asOf).filter((d): d is string => !!d).sort();
    const newest = dates.length ? dates[dates.length - 1] : null;
    let status: Status = 'OK';
    if (ing.retiredAt) status = 'Retired';
    else if (usable.length === 0) status = 'Unpriced';
    else if (staleText(newest, today) != null) status = 'Stale';
    return { ing, active, usable, cheapest, newest, status };
  });
}

function unitFromChoice(kind: UnitKind, key: string, one: string, many: string): Unit {
  if (kind === 'count') return { key: 'count', one: one.trim(), many: many.trim(), kind: 'count' };
  return UNITS[key] ?? UNITS.cup;
}

/** `stores` = the active store names, in order (mm_stores via lib/menu-monster/stores.ts). */
export function PriceBook({ catalog, today, stores, initialIngredientId }: { catalog: Catalog; today: string; stores: readonly string[]; initialIngredientId?: string }) {
  const router = useRouter();
  const rows = useMemo(() => buildRows(catalog, today), [catalog, today]);
  const search = useTableSearch(rows, (r) => [r.ing.name, r.ing.section, ...r.active.map((p) => p.name)]);
  const [selectedId, setSelectedId] = useState<string | null>(initialIngredientId ?? null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <SearchField
          value={search.q}
          onChange={search.setQ}
          label="Search ingredients"
          placeholder="Search ingredients…"
          resultCount={search.visible.length}
          totalCount={rows.length}
        />
        <span className={styles.spacer} />
        <Button variant="secondary" onClick={() => setAdding((v) => !v)}>
          + New ingredient
        </Button>
      </div>

      {note && <Notice variant="success">{note}</Notice>}
      {adding && (
        <NewFoodForm
          title="New ingredient"
          stores={stores}
          today={today}
          onDone={(res) => {
            if (res.ok) setAdding(false);
            if (res.id) setSelectedId(res.id);
            setNote(res.ok ? (res.note ?? null) : null);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Recipe unit</th>
              <th>Section</th>
              <th>Flags</th>
              <th className={styles.numCell}>Packages</th>
              <th className={styles.numCell}>Cheapest</th>
              <th>Newest price</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {search.visible.map((r) => (
              <Fragment key={r.ing.id}>
              <tr className={r.ing.id === selectedId ? styles.rowSelected : undefined}>
                <td>
                  {/* Click a row to open it right there; click it again to close it. */}
                  <button type="button" className={styles.rowBtn} aria-expanded={r.ing.id === selectedId} onClick={() => setSelectedId((cur) => (cur === r.ing.id ? null : r.ing.id))}>
                    {r.ing.name}
                  </button>
                </td>
                <td>{r.ing.unit.many}</td>
                <td>{SECTIONS[r.ing.section]}</td>
                <td>
                  <span className={styles.flags}>
                    {r.ing.staple && <Badge variant="muted">patrol box</Badge>}
                    {r.ing.avoid.map((k) => (
                      <Badge key={k} variant="muted">
                        not {RESTRICTIONS.find((x) => x.key === k)?.label.toLowerCase()}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className={styles.numCell}>{r.active.length}</td>
                <td className={styles.numCell}>{r.cheapest == null ? '—' : `${money(r.cheapest)}/${r.ing.unit.one}`}</td>
                <td>{r.newest ? fmtDate(r.newest) : '—'}</td>
                <td>
                  <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                </td>
              </tr>
              {/* The open ingredient sits directly under its own row (Patrick, 2026-10-05), not below all 66. */}
              {r.ing.id === selectedId && (
                <tr className={styles.detailRow} aria-label={`Details for ${r.ing.name}`}>
                  <td colSpan={8}>
                    <IngredientDetail row={r} catalog={catalog} today={today} stores={stores} scrollIntoView={r.ing.id === initialIngredientId} onChanged={() => router.refresh()} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {search.visible.length === 0 && (
              <tr>
                <td colSpan={8} className={styles.muted}>
                  No ingredient matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

/* ── Selected ingredient ─────────────────────────────────────────────────── */

function IngredientDetail({ row, catalog, today, stores, scrollIntoView = false, onChanged }: { row: Row; catalog: Catalog; today: string; stores: readonly string[]; scrollIntoView?: boolean; onChanged: () => void }) {
  const { ing } = row;
  // Arriving by a link to one ingredient (?ingredient=): bring its row into view once.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollIntoView) box.current?.scrollIntoView?.({ block: 'center' });
  }, [scrollIntoView]);
  const [editing, setEditing] = useState(false);
  const [changingUnit, setChangingUnit] = useState(false);
  const [showConversions, setShowConversions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [retiring, setRetiring] = useState(false);
  const retireDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (retiring) retireDialog.current?.showModal();
  }, [retiring]);
  const conversions = catalog.conversions.filter((c) => c.ingredientId === ing.id);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Something went wrong.');
      else onChanged();
    });
  }

  return (
    <div ref={box} className={styles.detail} aria-label={`${ing.name} details`} role="region">
      <div className={styles.detailHead}>
        <h2 className={styles.detailTitle}>{ing.name}</h2>
        <span className={styles.cardMeta}>
          measured in {ing.unit.many} · {SECTIONS[ing.section]}
          {ing.retiredAt ? ' · retired' : ''}
        </span>
        <span className={styles.spacer} />
        {!ing.retiredAt && (
          <Button variant="secondary" size="sm" disabled={pending || editing} onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        <ActionsMenu
          ariaLabel="More actions"
          placeholder="More actions…"
          disabled={pending}
          options={ing.retiredAt ? [{ value: 'restore', label: 'Restore' }] : [{ value: 'unit', label: 'Change unit' }, { value: 'retire', label: 'Retire' }]}
          onAction={(v) => {
            if (v === 'unit') setChangingUnit(true);
            else if (v === 'retire') setRetiring(true);
            else run(() => restoreIngredient(ing.id));
          }}
        />
      </div>
      {error && <Notice>{error}</Notice>}

      {editing && <IngredientEditForm ing={ing} onClose={() => setEditing(false)} onChanged={onChanged} />}

      {/* Whether it can be picked for a meal on its own — one entry, not a second one on another tab. Not for a
          retired food, or one a scout typed in that a leader has not kept yet. */}
      {!ing.retiredAt && !ing.needsMatch && <FoodOnMenu ing={ing} catalog={catalog} onChanged={onChanged} />}

      <BrandsAndPrices ing={ing} catalog={catalog} today={today} stores={stores} onChanged={onChanged} />

      <div>
        <button type="button" className={styles.rowBtn} aria-expanded={showConversions} onClick={() => setShowConversions((v) => !v)}>
          Conversions ({conversions.length}) {showConversions ? '▾' : '▸'}
        </button>
      </div>
      {showConversions && <ConversionsBlock ing={ing} conversions={conversions} onChanged={onChanged} />}

      {retiring && (
        <Dialog ref={retireDialog} danger aria-label={`Retire ${ing.name}`} onClose={() => setRetiring(false)}>
          <DialogHeader title={`Retire ${ing.name}?`} sub="Menus and recipes can’t pick it any more, and its prices stop counting. It can be restored later." />
          <DialogBody>{null}</DialogBody>
          <DialogActions>
            <Button variant="secondary" size="sm" onClick={() => setRetiring(false)}>
              Keep it
            </Button>
            <Button
              variant="dangerSolid"
              size="sm"
              onClick={() => {
                setRetiring(false);
                run(() => retireIngredient(ing.id));
              }}
            >
              Retire
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {changingUnit && (
        <ChangeUnitDialog
          ing={ing}
          packages={row.active}
          catalog={catalog}
          onClose={() => setChangingUnit(false)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

/* ── The ingredient itself: name, aisle, flags ───────────────────────────── */

const SECTION_KEYS = Object.keys(SECTIONS) as Section[];

/** Fix a typo, move it to another aisle, change what it warns about (Patrick, 2026-10-05: "No way I can
 *  find to rename an item"). The unit is not here — changing it rewrites yields, so it keeps its own dialog. */
function IngredientEditForm({ ing, onClose, onChanged }: { ing: Ingredient; onClose: () => void; onChanged: () => void }) {
  const initial = { name: ing.name, section: ing.section, staple: ing.staple, avoid: ing.avoid };
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const idp = `mm-ing-${ing.id}`;
  const { attempted, container, refuse } = useAttempt();
  const noName = !draft.name.trim();

  function save() {
    setError(null);
    start(async () => {
      const res = await updateIngredient(ing.id, { ...draft, name: draft.name.trim() });
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      onChanged();
      onClose();
    });
  }

  return (
    <FormPanel title={`Edit ${ing.name}`} aria-label={`Edit ${ing.name}`}>
      {error && <Notice>{error}</Notice>}
      <div ref={container} className={lib.fieldGrid}>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-name`}>
            Name
          </label>
          <input id={`${idp}-name`} className={attempted && noName ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={(attempted && noName) || undefined} value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          {attempted && noName && <p className={styles.badNote}>Give it a name.</p>}
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-section`}>
            Store section
          </label>
          <select id={`${idp}-section`} className={lib.selectInput} value={draft.section} onChange={(e) => setDraft((d) => ({ ...d, section: e.target.value as Section }))}>
            {SECTION_KEYS.map((k) => (
              <option key={k} value={k}>
                {SECTIONS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className={lib.fieldFull}>
          <span className={`adminLabel ${lib.fieldLabel}`}>Flags</span>
          <label className={styles.listRow}>
            <input type="checkbox" checked={draft.staple} onChange={(e) => setDraft((d) => ({ ...d, staple: e.target.checked }))} /> Patrol-box staple (counts in Used, never Spent)
          </label>
          {RESTRICTIONS.map((r) => (
            <label key={r.key} className={styles.listRow}>
              <input
                type="checkbox"
                checked={draft.avoid.includes(r.key)}
                onChange={(e) => setDraft((d) => ({ ...d, avoid: e.target.checked ? [...d.avoid, r.key] : d.avoid.filter((k) => k !== r.key) }))}
              />{' '}
              Warn {r.label.toLowerCase()} people
            </label>
          ))}
        </div>
      </div>
      <div className={lib.actionsRow}>
        <SaveButton dirty={dirty} pending={pending} blocked={noName} blockedReason="It needs a name" onBlocked={refuse} onClick={save} />
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        {attempted && noName && <SaveProblem reason="it needs a name" />}
      </div>
    </FormPanel>
  );
}

/* ── Conversions ─────────────────────────────────────────────────────────── */

const CONV_UNITS = [...new Set([...Object.keys(UNITS), 'each', 'dozen'])];

function ConversionsBlock({ ing, conversions, onChanged }: { ing: Ingredient; conversions: Conversion[]; onChanged: () => void }) {
  const [from, setFrom] = useState('lb');
  const [to, setTo] = useState(ing.unit.key);
  const [factor, setFactor] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const idp = `mm-conv-${ing.id}`;
  const factorNum = Number(factor);
  const { attempted, container, refuse, clear } = useAttempt();
  const nothingTyped = factor.trim() === '' && label.trim() === '';
  const badFactor = !(factor.trim() !== '' && factorNum > 0);
  const sameUnit = from === to;
  const problems = [
    ...(badFactor ? [{ field: 'factor', note: 'Needs a number above zero.', reason: 'say how many' }] : []),
    ...(sameUnit ? [{ field: 'to', note: 'Pick two different units.', reason: 'pick two different units' }] : [])
  ];
  const shown = attempted ? problems : [];
  const isBad = (f: string) => shown.some((x) => x.field === f);
  const unitLabel = (k: string) => (k === ing.unit.key ? ing.unit.many : UNITS[k]?.many ?? k);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Something went wrong.');
      else {
        after?.();
        onChanged();
      }
    });
  }

  return (
    <FormPanel
      title="Conversions"
      aria-label="Conversions"
      note={`How the store's units turn into ${ing.unit.many}. A recipe line may use any unit these can bridge; a package sold in one of these gets its yield suggested.`}
    >
      {error && <Notice>{error}</Notice>}
      {conversions.length === 0 ? (
        <p className={styles.muted}>None yet.</p>
      ) : (
        <ul className={styles.list} aria-label={`${ing.name} conversions`}>
          {conversions.map((c, i) => (
            <li key={c.id ?? `${c.from}-${c.to}-${i}`} className={styles.listRow}>
              <span className={styles.grow}>
                1 {unitLabel(c.from)} = {c.factor} {unitLabel(c.to)}
                {c.label ? <span className={styles.muted}> — {c.label}</span> : null}
              </span>
              {c.id != null && (
                <Button variant="quiet" size="sm" disabled={pending} aria-label={`Remove conversion 1 ${c.from} = ${c.factor} ${c.to}`} onClick={() => run(() => deleteConversion(c.id as number))}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div ref={container} className={styles.inlineForm}>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-from`}>
            1 of
          </label>
          <select id={`${idp}-from`} className={lib.selectInput} value={from} onChange={(e) => setFrom(e.target.value)}>
            {CONV_UNITS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.narrow}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-factor`}>
            equals
          </label>
          <input id={`${idp}-factor`} className={isBad('factor') ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={isBad('factor') || undefined} inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} placeholder="16" />
          {isBad('factor') && <p className={styles.badNote}>{problems.find((x) => x.field === 'factor')?.note}</p>}
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-to`}>
            of
          </label>
          <select id={`${idp}-to`} className={isBad('to') ? `${lib.selectInput} ${styles.bad}` : lib.selectInput} aria-invalid={isBad('to') || undefined} value={to} onChange={(e) => setTo(e.target.value)}>
            {CONV_UNITS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {isBad('to') && <p className={styles.badNote}>{problems.find((x) => x.field === 'to')?.note}</p>}
        </div>
        <div className={styles.grow}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-label`}>
            Where it comes from
          </label>
          <input id={`${idp}-label`} className={lib.textInput} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="USDA household measures, the label…" />
        </div>
        <Button
          variant="secondary"
          disabled={pending || nothingTyped}
          onClick={() => {
            if (problems.length > 0) {
              refuse();
              return;
            }
            run(
              () => addConversion(ing.id, { from, to, factor: factorNum, label: label || null }),
              () => {
                setFactor('');
                setLabel('');
                clear();
              }
            );
          }}
        >
          Add conversion
        </Button>
        {shown.length > 0 && <SaveProblem reason={shown[0].reason} more={shown.length - 1} />}
      </div>
    </FormPanel>
  );
}

/* ── Change unit ────────────────────────────────────────────────────────── */

function ChangeUnitDialog({ ing, packages, catalog, onClose, onChanged }: { ing: Ingredient; packages: Package[]; catalog: Catalog; onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<UnitKind>(ing.unit.kind);
  const [key, setKey] = useState(ing.unit.kind === 'count' ? 'cup' : ing.unit.key);
  const [one, setOne] = useState(ing.unit.kind === 'count' ? ing.unit.one : '');
  const [many, setMany] = useState(ing.unit.kind === 'count' ? ing.unit.many : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  const unit = unitFromChoice(kind, key, one, many);
  const lines = catalog.recipes
    .filter((r) => r.status !== 'retired')
    .flatMap((r) => r.lines.filter((l) => l.ingredientId === ing.id).map((l) => ({ recipeId: r.id, recipeName: r.name, unitKey: l.unitKey })));
  const same = unit.kind === ing.unit.kind && unit.key === ing.unit.key && unit.one === ing.unit.one && unit.many === ing.unit.many;
  const ready = !same && (kind !== 'count' || (one.trim() && many.trim()));
  const { attempted, container, refuse } = useAttempt();
  const badOne = kind === 'count' && !one.trim();
  const badMany = kind === 'count' && !many.trim();
  const shown = attempted ? [...(badOne ? ['name what one is called'] : []), ...(badMany ? ['name what several are called'] : [])] : [];
  const plan = ready ? changeUnitPlan(ing, unit, packages, lines, catalog.conversions) : null;

  return (
    <Dialog ref={ref} aria-label={`Change the recipe unit of ${ing.name}`} onClose={onClose}>
      <DialogHeader title={`Change the recipe unit of ${ing.name}`} sub={`Today: ${ing.unit.many}. Package yields and recipe lines follow the rules below.`} />
      <DialogBody>
        {error && <Notice>{error}</Notice>}
        <div ref={container} className={lib.fieldGrid}>
          <div>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-cu-kind">
              Measured by
            </label>
            <select
              id="mm-cu-kind"
              className={lib.selectInput}
              value={kind}
              onChange={(e) => {
                const k = e.target.value as UnitKind;
                setKind(k);
                setKey(k === 'weight' ? 'gram' : 'cup');
              }}
            >
              <option value="volume">Volume</option>
              <option value="weight">Weight</option>
              <option value="count">Count</option>
            </select>
          </div>
          {kind !== 'count' ? (
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-cu-unit">
                Recipe unit
              </label>
              <select id="mm-cu-unit" className={lib.selectInput} value={key} onChange={(e) => setKey(e.target.value)}>
                {(kind === 'volume' ? VOLUME_UNITS : WEIGHT_UNITS).map((k) => (
                  <option key={k} value={k}>
                    {UNITS[k].many}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-cu-one">
                  One is called
                </label>
                <input id="mm-cu-one" className={attempted && badOne ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={(attempted && badOne) || undefined} value={one} onChange={(e) => setOne(e.target.value)} />
                {attempted && badOne && <p className={styles.badNote}>Say what one is called.</p>}
              </div>
              <div>
                <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-cu-many">
                  Several are called
                </label>
                <input id="mm-cu-many" className={attempted && badMany ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={(attempted && badMany) || undefined} value={many} onChange={(e) => setMany(e.target.value)} />
                {attempted && badMany && <p className={styles.badNote}>Say what several are called.</p>}
              </div>
            </>
          )}
        </div>
        {plan ? (
          <ul className={styles.consequences} aria-label="What will change">
            {plan.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>Pick a different unit to see what would change.</p>
        )}
      </DialogBody>
      <DialogActions>
        {shown.length > 0 && <SaveProblem reason={shown[0]} more={shown.length - 1} />}
        <Button variant="secondary" disabled={pending} onClick={() => ref.current?.close()}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={pending || same}
          onClick={() => {
            if (!ready) {
              refuse();
              return;
            }
            setError(null);
            start(async () => {
              const res = await changeIngredientUnit(ing.id, unit);
              if (!res.ok) {
                setError(res.error ?? 'Something went wrong.');
                return;
              }
              onChanged();
              ref.current?.close();
            });
          }}
        >
          {pending ? 'Changing…' : 'Change unit'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

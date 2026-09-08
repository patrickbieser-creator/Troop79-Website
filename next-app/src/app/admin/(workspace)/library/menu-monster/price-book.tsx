'use client';

/**
 * Menu Monster leader tools — Price book (Plans/Menu-Monster-Leader-Tools.md).
 *
 * One table of ingredients, one selected at a time; under it that
 * ingredient's packages (each an inline dirty-gated edit), an Add-a-package
 * form with the Option C yield helper, its unit conversions, and Change unit
 * behind a dialog that previews the consequences before anything is written.
 * Every number and every line of copy comes from lib/menu-monster/authoring
 * — this file only lays them out.
 *
 * Status is never colour-only: the pill text says Unpriced / Stale / OK /
 * Retired, and the flags beside a price are sentences.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { FormPanel } from '../../../_components/form-panel';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { fmtDate } from '@/lib/format-date';
import { money } from '@/lib/event-money';
import {
  SOLD_UNITS,
  STORES,
  changeUnitPlan,
  priceChange,
  staleText,
  suggestYield,
  unusableText
} from '@/lib/menu-monster/authoring';
import { RESTRICTIONS, SECTIONS, UNITS } from '@/lib/menu-monster/units';
import type { Catalog, Conversion, Ingredient, Package, RestrictionKey, Section, Unit, UnitKind } from '@/lib/menu-monster/types';
import {
  addConversion,
  changeIngredientUnit,
  createIngredient,
  createPackage,
  deleteConversion,
  restoreIngredient,
  restorePackage,
  retireIngredient,
  retirePackage,
  updatePackage,
  type PackageEdit
} from './actions';
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
const SECTION_KEYS = Object.keys(SECTIONS) as Section[];
const ARM_MS = 4000;

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

/** A two-click arm for the one-way actions (D-070: no confirm()). */
function useArmed(): { armed: boolean; arm: () => boolean; disarm: () => void } {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return {
    armed,
    arm: () => {
      if (armed) {
        setArmed(false);
        return true;
      }
      setArmed(true);
      return false;
    },
    disarm: () => setArmed(false)
  };
}

export function PriceBook({ catalog, today, initialIngredientId }: { catalog: Catalog; today: string; initialIngredientId?: string }) {
  const router = useRouter();
  const rows = useMemo(() => buildRows(catalog, today), [catalog, today]);
  const search = useTableSearch(rows, (r) => [r.ing.name, r.ing.section, ...r.active.map((p) => p.name)]);
  const [selectedId, setSelectedId] = useState<string | null>(initialIngredientId ?? null);
  const [adding, setAdding] = useState(false);
  const selected = rows.find((r) => r.ing.id === selectedId) ?? null;

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
        <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
          + New ingredient
        </Button>
      </div>

      {adding && (
        <NewIngredientForm
          onDone={(id) => {
            setAdding(false);
            if (id) setSelectedId(id);
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
              <tr key={r.ing.id} className={r.ing.id === selectedId ? styles.rowSelected : undefined}>
                <td>
                  <button type="button" className={styles.rowBtn} onClick={() => setSelectedId(r.ing.id)}>
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

      {selected && (
        <IngredientDetail
          key={selected.ing.id}
          row={selected}
          catalog={catalog}
          today={today}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

/* ── New ingredient ─────────────────────────────────────────────────────── */

function NewIngredientForm({ onDone, onCancel }: { onDone: (id: string | null) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<UnitKind>('volume');
  const [key, setKey] = useState('cup');
  const [one, setOne] = useState('');
  const [many, setMany] = useState('');
  const [section, setSection] = useState<Section>('dry');
  const [staple, setStaple] = useState(false);
  const [avoid, setAvoid] = useState<RestrictionKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const feedback = useSavePhase();

  const ready = name.trim().length > 0 && (kind !== 'count' || (one.trim() && many.trim()));

  function submit() {
    setError(null);
    feedback.start();
    start(async () => {
      const res = await createIngredient({ name, unit: unitFromChoice(kind, key, one, many), section, staple, avoid });
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      feedback.done();
      onDone(res.id ?? null);
    });
  }

  return (
    <FormPanel
      title="New ingredient"
      aria-label="New ingredient"
      actions={<SaveFeedback phase={feedback.phase} />}
      note="It starts unpriced — add a package below to make it usable."
    >
      {error && <Notice>{error}</Notice>}
      <div className={lib.fieldGrid}>
        <div className={lib.fieldFull}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-name">
            Name
          </label>
          <input id="mm-new-name" className={lib.textInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Required" />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-kind">
            Measured by
          </label>
          <select
            id="mm-new-kind"
            className={lib.selectInput}
            value={kind}
            onChange={(e) => {
              const k = e.target.value as UnitKind;
              setKind(k);
              setKey(k === 'weight' ? 'gram' : 'cup');
            }}
          >
            <option value="volume">Volume (cups, Tbsp…)</option>
            <option value="weight">Weight (g, oz, lb)</option>
            <option value="count">Count (one, two, three…)</option>
          </select>
        </div>
        {kind !== 'count' ? (
          <div>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-unit">
              Recipe unit
            </label>
            <select id="mm-new-unit" className={lib.selectInput} value={key} onChange={(e) => setKey(e.target.value)}>
              {(kind === 'volume' ? VOLUME_UNITS : WEIGHT_UNITS).map((k) => (
                <option key={k} value={k}>
                  {UNITS[k].many}
                </option>
              ))}
            </select>
            <p className={styles.hint}>Packages state their yield in this unit.</p>
          </div>
        ) : (
          <>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-one">
                One is called
              </label>
              <input id="mm-new-one" className={lib.textInput} value={one} onChange={(e) => setOne(e.target.value)} placeholder="banana" />
            </div>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-many">
                Several are called
              </label>
              <input id="mm-new-many" className={lib.textInput} value={many} onChange={(e) => setMany(e.target.value)} placeholder="bananas" />
            </div>
          </>
        )}
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-section">
            Store section
          </label>
          <select id="mm-new-section" className={lib.selectInput} value={section} onChange={(e) => setSection(e.target.value as Section)}>
            {SECTION_KEYS.map((s) => (
              <option key={s} value={s}>
                {SECTIONS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className={`adminLabel ${lib.fieldLabel}`}>Flags</span>
          <label className={styles.listRow}>
            <input type="checkbox" checked={staple} onChange={(e) => setStaple(e.target.checked)} /> Patrol-box staple (counts in Used, never Spent)
          </label>
          {RESTRICTIONS.map((r) => (
            <label key={r.key} className={styles.listRow}>
              <input
                type="checkbox"
                checked={avoid.includes(r.key)}
                onChange={(e) => setAvoid((prev) => (e.target.checked ? [...prev, r.key] : prev.filter((k) => k !== r.key)))}
              />{' '}
              Warn {r.label.toLowerCase()} people
            </label>
          ))}
        </div>
      </div>
      <div className={lib.actionsRow}>
        <Button variant="primary" disabled={pending || !ready} title={ready ? undefined : 'Name it first'} onClick={submit}>
          {pending ? 'Adding…' : 'Add ingredient'}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </FormPanel>
  );
}

/* ── Selected ingredient ─────────────────────────────────────────────────── */

function IngredientDetail({ row, catalog, today, onChanged }: { row: Row; catalog: Catalog; today: string; onChanged: () => void }) {
  const { ing } = row;
  const [changingUnit, setChangingUnit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const retire = useArmed();
  const conversions = catalog.conversions.filter((c) => c.ingredientId === ing.id);
  const allPackages = catalog.packages.filter((p) => p.ingredientId === ing.id);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Something went wrong.');
      else onChanged();
    });
  }

  return (
    <div className={styles.detail} aria-label={`${ing.name} details`} role="region">
      <div className={styles.detailHead}>
        <h2 className={styles.detailTitle}>{ing.name}</h2>
        <span className={styles.cardMeta}>
          measured in {ing.unit.many} · {SECTIONS[ing.section]}
          {ing.retiredAt ? ' · retired' : ''}
        </span>
        <span className={styles.spacer} />
        {!ing.retiredAt && (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => setChangingUnit(true)}>
            Change unit
          </Button>
        )}
        {ing.retiredAt ? (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => restoreIngredient(ing.id))}>
            Restore
          </Button>
        ) : (
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (retire.arm()) run(() => retireIngredient(ing.id));
            }}
          >
            {retire.armed ? 'Click again to retire' : 'Retire ingredient'}
          </Button>
        )}
      </div>
      {error && <Notice>{error}</Notice>}

      {allPackages.length === 0 ? (
        <p className={styles.muted}>No packages yet — add one below so recipes can cost it out.</p>
      ) : (
        <div className={styles.cards}>
          {allPackages.map((p) => (
            <PackageCard key={p.id} pkg={p} ing={ing} today={today} onChanged={onChanged} />
          ))}
        </div>
      )}

      {!ing.retiredAt && <AddPackageForm ing={ing} conversions={conversions} today={today} onChanged={onChanged} />}

      <ConversionsBlock ing={ing} conversions={conversions} onChanged={onChanged} />

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

/* ── One package: inline dirty-gated edit ───────────────────────────────── */

interface PackageDraft {
  name: string;
  store: string;
  price: string;
  asOf: string;
  note: string;
  yield: string;
}

function PackageCard({ pkg, ing, today, onChanged }: { pkg: Package; ing: Ingredient; today: string; onChanged: () => void }) {
  const initial: PackageDraft = {
    name: pkg.name,
    store: pkg.store ?? '',
    price: pkg.price.toFixed(2),
    asOf: pkg.asOf ?? '',
    note: pkg.note ?? '',
    yield: pkg.yield == null ? '' : String(pkg.yield)
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
  const stale = staleText(snap.saved.asOf || null, today);
  const usable = pkg.yield != null;
  const perUnit = usable ? pkg.price / (pkg.yield as number) : null;
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
      const res = await updatePackage(pkg.id, edit);
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
    <section className={`${styles.card}${pkg.retiredAt ? ` ${styles.cardRetired}` : ''}`} aria-label={pkg.name}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardName}>{pkg.name}</h3>
        <span className={styles.cardMeta}>
          {pkg.store ?? 'store not set'}
          {pkg.soldSize != null && pkg.soldUnit ? ` · ${pkg.soldSize} ${pkg.soldUnit}` : ''}
          {pkg.retiredAt ? ' · retired' : ''}
        </span>
      </div>
      {usable ? (
        <p className={styles.readout}>
          {money(pkg.price)} → {money(perUnit as number)} per {ing.unit.one} ({pkg.yield} {ing.unit.many} per {pkg.noun})
          {pkg.asOf ? ` · as of ${fmtDate(pkg.asOf)}` : ''}
        </p>
      ) : (
        <p className={`${styles.readout} ${styles.readoutWarn}`}>{unusableText(pkg, ing)}</p>
      )}
      {stale && !pkg.retiredAt && <p className={`${styles.readout} ${styles.readoutWarn}`}>{stale}</p>}
      {error && <Notice>{error}</Notice>}

      {!pkg.retiredAt && (
        <>
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
                  setDraft((d) => ({ ...d, price, asOf: Number(price) !== savedPrice ? today : d.asOf }));
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
                max={today}
                className={lib.textInput}
                value={draft.asOf}
                onChange={(e) => setDraft((d) => ({ ...d, asOf: e.target.value }))}
              />
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
                placeholder={usable ? undefined : 'Type it to make this package usable'}
                onChange={(e) => setDraft((d) => ({ ...d, yield: e.target.value }))}
              />
            </div>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-store`}>
                Store
              </label>
              <select id={`${idp}-store`} className={lib.selectInput} value={draft.store} onChange={(e) => setDraft((d) => ({ ...d, store: e.target.value }))}>
                <option value="">— not set —</option>
                {STORES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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
                if (retire.arm()) start(async () => {
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
      )}
      {pkg.retiredAt && (
        <div className={lib.actionsRow}>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
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
        </div>
      )}
    </section>
  );
}

/* ── Add a package (create-once) ────────────────────────────────────────── */

function AddPackageForm({ ing, conversions, today, onChanged }: { ing: Ingredient; conversions: Conversion[]; today: string; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [store, setStore] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [soldUnit, setSoldUnit] = useState('');
  const [yieldText, setYieldText] = useState('');
  const [yieldTouched, setYieldTouched] = useState(false);
  const [asOf, setAsOf] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const feedback = useSavePhase();

  const sizeNum = size.trim() === '' ? null : Number(size);
  const suggestion = suggestYield(ing, Number.isFinite(sizeNum as number) ? sizeNum : null, soldUnit || null, conversions);
  const effectiveYield = yieldTouched ? yieldText : suggestion.value == null ? '' : String(suggestion.value);
  const yieldNum = effectiveYield.trim() === '' ? null : Number(effectiveYield);
  const priceNum = Number(price);
  const ready = name.trim().length > 0 && price.trim() !== '' && Number.isFinite(priceNum) && priceNum >= 0 && (yieldNum == null || yieldNum > 0);
  const perUnit = yieldNum != null && yieldNum > 0 && Number.isFinite(priceNum) ? priceNum / yieldNum : null;
  const idp = `mm-add-${ing.id}`;

  function submit() {
    setError(null);
    feedback.start();
    start(async () => {
      const res = await createPackage({
        ingredientId: ing.id,
        name,
        store: store || null,
        price: priceNum,
        soldSize: sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : null,
        soldUnit: soldUnit || null,
        yield: yieldNum,
        yieldUnitLabel: yieldNum == null ? (soldUnit || 'label size') : null,
        noun: soldUnit === 'dozen' ? 'dozen' : soldUnit === 'each' ? 'each' : 'pack',
        asOf: asOf || null,
        note: note || null
      });
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      feedback.done();
      setName('');
      setPrice('');
      setSize('');
      setSoldUnit('');
      setYieldText('');
      setYieldTouched(false);
      setNote('');
      onChanged();
    });
  }

  return (
    <FormPanel title="Add a package" aria-label="Add a package" actions={<SaveFeedback phase={feedback.phase} />}>
      {error && <Notice>{error}</Notice>}
      <div className={lib.fieldGrid}>
        <div className={lib.fieldFull}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-name`}>
            Product name
          </label>
          <input id={`${idp}-name`} className={lib.textInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="As it reads on the label" />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-store`}>
            Store
          </label>
          <select id={`${idp}-store`} className={lib.selectInput} value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">— pick —</option>
            {STORES.map((s) => (
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
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-size`}>
            Package size
          </label>
          <input id={`${idp}-size`} className={lib.textInput} inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 10" />
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
            <span>{suggestion.text}</span>
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
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-asof`}>
            Price as of
          </label>
          <input id={`${idp}-asof`} type="date" max={today} className={lib.textInput} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-note`}>
            Note
          </label>
          <input id={`${idp}-note`} className={lib.textInput} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </div>
      </div>
      <div className={lib.actionsRow}>
        <Button variant="primary" disabled={pending || !ready} title={ready ? undefined : 'A product name and a price are needed'} onClick={submit}>
          {pending ? 'Adding…' : 'Add package'}
        </Button>
      </div>
    </FormPanel>
  );
}

/* ── Conversions ─────────────────────────────────────────────────────────── */

const CONV_UNITS = [...Object.keys(UNITS), 'gallon', 'quart', 'each', 'dozen'];

function ConversionsBlock({ ing, conversions, onChanged }: { ing: Ingredient; conversions: Conversion[]; onChanged: () => void }) {
  const [from, setFrom] = useState('lb');
  const [to, setTo] = useState(ing.unit.key);
  const [factor, setFactor] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const idp = `mm-conv-${ing.id}`;
  const factorNum = Number(factor);
  const ready = from !== to && factor.trim() !== '' && factorNum > 0;
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
      <div className={styles.inlineForm}>
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
          <input id={`${idp}-factor`} className={lib.textInput} inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} placeholder="16" />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-to`}>
            of
          </label>
          <select id={`${idp}-to`} className={lib.selectInput} value={to} onChange={(e) => setTo(e.target.value)}>
            {CONV_UNITS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.grow}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-label`}>
            Where it comes from
          </label>
          <input id={`${idp}-label`} className={lib.textInput} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="USDA household measures, the label…" />
        </div>
        <Button
          variant="secondary"
          disabled={pending || !ready}
          title={ready ? undefined : 'Two different units and a factor above zero'}
          onClick={() =>
            run(
              () => addConversion(ing.id, { from, to, factor: factorNum, label: label || null }),
              () => {
                setFactor('');
                setLabel('');
              }
            )
          }
        >
          Add conversion
        </Button>
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
  const plan = ready ? changeUnitPlan(ing, unit, packages, lines, catalog.conversions) : null;

  return (
    <Dialog ref={ref} aria-label={`Change the recipe unit of ${ing.name}`} onClose={onClose}>
      <DialogHeader title={`Change the recipe unit of ${ing.name}`} sub={`Today: ${ing.unit.many}. Package yields and recipe lines follow the rules below.`} />
      <DialogBody>
        {error && <Notice>{error}</Notice>}
        <div className={lib.fieldGrid}>
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
                <input id="mm-cu-one" className={lib.textInput} value={one} onChange={(e) => setOne(e.target.value)} />
              </div>
              <div>
                <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-cu-many">
                  Several are called
                </label>
                <input id="mm-cu-many" className={lib.textInput} value={many} onChange={(e) => setMany(e.target.value)} />
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
        <Button variant="secondary" disabled={pending} onClick={() => ref.current?.close()}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={pending || !ready}
          onClick={() => {
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

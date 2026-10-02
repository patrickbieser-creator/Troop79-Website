'use client';

/**
 * "What you paid" — the second section of the Shopping tab (Plans/Menu-Monster-
 * Scout-Workspace.md, Phase 2 release B; prototype concept-e-scout-workspace/
 * shopping.html; UX-BRIEF §3). One row per line being bought: "planned 2 × $5.99"
 * on the left, "2 × $6.49" paid on the right, a quiet tag (✓ Updated / ⚑ Held /
 * ↻ Updates the book), held lines first. A click opens an inset: which package
 * you bought, how many, the price paid each, and a one-line verdict computed live
 * with the same band the server applies (paid-view.ts), so nothing is a surprise
 * after Save.
 *
 * It has its OWN dirty-gated Save + Discard (save-button standard), separate from
 * the shopping-choices Save: it writes through saveActualsAction, which touches
 * only `actuals` — no version bump — and reports each changed price to the troop
 * price book. The menu always keeps what the scout paid, whatever the outcome.
 *
 * `readOnly` (a leader): the paid values as text, no inputs, no Save.
 */

import { useEffect, useId, useState } from 'react';
import { priceText as money } from '@/lib/menu-monster/units';
import { Notice } from '@/app/_components/notice';
import { AmountInput, Stepper } from '@/app/_components/stepper';
import type { Catalog } from '@/lib/menu-monster/types';
import { MAX_ACTUAL_PRICE, MAX_ACTUAL_QTY, MIN_ACTUAL_PRICE, type Actual, type Actuals, type PaidStatus } from '@/lib/menu-monster/menus';
import type { MenuLine } from '@/lib/menu-monster/menu-view';
import { actualChanged, paidSavedSentence, paidVerdict, pricedActuals, type PaidTag } from '@/lib/menu-monster/paid-view';
import { saveActualsAction } from '../../../_tools/menu-monster/menu-actions';
import { SaveBar } from './save-bar';
import s from './workspace.module.css';

interface Entry {
  packageId: string;
  qty: number;
  /** null until a price is typed: a package or quantity pick alone is not an entry. */
  pricePaid: number | null;
}

const TAGS: Record<Exclude<PaidTag, null>, string> = { updated: '✓ Updated', held: '⚑ Held', book: '↻ Updates the book' };
const actualsKey = (a: Actuals) => JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k].packageId, a[k].qty, a[k].pricePaid]));
const priced = (e: Entry | undefined): Actual | undefined => (e && e.pricePaid != null ? { packageId: e.packageId, qty: e.qty, pricePaid: e.pricePaid } : undefined);

export interface PaidSavedInfo {
  actuals: Actuals;
  results: Record<string, PaidStatus>;
}

export function PaidSection({
  menuId,
  lines,
  catalog,
  initial,
  plannedTotal,
  readOnly,
  plannedBy,
  onDirtyChange,
  onSaved
}: {
  menuId: string;
  /** The lines being bought (status ok / short). */
  lines: readonly MenuLine[];
  /** The live price book, including prices this page just applied. */
  catalog: Catalog;
  initial: Actuals;
  plannedTotal: number;
  readOnly: boolean;
  plannedBy: string | null;
  onDirtyChange: (dirty: boolean) => void;
  /** After a save: the parent folds applied prices into its catalog and snapshot. */
  onSaved: (info: PaidSavedInfo) => void;
}) {
  const uid = useId();
  const [savedActuals, setSavedActuals] = useState<Actuals>(initial);
  const [draft, setDraft] = useState<Record<string, Entry>>(() => ({ ...initial }));
  const [results, setResults] = useState<Record<string, PaidStatus>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const dirty = actualsKey(pricedActuals(draft)) !== actualsKey(savedActuals);
  useEffect(() => {
    onDirtyChange(dirty && !readOnly);
  }, [dirty, readOnly, onDirtyChange]);

  const view = readOnly ? (savedActuals as Record<string, Entry>) : draft;
  const pkgOf = (id: string) => catalog.packages.find((p) => p.id === id);
  const verdictOf = (l: MenuLine) => {
    const e = priced(view[l.ing.id]);
    return paidVerdict(e ? pkgOf(e.packageId) : undefined, e, actualChanged(e, savedActuals[l.ing.id]), results[l.ing.id]);
  };

  // Held lines first; otherwise the list's own order.
  const rows = lines.map((l) => ({ l, v: verdictOf(l) })).sort((a, b) => Number(b.v.held) - Number(a.v.held));

  let entered = 0;
  let paidTotal = 0;
  let plannedEntered = 0;
  for (const { l } of rows) {
    const e = priced(view[l.ing.id]);
    if (!e) continue;
    entered++;
    paidTotal += e.pricePaid * e.qty;
    plannedEntered += l.spent;
  }
  const hint = entered > 0 ? `Planned ${money(plannedEntered)} · paid ${money(paidTotal)} on ${entered} of ${lines.length} lines` : `Planned ${money(plannedTotal)} · nothing entered yet`;

  const edit = (l: MenuLine, patch: Partial<Entry>) => {
    setDraft((d) => {
      const base: Entry = d[l.ing.id] ?? { packageId: l.pkg?.id ?? '', qty: l.qty, pricePaid: null };
      return { ...d, [l.ing.id]: { ...base, ...patch } };
    });
    setJustSaved(false);
    setError(null);
    setStatus('');
  };

  async function save() {
    setSaving(true);
    setError(null);
    const toSave = pricedActuals(draft);
    let res: Awaited<ReturnType<typeof saveActualsAction>>;
    try {
      res = await saveActualsAction(menuId, toSave);
    } catch {
      res = { ok: false, error: 'Something went wrong saving what you paid. Try again.' };
    }
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSavedActuals(toSave);
    setResults((r) => ({ ...r, ...res.results }));
    setStatus(paidSavedSentence(res.applied, res.held));
    setJustSaved(true);
    onSaved({ actuals: toSave, results: res.results });
  }

  function discard() {
    setDraft({ ...savedActuals });
    setResetKey((k) => k + 1);
    setError(null);
    setStatus('');
  }

  return (
    <section className={s.paidSection} aria-labelledby={`${uid}-h`}>
      <div className={s.secHead}>
        <h2 id={`${uid}-h`} className={s.heading}>
          What you paid
        </h2>
        <span className={s.hint}>{hint}</span>
        {!readOnly && (
          <SaveBar
            isNew={false}
            dirty={dirty}
            saving={saving}
            saved={justSaved}
            onSave={() => void save()}
            onDiscard={discard}
            labels={{ save: 'Save what I paid', clean: 'Prices saved', discard: 'Discard price changes' }}
          />
        )}
      </div>

      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}

      {rows.length === 0 ? (
        <p className={s.foot}>Nothing to buy yet.</p>
      ) : (
        <ul className={s.card} aria-label="What you paid, line by line">
          {rows.map(({ l, v }) => (
            <PaidRow
              key={l.ing.id}
              line={l}
              verdict={v}
              entry={view[l.ing.id]}
              pkgOf={pkgOf}
              open={!readOnly && openKey === l.ing.id}
              readOnly={readOnly}
              onToggle={() => setOpenKey((k) => (k === l.ing.id ? null : l.ing.id))}
              onEdit={(patch) => edit(l, patch)}
              resetKey={resetKey}
              panelId={`${uid}-paid-${l.ing.id}`}
            />
          ))}
        </ul>
      )}

      <p className={s.foot}>
        {readOnly
          ? `${plannedBy ?? 'The scout'} enters these after shopping.`
          : 'Use your receipt; leave a line blank if you haven’t bought it. Prices within 50% of the price book update it for every scout, with your name; further out, a leader checks first. What you enter always stays on your menu.'}
      </p>
      <p className={s.statusLine} role="status">
        {status}
      </p>
    </section>
  );
}

function PaidRow({
  line: l,
  verdict,
  entry,
  pkgOf,
  open,
  readOnly,
  onToggle,
  onEdit,
  resetKey,
  panelId
}: {
  line: MenuLine;
  verdict: ReturnType<typeof paidVerdict>;
  entry: Entry | undefined;
  pkgOf: (id: string) => Catalog['packages'][number] | undefined;
  open: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onEdit: (patch: Partial<Entry>) => void;
  resetKey: number;
  panelId: string;
}) {
  const e = priced(entry);
  const planned = l.pkg ? `planned ${l.qty} × ${money(l.pkg.price)}` : '';
  const boughtId = entry?.packageId ?? l.pkg?.id ?? '';
  const otherPkg = e && e.packageId !== l.pkg?.id ? pkgOf(e.packageId)?.name : null;
  const verdictId = `${panelId}-v`;
  const priceId = `${panelId}-price`;
  return (
    <li className={s.row}>
      <div className={`${s.rowMain} ${readOnly ? '' : s.clickRow}`} onClick={readOnly ? undefined : onToggle}>
        {readOnly ? (
          <strong className={s.rowName}>{l.ing.name}</strong>
        ) : (
          // The label starts with "What you paid", not the ingredient, so the Shopping list's own row button stays the only one named for it.
          <button type="button" className={s.rowName} aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label={`What you paid for ${l.ing.name}`}>
            {l.ing.name}
            <span className={s.chev} aria-hidden="true">
              ›
            </span>
          </button>
        )}
        {planned && <span className={s.meta}>{planned}</span>}
        {verdict.tag && <span className={s.tag}>{TAGS[verdict.tag]}</span>}
      </div>
      <div className={s.rcol}>
        {e ? `${e.qty} × ${money(e.pricePaid)}` : '—'}
        {otherPkg && <small>{otherPkg}</small>}
      </div>
      {open && (
        <div id={panelId} className={s.inset}>
          <div className={s.choice}>
            <div className={s.choiceLabel} id={`${panelId}-pkg`}>
              What did you buy?
            </div>
            <div className={s.chips} role="group" aria-labelledby={`${panelId}-pkg`}>
              {l.usable.map((p) => (
                <button key={p.id} type="button" className={s.chip} aria-pressed={boughtId === p.id} onClick={() => onEdit({ packageId: p.id })}>
                  {p.name} · {money(p.price)}
                </button>
              ))}
            </div>
          </div>
          <div className={s.paidFields}>
            <Stepper
              id={`${panelId}-qty`}
              label="How many"
              value={entry?.qty ?? l.qty}
              min={0}
              max={MAX_ACTUAL_QTY}
              onChange={(n) => onEdit({ qty: n })}
              groupLabel={`How many ${l.ing.name} packages you bought`}
              lessLabel={`One fewer ${l.ing.name} bought`}
              moreLabel={`One more ${l.ing.name} bought`}
            />
            <PaidPrice
              key={resetKey}
              id={priceId}
              value={entry?.pricePaid ?? null}
              placeholder={l.pkg ? l.pkg.price.toFixed(2) : ''}
              describedBy={verdictId}
              onChange={(n) => onEdit({ pricePaid: n })}
            />
          </div>
          <p id={verdictId} className={s.verdict} aria-live="polite">
            {verdict.text}
          </p>
        </div>
      )}
    </li>
  );
}

/** The price box keeps what is typed ("3." stays "3.") and reports a number only once it is a valid price. */
function PaidPrice({ id, value, placeholder, describedBy, onChange }: { id: string; value: number | null; placeholder: string; describedBy: string; onChange: (n: number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : value.toFixed(2));
  return (
    <span className={s.paidField}>
      <label htmlFor={id} className={s.choiceLabel}>
        Price paid, each
      </label>
      <AmountInput
        id={id}
        value={text}
        min={MIN_ACTUAL_PRICE}
        max={MAX_ACTUAL_PRICE}
        step="0.01"
        placeholder={placeholder}
        aria-describedby={describedBy}
        onChange={(ev) => {
          const t = ev.target.value;
          setText(t);
          const n = Number(t);
          onChange(t.trim() !== '' && Number.isFinite(n) && n >= MIN_ACTUAL_PRICE && n <= MAX_ACTUAL_PRICE ? Math.round(n * 100) / 100 : null);
        }}
      />
    </span>
  );
}

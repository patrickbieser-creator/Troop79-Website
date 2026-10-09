'use client';

/**
 * Receipt — "Planned vs bought" (Plans/Menu-Monster-Receipt-Reconciliation.md), a menu's step after What we bought.
 *
 * Part A is the receipt's lines in printed order, worked one at a time (Jenna, Patrick 2026-10-08): a tight list,
 * one disclosure per row, only the first unsettled line open on load, nothing locked, no wizard and no modal. An open
 * line shows what the receipt says and, when the matcher had a guess, "Looks like <food>" with Confirm; "Something
 * else…" swaps in the menu's foods, "Not on the plan" asks which meal the item joined. Each line saves as it is
 * settled (no Save bar), the row collapses to one line saying what happened, and focus moves to the next open line.
 * Undo is a link on every settled row. A line with no guess opens straight onto the food picker.
 *
 * Part B is every meal as planned beside as bought (reconcile.ts), with the cost per meal and per person and the
 * menu total against the receipt. Everyone who can open the menu reads both; `canRecord` settles lines.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { Field, SelectInput, TextInput } from '@/app/_components/form';
import { fmtDateTime, fmtDay } from '@/lib/format-date';
import type { Catalog, ShoppingLine } from '@/lib/menu-monster/types';
import type { Menu } from '@/lib/menu-monster/menus';
import { buildMenuList, mealTitle } from '@/lib/menu-monster/menu-view';
import { boughtRows, onChecklist, type Bought, type BoughtItem, type BoughtRow } from '@/lib/menu-monster/bought';
import { mealsInOrder, reconcileMeals, type MealReconciliation, type Receipt, type ReceiptLine } from '@/lib/menu-monster/reconcile';
import { priceText as money } from '@/lib/menu-monster/units';
import { confirmReceiptLineAction, markReceiptLineExtraAction, reopenReceiptLineAction, skipReceiptLineAction } from '../../../_tools/menu-monster/receipt-actions';
import s from './workspace.module.css';
import r from './receipt-tab.module.css';

export interface ReceiptTabProps {
  catalog: Catalog;
  menuId: string;
  menu: Menu;
  receipt: Receipt | null;
  bought: Bought;
  canRecord: boolean;
  tabs?: ReactNode;
  aside?: ReactNode;
}

type Mode = 'proposal' | 'pick' | 'extra';
interface Draft {
  food: string;
  meal: string;
  name: string | null;
}
type Outcome = { ok: true; receipt: Receipt; bought: Bought } | { ok: false; error: string };

const GENERIC_ERROR = 'That line didn’t save. Check your connection and try again.';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const amount = (qty: number, unit: number) => `${qty} × ${money(unit)} = ${money(Math.round(qty * unit * 100) / 100)}`;

/** One word for how a changed line differs from the plan, or null (swapped, more, fewer, cheaper, dearer). */
export function changeWord(planned: readonly BoughtItem[], items: readonly BoughtItem[]): string | null {
  const pQty = planned.reduce((n, x) => n + x.qty, 0);
  const bQty = items.reduce((n, x) => n + x.qty, 0);
  if (pQty === 0 || bQty === 0) return null;
  const pTotal = planned.reduce((n, x) => n + x.qty * x.pricePaid, 0);
  const bTotal = items.reduce((n, x) => n + x.qty * x.pricePaid, 0);
  const named = new Set(planned.map((x) => x.brandId).filter((b): b is string => b != null));
  const brandDiffers = named.size > 0 && items.some((x) => x.brandId == null || !named.has(x.brandId));
  const priceDiffers = Math.abs(pTotal / pQty - bTotal / bQty) > 0.005;
  if (brandDiffers && priceDiffers) return 'swapped';
  if (bQty > pQty) return 'more';
  if (bQty < pQty) return 'fewer';
  if (bTotal < pTotal - 0.005) return 'cheaper';
  if (bTotal > pTotal + 0.005) return 'dearer';
  return null;
}

export function ReceiptTab({ catalog, menuId, menu, receipt: initial, bought: initialBought, canRecord, tabs, aside }: ReceiptTabProps) {
  const uid = useId();
  const [receipt, setReceipt] = useState<Receipt | null>(initial);
  const [bought, setBought] = useState<Bought>(initialBought);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => {
    const first = initial?.lines.find((l) => l.status === 'pending');
    return new Set(first ? [first.id] : []);
  });
  const [modes, setModes] = useState<Record<number, Mode>>({});
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  /** Where focus goes after an action lands: a line's first control, or the status line. `n` makes a repeat count. */
  const [focus, setFocus] = useState<{ id: number | null; n: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!focus) return;
    const target = focus.id != null ? listRef.current?.querySelector<HTMLElement>(`[data-line="${focus.id}"] [data-first]`) : null;
    (target ?? statusRef.current)?.focus();
  }, [focus]);

  const list = buildMenuList(menu, catalog).lines.filter(onChecklist);
  const foods = [...list].sort((a, b) => a.ing.name.localeCompare(b.ing.name));
  const foodLine = new Map(list.map((l) => [l.ing.id, l]));
  const foodName = (id: string | null) => (id ? (foodLine.get(id)?.ing.name ?? catalog.ingredients.find((i) => i.id === id)?.name ?? id) : '');
  const mealName = (mealId: string | null) => {
    const m = menu.meals.find((x) => x.id === mealId);
    return m ? mealTitle(menu.startDate, m.day, m.slot) : '';
  };

  const lines = receipt?.lines ?? [];
  const pending = lines.filter((l) => l.status === 'pending');
  const settledCount = lines.length - pending.length;
  const modeOf = (l: ReceiptLine): Mode => modes[l.id] ?? (l.proposedIngredientId && foodLine.has(l.proposedIngredientId) ? 'proposal' : 'pick');
  const draftOf = (l: ReceiptLine): Draft => drafts[l.id] ?? { food: '', meal: '', name: null };
  const setDraft = (l: ReceiptLine, patch: Partial<Draft>) => setDrafts((cur) => ({ ...cur, [l.id]: { ...draftOf(l), ...patch } }));
  const setMode = (l: ReceiptLine, mode: Mode) => setModes((cur) => ({ ...cur, [l.id]: mode }));
  const setError = (id: number, text: string | null) =>
    setErrors((cur) => {
      const next = { ...cur };
      if (text == null) delete next[id];
      else next[id] = text;
      return next;
    });
  const toggle = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Run one write. On success: take the new receipt, collapse this row, open the next unsettled one, and say what happened. */
  async function run(line: ReceiptLine, call: () => Promise<Outcome>, say: (next: ReceiptLine | null) => string, reopened = false) {
    if (busy) return;
    setBusy(true);
    setError(line.id, null);
    try {
      const res = await call();
      if (!res.ok) {
        setError(line.id, res.error);
        return;
      }
      setReceipt(res.receipt);
      setBought(res.bought);
      setModes((cur) => {
        const next = { ...cur };
        delete next[line.id];
        return next;
      });
      setDrafts((cur) => {
        const next = { ...cur };
        delete next[line.id];
        return next;
      });
      const left = res.receipt.lines.filter((l) => l.status === 'pending');
      const next = reopened ? null : (left.find((l) => l.position > line.position) ?? left[0] ?? null);
      setOpen((cur) => {
        const o = new Set(cur);
        if (reopened) o.add(line.id);
        else {
          o.delete(line.id);
          if (next) o.add(next.id);
        }
        return o;
      });
      setMessage(say(next));
      setFocus((f) => ({ id: reopened ? line.id : (next?.id ?? null), n: (f?.n ?? 0) + 1 }));
    } catch {
      setError(line.id, GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const nextText = (next: ReceiptLine | null) => (next ? ` Next: ${next.rawName}.` : ' That was the last line.');
  const confirm = (line: ReceiptLine, ingredientId: string) =>
    run(line, () => confirmReceiptLineAction(menuId, line.id, ingredientId), (next) => `${foodName(ingredientId)} confirmed.${nextText(next)}`);
  const addExtra = (line: ReceiptLine) => {
    const d = draftOf(line);
    if (!d.meal) {
      setError(line.id, 'Choose the meal it joined.');
      return;
    }
    const label = (d.name ?? line.rawName).trim() || line.rawName;
    void run(line, () => markReceiptLineExtraAction(menuId, line.id, d.meal, label), (next) => `${label} added to ${mealName(d.meal)}.${nextText(next)}`);
  };
  const skip = (line: ReceiptLine) => run(line, () => skipReceiptLineAction(menuId, line.id), (next) => `${line.rawName} set aside.${nextText(next)}`);
  const reopen = (line: ReceiptLine) => run(line, () => reopenReceiptLineAction(menuId, line.id), () => `${line.rawName} reopened.`, true);

  /** Esc inside an open sub-view goes back to the proposal (or the picker, when there is no guess). */
  const onPanelKey = (line: ReceiptLine) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || modeOf(line) === 'proposal') return;
    e.stopPropagation();
    setMode(line, line.proposedIngredientId && foodLine.has(line.proposedIngredientId) ? 'proposal' : 'pick');
  };

  const reconciliation = receipt ? reconcileMeals(menu, catalog, bought, receipt) : null;
  const rowsById = new Map(boughtRows(list, bought).map((row) => [row.line.ing.id, row]));
  const heading = receipt ? `Receipt · ${receipt.store || 'Store'} · ${fmtDay(receipt.boughtAt)}` : 'Receipt';

  return (
    <div>
      <div className={s.titleLine}>
        <h1 className={s.menuTitle}>{menu.name.trim() || 'Untitled menu'}</h1>
      </div>
      {aside}
      {tabs != null && <div className={s.tabs}>{tabs}</div>}

      {!receipt ? (
        <section aria-labelledby={`${uid}-a`}>
          <h2 id={`${uid}-a`} className={s.heading}>
            Planned vs bought
          </h2>
          <p className={s.foot}>No receipt yet. A leader adds one from the receipt photos.</p>
        </section>
      ) : (
        <>
          <section aria-labelledby={`${uid}-a`}>
            <h2 id={`${uid}-a`} className={`${s.heading} ${r.anchor}`} tabIndex={-1}>
              {heading}
            </h2>
            <p ref={statusRef} role="status" tabIndex={-1} className={r.status}>
              {message && <span className={r.say}>{message} </span>}
              {settledCount} of {plural(lines.length, 'line', 'lines')} settled
              {pending.length > 0 ? ` · ${pending.length} to go` : ''} · Receipt total {money(receipt.total)}
              <span className={s.srOnly}> · {fmtDateTime(receipt.boughtAt)}</span>
            </p>
            {canRecord && <p className={s.foot}>Each line saves as you confirm it.</p>}

            <ul ref={listRef} className={s.card} aria-label="Receipt lines">
              {lines.map((line) => {
                const isOpen = canRecord && open.has(line.id);
                const panel = `${uid}-p${line.id}`;
                const settled = line.status !== 'pending';
                const mode = modeOf(line);
                const proposed = line.proposedIngredientId ? foodLine.get(line.proposedIngredientId) : undefined;
                const d = draftOf(line);
                const err = errors[line.id];
                return (
                  <li key={line.id} data-line={line.id} className={`${s.row} ${err ? r.rowBad : ''}`}>
                    <div className={s.rowMain}>
                      {canRecord ? (
                        <button type="button" className={s.rowName} aria-expanded={isOpen} aria-controls={isOpen ? panel : undefined} onClick={() => toggle(line.id)}>
                          {line.rawName}
                          <span className={s.chev} aria-hidden="true">
                            ›
                          </span>
                        </button>
                      ) : (
                        <span className={r.plainName}>{line.rawName}</span>
                      )}
                      {settled ? (
                        <span className={r.settled}>{settledText(line)}</span>
                      ) : (
                        !canRecord && <span className={s.meta}>not settled yet</span>
                      )}
                    </div>
                    <div className={r.amount}>
                      {line.qty > 1 ? amount(line.qty, line.unitPrice) : money(line.unitPrice)}
                    </div>
                    {canRecord && settled && (
                      <button type="button" className={`${s.linkBtn} ${r.act}`} disabled={busy} onClick={() => void reopen(line)} aria-label={`Undo ${line.rawName}`}>
                        Undo
                      </button>
                    )}

                    {isOpen && (
                      <div id={panel} className={`${s.inset} ${r.panel}`} onKeyDown={onPanelKey(line)}>
                        <p className={s.insetLine}>
                          {line.rawName}: {amount(line.qty, line.unitPrice)}
                        </p>

                        {mode === 'proposal' && proposed && (
                          <>
                            <p className={s.insetLine}>
                              Looks like <strong>{proposed.ing.name}</strong>
                              {proposed.pkg ? ` · planned ${proposed.qty} × ${money(proposed.pkg.price)}` : ''}
                            </p>
                            <div className={r.actions}>
                              <Button size="sm" data-first="" disabled={busy} onClick={() => void confirm(line, proposed.ing.id)}>
                                Confirm
                              </Button>
                              <button type="button" className={`${s.linkBtn} ${r.act}`} onClick={() => setMode(line, 'pick')}>
                                Something else…
                              </button>
                              <button type="button" className={`${s.linkBtn} ${r.act}`} onClick={() => setMode(line, 'extra')}>
                                Not on the plan
                              </button>
                              <button type="button" className={`${s.linkBtn} ${r.act}`} disabled={busy} onClick={() => void skip(line)}>
                                Set aside
                              </button>
                            </div>
                          </>
                        )}

                        {mode === 'pick' && (
                          <>
                            {!proposed && <p className={r.needs}>Needs a food</p>}
                            <Field label="Which food is this?">
                              <SelectInput data-first="" value={d.food} onChange={(e) => setDraft(line, { food: e.target.value })}>
                                <option value="">Choose a food…</option>
                                {foods.map((f) => (
                                  <option key={f.ing.id} value={f.ing.id}>
                                    {f.ing.name}
                                  </option>
                                ))}
                              </SelectInput>
                            </Field>
                            <div className={r.actions}>
                              {d.food !== '' && (
                                <Button size="sm" disabled={busy} onClick={() => void confirm(line, d.food)}>
                                  Confirm
                                </Button>
                              )}
                              {proposed && (
                                <button type="button" className={`${s.linkBtn} ${r.act}`} onClick={() => setMode(line, 'proposal')}>
                                  Cancel
                                </button>
                              )}
                              <button type="button" className={`${s.linkBtn} ${r.act}`} onClick={() => setMode(line, 'extra')}>
                                Not on the plan
                              </button>
                              <button type="button" className={`${s.linkBtn} ${r.act}`} disabled={busy} onClick={() => void skip(line)}>
                                Set aside
                              </button>
                            </div>
                          </>
                        )}

                        {mode === 'extra' && (
                          <>
                            <Field label="Which meal did it join?" problem={err === 'Choose the meal it joined.' ? err : undefined}>
                              <SelectInput data-first="" value={d.meal} onChange={(e) => setDraft(line, { meal: e.target.value })}>
                                <option value="">Choose a meal…</option>
                                {mealsInOrder(menu).map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {mealTitle(menu.startDate, m.day, m.slot)}
                                  </option>
                                ))}
                              </SelectInput>
                            </Field>
                            <Field label="Name">
                              <TextInput
                                value={d.name ?? line.rawName}
                                maxLength={60}
                                autoComplete="off"
                                onChange={(e) => setDraft(line, { name: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter') return;
                                  e.preventDefault();
                                  addExtra(line);
                                }}
                              />
                            </Field>
                            <div className={r.actions}>
                              <Button size="sm" disabled={busy} onClick={() => addExtra(line)}>
                                Add to this meal
                              </Button>
                              <button type="button" className={`${s.linkBtn} ${r.act}`} onClick={() => setMode(line, proposed ? 'proposal' : 'pick')}>
                                Cancel
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {err && err !== 'Choose the meal it joined.' && (
                      <div className={r.rowNote}>
                        <Notice tone="error">{err}</Notice>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {reconciliation && (
            <section aria-labelledby={`${uid}-b`} className={r.compareSection}>
              <h2 id={`${uid}-b`} className={s.heading}>
                Planned vs bought
              </h2>
              {reconciliation.meals.map((m) => (
                <MealTable key={m.mealId} meal={m} title={mealName(m.mealId)} rows={rowsById} list={foodLine} />
              ))}
              <Totals receipt={receipt} totals={reconciliation.totals} pending={pending.length} skipped={lines.filter((l) => l.status === 'skipped').length} anchor={`#${uid}-a`} />
              <h3 className={r.compareHead}>Compare</h3>
              <ol className={r.prompts}>
                <li>Which line cost the most over plan? Was it the price or the amount?</li>
                <li>Which swap saved the most? Is it really the same food?</li>
                <li>What did we buy that wasn’t planned? Which meal needed it?</li>
                <li>Which meal cost the most per person, and which the least? What made the difference?</li>
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  );

  function settledText(line: ReceiptLine): ReactNode {
    if (line.status === 'confirmed') {
      return (
        <>
          <span aria-hidden="true">✓ </span>
          {foodName(line.ingredientId)} · confirmed{line.confirmedBy ? ` by ${line.confirmedBy}` : ''}
        </>
      );
    }
    if (line.status === 'extra') {
      return (
        <>
          <span aria-hidden="true">+ </span>
          {line.label || line.rawName} · {mealName(line.mealId)}
          {line.confirmedBy ? ` · ${line.confirmedBy}` : ''}
        </>
      );
    }
    return (
      <>
        <span aria-hidden="true">– </span>set aside
      </>
    );
  }
}

/* ---------------------------------------------------------------- Part B */

function MealTable({ meal, title, rows, list }: { meal: MealReconciliation; title: string; rows: Map<string, BoughtRow>; list: Map<string, ShoppingLine> }) {
  const delta = meal.delta;
  const perPerson = Math.round((meal.bought.perPerson - meal.planned.perPerson) * 100) / 100;
  const verdict = Math.abs(delta) < 0.005 ? 'same as planned' : `${money(Math.abs(delta))} ${delta < 0 ? 'under' : 'over'}`;
  const person = Math.abs(perPerson) < 0.005 ? '' : ` · ${money(Math.abs(perPerson))} ${perPerson < 0 ? 'less' : 'more'} per person`;

  const plannedIds = new Set(meal.planned.items.map((p) => p.ingredientId));
  const notBought = new Set(meal.bought.notBought.map((n) => n.ingredientId));
  const boughtFor = (id: string) => meal.bought.items.filter((b) => b.ingredientId === id && b.kind !== 'extra');
  const unplannedFoods = [...new Set(meal.bought.items.filter((b) => b.kind !== 'extra' && b.ingredientId && !plannedIds.has(b.ingredientId)).map((b) => b.ingredientId as string))];
  const extras = meal.bought.items.filter((b) => b.kind === 'extra');

  const item = (b: { qty: number; unitPrice: number; spent: number }) => {
    const whole = Math.round(b.qty * b.unitPrice * 100) / 100;
    return `${amount(b.qty, b.unitPrice)}${Math.abs(whole - b.spent) > 0.005 ? ` (${money(b.spent)} for this meal)` : ''}`;
  };

  return (
    <div className={r.tableWrap}>
      <table className={r.table}>
        <caption className={r.caption}>
          <span className={r.mealName}>{title}</span>
          <span className={r.mealSum}>
            {money(meal.planned.cost)} planned · {money(meal.bought.cost)} bought · {verdict}
            {person}
          </span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Food</th>
            <th scope="col">As planned</th>
            <th scope="col">As bought</th>
          </tr>
        </thead>
        <tbody>
          {meal.planned.items.map((p) => {
            const row = rows.get(p.ingredientId);
            const items = boughtFor(p.ingredientId);
            const gone = notBought.has(p.ingredientId);
            const unconfirmed = row?.state === 'unconfirmed';
            const word = row?.state === 'changed' ? changeWord(row.planned, row.items) : null;
            const unit = list.get(p.ingredientId)?.pkg?.price;
            const plannedText = unit != null ? amount(p.qty, unit) : money(p.spent);
            const plannedShare = unit != null && Math.abs(Math.round(p.qty * unit * 100) / 100 - p.spent) > 0.005 ? ` (${money(p.spent)} for this meal)` : '';
            return (
              <tr key={p.ingredientId} className={word || gone ? r.changed : r.same}>
                <th scope="row" className={r.food}>
                  {p.name}
                </th>
                <td data-label="Planned">
                  {plannedText}
                  {plannedShare}
                </td>
                <td data-label="Bought">
                  {gone ? (
                    <s className={r.struck}>
                      <span aria-hidden="true">✕ </span>not bought
                    </s>
                  ) : unconfirmed ? (
                    <span className={r.muted}>as planned · not confirmed</span>
                  ) : (
                    <>
                      {items.map((b, i) => (
                        <span key={i} className={r.amt}>
                          {item(b)}
                        </span>
                      ))}
                      {word && <em className={r.tag}> {word}</em>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {unplannedFoods.map((id) => (
            <tr key={`u-${id}`} className={r.changed}>
              <th scope="row" className={r.food}>
                {boughtFor(id)[0].name}
              </th>
              <td data-label="Planned">
                <span className={r.muted}>no price planned</span>
              </td>
              <td data-label="Bought">
                {boughtFor(id).map((b, i) => (
                  <span key={i} className={r.amt}>
                    {item(b)}
                  </span>
                ))}
              </td>
            </tr>
          ))}
          {extras.map((b, i) => (
            <tr key={`x-${i}`} className={r.changed}>
              <th scope="row" className={r.food}>
                {b.name}
              </th>
              <td data-label="Planned">
                <span className={s.srOnly}>not planned</span>
              </td>
              <td data-label="Bought">
                <span className={r.amt}>{item(b)}</span>
                <em className={r.tag}> add-on</em>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ receipt, totals, pending, skipped, anchor }: { receipt: Receipt; totals: { planned: number; bought: number }; pending: number; skipped: number; anchor: string }) {
  const gap = Math.round((receipt.total - totals.bought) * 100) / 100;
  const parts: ReactNode[] = [];
  if (pending > 0) {
    parts.push(
      <a key="p" className={s.link} href={anchor}>
        {plural(pending, 'line', 'lines')} not settled
      </a>
    );
  }
  if (skipped > 0) parts.push(<span key="s">{skipped} set aside</span>);
  if (receipt.tax > 0) parts.push(<span key="t">tax {money(receipt.tax)}</span>);
  return (
    <p className={r.totals}>
      <strong>Menu {money(totals.planned)} planned · {money(totals.bought)} bought · Receipt {money(receipt.total)}</strong>
      {Math.abs(gap) >= 0.005 && (
        <span className={r.gap}>
          {' '}
          {money(Math.abs(gap))} {gap > 0 ? 'of the receipt is not in the meals' : 'more in the meals than on the receipt'}
          {parts.length > 0 && (
            <>
              {' ('}
              {parts.map((p, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {p}
                </span>
              ))}
              {')'}
            </>
          )}
        </span>
      )}
    </p>
  );
}

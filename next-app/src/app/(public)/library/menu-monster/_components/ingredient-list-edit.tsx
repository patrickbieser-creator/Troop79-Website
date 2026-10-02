'use client';

/**
 * IngredientList in 'menu-edit' mode (Plans/Menu-Monster-Scout-Workspace.md,
 * Phase 2 release A; prototype concept-e-scout-workspace/meal.html): a menu's OWN
 * version of one recipe. Same row as read mode, plus a ⋯ per row:
 *
 *   Change amount    an inline number for the per-person amount (fractions ok)
 *   Swap for…        an inline search over catalog ingredients
 *   Leave out / Put back
 *   Back to the troop amount / Back to <troop ingredient>
 *   Remove           (rows the scout added)
 *
 * and a dashed "Add an ingredient" search at the end. The list holds only its
 * own UI state (which row is being edited, focus); every change is reported as
 * a RowAction and the parent turns it into ops (ingredient-rows.ts op builders)
 * and hands back new rows — the shared recipe never changes. Changed rows show
 * the troop's amount struck, swapped rows the troop's item struck, added rows a
 * quiet "Added", left-out rows dimmed with "Left out".
 *
 * Keyboard + a11y: the ⋯ is the plain disclosure RowMenu; the amount box and
 * both searches have labels that carry the unit; Escape cancels and returns
 * focus to the row's ⋯; a swap or an add moves on to the amount box (the new
 * ingredient's unit is not the old one's); every change is announced through
 * onAnnounce (the meal page's status line).
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { fracText, parseQty } from '@/lib/menu-monster/units';
import type { IngredientRow } from '@/lib/menu-monster/ingredient-rows';
import { RowMenu, type RowMenuItem } from '../menus/_components/row-menu';
import { IngredientSearch, type IngredientChoice } from './ingredient-search';
import s from './ingredient-list.module.css';

/** What a row's ⋯, amount box or search asked for. The parent builds the ops. */
export type RowAction =
  | { type: 'amount'; key: string; qtyPerPerson: number }
  | { type: 'swap'; key: string; to: string }
  | { type: 'leave_out' | 'put_back' | 'reset' | 'remove'; key: string }
  | { type: 'add'; ingredientId: string };

export interface MenuEditProps {
  rows: readonly IngredientRow[];
  /** 'Pancakes ingredients'. */
  ariaLabel: string;
  emptyText?: string;
  /** Catalog ingredients a swap or an add may pick from. */
  choices: readonly IngredientChoice[];
  onAction: (action: RowAction) => void;
  /** A sentence for the live region: 'Swapped Pancake mix for Eggs.' */
  onAnnounce: (text: string) => void;
}

const MAX_QTY = 1000;

/** The amount box: one number per person, Enter or leaving the box commits, Escape cancels. */
function AmountEditor({
  name,
  unitLabel,
  value,
  onCommit,
  onCancel
}: {
  name: string;
  unitLabel: string;
  value: number;
  /** refocus: hand focus back to the row's ⋯ (Enter) — not on a blur, which already moved focus. */
  onCommit: (qty: number, refocus: boolean) => void;
  onCancel: (refocus: boolean) => void;
}) {
  const [text, setText] = useState(() => String(Math.round(value * 10000) / 10000));
  const [bad, setBad] = useState(false);
  const finished = useRef(false);
  const errId = useId();

  const parsed = parseQty(text);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_QTY;

  function finish(refocus: boolean, fromBlur: boolean) {
    if (finished.current) return;
    if (valid) {
      finished.current = true;
      onCommit(parsed, refocus);
    } else if (fromBlur) {
      finished.current = true;
      onCancel(false);
    } else {
      setBad(true);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true, false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finished.current = true;
      onCancel(true);
    }
  }

  return (
    <span className={s.amountEdit}>
      <input
        type="text"
        inputMode="decimal"
        className={s.amountInput}
        value={text}
        autoFocus
        aria-label={`Amount per person of ${name}, in ${unitLabel}`}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? errId : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onKeyDown={onKey}
        onBlur={() => finish(false, true)}
        onFocus={(e) => e.currentTarget.select()}
      />
      <span className={s.unit}>{unitLabel} each person</span>
      {bad && (
        <span id={errId} className={s.fieldError} role="alert">
          Enter an amount above 0.
        </span>
      )}
    </span>
  );
}

export function MenuEditList({ rows, ariaLabel, emptyText = 'No ingredients.', choices, onAction, onAnnounce }: MenuEditProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<string | null>(null);
  // Where focus goes after the next render: a row's ⋯ (by key) or the add box.
  const [focusReq, setFocusReq] = useState<string | 'add' | null>(null);

  useEffect(() => {
    if (focusReq == null) return;
    if (focusReq !== 'add') {
      const li = Array.from(listRef.current?.querySelectorAll<HTMLElement>('li[data-key]') ?? []).find((el) => el.dataset.key === focusReq);
      const btn = li?.querySelector<HTMLButtonElement>('[data-more] button');
      if (btn) {
        btn.focus();
        setFocusReq(null);
        return;
      }
    }
    addRef.current?.focus();
    setFocusReq(null);
  }, [focusReq]);

  // Ingredients already in this recipe (as shown now) are not offered again.
  const inUse = new Set(rows.map((r) => r.edit?.currentIngredientId).filter(Boolean));
  const free = choices.filter((c) => !inUse.has(c.id));

  function menuItems(r: IngredientRow): RowMenuItem[] {
    const e = r.edit;
    if (!e) return [];
    const change = { label: 'Change amount', onSelect: () => { setSwapping(null); setEditing(r.key); } };
    if (e.kind === 'added') {
      return [
        change,
        {
          label: 'Remove',
          danger: true,
          onSelect: () => {
            onAction({ type: 'remove', key: r.key });
            onAnnounce(`${r.name} removed from your version.`);
            setFocusReq('add');
          }
        }
      ];
    }
    if (e.op === 'leave_out') {
      return [
        {
          label: 'Put back',
          onSelect: () => {
            onAction({ type: 'put_back', key: r.key });
            onAnnounce(`${r.name} is back.`);
            setFocusReq(r.key);
          }
        }
      ];
    }
    const items: RowMenuItem[] = [
      change,
      { label: e.op === 'swap' ? 'Swap for something else…' : 'Swap for…', onSelect: () => { setEditing(null); setSwapping(r.key); } },
      {
        label: 'Leave out',
        onSelect: () => {
          onAction({ type: 'leave_out', key: r.key });
          onAnnounce(`${r.name} left out of your version.`);
          setFocusReq(r.key);
        }
      }
    ];
    if (e.op === 'amount' || e.op === 'swap') {
      items.push({
        label: e.op === 'swap' ? `Back to ${e.baseName ?? 'the troop ingredient'}` : 'Back to the troop amount',
        onSelect: () => {
          onAction({ type: 'reset', key: r.key });
          onAnnounce(e.op === 'swap' ? `Back to ${e.baseName} from the troop recipe.` : `${r.name} is back to the troop amount.`);
          setFocusReq(r.key);
        }
      });
    }
    return items;
  }

  return (
    <div>
      {rows.length === 0 && <p className={s.empty}>{emptyText}</p>}
      <ul className={s.list} aria-label={ariaLabel} ref={listRef} hidden={rows.length === 0}>
        {rows.map((r) => {
          const out = r.marker?.kind === 'out';
          const e = r.edit;
          return (
            <li key={r.key} data-key={r.key} className={`${s.row} ${s.rowEdit} ${out ? s.rowOut : ''}`}>
              <span className={s.main}>
                <span className={s.name}>{r.name}</span>
                {r.marker?.kind === 'swapped' && (
                  <s className={s.was}>
                    <span className={s.srOnly}>was </span>
                    {r.marker.was}
                  </s>
                )}
                {r.marker?.kind === 'added' && <span className={s.tag}>Added</span>}
                {out && <span className={s.tag}>Left out</span>}
                {r.note && <span className={s.note}>{r.note}</span>}
              </span>
              <span className={s.amount}>
                {editing === r.key && e ? (
                  <AmountEditor
                    name={r.name}
                    unitLabel={e.unitLabel}
                    value={e.qtyPerPerson}
                    onCommit={(qty, refocus) => {
                      setEditing(null);
                      if (Math.abs(qty - e.qtyPerPerson) > 1e-9) {
                        onAction({ type: 'amount', key: r.key, qtyPerPerson: qty });
                        onAnnounce(`${r.name} changed to ${fracText(qty)} ${e.unitLabel} each person.`);
                      }
                      if (refocus) setFocusReq(r.key);
                    }}
                    onCancel={(refocus) => {
                      setEditing(null);
                      if (refocus) setFocusReq(r.key);
                    }}
                  />
                ) : (
                  <>
                    {r.marker?.kind === 'changed' && (
                      <s className={s.was}>
                        <span className={s.srOnly}>was </span>
                        {r.marker.was}
                      </s>
                    )}
                    {r.amount}
                  </>
                )}
              </span>
              <div data-more className={s.moreCell}>
                <RowMenu label={`Change ${r.name}`} items={menuItems(r)} />
              </div>
              {swapping === r.key && e && (
                <div className={s.sub}>
                  <IngredientSearch
                    autoFocus
                    label={`Swap ${e.baseName ?? r.name} for`}
                    placeholder={`Swap ${e.baseName ?? r.name} for… search the ingredients`}
                    choices={free.filter((c) => c.id !== e.ingredientId)}
                    onPick={(c) => {
                      setSwapping(null);
                      onAction({ type: 'swap', key: r.key, to: c.id });
                      onAnnounce(`Swapped ${e.baseName ?? r.name} for ${c.name}. Set how much each person needs.`);
                      setEditing(r.key);
                    }}
                    onCancel={() => {
                      setSwapping(null);
                      setFocusReq(r.key);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className={s.addRow}>
        <IngredientSearch
          inputRef={addRef}
          label="Add an ingredient to your version"
          placeholder="Add an ingredient — search the troop’s ingredients"
          choices={free}
          onPick={(c) => {
            onAction({ type: 'add', ingredientId: c.id });
            onAnnounce(`${c.name} added to your version. Set how much each person needs.`);
            setEditing(`add:${c.id}`);
          }}
        />
      </div>
    </div>
  );
}

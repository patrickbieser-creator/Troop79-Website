'use client';

/**
 * IngredientList in 'author' mode (Plans/Menu-Monster-Scout-Workspace.md,
 * Phase 4; the approved prototype concept-e-scout-workspace/recipe-editor.html):
 * the scout's own recipe. Same row as read mode, plus
 *
 *   a grip            drag, or the up / down arrow keys, to reorder
 *   the name          toggles "What you'd buy" under the row (one open at a time)
 *   ⋯                 Change amount / Move up / Move down / Remove
 *   + Ingredient      an AddRow: opens a search that adds an ingredient from the price book
 *
 * The list owns only its UI state; every change is an AuthorAction the editor
 * applies to its draft, and every change is announced through onAnnounce.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fracText } from '@/lib/menu-monster/units';
import { RowMenu } from '../menus/_components/row-menu';
import { AmountEditor, type AmountUnits } from './ingredient-list-edit';
import { IngredientSearch, type IngredientChoice } from './ingredient-search';
import { AddRow } from './add-row';
import { Grip, useDragReorder } from './reorder';
import s from './ingredient-list.module.css';

export interface AuthorRow {
  /** `ing:<ingredientId>` — an added row opens its amount box by this key. */
  key: string;
  ingredientId: string;
  name: string;
  /** As shown in the right column, in the current view (total or per person). */
  amount: string;
  note: string | null;
  qtyPerPerson: number;
  /** The unit the per-person amount is in ('cups'). */
  unitLabel: string;
  /** The line's own unit key (null/absent = the ingredient's), every unit it may use (the ingredient's own first), and the typed-unit rule. Absent = no unit choice. */
  unitKey?: string | null;
  units?: readonly { key: string; label: string }[];
  parseAmount?: AmountUnits['parse'];
  /** 'meal' = the amount is for the whole meal, once; absent = per person. */
  scale?: 'meal';
  /** "What you'd buy": the price book's cheapest package, or null when it has none. */
  buy: string | null;
  /** A typed-in ingredient no leader has matched yet (Phase 4B): tagged "New". */
  isNew?: boolean;
}

export type AuthorAction =
  | { type: 'amount'; ingredientId: string; qtyPerPerson: number; scale: 'person' | 'meal'; unitKey?: string | null }
  | { type: 'move'; from: number; to: number }
  | { type: 'remove'; ingredientId: string }
  | { type: 'add'; ingredientId: string };

export interface AuthorListProps {
  rows: readonly AuthorRow[];
  ariaLabel: string;
  emptyText?: string;
  /** Price-book ingredients the search may add. */
  choices: readonly IngredientChoice[];
  onAction: (action: AuthorAction) => void;
  onAnnounce: (text: string) => void;
  /** The "new ingredient" form for typed text (Phase 4B); it calls `done` with the id it added, or null on cancel. */
  renderNew?: (name: string, done: (ingredientId: string | null) => void) => ReactNode;
}

export function AuthorList({ rows, ariaLabel, emptyText = 'No ingredients yet.', choices, onAction, onAnnounce, renderNew }: AuthorListProps) {
  const [newName, setNewName] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const addWrapRef = useRef<HTMLDivElement>(null);
  const [addOpen, setAddOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<{ key: string; part: 'grip' | 'more' } | 'add' | null>(null);

  useEffect(() => {
    if (focusReq == null) return;
    if (focusReq !== 'add') {
      const li = Array.from(listRef.current?.querySelectorAll<HTMLElement>('li[data-key]') ?? []).find((el) => el.dataset.key === focusReq.key);
      const el = li?.querySelector<HTMLButtonElement>(focusReq.part === 'grip' ? '[data-grip] button, button[draggable]' : '[data-more] button');
      if (el) {
        el.focus();
        setFocusReq(null);
        return;
      }
    }
    // The open search's input, or at rest the "+ Ingredient" link.
    addWrapRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    setFocusReq(null);
  }, [focusReq]);

  const move = (from: number, to: number, part: 'grip' | 'more') => {
    if (to < 0 || to >= rows.length || from === to) return;
    const r = rows[from];
    onAction({ type: 'move', from, to });
    onAnnounce(`${r.name} moved to ${to + 1} of ${rows.length}.`);
    setFocusReq({ key: r.key, part });
  };
  const { itemProps, gripProps } = useDragReorder((from, to) => move(from, to, 'grip'));

  const inUse = new Set(rows.map((r) => r.ingredientId));
  const free = choices.filter((c) => !inUse.has(c.id));

  return (
    <div>
      {rows.length === 0 && <p className={s.empty}>{emptyText}</p>}
      <ul className={s.list} aria-label={ariaLabel} ref={listRef} hidden={rows.length === 0}>
        {rows.map((r, i) => {
          const open = openKey === r.key;
          const panel = `buy-${r.key}`;
          return (
            <li key={r.key} data-key={r.key} className={`${s.row} ${s.rowEdit}`} {...itemProps(i)}>
              <Grip label={r.name} onMove={(by) => move(i, i + by, 'grip')} dragProps={gripProps(i)} />
              <span className={s.main}>
                <button type="button" className={s.nameBtn} aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => setOpenKey(open ? null : r.key)}>
                  {r.name}
                </button>
                {r.isNew && <span className={s.tag}>New</span>}
                {r.note && <span className={s.note}>{r.note}</span>}
              </span>
              <span className={s.amount}>
                {editing === r.key ? (
                  <AmountEditor
                    name={r.name}
                    unitLabel={r.unitLabel}
                    value={r.qtyPerPerson}
                    scale={r.scale ?? 'person'}
                    canScale
                    units={r.units && r.parseAmount ? { key: r.unitKey ?? r.units[0].key, options: r.units, parse: r.parseAmount } : undefined}
                    onCommit={(qty, refocus, scale, unit) => {
                      setEditing(null);
                      const was = r.unitKey ?? r.units?.[0].key;
                      const unitChanged = unit != null && unit !== was;
                      if (Math.abs(qty - r.qtyPerPerson) > 1e-9 || scale !== (r.scale ?? 'person') || unitChanged) {
                        const unitLabel = unit != null ? (r.units?.find((o) => o.key === unit)?.label ?? r.unitLabel) : r.unitLabel;
                        onAction({
                          type: 'amount',
                          ingredientId: r.ingredientId,
                          qtyPerPerson: qty,
                          scale,
                          ...(unit != null ? { unitKey: unit === r.units?.[0].key ? null : unit } : {})
                        });
                        onAnnounce(`${r.name} changed to ${fracText(qty)} ${unitLabel} ${scale === 'meal' ? 'for the whole meal' : 'each person'}.`);
                      }
                      if (refocus) setFocusReq({ key: r.key, part: 'more' });
                    }}
                    onCancel={(refocus) => {
                      setEditing(null);
                      if (refocus) setFocusReq({ key: r.key, part: 'more' });
                    }}
                  />
                ) : (
                  r.amount
                )}
              </span>
              <div data-more className={s.moreCell}>
                <RowMenu
                  label={`Change ${r.name}`}
                  items={[
                    { label: 'Change amount', onSelect: () => setEditing(r.key) },
                    ...(i > 0 ? [{ label: 'Move up', onSelect: () => move(i, i - 1, 'more') }] : []),
                    ...(i < rows.length - 1 ? [{ label: 'Move down', onSelect: () => move(i, i + 1, 'more') }] : []),
                    {
                      label: 'Remove',
                      danger: true,
                      onSelect: () => {
                        onAction({ type: 'remove', ingredientId: r.ingredientId });
                        onAnnounce(`${r.name} removed.`);
                        if (openKey === r.key) setOpenKey(null);
                        setFocusReq('add');
                      }
                    }
                  ]}
                />
              </div>
              {open && (
                <div id={panel} className={s.sub}>
                  <p className={s.buy}>{r.buy ?? 'Not in the price book yet.'}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div ref={addWrapRef}>
        <AddRow
          open={addOpen}
          onOpenChange={(id, reason) => {
            // A typed-in new ingredient's form stays up below the row on a blur; Cancel / Esc discards it with the row.
            if (id === null && newName != null) {
              if (reason === 'blur') return;
              setNewName(null);
            }
            setAddOpen(id);
          }}
          actions={[
            {
              id: 'ingredient',
              label: 'Ingredient',
              content: (
                <IngredientSearch
                  inputRef={addRef}
                  label="Add an ingredient"
                  placeholder="Add an ingredient — search the price book"
                  choices={free}
                  onPick={(c) => {
                    setNewName(null);
                    onAction({ type: 'add', ingredientId: c.id });
                    onAnnounce(`${c.name} added. Set how much each person needs.`);
                    setEditing(`ing:${c.id}`);
                    setAddOpen(null);
                  }}
                  onNew={renderNew ? (name) => setNewName(name) : undefined}
                />
              )
            }
          ]}
        />
        {newName != null &&
          renderNew?.(newName, (id) => {
            setNewName(null);
            if (id) {
              setEditing(`ing:${id}`);
              setAddOpen(null);
            } else setFocusReq('add');
          })}
      </div>
    </div>
  );
}

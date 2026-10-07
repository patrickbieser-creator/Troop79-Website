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
 *
 * Diets (Patrick, 2026-10-06): given the meal's `restrictions`, a troop row's ⋯ also offers
 * "Swap for <diet> scouts…" / "Leave out for <diet> scouts" for each diet with people on the
 * meal, and the add search carries a "For" choice (Everyone by default). A row that is for one
 * diet says so in words ("Gluten-free scouts only", "except gluten-free"); one for a diet with
 * nobody on the meal stays, dimmed, and says why. The ops are the parent's; the rules are the
 * recipe variations' own (lib/menu-monster/variations.ts).
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { RestrictionKey } from '@/lib/menu-monster/types';
import { RESTRICTIONS, RESTRICTION_BY_KEY, fracText, parseQty, type parseAmountWithUnit } from '@/lib/menu-monster/units';
import { idleLabel, scopeLabel, type IngredientRow } from '@/lib/menu-monster/ingredient-rows';
import { SelectInput } from '@/app/_components/form';
import { RowMenu, type RowMenuItem } from '../menus/_components/row-menu';
import { IngredientSearch, type IngredientChoice } from './ingredient-search';
import s from './ingredient-list.module.css';

/** What a row's ⋯, amount box or search asked for. The parent builds the ops. */
export type RowAction =
  | { type: 'amount'; key: string; qtyPerPerson: number }
  /** `scope`: for that diet's scouts only (absent on a scoped row = that row's own diet). */
  | { type: 'swap'; key: string; to: string; scope?: RestrictionKey }
  | { type: 'leave_out' | 'put_back' | 'reset' | 'remove'; key: string; scope?: RestrictionKey }
  | { type: 'add'; ingredientId: string; scope?: RestrictionKey };

/** What the warning under a recipe asked this list to open (the meal panel remounts the list with it). */
export type ListIntent =
  | { kind: 'swap'; ingredientId: string; scope: RestrictionKey }
  | { kind: 'add'; scope: RestrictionKey };

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
  /** The "new ingredient" form for typed text no ingredient matches (release C, a signed-in scout's
   *  saved menu only); it calls `done` with the id it added, or null on cancel. */
  /** `scope`: the "Add for" choice at the moment the name was typed, so a brand-new food lands for those scouts too (2026-10-06). */
  renderNew?: (name: string, done: (ingredientId: string | null) => void, scope?: RestrictionKey) => ReactNode;
  /** Compact rows with no rule between them (a meal open on the Plan tab). */
  dense?: boolean;
  /** Release 3: the brand beside an ingredient's name (quiet text + one action) and the chooser it opens,
   *  for the ingredient a row shows now. The parent owns what is open; null = nothing to show. */
  brandSlot?: (ingredientId: string, name: string) => { text: ReactNode; inset: ReactNode } | null;
  /** The meal's diet counts. Absent = no diet actions (a list with nobody on a diet offers none). */
  restrictions?: Record<RestrictionKey, number>;
  /** Open on a diet's swap search (or the add search set to that diet) — the answer a warning offers. */
  initialIntent?: ListIntent;
}

const MAX_QTY = 1000;

/** The unit a recipe line may be written in, on the amount box (a recipe being written; a menu's own amount keeps the troop line's unit). */
export interface AmountUnits {
  /** The unit key the box opens in. */
  key: string;
  /** Every unit the line may use, the ingredient's own first. */
  options: readonly { key: string; label: string }[];
  /** The rule for a unit word typed after the number ("4 cups"). */
  parse: (text: string) => ReturnType<typeof parseAmountWithUnit>;
}

/** The amount box: one number per person, Enter or leaving the box commits, Escape cancels. Shared with author mode. */
export function AmountEditor({
  name,
  unitLabel,
  value,
  scale = 'person',
  canScale = false,
  units,
  onCommit,
  onCancel
}: {
  name: string;
  unitLabel: string;
  value: number;
  /** What the amount is for now: each person (default) or the whole meal. */
  scale?: 'person' | 'meal';
  /** Offer the choice (a recipe being written). A menu's edit keeps the troop line's own scale, so it only says it. */
  canScale?: boolean;
  /** Offer the unit choice (a recipe being written): a select when there is more than one, and a typed word in the box sets it. */
  units?: AmountUnits;
  /** refocus: hand focus back to the row's ⋯ (Enter) — not on a blur, which already moved focus. `unit` is the unit key chosen (only when `units` was given). */
  onCommit: (qty: number, refocus: boolean, scale: 'person' | 'meal', unit?: string) => void;
  onCancel: (refocus: boolean) => void;
}) {
  const [text, setText] = useState(() => String(Math.round(value * 10000) / 10000));
  const [bad, setBad] = useState(false);
  const [chosen, setChosen] = useState<'person' | 'meal'>(scale);
  const [unit, setUnit] = useState(units?.key ?? '');
  /** A typed unit word the price book cannot convert for this ingredient. */
  const [badWord, setBadWord] = useState<string | null>(null);
  const shownUnit = units ? (units.options.find((o) => o.key === unit)?.label ?? unitLabel) : unitLabel;
  const finished = useRef(false);
  const box = useRef<HTMLSpanElement>(null);
  const errId = useId();
  const groupName = useId();

  const typed = units?.parse(text) ?? null;
  const word = typed && 'bad' in typed ? typed.word : null;
  const numberText = typed && !('bad' in typed) ? typed.amount : text;
  const parsed = parseQty(numberText);
  const valid = word == null && Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_QTY;

  function finish(refocus: boolean, fromBlur: boolean) {
    if (finished.current) return;
    if (word != null) {
      // Stay open and say so in place; a conversion in the Price book is how a unit becomes usable.
      setBadWord(word);
      return;
    }
    if (valid) {
      finished.current = true;
      const chosenUnit = typed && !('bad' in typed) && typed.unitKey ? typed.unitKey : unit;
      onCommit(parsed, refocus, chosen, units ? chosenUnit : undefined);
    } else if (fromBlur) {
      finished.current = true;
      onCancel(false);
    } else {
      setBad(true);
    }
  }

  function onKey(e: KeyboardEvent<HTMLElement>) {
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
    <span
      className={s.amountEdit}
      ref={box}
      onKeyDown={onKey}
      onBlur={(e) => {
        // Moving between the box and the scale choice is still editing; leaving the whole editor commits.
        if (e.relatedTarget instanceof Node && box.current?.contains(e.relatedTarget)) return;
        finish(false, true);
      }}
    >
      <input
        type="text"
        inputMode="decimal"
        className={s.amountInput}
        value={text}
        autoFocus
        aria-label={chosen === 'meal' ? `Amount of ${name} for the whole meal, in ${shownUnit}` : `Amount per person of ${name}, in ${shownUnit}`}
        aria-invalid={bad || badWord != null || undefined}
        aria-describedby={bad || badWord != null ? errId : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
          setBadWord(null);
        }}
        onFocus={(e) => e.currentTarget.select()}
      />
      {canScale ? (
        <span className={s.scaleGroup} role="radiogroup" aria-label={`What the ${name} amount is for`}>
          {units && units.options.length > 1 ? (
            <SelectInput className={s.unitSelect} aria-label={`Unit for ${name}`} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {units.options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </SelectInput>
          ) : (
            <span className={s.unit}>{shownUnit}</span>
          )}
          {(
            [
              ['person', 'per person'],
              ['meal', 'whole meal']
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={s.scaleOpt}>
              <input type="radio" name={groupName} className={s.scaleRadio} checked={chosen === key} onChange={() => setChosen(key)} />
              <span>{label}</span>
            </label>
          ))}
        </span>
      ) : (
        <span className={s.unit}>{chosen === 'meal' ? `${unitLabel} for the whole meal` : `${unitLabel} each person`}</span>
      )}
      {(bad || badWord != null) && (
        <span id={errId} className={s.fieldError} role="alert">
          {badWord != null ? `${badWord} is not a unit the Price book can convert for ${name}. Ask a leader to add a conversion.` : 'Enter an amount above 0.'}
        </span>
      )}
    </span>
  );
}

const dietLower = (k: RestrictionKey) => RESTRICTION_BY_KEY[k].label.toLowerCase();

export function MenuEditList({ rows, ariaLabel, emptyText = 'No ingredients.', choices, onAction, onAnnounce, renderNew, dense = false, brandSlot, restrictions, initialIntent }: MenuEditProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<{ key: string; scope?: RestrictionKey } | null>(() => {
    if (initialIntent?.kind !== 'swap') return null;
    const row = rows.find((r) => r.edit?.kind === 'base' && !r.edit.scope && r.edit.ingredientId === initialIntent.ingredientId);
    return row ? { key: row.key, scope: initialIntent.scope } : null;
  });
  /** The diet the next added ingredient is for ('' = everyone). */
  const [addFor, setAddFor] = useState<RestrictionKey | ''>(initialIntent?.kind === 'add' ? initialIntent.scope : '');
  const addForId = useId();
  /** Diets with people on this meal: the ones worth offering. */
  const diets = restrictions ? RESTRICTIONS.filter((d) => (restrictions[d.key] ?? 0) > 0) : [];
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
    if (e.scope) {
      // A line just for one diet's scouts (swapped in): its own amount, another swap, or back to the troop's.
      return [
        change,
        { label: 'Swap for something else…', onSelect: () => { setEditing(null); setSwapping({ key: r.key, scope: e.scope }); } },
        {
          label: `Back to ${e.baseName ?? 'the troop ingredient'}`,
          onSelect: () => {
            onAction({ type: 'reset', key: r.key });
            onAnnounce(`Back to ${e.baseName} for ${dietLower(e.scope as RestrictionKey)} scouts, as the troop wrote it.`);
            setFocusReq(r.key);
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
      { label: e.op === 'swap' ? 'Swap for something else…' : 'Swap for…', onSelect: () => { setEditing(null); setSwapping({ key: r.key }); } },
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
    if (e.scopable) {
      for (const d of diets) {
        if (e.recipeOut?.includes(d.key)) continue; // the troop's recipe already leaves it out for them
        const who = `${dietLower(d.key)} scouts`;
        items.push({ label: `Swap for ${who}…`, onSelect: () => { setEditing(null); setSwapping({ key: r.key, scope: d.key }); } });
        if (e.scopedOut?.includes(d.key)) {
          items.push({
            label: `Put back for ${who}`,
            onSelect: () => {
              onAction({ type: 'put_back', key: r.key, scope: d.key });
              onAnnounce(`${r.name} is back for ${who}.`);
              setFocusReq(r.key);
            }
          });
        } else {
          items.push({
            label: `Leave out for ${who}`,
            onSelect: () => {
              onAction({ type: 'leave_out', key: r.key, scope: d.key });
              onAnnounce(`${r.name} left out for ${who}.`);
              setFocusReq(r.key);
            }
          });
        }
      }
    }
    return items;
  }

  return (
    <div>
      {rows.length === 0 && <p className={s.empty}>{emptyText}</p>}
      <ul className={`${s.list} ${dense ? s.dense : ''}`} aria-label={ariaLabel} ref={listRef} hidden={rows.length === 0}>
        {rows.map((r) => {
          const out = r.marker?.kind === 'out';
          const e = r.edit;
          const idle = r.scope?.idle === true;
          const brand = !out && !idle && e ? brandSlot?.(e.currentIngredientId, r.name) : null;
          return (
            <li key={r.key} data-key={r.key} className={`${s.row} ${s.rowEdit} ${out || idle ? s.rowOut : ''}`}>
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
                {r.scope && <span className={s.tag}>{scopeLabel(r.scope)}</span>}
                {r.scope?.idle && <span className={s.note}>{idleLabel(r.scope)}</span>}
                {r.note && <span className={s.note}>{r.note}</span>}
                {brand?.text}
              </span>
              <span className={s.amount}>
                {editing === r.key && e ? (
                  <AmountEditor
                    name={r.name}
                    unitLabel={e.unitLabel}
                    value={e.qtyPerPerson}
                    scale={e.scale}
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
              {swapping?.key === r.key && e && (
                <div className={s.sub}>
                  <IngredientSearch
                    autoFocus
                    label={`Swap ${e.baseName ?? r.name} for${swapping.scope ? ` ${dietLower(swapping.scope)} scouts` : ''}`}
                    placeholder={`Swap ${e.baseName ?? r.name} for${swapping.scope ? ` ${dietLower(swapping.scope)} scouts` : ''}… search the ingredients`}
                    choices={free.filter((c) => c.id !== e.ingredientId)}
                    onPick={(c) => {
                      const scope = swapping.scope;
                      setSwapping(null);
                      onAction({ type: 'swap', key: r.key, to: c.id, ...(scope ? { scope } : {}) });
                      onAnnounce(`Swapped ${e.baseName ?? r.name} for ${c.name}${scope ? ` for ${dietLower(scope)} scouts` : ''}. Set how much each person needs.`);
                      setEditing(scope && !e.scope ? `swap:${scope}:${e.ingredientId}` : r.key);
                    }}
                    onCancel={() => {
                      setSwapping(null);
                      setFocusReq(r.key);
                    }}
                  />
                </div>
              )}
              {brand?.inset && <div className={s.sub}>{brand.inset}</div>}
            </li>
          );
        })}
      </ul>
      <div className={s.addRow}>
        {diets.length > 0 && (
          <div className={s.forRow}>
            <label htmlFor={addForId} className={s.forLabel}>
              Add for
            </label>
            <SelectInput id={addForId} className={s.forSelect} value={addFor} onChange={(ev) => setAddFor(ev.target.value as RestrictionKey | '')}>
              <option value="">Everyone</option>
              {diets.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label} scouts
                </option>
              ))}
            </SelectInput>
          </div>
        )}
        <IngredientSearch
          inputRef={addRef}
          label="Add an ingredient to your version"
          placeholder="Add an ingredient — search the troop’s ingredients"
          choices={free}
          onPick={(c) => {
            setNewName(null);
            const scope = addFor || undefined;
            onAction({ type: 'add', ingredientId: c.id, ...(scope ? { scope } : {}) });
            onAnnounce(`${c.name} added to your version${scope ? ` for ${dietLower(scope)} scouts` : ''}. Set how much each person needs.`);
            setEditing(scope ? `add:${scope}:${c.id}` : `add:${c.id}`);
            setAddFor('');
          }}
          onNew={renderNew ? (name) => setNewName(name) : undefined}
        />
        {newName != null &&
          renderNew?.(
            newName,
            (id) => {
              setNewName(null);
              if (id) setEditing(`add:${id}`);
              else setFocusReq('add');
            },
            addFor || undefined
          )}
      </div>
    </div>
  );
}

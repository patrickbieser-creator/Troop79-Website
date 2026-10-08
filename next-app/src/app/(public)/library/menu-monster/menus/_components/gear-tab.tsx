'use client';

/**
 * The Gear tab of a menu (Plans/Menu-Monster-Brands-Gear.md, release 2; prototype concept-f-kinds/gear.html).
 * The gear crew's packing list, live as the plan changes: while one group of scouts plans the meals, another
 * waits for this list so they can pull the right gear before the campout.
 *
 * One row per item, grouped by where it comes from (4th Floor NWS — the troop's gear store at Northwoods, patrol box, chef kit, home): a Packed tick, the
 * name (a disclosure: which meals and foods need it), who packed it, and how many in the fixed right column.
 * Reusable gear is shared — the count is the most any one food needs, never the sum (lib/menu-monster/gear.ts);
 * the troop's mess kits follow People. A tick remembers the count it was made at: when the plan later changes
 * that item the tick clears itself and the row says why.
 *
 * Who does what: anyone who can record on the menu ticks (`canPack`: the owner, any signed-in scout on an
 * outing's menu, a leader); only the owner adds or removes the menu's own extras (`canEdit`). Ticks and extras
 * save at once — there is nothing to Save here — and never touch the menu's version.
 *
 * Each row also carries the B L D S Ds letters of the meals that use it, between the name and the count (Patrick,
 * 2026-10-08); per-person items and menu extras leave the slots blank.
 *
 * Print: a one-page packing checklist (the print-only sheet at the foot; the screen list hides).
 */

import { useId, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import type { Catalog, MealSlot } from '@/lib/menu-monster/types';
import type { Menu } from '@/lib/menu-monster/menus';
import { GEAR_HOMES, gearKey, menuGearRows, packedSummary, parseGear, type GearItem, type GearRow, type MenuGearState } from '@/lib/menu-monster/gear';
import { mealTitle } from '@/lib/menu-monster/menu-view';
import { MealLetters } from './meal-letters';
import { setGearExtrasAction, setGearPackedAction } from '../../../_tools/menu-monster/gear-actions';
import { AddRow } from '../../_components/add-row';
import { GearPicker } from '../../_components/gear-picker';
import s from './workspace.module.css';

export interface GearTabProps {
  catalog: Catalog;
  menuId: string;
  menu: Menu;
  /** The troop's gear list (not retired). */
  gearList: GearItem[];
  state: MenuGearState;
  /** May tick Packed. */
  canPack: boolean;
  /** May add and remove the menu's own extras (the owner). */
  canEdit: boolean;
  /** The viewer's name as a tick shows it ("Leo B."). */
  viewerName: string;
  tabs?: ReactNode;
  aside?: ReactNode;
}

export function GearTab({ catalog, menuId, menu, gearList, state: initial, canPack, canEdit, viewerName, tabs, aside }: GearTabProps) {
  const uid = useId();
  const router = useRouter();
  const [state, setState] = useState<MenuGearState>(initial);
  const [openKey, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [addOpen, setAddOpen] = useState<string | null>(null);

  const rows = menuGearRows(menu, catalog, gearList, state);
  const sum = packedSummary(rows);
  const mealName = (id: string) => {
    const m = menu.meals.find((x) => x.id === id);
    return m ? mealTitle(menu.startDate, m.day, m.slot) : '';
  };
  /** The meal kinds that use a row, from the meals that need it; a per-person item or a menu extra has none (blank slots). */
  const slotsFor = (r: GearRow): MealSlot[] => {
    const mealIds = new Set(r.usedBy.map((u) => u.mealId));
    return menu.meals.filter((m) => mealIds.has(m.id)).map((m) => m.slot);
  };
  const toggleOpen = (key: string) =>
    setOpenKeys((cur) => {
      const next = new Set(cur);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  function setPacked(row: GearRow, packed: boolean) {
    const before = state;
    const next = { ...state.packed };
    if (packed) next[row.key] = { count: row.count, by: viewerName, personId: null, at: new Date().toISOString() };
    else delete next[row.key];
    setState({ ...state, packed: next });
    setError(null);
    setStatus(packed ? `${row.name} packed.` : `${row.name} not packed.`);
    start(async () => {
      const res = await setGearPackedAction(menuId, row.key, row.count, packed);
      if (!res.ok) {
        setState(before);
        setStatus('');
        setError(res.error);
      }
    });
  }

  function saveExtras(extras: string[], said: string) {
    const before = state;
    setState({ ...state, extras });
    setError(null);
    setStatus(said);
    start(async () => {
      const res = await setGearExtrasAction(menuId, extras);
      if (!res.ok) {
        setState(before);
        setStatus('');
        setError(res.error);
        return;
      }
      setState((cur) => ({ ...cur, extras: res.extras }));
      // Gear is picked from the troop's list; a name that is not on it is never kept (and the picker never offers one).
      if (res.dropped.length > 0) setError(`Not on the gear list, so not kept: ${res.dropped.join(', ')}.`);
      router.refresh();
    });
  }

  /** Picked from the troop's list, so it is never a new name; the picker already left out what is on the menu. */
  const addExtra = (name: string) => {
    setAddOpen(null);
    saveExtras([...state.extras.filter((e) => gearKey(parseGear(e).name) !== gearKey(name)), name], `${name} added.`);
  };

  const removeExtra = (row: GearRow) => saveExtras(state.extras.filter((e) => gearKey(parseGear(e).name) !== row.key), `${row.name} removed.`);

  const groups = GEAR_HOMES.map((h) => ({ ...h, rows: rows.filter((r) => r.home === h.key) })).filter((g) => g.rows.length > 0);

  return (
    <div data-mm-print>
      <div className={s.titleLine}>
        <h1 className={s.menuTitle}>{menu.name.trim() || 'Untitled menu'}</h1>
        <div className={s.titleActions}>
          {rows.length > 0 && (
            <span className={s.meta} role="status">
              {sum.packed} of {sum.total} packed
            </span>
          )}
          <Button variant="secondary" onClick={() => window.print()} disabled={rows.length === 0}>
            Print
          </Button>
        </div>
      </div>
      {aside}
      {tabs != null && <div className={s.tabs}>{tabs}</div>}

      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}

      <div className={s.screenOnly}>
        {rows.length === 0 && <p className={s.foot}>Nothing to pack yet. Gear shows up here as food goes on the Plan tab.</p>}
        {groups.map((g) => (
          <section key={g.key} className={s.section} aria-labelledby={`${uid}-${g.key}`}>
            <h2 id={`${uid}-${g.key}`} className={s.heading}>
              {g.label}
            </h2>
            <ul className={s.card} aria-label={g.label}>
              {g.rows.map((r) => {
                const open = openKey.has(r.key);
                const panel = `${uid}-g-${r.key.replace(/[^a-z0-9]+/g, '-')}`;
                return (
                  <li key={r.key} className={s.row}>
                    <div className={s.rowMain}>
                      {canPack && (
                        <input
                          type="checkbox"
                          className={s.gearCheck}
                          checked={r.packed != null}
                          disabled={busy}
                          aria-label={`${r.name} packed`}
                          onChange={(e) => setPacked(r, e.target.checked)}
                        />
                      )}
                      <button type="button" className={s.rowName} aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => toggleOpen(r.key)}>
                        {r.name}
                        <span className={s.chev} aria-hidden="true">
                          ›
                        </span>
                      </button>
                      {r.packed && <span className={s.meta}>{canPack ? r.packed.by : ['Packed', r.packed.by].filter(Boolean).join(' · ')}</span>}
                      {r.changed && (
                        <span className={s.tag}>
                          Now {r.count}, was {r.changed.count}
                        </span>
                      )}
                    </div>
                    <MealLetters slots={slotsFor(r)} />
                    <div className={s.cost}>{r.count > 1 ? `× ${r.count}` : ''}</div>
                    {open && (
                      <div id={panel} className={s.inset}>
                        {r.description && <p className={s.insetMuted}>{r.description}</p>}
                        {r.perPerson ? (
                          <p className={s.insetMuted}>One per person.</p>
                        ) : r.usedBy.length > 0 ? (
                          <ul className={s.plainList} aria-label={`What needs ${r.name}`}>
                            {r.usedBy.map((u) => (
                              <li key={u.mealId} className={s.insetLine}>
                                {mealName(u.mealId)}: {u.recipes.length > 0 ? u.recipes.join(', ') : 'Added to this meal'}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={s.insetMuted}>Added to this menu.</p>
                        )}
                        {r.changed && (
                          <p className={s.insetMuted}>
                            The plan changed after {r.changed.by} packed it, so the tick was cleared.
                          </p>
                        )}
                        {r.extra && canEdit && (
                          <button type="button" className={s.linkBtn} disabled={busy} onClick={() => removeExtra(r)}>
                            Remove from this menu
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {canEdit && (
          <div className={s.gearAdd}>
            <AddRow
              open={addOpen}
              onOpenChange={(id) => setAddOpen(id)}
              actions={[{ id: 'gear', label: 'Gear', content: <GearPicker list={gearList} taken={rows.map((r) => r.name)} onPick={addExtra} label="Add gear" placeholder="Find gear" /> }]}
            />
          </div>
        )}
        <p className={status ? s.statusLine : s.srOnly} role="status">
          {status}
        </p>
      </div>

      <div className={s.printSheet}>
        <h1 className={s.printTitle}>{menu.name.trim() || 'Untitled menu'} — gear</h1>
        {groups.map((g) => (
          <table key={g.key} className={s.printTable}>
            <caption>{g.label}</caption>
            <thead>
              <tr>
                <th scope="col">Packed</th>
                <th scope="col">Item</th>
                <th scope="col">How many</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.packed ? '☑' : '☐'}</td>
                  <th scope="row">{r.name}</th>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

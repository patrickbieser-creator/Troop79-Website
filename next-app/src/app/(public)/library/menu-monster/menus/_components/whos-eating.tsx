'use client';

/**
 * The Who's eating step, on its own screen (Patrick, 2026-10-06: "make Who's Eating its own step on its own
 * screen and not merged together" with the meals). The form is ALWAYS open — no summary line, no Edit toggle:
 * name, where you're cooking, outing, patrol, the People dialer with the diets above zero and "Add a diet…",
 * and the budget. It is a presentational piece: PlanTab (page "people") owns the one draft, the Save / Discard
 * rail and the leave guard, and hands each change back through the callbacks.
 *
 * A read-only viewer (leader, parent, shared) gets `WhosEatingReadOnly`: the same facts as text, no controls.
 */

import { useState, type RefObject } from 'react';
import { priceText as money } from '@/lib/menu-monster/units';
import { fmtRange } from '@/lib/format-date';
import { Field, SelectInput, TextInput } from '@/app/_components/form';
import { NumberBox } from '@/app/_components/stepper';
import type { RestrictionKey } from '@/lib/menu-monster/types';
import { RESTRICTION_BY_KEY } from '@/lib/menu-monster/units';
import { MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import { MENU_CONTEXTS, MAX_MENU_NAME, type Menu, type MenuContext } from '@/lib/menu-monster/menus';
import { DIET_ORDER, type Outing } from '@/lib/menu-monster/menu-view';
import { AddDietMenu } from './add-diet-menu';
import type { ScoutOption } from './scout-options';
import g from '../../_components/gear-picker.module.css';
import s from './workspace.module.css';
import c from './whos-eating.module.css';

const dietLabel = (k: RestrictionKey) => RESTRICTION_BY_KEY[k].label;

export interface WhosEatingFormProps {
  menu: Menu;
  outings: readonly Outing[];
  /** The troop's patrol names, as the Patrol pull-down's options. */
  patrols: readonly string[];
  nameError: string | null;
  /** The name field, so a Save that finds it empty can focus it. */
  nameRef: RefObject<HTMLInputElement | null>;
  onName: (name: string) => void;
  onContext: (context: MenuContext) => void;
  /** The outing select's value: an outing id, or 'none'. */
  onOuting: (value: string) => void;
  onPatrol: (value: string) => void;
  onHeadcount: (n: number) => void;
  onDiet: (key: RestrictionKey, n: number) => void;
  onBudget: (n: number) => void;
  /** The active scouts the Planned by pull-down offers. Empty (with nobody picked) = no field; a menu kept on this computer passes none. */
  scoutOptions?: readonly ScoutOption[];
  /** Names of scouts already on the menu who are not in `scoutOptions` (no longer active). */
  planners?: readonly ScoutOption[];
  onPlannedBy?: (ids: number[]) => void;
}

export function WhosEatingForm({ menu, outings, patrols, nameError, nameRef, onName, onContext, onOuting, onPatrol, onHeadcount, onDiet, onBudget, scoutOptions = [], planners = [], onPlannedBy }: WhosEatingFormProps) {
  /** Diets that show a dialer: those above zero on load, plus any added with "Add a diet…" (so a dialer stepped back to 0 stays put). */
  const [shownDiets, setShownDiets] = useState<ReadonlySet<RestrictionKey>>(() => new Set(DIET_ORDER.filter((k) => (menu.restrictions[k] || 0) > 0)));
  const linked = outings.find((o) => o.id === menu.calendarEntryId) ?? null;
  // The troop's patrols, plus the menu's own when it is not on the list (a retired or typed-in one): nothing is lost.
  const patrolOptions = menu.patrol && !patrols.includes(menu.patrol) ? [...patrols, menu.patrol] : patrols;
  const visibleDiets = DIET_ORDER.filter((k) => shownDiets.has(k) || (menu.restrictions[k] || 0) > 0);
  const hiddenDiets = DIET_ORDER.filter((k) => !visibleDiets.includes(k));
  const picked = menu.plannedBy ?? [];
  const nameOf = (id: number) => scoutOptions.find((o) => o.personId === id)?.name ?? planners.find((o) => o.personId === id)?.name ?? '';
  const toPick = scoutOptions.filter((o) => !picked.includes(o.personId));
  const showPlanners = !!onPlannedBy && (scoutOptions.length > 0 || picked.length > 0);
  const addDiet = (k: RestrictionKey) => {
    setShownDiets((cur) => new Set(cur).add(k));
    requestAnimationFrame(() => document.getElementById(`mm-diet-${k}`)?.focus());
  };

  return (
    <section className={s.basics} aria-label="Who’s eating">
      <h2 className={s.heading}>Who’s eating</h2>
      <div className={s.basicsTop}>
        <Field label="Menu name" error={nameError}>
          <TextInput
            ref={nameRef}
            value={menu.name}
            maxLength={MAX_MENU_NAME}
            autoComplete="off"
            placeholder="Fall Camporee"
            aria-invalid={nameError ? true : undefined}
            onChange={(e) => onName(e.target.value)}
          />
        </Field>
        <div className={s.pickRow}>
          <Field label="Where you’re cooking">
            <SelectInput value={menu.context} onChange={(e) => onContext(e.target.value as MenuContext)}>
              {MENU_CONTEXTS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          {/* A consequence to know before choosing (qa-lead, 2026-10-04): an outing's menu is open to its crew, whoever saved it. */}
          <Field label="Outing" hint={linked ? 'Signed-in scouts and leaders can open this menu from the outing, and record what was bought.' : undefined}>
            <SelectInput value={linked ? String(linked.id) : 'none'} onChange={(e) => onOuting(e.target.value)}>
              {outings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} · {fmtRange(o.startDate, o.endDate)}
                </option>
              ))}
              <option value="none">No outing</option>
            </SelectInput>
          </Field>
          <Field label="Patrol">
            <SelectInput value={menu.patrol ?? ''} onChange={(e) => onPatrol(e.target.value)}>
              <option value="">— pick —</option>
              {patrolOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </SelectInput>
          </Field>
          {showPlanners && (
            <Field label="Planned by">
              <SelectInput
                value=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id) onPlannedBy?.([...picked, id]);
                }}
              >
                <option value="">— pick —</option>
                {toPick.map((o) => (
                  <option key={o.personId} value={o.personId}>
                    {o.name}
                  </option>
                ))}
              </SelectInput>
              {picked.length > 0 && (
                <ul className={g.chips} aria-label="Planned by">
                  {picked.map((id) => (
                    <li key={id} className={g.chip}>
                      <span className={g.chipName}>{nameOf(id)}</span>
                      <button type="button" className={g.remove} aria-label={`Remove ${nameOf(id)}`} onClick={() => onPlannedBy?.(picked.filter((x) => x !== id))}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          )}
        </div>
      </div>

      <div className={c.rows}>
        <div className={c.row}>
          <label htmlFor="mm-people">People</label>
          <span className={`${c.box} ${c.plain}`}>
            <NumberBox id="mm-people" value={menu.headcount} min={MIN_HEADCOUNT} max={MAX_HEADCOUNT} onCommit={onHeadcount} />
          </span>
        </div>
        {/* The diets are part of the People count, so they sit one step in under a quiet "of whom". */}
        {(visibleDiets.length > 0 || hiddenDiets.length > 0) && (
          <div className={c.nested}>
            {visibleDiets.length > 0 && <span className={c.leadIn}>of whom</span>}
            {visibleDiets.map((k) => (
              <div key={k} className={c.row}>
                <label htmlFor={`mm-diet-${k}`}>{dietLabel(k)}</label>
                <span className={`${c.box} ${c.plain}`}>
                  <NumberBox id={`mm-diet-${k}`} value={menu.restrictions[k] || 0} min={0} max={menu.headcount} onCommit={(n) => onDiet(k, n)} />
                </span>
              </div>
            ))}
            {hiddenDiets.length > 0 && <AddDietMenu id="mm-add-diet" diets={hiddenDiets} onPick={addDiet} />}
          </div>
        )}
      </div>
      <div className={s.line}>
        <span className={s.moneyIn}>
          <span aria-hidden="true">$</span>
          <NumberBox framed id="mm-budget" value={menu.budgetPerPersonMeal} min={0} max={999} step={0.25} ariaLabel="Budget a person, per meal, in dollars" onCommit={onBudget} />
        </span>
        <span>budget a person, per meal</span>
      </div>
    </section>
  );
}

/** A leader's, parent's or shared viewer's Who's eating: the values as text, nothing to edit. */
export function WhosEatingReadOnly({ menu, outings, planners = [] }: { menu: Menu; outings: readonly Outing[]; planners?: readonly ScoutOption[] }) {
  const linked = outings.find((o) => o.id === menu.calendarEntryId) ?? null;
  const diets = DIET_ORDER.filter((k) => (menu.restrictions[k] || 0) > 0);
  return (
    <section className={s.basics} aria-label="Who’s eating">
      <h2 className={s.heading}>Who’s eating</h2>
      <p className={s.foot}>{[MENU_CONTEXTS.find((c) => c.key === menu.context)?.label ?? menu.context, linked?.title, menu.patrol].filter(Boolean).join(' · ')}</p>
      {planners.length > 0 && <p className={s.foot}>Planned by {planners.map((p) => p.name).join(', ')}</p>}
      <p className={s.foot}>People: {menu.headcount}</p>
      {diets.length > 0 && (
        <p className={`${s.foot} ${c.nestedText}`}>
          of whom {diets.map((k) => `${dietLabel(k)}: ${menu.restrictions[k]}`).join(' · ')}
        </p>
      )}
      <p className={s.foot}>{money(menu.budgetPerPersonMeal)} budget a person, per meal</p>
    </section>
  );
}

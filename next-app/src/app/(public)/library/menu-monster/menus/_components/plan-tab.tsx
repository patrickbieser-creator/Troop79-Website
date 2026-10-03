'use client';

/**
 * The Plan tab of a scout's menu (Plans/Menu-Monster-Scout-Workspace.md,
 * Phase 1; prototype concept-e-scout-workspace/editor.html, v5).
 *
 * Title line: the h1 is the live menu name + Save / Discard (the public
 * save-button standard — dirty-gated, "Saved" when clean, a new menu's first
 * save is "Save menu"). Basics: name, where you're cooking, outing, one line of
 * dialers, the budget. Meals: one list card per day, one row per meal.
 * Shopping (right): the menu total and the budget readout; the merged
 * cross-meal list is the Shopping tab (slice 5).
 *
 * The draft is the Menu the server stores; everything shown is derived from
 * it by the pure engine on each render. The day count is stored on the menu
 * (never fewer than the last meal's day + 1), so "Add a day" and "Remove day"
 * are saved, dirty-gated edits like any other. Unsaved edits are guarded by
 * useLeaveGuard (reload / close and in-app links).
 *
 * `readOnly` (a leader looking at a scout's menu): the same page with values as
 * text — no Save / Discard, inputs, dialers, add / remove / ⋯ menus or leave guard.
 * The meal rows are plain links and the shopping list is one link away.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { priceText as money } from '@/lib/menu-monster/units';
import { fmtRange } from '@/lib/format-date';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { Button } from '@/app/_components/button';
import { Field, SelectInput, TextInput } from '@/app/_components/form';
import { Notice } from '@/app/_components/notice';
import { NumberBox, Stepper } from '@/app/_components/stepper';
import type { Catalog, Plan, RestrictionKey } from '@/lib/menu-monster/types';
import { MEALS, RESTRICTION_BY_KEY } from '@/lib/menu-monster/units';
import { MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import { MAX_MENU_DAYS, MAX_MENU_MEALS, MENU_CONTEXTS, MAX_MENU_NAME, menuNameError, type Menu, type MenuContext, type MenuMeal } from '@/lib/menu-monster/menus';
import { DIET_ORDER, budgetState, dayLabel, mealTitle, menuCost, outingDayCount, type Outing } from '@/lib/menu-monster/menu-view';
import type { CreateResult, MenuStore, SaveResult } from '@/lib/menu-monster/menu-store';
import { serverMenuStore } from './server-menu-store';
import { RowMenu } from './row-menu';
import { RecipeLibraryDialog } from './recipe-library-dialog';
import { ReadOnlyLine } from './read-only-line';
import { SaveBar } from './save-bar';
import s from './workspace.module.css';

const newId = () => (typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `m-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
const slotLabel = (slot: Plan['meal']) => MEALS.find((m) => m.key === slot)?.label ?? slot;
const slotOrder = (slot: Plan['meal']) => MEALS.findIndex((m) => m.key === slot);

export interface PlanTabProps {
  catalog: Catalog;
  /** null = a menu that has not been saved yet. */
  menuId: string | null;
  menu: Menu;
  /** The version token the menu was loaded at (null for a new menu). */
  updatedAt: string | null;
  outings: Outing[];
  /** The Plan / Shopping tab strip, rendered under the title line. */
  tabs?: ReactNode;
  /** A leader's view of a scout's menu: shown as text, nothing edits or saves. */
  readOnly?: boolean;
  /** Credit name of the scout who planned it (read-only view). */
  plannedBy?: string | null;
  /** Where the menu is kept. Omitted = the signed-in scout's saved menu (server). */
  store?: MenuStore;
  /** The title's heading level: the hub shows this under the page's own h1. */
  titleAs?: 'h1' | 'h2';
}

export function PlanTab({ catalog, menuId, menu: initial, updatedAt, outings, tabs, readOnly = false, plannedBy = null, store: storeProp, titleAs: Title = 'h1' }: PlanTabProps) {
  const router = useRouter();
  const store = useMemo(() => storeProp ?? serverMenuStore(menuId), [storeProp, menuId]);
  const { canSave } = store.caps;
  const [isNew, setIsNew] = useState(menuId === null);
  const [menu, setMenu] = useState<Menu>(initial);
  const [saved, setSaved] = useState<{ menu: Menu; key: string }>(() => ({ menu: initial, key: JSON.stringify(initial) }));
  const [version, setVersion] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [navWarn, setNavWarn] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  /** The day whose recipe library popup is open, or null. */
  const [libraryDay, setLibraryDay] = useState<number | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const warnRef = useRef<HTMLDivElement | null>(null);

  const linked = outings.find((o) => o.id === menu.calendarEntryId) ?? null;
  const days = menu.dayCount;

  const draftKey = JSON.stringify(menu);
  const dirty = draftKey !== saved.key;
  const cost = menuCost(menu, catalog);
  const priced = menu.meals.some((m) => m.recipeIds.length > 0);
  const budget = budgetState({ perSpent: cost.perPersonMeal }, menu.budgetPerPersonMeal);

  useLeaveGuard(dirty && !readOnly);

  // A dirty meal-row click opens the "save first" notice; move focus to it so
  // keyboard and screen-reader users land on what just appeared.
  useEffect(() => {
    if (navWarn) warnRef.current?.focus();
  }, [navWarn]);

  const edit = (f: (m: Menu) => Menu) => {
    setMenu(f);
    setJustSaved(false);
    setError(null);
    setStatus('');
  };

  /* ---- Basics ---- */
  const setName = (name: string) => {
    edit((m) => ({ ...m, name }));
    if (nameError && !menuNameError(name)) setNameError(null);
  };
  const setHeadcount = (n: number) =>
    edit((m) => {
      const headcount = Math.min(MAX_HEADCOUNT, Math.max(MIN_HEADCOUNT, Math.round(n) || MIN_HEADCOUNT));
      const restrictions = { ...m.restrictions };
      for (const k of DIET_ORDER) restrictions[k] = Math.min(restrictions[k] || 0, headcount);
      return { ...m, headcount, restrictions };
    });
  const setDiet = (k: RestrictionKey, n: number) =>
    edit((m) => ({ ...m, restrictions: { ...m.restrictions, [k]: Math.min(m.headcount, Math.max(0, Math.round(n) || 0)) } }));
  const setContext = (context: MenuContext) => edit((m) => ({ ...m, context }));
  const setOuting = (value: string) => {
    const outing = outings.find((o) => String(o.id) === value);
    if (!outing) {
      edit((m) => ({ ...m, calendarEntryId: null }));
      return;
    }
    edit((m) => ({
      ...m,
      calendarEntryId: outing.id,
      startDate: outing.startDate,
      // An empty menu takes the outing's span; one with meals keeps its days.
      dayCount: m.meals.length === 0 ? outingDayCount(outing) : m.dayCount,
      name: m.name.trim() ? m.name : outing.title.slice(0, MAX_MENU_NAME)
    }));
    if (!menu.name.trim()) setNameError(null);
  };

  /* ---- Meals ---- */
  /** Drop a recipe into the day's meal of that slot, creating the meal if the day lacks it. */
  const addRecipe = (day: number, slot: Plan['meal'], recipeId: string) => {
    const existing = menu.meals.find((m) => m.day === day && m.slot === slot);
    if (!existing && menu.meals.length >= MAX_MENU_MEALS) return;
    if (existing?.recipeIds.includes(recipeId)) return;
    edit((m) => {
      const here = m.meals.find((x) => x.day === day && x.slot === slot);
      if (here) return { ...m, meals: m.meals.map((x) => (x === here ? { ...x, recipeIds: [...x.recipeIds, recipeId] } : x)) };
      const meal: MenuMeal = { id: newId(), day, slot, headcount: null, recipeIds: [recipeId], recipeEdits: {} };
      return { ...m, meals: [...m.meals, meal] };
    });
    const name = catalog.recipes.find((r) => r.id === recipeId)?.name ?? 'Recipe';
    setStatus(`${name} added to ${mealTitle(menu.startDate, day, slot)}. Save to keep it.`);
  };
  /** An empty meal for the slot (if the day lacks it), then the meal page — via the save-first notice. */
  const planMeal = (day: number, slot: Plan['meal']) => {
    const existing = menu.meals.find((m) => m.day === day && m.slot === slot);
    if (existing) {
      setNavWarn(existing.id);
      return;
    }
    if (menu.meals.length >= MAX_MENU_MEALS) return;
    const meal: MenuMeal = { id: newId(), day, slot, headcount: null, recipeIds: [], recipeEdits: {} };
    edit((m) => ({ ...m, meals: [...m.meals, meal] }));
    setStatus(`${mealTitle(menu.startDate, day, slot)} added. Save to keep it.`);
    setNavWarn(meal.id);
  };
  /** The popup closed: focus goes back to the day's Search recipes, unless a save-first notice took it. */
  const closeLibrary = (day: number) => {
    setLibraryDay(null);
    requestAnimationFrame(() => {
      if (!warnRef.current?.contains(document.activeElement)) document.getElementById(`mm-lib-${day}`)?.focus();
    });
  };
  const removeMeal = (id: string) => edit((m) => ({ ...m, meals: m.meals.filter((x) => x.id !== id) }));
  const addDay = () => edit((m) => ({ ...m, dayCount: Math.min(MAX_MENU_DAYS, m.dayCount + 1) }));
  const removeLastDay = () => edit((m) => ({ ...m, dayCount: Math.max(1, m.dayCount - 1) }));

  /* ---- Save ---- */
  async function save(thenOpen?: string): Promise<boolean> {
    const bad = menuNameError(menu.name);
    if (bad) {
      setNameError(bad);
      nameRef.current?.focus();
      return false;
    }
    setNameError(null);
    setSaving(true);
    setError(null);
    const sent = menu;
    let res: CreateResult | SaveResult;
    try {
      res = isNew ? await store.create(sent) : await store.save(sent, version);
    } catch {
      res = { ok: false, error: 'Something went wrong saving your menu. Try again.' };
    }
    if (!res.ok) {
      setSaving(false);
      setError(res.error);
      return false;
    }
    setSaved({ menu: sent, key: JSON.stringify(sent) });
    setNavWarn(null);
    if (isNew && 'id' in res) {
      const href = store.afterCreate(res.id, thenOpen);
      if (href) {
        // Stay "Saving…" — the page is replaced by the saved menu's own URL.
        router.replace(href);
        return true;
      }
      setIsNew(false);
      setSaving(false);
      setJustSaved(true);
      return true;
    }
    setSaving(false);
    if ('updatedAt' in res) setVersion(res.updatedAt ?? version);
    setJustSaved(true);
    if (thenOpen) router.push(store.hrefs.meal(thenOpen));
    return true;
  }

  function discard() {
    setMenu(saved.menu);
    setNameError(null);
    setError(null);
    setNavWarn(null);
  }

  const mealHref = store.hrefs.meal;
  const clean = !isNew && !dirty;
  const dialerLabel = (k: RestrictionKey) => RESTRICTION_BY_KEY[k].label;

  return (
    <div>
      <div className={s.titleLine}>
        <Title className={s.menuTitle}>{menu.name.trim() || (isNew ? 'New menu' : 'Untitled menu')}</Title>
        {!readOnly && (
          <SaveBar
            isNew={isNew}
            newLabel={canSave ? undefined : 'Save on this computer'}
            labels={canSave ? undefined : { clean: 'Saved on this computer' }}
            dirty={dirty}
            saving={saving}
            saved={justSaved}
            onSave={() => void save()}
            onDiscard={discard}
          />
        )}
      </div>
      {readOnly && <ReadOnlyLine plannedBy={plannedBy} />}
      {tabs != null && <div className={s.tabs}>{tabs}</div>}

      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}
      {navWarn && (
        <Notice tone="warning" role="alert" tabIndex={-1} ref={warnRef} className={s.notice}>
          <strong>Save your changes before opening a meal</strong>
          <div>{canSave ? 'The meal opens your saved menu.' : 'The meal opens the menu saved on this computer.'}</div>
          <div className={s.noticeActions}>
            <Button size="sm" variant="primary" disabled={saving} onClick={() => void save(navWarn)}>
              Save and open the meal
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setNavWarn(null)}>
              Stay here
            </Button>
          </div>
        </Notice>
      )}

      {readOnly ? (
        <section className={s.basics} aria-label="Menu basics">
          <p className={s.foot}>{[MENU_CONTEXTS.find((c) => c.key === menu.context)?.label ?? menu.context, linked?.title].filter(Boolean).join(' · ')}</p>
          <p className={s.foot}>
            {[`People: ${menu.headcount}`, ...DIET_ORDER.filter((k) => (menu.restrictions[k] || 0) > 0).map((k) => `${dialerLabel(k)}: ${menu.restrictions[k]}`)].join(' · ')}
          </p>
          <p className={s.foot}>{money(menu.budgetPerPersonMeal)} budget a person, per meal</p>
        </section>
      ) : (
      <section className={s.basics} aria-label="Menu name and basics">
        <div className={s.basicsTop}>
        <Field label="Menu name" error={nameError}>
          <TextInput
            ref={nameRef}
            value={menu.name}
            maxLength={MAX_MENU_NAME}
            autoComplete="off"
            placeholder="Fall Camporee"
            aria-invalid={nameError ? true : undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className={s.pickRow}>
          <Field label="Where you’re cooking">
            <SelectInput value={menu.context} onChange={(e) => setContext(e.target.value as MenuContext)}>
              {MENU_CONTEXTS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Outing">
            <SelectInput value={linked ? String(linked.id) : 'none'} onChange={(e) => setOuting(e.target.value)}>
              {outings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} · {fmtRange(o.startDate, o.endDate)}
                </option>
              ))}
              <option value="none">No outing</option>
            </SelectInput>
          </Field>
        </div>
        </div>

        <div className={s.line}>
          <Stepper
            id="mm-people"
            label="People"
            value={menu.headcount}
            min={MIN_HEADCOUNT}
            max={MAX_HEADCOUNT}
            onChange={setHeadcount}
            groupLabel="People"
            lessLabel="One fewer person"
            moreLabel="One more person"
          />
          {DIET_ORDER.map((k) => (
            <span key={k} className={s.line}>
              <span className={s.sep} aria-hidden="true">
                ·
              </span>
              <Stepper
                id={`mm-diet-${k}`}
                label={dialerLabel(k)}
                value={menu.restrictions[k] || 0}
                min={0}
                max={menu.headcount}
                onChange={(n) => setDiet(k, n)}
                groupLabel={`${dialerLabel(k)} people`}
                lessLabel={`One fewer ${dialerLabel(k).toLowerCase()} person`}
                moreLabel={`One more ${dialerLabel(k).toLowerCase()} person`}
              />
            </span>
          ))}
        </div>
        <div className={s.line}>
          <span className={s.moneyIn}>
            <span aria-hidden="true">$</span>
            <NumberBox
              framed
              id="mm-budget"
              value={menu.budgetPerPersonMeal}
              min={0}
              max={999}
              step={0.25}
              ariaLabel="Budget a person, per meal, in dollars"
              onCommit={(n) => edit((m) => ({ ...m, budgetPerPersonMeal: n }))}
            />
          </span>
          <span>budget a person, per meal</span>
        </div>
      </section>
      )}

      <div className={s.grid}>
        <div className={s.col}>
          <section aria-labelledby="mm-meals-h">
            <h2 id="mm-meals-h" className={s.heading}>
              Meals
            </h2>
            <p className={s.statusLine} aria-live="polite">
              {status}
            </p>
            {Array.from({ length: days }, (_, d) => {
              const meals = menu.meals.filter((m) => m.day === d).sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot));
              const removable = d === days - 1 && days > 1 && meals.length === 0;
              return (
                <div key={d} className={s.dayBlock}>
                  <div className={s.dayHeadRow}>
                    <h3 className={s.dayHead}>{dayLabel(menu.startDate, d)}</h3>
                    {removable && !readOnly && (
                      <Button variant="ghost" onClick={removeLastDay} aria-label={`Remove Day ${d + 1}`}>
                        Remove day
                      </Button>
                    )}
                  </div>
                  <ul className={s.card}>
                    {meals.length === 0 && <li className={s.empty}>Nothing planned yet.</li>}
                    {meals.map((meal) => {
                      const names = meal.recipeIds.map((id) => catalog.recipes.find((r) => r.id === id)?.name).filter(Boolean);
                      const label = slotLabel(meal.slot);
                      const rowName = clean || readOnly ? (
                        <Link className={s.rowName} href={mealHref(meal.id)}>
                          {label}
                        </Link>
                      ) : (
                        <button type="button" className={s.rowName} onClick={() => setNavWarn(meal.id)}>
                          {label}
                        </button>
                      );
                      return (
                        <li key={meal.id} className={s.row}>
                          <div className={s.rowMain}>
                            {rowName}
                            <span className={s.meta}>{names.length ? names.join(', ') : 'Nothing picked yet'}</span>
                          </div>
                          <div className={s.cost}>{meal.recipeIds.length ? money(cost.byMeal[meal.id] ?? 0) : ''}</div>
                          {!readOnly && (
                            <RowMenu
                              label={`More for Day ${d + 1} ${label.toLowerCase()}`}
                              items={[
                                clean ? { label: 'Open', href: mealHref(meal.id) } : { label: 'Open', onSelect: () => setNavWarn(meal.id) },
                                { label: 'Remove', danger: true, onSelect: () => removeMeal(meal.id) }
                              ]}
                            />
                          )}
                        </li>
                      );
                    })}
                    {!readOnly && (
                      <li className={s.addRow}>
                        <button type="button" id={`mm-lib-${d}`} className={s.libOpen} aria-haspopup="dialog" aria-label={`Search recipes for ${dayLabel(menu.startDate, d)}`} onClick={() => setLibraryDay(d)}>
                          <span aria-hidden="true">⌕</span>
                          Search recipes
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
            {libraryDay !== null && !readOnly && (
              <RecipeLibraryDialog
                catalog={catalog}
                menu={menu}
                day={libraryDay}
                dayName={dayLabel(menu.startDate, libraryDay)}
                onPick={(recipeId, slot) => addRecipe(libraryDay, slot, recipeId)}
                onPlanEmpty={(slot) => planMeal(libraryDay, slot)}
                onClose={() => closeLibrary(libraryDay)}
              />
            )}
            {!readOnly && (
              <div className={s.addDay}>
                <Button variant="ghost" onClick={addDay} disabled={days >= MAX_MENU_DAYS}>
                  Add a day
                </Button>
              </div>
            )}
          </section>
        </div>

        <div className={s.col}>
          <section className={s.section} aria-labelledby="mm-shop-h">
            <h2 id="mm-shop-h" className={s.heading}>
              Shopping
            </h2>
            {priced ? (
              <p className={s.shopLine} role="status">
                <strong>{money(cost.total)}</strong> <span className={s.muted}>· {money(cost.perPersonMeal)} a person per meal ·</span>{' '}
                <span aria-hidden="true">{budget.icon}</span> {budget.msg}
              </p>
            ) : (
              <p className={s.foot}>Add a meal and pick what you’re cooking, and the shopping list builds itself.</p>
            )}
            {!isNew && (
              <Link className={s.link} href={store.hrefs.shopping}>
                Open the shopping list
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

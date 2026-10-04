'use client';

/**
 * The Plan tab of a scout's menu (Plans/Menu-Monster-Scout-Workspace.md,
 * Phase 1; prototype concept-e-scout-workspace/editor.html, v5).
 *
 * Title line: the h1 is the live menu name + Save / Discard (the public
 * save-button standard — dirty-gated, "Saved" when clean, a new menu's first
 * save is "Save menu"). Basics: name, where you're cooking, outing, one line of
 * dialers, the budget. Meals: one list card per day, one row per meal; a
 * meal's name opens it INLINE (MealPanel — Patrick, 2026-10-03, the separate
 * meal page was too many clicks). One control per job (2026-10-03): a day ends in
 * "+ Add a meal" (AddMealMenu — the meals it lacks), and food goes in through the
 * meal's own search. Everything on the page is one draft with one
 * Save; one Total to buy / Per person switch above the meals sets every open
 * meal's amounts and the meal costs. `openMeal` (?meal=) opens one on load.
 * Shopping (right): the menu total and the budget readout; the merged
 * cross-meal list is the Shopping tab (slice 5).
 *
 * The draft is the Menu the server stores; everything shown is derived from
 * it by the pure engine on each render. The day count is stored on the menu
 * (never fewer than the last meal's day + 1), so "Add a day" and "Remove day"
 * are saved, dirty-gated edits like any other. Unsaved edits are guarded by
 * useLeaveGuard (reload / close and in-app links).
 *
 * `readOnly` (a leader, parent or shared viewer): the same page with values as
 * text — no Save / Discard, inputs, dialers, add / remove / ⋯ menus or leave
 * guard. Meals still open inline, read-only; the shopping list is one link away.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { priceText as money } from '@/lib/menu-monster/units';
import { fmtRange } from '@/lib/format-date';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { Button } from '@/app/_components/button';
import { Field, SelectInput, TextInput } from '@/app/_components/form';
import { Notice } from '@/app/_components/notice';
import { NumberBox, Stepper } from '@/app/_components/stepper';
import type { Brand, BrandPick, Catalog, Plan, RestrictionKey } from '@/lib/menu-monster/types';
import { MEALS, RESTRICTION_BY_KEY } from '@/lib/menu-monster/units';
import { MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import { MAX_MENU_DAYS, MAX_MENU_MEALS, MENU_CONTEXTS, MAX_MENU_NAME, MAX_PATROL_NAME, menuNameError, type Menu, type MenuContext, type MenuMeal } from '@/lib/menu-monster/menus';
import { DIET_ORDER, budgetState, buildMenuList, dayLabel, mealTitle, menuCost, outingDayCount, type Outing } from '@/lib/menu-monster/menu-view';
import { addBrandAction, suggestRecipeBrandAction } from '../../../_tools/menu-monster/brand-actions';
import type { CreateResult, MenuStore, SaveResult } from '@/lib/menu-monster/menu-store';
import { serverMenuStore } from './server-menu-store';
import { MealPanel } from './meal-panel';
import { overlayNewIngredients, type NewIngredient } from '@/lib/menu-monster/scout-ingredients';
import type { AmountView } from '@/lib/menu-monster/ingredient-rows';
import { RowMenu } from './row-menu';
import { AddMealMenu } from './add-meal-menu';
import { mealsToAdd } from '@/lib/menu-monster/menu-search';
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
  /** What the page says about who is looking (menu name credit, copy, review note…); replaces the read-only line. */
  aside?: ReactNode;
  /** Where the menu is kept. Omitted = the signed-in scout's saved menu (server). */
  store?: MenuStore;
  /** The title's heading level: the hub shows this under the page's own h1. */
  titleAs?: 'h1' | 'h2';
  /** A meal to open on load (?meal=, the old meal-page links redirect here). */
  openMeal?: string | null;
  /** The troop's patrol names, as suggestions for the Patrol field (release 5). */
  patrols?: readonly string[];
}

export function PlanTab({ catalog: catalogProp, menuId, menu: initial, updatedAt, outings, tabs, readOnly = false, plannedBy = null, aside, store: storeProp, titleAs: Title = 'h1', openMeal = null, patrols = [] }: PlanTabProps) {
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
  const [status, setStatus] = useState('');
  /** Meals open inline (all closed on load, unless ?meal= names one). */
  const [openMeals, setOpenMeals] = useState<ReadonlySet<string>>(() => new Set(openMeal && initial.meals.some((m) => m.id === openMeal) ? [openMeal] : []));
  const [view, setView] = useState<AmountView>('total');
  // Release C: ingredients the scout typed in on this page, until the next load brings them in the catalog.
  const [typed, setTyped] = useState<NewIngredient[]>([]);
  // Release 3: brands typed on this page join the troop's list at once; until the next load they ride here.
  const [typedBrands, setTypedBrands] = useState<Brand[]>([]);
  const catalog = useMemo(() => {
    const withTyped = overlayNewIngredients(catalogProp, typed);
    const have = new Set((withTyped.brands ?? []).map((b) => b.id));
    const fresh = typedBrands.filter((b) => !have.has(b.id));
    return fresh.length > 0 ? { ...withTyped, brands: [...(withTyped.brands ?? []), ...fresh] } : withTyped;
  }, [catalogProp, typed, typedBrands]);
  /** The meal "Add a meal" just created: its panel takes focus into its search, once. */
  const [focusMeal, setFocusMeal] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const linked = outings.find((o) => o.id === menu.calendarEntryId) ?? null;
  const days = menu.dayCount;

  const draftKey = JSON.stringify(menu);
  const dirty = draftKey !== saved.key;
  const cost = menuCost(menu, catalog);
  // The menu's priced lines by ingredient: a brand chooser shows each brand's package count from here.
  const lineByIng = useMemo(() => new Map(buildMenuList(menu, catalog).lines.map((l) => [l.ing.id, l])), [menu, catalog]);
  const priced = menu.meals.some((m) => m.recipeIds.length > 0);
  const budget = budgetState({ perSpent: cost.perPersonMeal }, menu.budgetPerPersonMeal);

  useLeaveGuard(dirty && !readOnly);

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
  const openMeal$ = (id: string) => setOpenMeals((cur) => new Set(cur).add(id));
  const toggleMeal = (id: string) =>
    setOpenMeals((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  /** The brands for one ingredient, for the whole menu (an empty list = any brand: the key goes away). */
  const setBrands = (ingredientId: string, picks: BrandPick[]) =>
    edit((m) => {
      const brands = { ...(m.shopping.brands ?? {}) };
      if (picks.length > 0) brands[ingredientId] = picks;
      else delete brands[ingredientId];
      const { brands: _old, ...rest } = m.shopping;
      void _old;
      // A count typed for the old package choice is not the new brands' count.
      const qtyOverride = { ...rest.qtyOverride };
      delete qtyOverride[ingredientId];
      const next = { ...rest, qtyOverride };
      return { ...m, shopping: Object.keys(brands).length > 0 ? { ...next, brands } : next };
    });
  const typeBrand = async (ingredientId: string, name: string) => {
    const res = await addBrandAction(ingredientId, name);
    if (res.ok) setTypedBrands((cur) => [...cur.filter((b) => b.id !== res.brand.id), res.brand]);
    return res;
  };
  /** A meal panel's change: the whole next meal, into the one draft. */
  const setMeal = (next: MenuMeal) => edit((m) => ({ ...m, meals: m.meals.map((x) => (x.id === next.id ? next : x)) }));
  /** A meal's own People (on its line): the menu's number is stored as null, so going back to it is not a change. */
  const setMealPeople = (meal: MenuMeal, n: number) => {
    const v = Math.min(MAX_HEADCOUNT, Math.max(MIN_HEADCOUNT, Math.round(n) || MIN_HEADCOUNT));
    setMeal({ ...meal, headcount: v === menu.headcount ? null : v });
  };
  /** "Add a meal": an empty meal for the slot, opened inline with focus in its search. */
  const addMeal = (day: number, slot: Plan['meal']) => {
    if (menu.meals.length >= MAX_MENU_MEALS || menu.meals.some((m) => m.day === day && m.slot === slot)) return;
    const meal: MenuMeal = { id: newId(), day, slot, headcount: null, recipeIds: [], recipeEdits: {} };
    edit((m) => ({ ...m, meals: [...m.meals, meal] }));
    openMeal$(meal.id);
    setFocusMeal(meal.id);
    setStatus(`${slotLabel(slot)} added to Day ${day + 1}.`);
  };
  /** The row (and its focused ⋯) goes away: focus moves to the day's "Add a meal" (a removal always leaves it room). */
  const removeMeal = (id: string, day: number) => {
    edit((m) => ({ ...m, meals: m.meals.filter((x) => x.id !== id) }));
    requestAnimationFrame(() => document.getElementById(`mm-add-${day}`)?.focus());
  };
  const addDay = () => edit((m) => ({ ...m, dayCount: Math.min(MAX_MENU_DAYS, m.dayCount + 1) }));
  const removeLastDay = () => edit((m) => ({ ...m, dayCount: Math.max(1, m.dayCount - 1) }));

  /* ---- Save ---- */
  async function save(): Promise<boolean> {
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
    if (isNew && 'id' in res) {
      // The page is replaced by the saved menu's own URL; the first open meal stays open there.
      const href = store.afterCreate(res.id, [...openMeals][0]);
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
    return true;
  }

  function discard() {
    setMenu(saved.menu);
    setNameError(null);
    setError(null);
  }

  // Release C typed-ins and 4C "Share this version" belong to a signed-in scout's saved menu.
  const canTypeIn = !storeProp && menuId != null && !readOnly;
  // A typed brand needs a signed-in person to add it; a menu kept on this computer can still choose known brands.
  const canTypeBrand = !storeProp && !readOnly;
  const shareVersionMenuId = canSave && !storeProp && menuId != null && !isNew && !dirty ? menuId : null;
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
      {aside ?? (readOnly && <ReadOnlyLine plannedBy={plannedBy} />)}
      {tabs != null && <div className={s.tabs}>{tabs}</div>}

      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}

      {readOnly ? (
        <section className={s.basics} aria-label="Menu basics">
          <p className={s.foot}>{[MENU_CONTEXTS.find((c) => c.key === menu.context)?.label ?? menu.context, linked?.title, menu.patrol].filter(Boolean).join(' · ')}</p>
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
          <Field label="Patrol">
            <TextInput
              value={menu.patrol ?? ''}
              maxLength={MAX_PATROL_NAME}
              autoComplete="off"
              list="mm-patrols"
              onChange={(e) =>
                edit((m) => {
                  const { patrol: _old, ...rest } = m;
                  void _old;
                  return e.target.value.trim() ? { ...rest, patrol: e.target.value } : rest;
                })
              }
            />
            <datalist id="mm-patrols">
              {patrols.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
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
            <div className={s.secHead}>
              <h2 id="mm-meals-h" className={s.heading}>
                Meals
              </h2>
              <div className={s.seg} role="group" aria-label="Show amounts as">
                {(
                  [
                    ['total', 'Total to buy'],
                    ['person', 'Per person']
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} type="button" className={s.segBtn} aria-pressed={view === k} onClick={() => setView(k)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className={status ? s.statusLine : s.srOnly} aria-live="polite">
              {status}
            </p>
            {Array.from({ length: days }, (_, d) => {
              const meals = menu.meals.filter((m) => m.day === d).sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot));
              const removable = d === days - 1 && days > 1 && meals.length === 0;
              const toAdd = mealsToAdd(menu, d);
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
                      const open = openMeals.has(meal.id);
                      const panel = `mm-meal-${meal.id}`;
                      const mealCost = cost.byMeal[meal.id] ?? 0;
                      const people = meal.headcount ?? menu.headcount;
                      const title = mealTitle(menu.startDate, meal.day, meal.slot);
                      return (
                        <li key={meal.id} className={s.row}>
                          <div className={s.rowMain}>
                            <button
                              type="button"
                              className={s.rowName}
                              aria-label={`${label}, ${dayLabel(menu.startDate, d)}`}
                              aria-expanded={open}
                              aria-controls={open ? panel : undefined}
                              onClick={() => toggleMeal(meal.id)}
                            >
                              {label}
                              <span className={s.chev} aria-hidden="true">
                                ›
                              </span>
                            </button>
                            {!open && <span className={s.meta}>{names.length ? names.join(', ') : 'Nothing yet'}</span>}
                          </div>
                          {/* Breakfast · [dialer] · $ (Patrick, 2026-10-03): the meal's People on its own line, not inside the panel. */}
                          {readOnly ? (
                            <span className={s.meta}>{people} people</span>
                          ) : (
                            <span className={s.mealPeople}>
                              {people !== menu.headcount && (
                                <Button variant="ghost" onClick={() => setMealPeople(meal, menu.headcount)}>
                                  Reset to {menu.headcount}
                                </Button>
                              )}
                              <Stepper
                                id={`mm-people-${meal.id}`}
                                value={people}
                                min={MIN_HEADCOUNT}
                                max={MAX_HEADCOUNT}
                                onChange={(n) => setMealPeople(meal, n)}
                                groupLabel={`${title} people`}
                                inputLabel={`${title} people`}
                                lessLabel="One fewer person"
                                moreLabel="One more person"
                              />
                            </span>
                          )}
                          <div className={s.cost}>{meal.recipeIds.length ? money(view === 'total' ? mealCost : mealCost / (meal.headcount ?? menu.headcount)) : ''}</div>
                          {!readOnly && (
                            <RowMenu label={`More for Day ${d + 1} ${label.toLowerCase()}`} items={[{ label: 'Remove meal', danger: true, onSelect: () => removeMeal(meal.id, d) }]} />
                          )}
                          {open && (
                            <div id={panel} className={s.inset}>
                              <MealPanel
                                catalog={catalog}
                                menu={menu}
                                meal={meal}
                                view={view}
                                readOnly={readOnly}
                                onChange={setMeal}
                                canTypeIn={canTypeIn}
                                onTyped={(n) => setTyped((t) => [...t, n])}
                                shareVersionMenuId={shareVersionMenuId}
                                autoFocusAdd={meal.id === focusMeal}
                                onBrands={readOnly ? undefined : setBrands}
                                lineFor={(id) => lineByIng.get(id)}
                                onTypeBrand={canTypeBrand ? typeBrand : undefined}
                                onSuggestBrand={canTypeBrand ? suggestRecipeBrandAction : undefined}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                    {!readOnly && toAdd.slots.length > 0 && (
                      <li className={s.addRow}>
                        <AddMealMenu id={`mm-add-${d}`} dayName={dayLabel(menu.startDate, d)} slots={toAdd.slots} full={toAdd.full} onPick={(slot) => addMeal(d, slot)} />
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
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

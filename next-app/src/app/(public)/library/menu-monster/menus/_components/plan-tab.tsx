'use client';

/**
 * The Plan tab of a scout's menu (Plans/Menu-Monster-Scout-Workspace.md,
 * Phase 1; prototype concept-e-scout-workspace/editor.html, v5).
 *
 * Title line: the h1 is the live menu name + Save / Discard (the public
 * save-button standard — dirty-gated, "Saved" when clean, a new menu's first
 * save is "Save menu"). Two screens edit this ONE draft (2026-10-06, planner flow): `page="people"` is the
 * Who's eating step (whos-eating.tsx: name, where you're cooking, outing, patrol, dialers, budget — always
 * open; PeopleTab), `page="meals"` the Meals step below. Each screen is its own page with its own Save, like
 * Plan and Shopping. Meals: one list card per day, one row per meal; a
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

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { priceText as money } from '@/lib/menu-monster/units';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import type { Brand, BrandPick, Catalog, Package, Plan, Recipe, RestrictionKey } from '@/lib/menu-monster/types';
import { MEALS } from '@/lib/menu-monster/units';
import { MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import { MAX_MENU_DAYS, MAX_MENU_MEALS, MAX_MENU_NAME, menuNameError, type Menu, type MenuContext, type MenuMeal } from '@/lib/menu-monster/menus';
import { standardMeals } from '@/lib/menu-monster/menu-prefill';
import { DIET_ORDER, budgetState, buildMenuList, dayLabel, mealTitle, mealUnpricedItems, menuCost, outingDayCount, planProgress, type Outing } from '@/lib/menu-monster/menu-view';
import { addBrandAction, suggestRecipeBrandAction } from '../../../_tools/menu-monster/brand-actions';
import type { CreateResult, MenuStore, SaveResult } from '@/lib/menu-monster/menu-store';
import { serverMenuStore } from './server-menu-store';
import { MealPanel } from './meal-panel';
import type { AddedPackage } from './add-package-form';
import { settleNewBrands } from '@/lib/menu-monster/brand-detail';
import { withoutMealGear, type GearItem } from '@/lib/menu-monster/gear';
import { overlayNewIngredients, type NewIngredient } from '@/lib/menu-monster/scout-ingredients';
import { overlayNewRecipes } from '@/lib/menu-monster/single-food';
import type { AmountView } from '@/lib/menu-monster/ingredient-rows';
import { RowMenu } from './row-menu';
import { MealPeople } from './meal-people';
import { AddMealMenu } from './add-meal-menu';
import { WhosEatingForm, WhosEatingReadOnly } from './whos-eating';
import { ScoutOptions, type ScoutOption } from './scout-options';
import { mealsToAdd } from '@/lib/menu-monster/menu-search';
import { ReadOnlyLine } from './read-only-line';
import { SaveBar } from './save-bar';
import { StepStrip, type StepStripConfig } from './step-strip';
import { SummaryRail } from './summary-rail';
import type { DraftItem } from '@/lib/menu-monster/draft-items';
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
  /** Which screen of the planner this is: the Meals step (the default) or the Who's eating step (PeopleTab). Both edit the same menu draft. */
  page?: 'meals' | 'people';
  /** The Plan / Shopping tab strip, rendered under the title line. */
  tabs?: ReactNode;
  /** A leader's view of a scout's menu: shown as text, nothing edits or saves. */
  readOnly?: boolean;
  /** Credit name of the scout who planned it (read-only view). */
  plannedBy?: string | null;
  /** A leader working on someone else's menu: everything saves as the owner's menu, and a new ingredient
   *  typed here is filed under the owner (HelperMenu). Only "Share this version as a new recipe" is held
   *  back — that recipe would be the leader's, not the scout's. */
  helper?: boolean;
  /** What the page says about who is looking (menu name credit, copy, review note…); replaces the read-only line. */
  aside?: ReactNode;
  /** Where the menu is kept. Omitted = the signed-in scout's saved menu (server). */
  store?: MenuStore;
  /** The title's heading level: the hub shows this under the page's own h1. */
  titleAs?: 'h1' | 'h2';
  /** A meal to open on load (?meal=, the old meal-page links redirect here). */
  openMeal?: string | null;
  /** The step strip's routes (a saved menu's own pages); its ticks come from this draft. Omitted = `tabs`, or nothing. */
  steps?: StepStripConfig;
  /** Show only this meal, as its own page (Patrick, 2026-10-06, decision 1): its own Save / Cancel and a way back to the meals. */
  mealOnly?: string | null;
  /** The troop's patrol names, as suggestions for the Patrol field (release 5). */
  patrols?: readonly string[];
  /** The troop's gear list (not retired) for each meal's "More gear for this meal" picker. Absent = no picker (a menu kept on this computer, a read-only view). */
  gearList?: readonly GearItem[];
  /** The signed-in scout's own patrol: a NEW menu's Patrol field starts there (guideline 5). Absent = nothing to default to. */
  myPatrol?: string | null;
  /** The troop's DRAFT items (names only), for a meal search that finds nothing to say a draft has that name. Absent = not said (a read-only view). */
  draftItems?: readonly DraftItem[];
  /** The viewer has admin access (a leader): a draft's name links to its admin recipe page. */
  adminLinks?: boolean;
  /** The scouts on the menu's Planned by, by name (the loader attaches names; the draft carries ids in menu.plannedBy). */
  planners?: readonly ScoutOption[];
}

export function PlanTab({ catalog: catalogProp, menuId, menu: initial, updatedAt, outings, page = 'meals', tabs, readOnly = false, helper = false, plannedBy = null, aside, store: storeProp, titleAs: Title = 'h1', openMeal = null, steps, mealOnly = null, patrols = [], gearList, myPatrol = null, draftItems, adminLinks = false, planners = [] }: PlanTabProps) {
  const router = useRouter();
  const store = useMemo(() => storeProp ?? serverMenuStore(menuId), [storeProp, menuId]);
  const { canSave } = store.caps;
  const [isNew, setIsNew] = useState(menuId === null);
  // A scout's new menu starts with their own patrol; a saved menu's patrol (or none) is theirs to leave as it is.
  const start: Menu = menuId === null && myPatrol && !initial.patrol ? { ...initial, patrol: myPatrol } : initial;
  const [menu, setMenu] = useState<Menu>(start);
  const [saved, setSaved] = useState<{ menu: Menu; key: string }>(() => ({ menu: start, key: JSON.stringify(start) }));
  const contextTouched = useRef(false);
  const [version, setVersion] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  /** Meals open inline (all closed on load, unless ?meal= names one). */
  const [openMeals, setOpenMeals] = useState<ReadonlySet<string>>(() => new Set(openMeal && initial.meals.some((m) => m.id === openMeal) ? [openMeal] : []));
  const [view, setView] = useState<AmountView>('total');
  // A link to #meal-<id> (the rail's "3 meals empty", the meal page's way back) opens that meal's row.
  useEffect(() => {
    const go = () => {
      const m = /^#meal-(.+)$/.exec(window.location.hash);
      if (!m) return;
      const id = decodeURIComponent(m[1]);
      setOpenMeals((cur) => new Set(cur).add(id));
      requestAnimationFrame(() => document.getElementById(`meal-${id}`)?.scrollIntoView?.());
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);
  // Release C: ingredients the scout typed in on this page, until the next load brings them in the catalog.
  const [typed, setTyped] = useState<NewIngredient[]>([]);
  // Release 3: brands typed on this page join the troop's list at once; until the next load they ride here.
  const [typedBrands, setTypedBrands] = useState<Brand[]>([]);
  // Foods added on the fly from a meal: their menu items ride here too.
  const [madeRecipes, setMadeRecipes] = useState<Recipe[]>([]);
  // Packages priced from a meal's "No price yet" badge ride here the same way.
  const [addedPackages, setAddedPackages] = useState<Package[]>([]);
  const catalog = useMemo(() => {
    const withTyped = overlayNewRecipes(overlayNewIngredients(catalogProp, typed), madeRecipes);
    const have = new Set((withTyped.brands ?? []).map((b) => b.id));
    const fresh = typedBrands.filter((b) => !have.has(b.id));
    const withBrands = fresh.length > 0 ? { ...withTyped, brands: [...(withTyped.brands ?? []), ...fresh] } : withTyped;
    const haveP = new Set(withBrands.packages.map((p) => p.id));
    const freshP = addedPackages.filter((p) => !haveP.has(p.id));
    return settleNewBrands(freshP.length > 0 ? { ...withBrands, packages: [...withBrands.packages, ...freshP] } : withBrands);
  }, [catalogProp, typed, madeRecipes, typedBrands, addedPackages]);
  /** The meal "Add a meal" just created: its panel takes focus into its search, once. */
  const [focusMeal, setFocusMeal] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const days = menu.dayCount;
  const onPeople = page === 'people';

  const draftKey = JSON.stringify(menu);
  const dirty = draftKey !== saved.key;
  const cost = menuCost(menu, catalog);
  // The menu's priced lines by ingredient: a brand chooser shows each brand's package count from here.
  const list = useMemo(() => buildMenuList(menu, catalog), [menu, catalog]);
  const lineByIng = useMemo(() => new Map(list.lines.map((l) => [l.ing.id, l])), [list]);
  // The rail and the step ticks read the DRAFT (what is on screen), not the saved menu.
  const progress = useMemo(() => planProgress(menu, catalog, { list }), [menu, catalog, list]);
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
  const setPatrol = (value: string) =>
    edit((m) => {
      const { patrol: _old, ...rest } = m;
      void _old;
      return value.trim() ? { ...rest, patrol: value } : rest;
    });
  // A menu kept on this computer has no roster: no Planned by field.
  const scoutOptions = useContext(ScoutOptions);
  const setPlannedBy = (ids: number[]) => edit((m) => ({ ...m, plannedBy: ids }));
  const setContext = (context: MenuContext) => {
    contextTouched.current = true;
    edit((m) => ({ ...m, context }));
  };
  const setOuting = (value: string) => {
    const outing = outings.find((o) => String(o.id) === value);
    if (!outing) {
      edit((m) => ({ ...m, calendarEntryId: null }));
      return;
    }
    // An outing is a camp trip: a new menu whose context nobody has chosen yet takes Camp (guideline 5).
    const campByDefault = isNew && !contextTouched.current;
    edit((m) => ({
      ...m,
      context: campByDefault ? 'camp' : m.context,
      calendarEntryId: outing.id,
      startDate: outing.startDate,
      // An empty menu takes the outing's span and its standard meals (empty, no headcount); one with meals keeps both.
      ...(m.meals.length === 0 ? { dayCount: outingDayCount(outing), meals: standardMeals(outing, newId) } : {}),
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
  /** A package priced from a meal joins the catalog at once; when the food already had a price it is also picked, as on Shopping. */
  const packageAdded = (ingredientId: string, { pkg, status: st }: AddedPackage) => {
    if (st !== 'same') setAddedPackages((cur) => [...cur, pkg]);
    const rec = lineByIng.get(ingredientId)?.rec;
    if (!rec || rec.id === pkg.id) return;
    edit((m) => {
      const qtyOverride = { ...m.shopping.qtyOverride };
      delete qtyOverride[ingredientId];
      return { ...m, shopping: { ...m.shopping, packageChoice: { ...m.shopping.packageChoice, [ingredientId]: pkg.id }, qtyOverride } };
    });
  };
  /** A size and price saved for a brand from the chooser's dialog: the package joins the catalog (the brand stops being New). It is not picked as the food's package. */
  const brandPackageAdded = (_ingredientId: string, { pkg, status: st }: AddedPackage) => {
    if (st !== 'same') setAddedPackages((cur) => [...cur, pkg]);
  };
  const typeBrand = async (ingredientId: string, name: string) => {
    const res = await addBrandAction(ingredientId, name, menuId ?? undefined);
    if (res.ok) setTypedBrands((cur) => [...cur.filter((b) => b.id !== res.brand.id), res.brand]);
    return res;
  };
  /** A meal panel's change: the whole next meal, into the one draft. */
  const setMeal = (next: MenuMeal) => edit((m) => ({ ...m, meals: m.meals.map((x) => (x.id === next.id ? next : x)) }));
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

  /** On a phone a saved, unedited menu opens a meal as its own page; everywhere else it opens inline. */
  const canOpenPage = !storeProp && menuId != null && !isNew && !dirty;
  const onRowName = (id: string, isOpen: boolean) => {
    if (canOpenPage && !isOpen && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches) {
      router.push(store.hrefs.meal(id));
      return;
    }
    toggleMeal(id);
  };

  /* ---- Save ---- */
  async function save(): Promise<boolean> {
    const bad = menuNameError(menu.name);
    if (bad) {
      setNameError(bad);
      // The name field lives on the Who's eating screen: there it takes focus; on the meals screen the error says so.
      if (onPeople) nameRef.current?.focus();
      else setError(`${bad} It is on the Who’s eating step.`);
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
    // Gear is picked from the troop's list; a name the server did not keep comes off the draft too, and is said.
    const dropped = res.dropped ?? [];
    const kept = dropped.length > 0 ? withoutMealGear(sent, dropped) : sent;
    setSaved({ menu: kept, key: JSON.stringify(kept) });
    if (dropped.length > 0) {
      setMenu((cur) => withoutMealGear(cur, dropped));
      setError(`Not on the gear list, so not kept: ${dropped.join(', ')}.`);
    }
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
  const shareVersionMenuId = canSave && !storeProp && menuId != null && !isNew && !dirty && !helper ? menuId : null;
  // The foods a total leaves out, by meal, with their ids: "N not priced" and "No price yet" link to that item's Shopping row.
  const unpricedItems = useMemo(
    () => Object.fromEntries(menu.meals.map((m) => [m.id, [...new Map(Object.values(mealUnpricedItems(menu, m, catalog)).flat().map((i) => [i.id, i])).values()]])),
    [menu, catalog]
  );
  // Only where the Shopping tab can answer it: a saved menu the viewer can edit, kept on the server.
  const fixHref = !readOnly && !isNew && store.caps.canReport ? (ingredientId: string) => `${store.hrefs.shopping}?item=${encodeURIComponent(ingredientId)}` : null;

  const panelFor = (meal: MenuMeal, onRow = false) => (
    <MealPanel
      catalog={catalog}
      menu={menu}
      meal={meal}
      view={view}
      readOnly={readOnly}
      gearList={gearList}
      peopleInHeader={onRow}
      draftItems={draftItems}
      adminLinks={adminLinks}
      onPackageAdded={fixHref ? packageAdded : undefined}
      onChange={setMeal}
      canTypeIn={canTypeIn}
      onTyped={(n) => setTyped((t) => [...t, n])}
      onNewRecipe={(r) => setMadeRecipes((c) => [...c, r])}
      shareVersionMenuId={shareVersionMenuId}
      autoFocusAdd={meal.id === focusMeal}
      onBrands={readOnly ? undefined : setBrands}
      lineFor={(id) => lineByIng.get(id)}
      onTypeBrand={canTypeBrand ? typeBrand : undefined}
      onBrandPackage={canTypeBrand ? brandPackageAdded : undefined}
      // A recipe's suggested brand is its author's to set: not offered to a leader on the scout's menu (qa-lead).
      onSuggestBrand={canTypeBrand && !helper ? suggestRecipeBrandAction : undefined}
    />
  );
  // A menu not saved yet has no pages of its own to link to: its rail rows that need one are plain text.
  const peopleHref = store.hrefs.people ?? store.hrefs.plan;
  const railHrefs = { people: isNew ? null : peopleHref, plan: isNew ? '' : store.hrefs.plan, gear: isNew ? null : (store.hrefs.gear ?? null), shopping: isNew ? null : store.hrefs.shopping };
  // Who's eating is followed by Meals; Meals by Gear on a saved menu (a menu kept on this computer has no Gear page, so Shopping).
  const nextStep = isNew
    ? undefined
    : onPeople
      ? { label: 'Next: Meals ›', href: store.hrefs.plan }
      : store.hrefs.gear
        ? { label: 'Next: Gear ›', href: store.hrefs.gear }
        : { label: 'Next: Shopping ›', href: store.hrefs.shopping };
  const rail = (extra?: { next?: { label: string; href: string }; labels?: { discard?: string }; onDiscard?: () => void }) => (
    <SummaryRail progress={progress} hrefs={railHrefs} unsaved={dirty && !readOnly}>
      {readOnly ? (
        nextStep && (
          <Button variant="primary" href={extra?.next?.href ?? nextStep.href}>
            {extra?.next?.label ?? nextStep.label}
          </Button>
        )
      ) : (
        <SaveBar
          isNew={isNew}
          newLabel={canSave ? undefined : 'Save on this computer'}
          labels={canSave ? { discard: extra?.labels?.discard } : { clean: 'Saved on this computer', discard: extra?.labels?.discard }}
          dirty={dirty}
          saving={saving}
          saved={justSaved}
          onSave={() => void save()}
          onDiscard={extra?.onDiscard ?? discard}
          next={extra?.next ?? nextStep}
        />
      )}
    </SummaryRail>
  );

  if (mealOnly != null) {
    const target = menu.meals.find((m) => m.id === mealOnly);
    const back = `${store.hrefs.plan}#meal-${mealOnly}`;
    if (!target) {
      return (
        <p className={s.foot}>
          That meal is not on this menu.{' '}
          <Link className={s.link} href={store.hrefs.plan}>
            Back to meals
          </Link>
        </p>
      );
    }
    return (
      <div>
        {rail({
          next: { label: 'Done', href: back },
          labels: { discard: 'Cancel' },
          // Cancel throws this meal's edits away and goes back; Back (the link) asks first when there are unsaved edits.
          onDiscard: () => {
            discard();
            router.push(back);
          }
        })}
        <p className={s.backLine}>
          <Link className={s.link} href={back}>
            ← Back to meals
          </Link>
        </p>
        <div className={s.titleLine}>
          <Title className={s.menuTitle}>{mealTitle(menu.startDate, target.day, target.slot)}</Title>
        </div>
        {aside ?? (readOnly && <ReadOnlyLine plannedBy={plannedBy} />)}
        {error && (
          <Notice tone="error" className={s.notice}>
            {error}
          </Notice>
        )}
        <p className={status ? s.statusLine : s.srOnly} aria-live="polite">
          {status}
        </p>
        <div className={s.mealPage}>{panelFor(target)}</div>
      </div>
    );
  }

  return (
    <div>
      {rail()}
      <div className={s.titleLine}>
        <Title className={s.menuTitle}>{menu.name.trim() || (isNew ? 'New menu' : 'Untitled menu')}</Title>
        {priced && !onPeople && (
          <p className={s.shopLine} role="status" aria-label="Shopping summary">
            <strong>{money(cost.total)}</strong> <span className={s.muted}>· {money(cost.perPersonMeal)} a person per meal ·</span>{' '}
            <span aria-hidden="true">{budget.icon}</span> {budget.msg}
          </p>
        )}
      </div>
      {aside ?? (readOnly && <ReadOnlyLine plannedBy={plannedBy} />)}
      {steps ? <StepStrip config={steps} done={{ eating: progress.steps.eating.done, meals: progress.steps.meals.done, gear: progress.steps.gear.done, shopping: progress.steps.shopping.done }} current={onPeople ? 'eating' : 'meals'} /> : tabs != null && <div className={s.tabs}>{tabs}</div>}

      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}

      {onPeople &&
        (readOnly ? (
          <WhosEatingReadOnly menu={menu} outings={outings} planners={planners} />
        ) : (
          <WhosEatingForm
            menu={menu}
            outings={outings}
            patrols={patrols}
            nameError={nameError}
            nameRef={nameRef}
            onName={setName}
            onContext={setContext}
            onOuting={setOuting}
            onPatrol={setPatrol}
            onHeadcount={setHeadcount}
            onDiet={setDiet}
            onBudget={(n) => edit((m) => ({ ...m, budgetPerPersonMeal: n }))}
            scoutOptions={storeProp ? [] : scoutOptions}
            planners={planners}
            onPlannedBy={storeProp ? undefined : setPlannedBy}
          />
        ))}

      {!onPeople && (
      <>
          <section id="meals" className={s.anchor} aria-labelledby="mm-meals-h">
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
                      <RowMenu label={`More for Day ${d + 1}`} items={[{ label: 'Remove', danger: true, onSelect: removeLastDay }]} />
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
                      const noPrice = unpricedItems[meal.id] ?? [];
                      const people = meal.headcount ?? menu.headcount;
                      return (
                        <li key={meal.id} id={`meal-${meal.id}`} className={`${s.row} ${s.anchor}`}>
                          <div className={s.rowMain}>
                            <button
                              type="button"
                              className={s.rowName}
                              aria-label={`${label}, ${dayLabel(menu.startDate, d)}`}
                              aria-expanded={open}
                              aria-controls={open ? panel : undefined}
                              onClick={() => onRowName(meal.id, open)}
                            >
                              {label}
                              <span className={s.chev} aria-hidden="true">
                                ›
                              </span>
                            </button>
                            {!open && <span className={s.meta}>{names.length ? names.join(', ') : 'Nothing yet'}</span>}
                          </div>
                          {/* The meal's own People sits on the slot's line (Patrick, 2026-10-07); a viewer reads it as text. */}
                          {readOnly ? <span className={s.meta}>{people} people</span> : <MealPeople menu={menu} meal={meal} onChange={setMeal} />}
                          {/* The figure beside it leaves these out, so it says so (and which, to a screen reader and on hover). */}
                          {noPrice.length > 0 &&
                            (fixHref ? (
                              <Link
                                className={`${s.tag} ${s.tagBtn}`}
                                href={fixHref(noPrice[0].id)}
                                title={noPrice.map((i) => i.name).join(', ')}
                                aria-label={`${noPrice.length === 1 ? '1 not priced' : `${noPrice.length} not priced`}: ${noPrice.map((i) => i.name).join(', ')}. Add a price in Shopping`}
                              >
                                {noPrice.length === 1 ? '1 not priced' : `${noPrice.length} not priced`}
                                <span className={s.srOnly}>: {noPrice.map((i) => i.name).join(', ')}</span>
                              </Link>
                            ) : (
                              <span className={s.tag} title={noPrice.map((i) => i.name).join(', ')}>
                                {noPrice.length === 1 ? '1 not priced' : `${noPrice.length} not priced`}
                                <span className={s.srOnly}>: {noPrice.map((i) => i.name).join(', ')}</span>
                              </span>
                            ))}
                          <div className={s.cost}>{meal.recipeIds.length ? money(view === 'total' ? mealCost : mealCost / (meal.headcount ?? menu.headcount)) : ''}</div>
                          {!readOnly && (
                            <RowMenu label={`More for Day ${d + 1} ${label.toLowerCase()}`} items={[{ label: 'Remove', danger: true, onSelect: () => removeMeal(meal.id, d) }]} />
                          )}
                          {open && (
                            <div id={panel} className={s.inset}>
                              {panelFor(meal, true)}
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

          {priced && cost.unpriced.length > 0 && (
            <p className={s.foot} role="status">
              Not counting {cost.unpriced.length === 1 ? '1 food' : `${cost.unpriced.length} foods`} with no price yet: {cost.unpriced.join(', ')}.
            </p>
          )}
      </>
      )}
    </div>
  );
}

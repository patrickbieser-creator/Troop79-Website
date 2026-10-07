'use client';

/**
 * One meal, open inline on the Plan tab (Plans/Menu-Monster-Scout-Workspace.md,
 * "Meals inline on the Plan tab" — Patrick, 2026-10-03: the separate meal page
 * was too many clicks). Clicking a meal's name on the Plan tab opens this panel
 * under it; it was the meal page:
 *
 *   - one quiet row per recipe: its name is a disclosure that opens the recipe's
 *     ingredient list — the menu's OWN version of it (IngredientList, menu-edit
 *     mode: change an amount, swap, leave out, add — typed-ins too), the recipe's
 *     share of the meal in the right column, a ⋯ with Swap…, Back to the
 *     troop's version, Share this version as a new recipe, and Remove;
 *   - a dashed search at the end adds a recipe that fits this slot (a combobox +
 *     listbox, fully keyboard-operable; "Swap X for…" while swapping). The list
 *     always ends in "Browse all recipes…": the Food & Recipes popup for this
 *     meal (the only way to add food — the day's control adds meals, 2026-10-03);
 *   - the meal's People dialer at the top (2026-10-06, guideline 6: a meal's own headcount is a detail of that meal; its
 *     Plan-tab row says "6 people" only when it differs from the menu's);
 *   - its own status line — what just happened, Undo after a remove or swap;
 *   - a quiet warning under a recipe that isn't for someone the menu counts
 *     (ported from the retired planner: unsuitable, or gluten / nuts with no swap),
 *     with the answer beside it (Patrick, 2026-10-06; "a badge is never a dead end"):
 *     "Swap bread for gluten-free scouts…" / "Leave bread out for gluten-free scouts"
 *     — a diet-scoped op on this meal's version, which clears the warning.
 * The meal's cost is the Plan tab row's right column (Jenna, 2026-10-03: no
 * footer repeating it).
 *
 * Controlled: the meal lives in the Plan tab's ONE draft (one Save / Discard on
 * the title line, the save standard). Every change goes up through `onChange`
 * as the whole next meal; this panel keeps only its own UI state (which recipe
 * is open, the search, the swap). The Total to buy / Per person switch is the
 * Plan tab's, passed in as `view`.
 *
 * `readOnly`: no People dialer (the row says it), recipes opening to plain ingredient rows, and no
 * ⋯ menus, search or Undo.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { MEALS, RESTRICTION_BY_KEY, priceText as money } from '@/lib/menu-monster/units';
import { Button } from '@/app/_components/button';
import { NumberBox } from '@/app/_components/stepper';
import { Notice } from '@/app/_components/notice';
import type { Brand, BrandPick, Catalog, Plan, Recipe, ShoppingLine } from '@/lib/menu-monster/types';
import { BrandChooser, brandSummary } from './brand-chooser';
import { MAX_HEADCOUNT, MIN_HEADCOUNT, effectiveRestrictions, livePicks, recipeSuggestions, recipesForMeal, restrictionWarnings } from '@/lib/menu-monster/engine';
import type { RestrictionKey } from '@/lib/menu-monster/types';
import { isPickable, stepsFromText } from '@/lib/menu-monster/scout-recipes';
import { authoringOf, isSingleFood } from '@/lib/menu-monster/authoring';
import { draftsMatching, type DraftItem } from '@/lib/menu-monster/draft-items';
import { gearKey, gearText, mealRecipeGear, parseGear, recipeGear, sortGear, type GearItem } from '@/lib/menu-monster/gear';
import { GearChips, GearPicker } from '../../_components/gear-picker';
import { AddRow } from '../../_components/add-row';
import { RECIPES_HREF } from '../../recipes/_components/paths';
import { composePlan, mealCatalog, type EditOp, type Menu, type MenuMeal, type RecipeEdits } from '@/lib/menu-monster/menus';
import { mealTitle, mealUnpricedItems, recipeShares } from '@/lib/menu-monster/menu-view';
import {
  defaultSwapQty,
  menuEditRows,
  opsWithAdded,
  opsWithAmount,
  opsWithLeaveOut,
  opsWithSwap,
  opsWithoutAdded,
  opsWithoutOp,
  type AmountView
} from '@/lib/menu-monster/ingredient-rows';
import type { NewIngredient } from '@/lib/menu-monster/scout-ingredients';
import { MenuNewIngredient } from './menu-new-ingredient';
import { MealNewFood, type FoodAdded } from './meal-new-food';
import { IngredientList, type RowAction } from '../../_components/ingredient-list';
import type { ListIntent } from '../../_components/ingredient-list-edit';
import { RowMenu } from './row-menu';
import { AddPackageForm, type AddedPackage } from './add-package-form';
import { RecipeLibraryDialog } from './recipe-library-dialog';
import s from './workspace.module.css';

/** The part of a meal a remove, swap or "back to the troop recipe" can undo. */
type UndoPoint = Pick<MenuMeal, 'recipeIds' | 'recipeEdits'>;

interface Status {
  text: string;
  undoTo: UndoPoint | null;
  /** Hand focus to Undo: a remove leaves nothing else focused. */
  focusUndo?: boolean;
}

export interface MealPanelProps {
  /** The catalog the menu prices with (the Plan tab's, typed-ins added this visit included). */
  catalog: Catalog;
  /** The menu as drafted now (the meal's people and the diets come from it). */
  menu: Menu;
  meal: MenuMeal;
  view: AmountView;
  readOnly?: boolean;
  /** The troop's gear list (not retired): "More gear for this meal" picks from it. Absent = no picker. */
  gearList?: readonly GearItem[];
  onChange: (next: MenuMeal) => void;
  /** A "No price yet" food is answered in place: the badge opens the add-a-package form under the ingredient, and the
   *  package that lands comes up here (the Plan tab's catalog). Absent = the badge stays plain text (read-only, a new or local menu). */
  onPackageAdded?: (ingredientId: string, a: AddedPackage) => void;
  /** A signed-in scout's saved menu: "Add “x” as a new ingredient" (release C). */
  canTypeIn?: boolean;
  onTyped?: (n: NewIngredient) => void;
  /** A menu item made on the fly ("Add “x” as a new food"): the Plan tab keeps it in the catalog until the next load. */
  onNewRecipe?: (r: Recipe) => void;
  /** Set when "Share this version as a new recipe" may link out: a saved menu, no unsaved changes. */
  shareVersionMenuId?: string | null;
  /** A meal the scout just added ("Add a meal"): focus lands in its search. */
  autoFocusAdd?: boolean;
  /** Release 3 — brands, one set per ingredient for the whole menu: change them (absent = read-only text),
   *  the menu's priced lines by ingredient (for per-brand counts), and adding a typed brand (signed in only). */
  onBrands?: (ingredientId: string, picks: BrandPick[]) => void;
  lineFor?: (ingredientId: string) => ShoppingLine | undefined;
  onTypeBrand?: (ingredientId: string, name: string) => Promise<{ ok: true; brand: Brand } | { ok: false; error: string }>;
  /** Brand detail: a size and price saved for a brand from the chooser's dialog (the Plan tab's catalog takes the package). Absent = brands cannot be sized here. */
  onBrandPackage?: (ingredientId: string, a: AddedPackage) => void;
  /** Release 6 — the recipe's author sets (or with null clears) the brand their recipe suggests. Absent = not offered. */
  onSuggestBrand?: (recipeId: string, ingredientId: string, brandId: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** The troop's DRAFT items (names only): a search that finds nothing says when a draft has the name — the list is published items only. */
  draftItems?: readonly DraftItem[];
  /** The viewer has admin access: a draft's name links to its admin recipe page. */
  adminLinks?: boolean;
}

export function MealPanel({ catalog, menu, meal, view, readOnly = false, gearList, onPackageAdded, onChange, canTypeIn = false, onTyped, onNewRecipe, shareVersionMenuId = null, autoFocusAdd = false, onBrands, lineFor, onTypeBrand, onBrandPackage, onSuggestBrand, draftItems = [], adminLinks = false }: MealPanelProps) {
  /** Suggestions changed this visit ("recipe:ingredient" → brand id, or null for cleared): the catalog prop is as loaded. */
  const [suggested, setSuggested] = useState<Readonly<Record<string, string | null>>>({});
  const uid = useId();
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<Status>({ text: '', undoTo: null });
  const [swapId, setSwapId] = useState<string | null>(null);
  /** What a warning's answer asked a recipe's ingredient list to open (the list is remounted with it, keyed by `n`). */
  const [intent, setIntent] = useState<(ListIntent & { rid: string; n: number }) | null>(null);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  /** The highlighted option; null = the default (the first match, or none when nothing matches). */
  const [active, setActive] = useState<number | null>(null);
  const [browsing, setBrowsing] = useState(false);
  /** The meal's one add row: 'food' | 'gear' open, null resting, undefined = the default (open on a meal with no foods yet). */
  const [rowOpen, setRowOpen] = useState<string | null | undefined>(undefined);
  /** The food typed in the search that the book doesn't have, while its "Add as a new food" panel is open. */
  const [newFood, setNewFood] = useState<string | null>(null);
  /** Brand choosers open in this meal, by `recipe:ingredient` (several stay open together — Patrick, 2026-10-03). */
  const [brandOpen, setBrandOpen] = useState<ReadonlySet<string>>(() => new Set());
  /** The one price form open in this meal: the food it prices, under the recipe whose badge opened it. */
  const [priceOpen, setPriceOpen] = useState<{ rid: string; ingredientId: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const priceRef = useRef<HTMLDivElement>(null);

  // The price form just opened: focus goes to its first field.
  const priceKey = priceOpen ? `${priceOpen.rid}:${priceOpen.ingredientId}` : null;
  useEffect(() => {
    if (priceKey) priceRef.current?.querySelector('input')?.focus();
  }, [priceKey]);

  useEffect(() => {
    if (status.focusUndo) undoRef.current?.focus();
  }, [status]);

  useEffect(() => {
    if (autoFocusAdd) requestAnimationFrame(() => inputRef.current?.focus());
    // Mount only: a just-added meal, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edits = meal.recipeEdits ?? {};
  const plan: Plan = composePlan(menu, meal);
  // Ported from the retired planner: a recipe that isn't for someone the menu counts says so. Measured
  // on the meal's own version (its edits applied), so leaving the ingredient out clears the warning.
  const warnings = restrictionWarnings(plan, mealCatalog(catalog, meal));
  const choices = catalog.ingredients.map((i) => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
  const recipeName = (id: string) => byId.get(id)?.name ?? id;
  // Each recipe's share of the meal (shared packages split), so the rows add up to the footer.
  const shares = recipeShares(menu, meal, catalog);
  // Foods with no price yet, by item: the cost beside an item leaves them out, so the row says so.
  const noPrice = mealUnpricedItems(menu, meal, catalog);
  const costOf = (id: string) => (view === 'total' ? (shares[id] ?? 0) : (shares[id] ?? 0) / plan.headcount);
  // A to Z (Patrick, 2026-10-03): a scout looks a food up by name, not by the leaders' catalog order.
  const candidates = recipesForMeal(catalog, meal.slot)
    .filter((r) => isPickable(r) && !meal.recipeIds.includes(r.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const matches = candidates.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  // A draft is not offered (published items only), but a search for its name says it exists.
  const draftHits = matches.length === 0 ? draftsMatching(draftItems, query, meal.slot) : [];
  // The list always ends in "Browse all recipes…" (the Food & Recipes popup, for this meal); it is never
  // the default, so Enter on a typo does nothing rather than open a popup.
  // "Add “x” as a new food…" sits above Browse when nothing matches what was typed (a signed-in scout's own menu only).
  const addAt = canTypeIn && matches.length === 0 && query.trim() !== '' ? 0 : -1;
  const browseAt = matches.length + (addAt >= 0 ? 1 : 0);
  const act = Math.min(active ?? (matches.length > 0 ? 0 : -1), browseAt);
  const showList = listOpen;
  const addOpen = rowOpen !== undefined ? rowOpen : meal.recipeIds.length === 0 ? 'food' : null;
  const swapping = swapId ? recipeName(swapId) : null;
  // No noun (Patrick, 2026-10-03): the list holds single foods and recipes alike; the results name themselves.
  const addLabel = swapping ? `Swap ${swapping} for` : `Add to ${mealTitle(menu.startDate, meal.day, meal.slot)}`;
  const title = mealTitle(menu.startDate, meal.day, meal.slot);
  const slotWord = (MEALS.find((m) => m.key === meal.slot)?.label ?? meal.slot).toLowerCase();

  const change = (next: Partial<MenuMeal>) => onChange({ ...meal, ...next });
  /** This meal's own People: the menu's number is stored as null, so going back to it is not a change. */
  const setPeople = (n: number) => {
    const v = Math.min(MAX_HEADCOUNT, Math.max(MIN_HEADCOUNT, Math.round(n) || MIN_HEADCOUNT));
    change({ headcount: v === menu.headcount ? null : v });
  };
  // Gear for the meal itself (soap, wash basins), with what its foods already ask for shown beside it.
  const ownGear = meal.gear ?? [];
  const foodGear = mealRecipeGear(meal, catalog);
  /** The master list's description for each gear item, by name key (Patrick, 2026-10-06): a muted line under the item. */
  const gearNotes = gearDescriptions(gearList);

  const toggle = (id: string) => {
    // A closed list forgets what a warning asked it to open, so reopening it later starts plain.
    if (openIds.has(id)) setIntent((cur) => (cur?.rid === id ? null : cur));
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const openList = (id: string) => setOpenIds((cur) => new Set(cur).add(id));

  const clearSearch = () => {
    setQuery('');
    setListOpen(false);
    setActive(null);
  };

  const openBrowse = () => {
    clearSearch();
    setBrowsing(true);
  };
  const closeBrowse = () => {
    setBrowsing(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const openNewFood = () => {
    const typedName = query.trim();
    clearSearch();
    setNewFood(typedName);
  };
  const closeNewFood = () => {
    setNewFood(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const choose = (i: number) => (i === addAt ? openNewFood() : i < matches.length ? pick(matches[i]) : openBrowse());

  const without = (e: RecipeEdits, rid: string): RecipeEdits => {
    const { [rid]: dropped, ...rest } = e;
    void dropped;
    return rest;
  };
  const undoPoint = (): UndoPoint => ({ recipeIds: meal.recipeIds, recipeEdits: edits });

  function remove(id: string) {
    const before = undoPoint();
    // A removed recipe takes this meal's edits to it along (sanitizeMenu would drop them anyway).
    change({ recipeIds: before.recipeIds.filter((x) => x !== id), recipeEdits: without(edits, id) });
    if (before.recipeIds.length === 1) setRowOpen(undefined);
    setStatus({ text: `${recipeName(id)} removed.`, undoTo: before, focusUndo: true });
  }

  /** The recipe's suggested brands become this menu's choice — only where the menu has chosen none yet. */
  function applySuggestions(r: Recipe): string[] {
    if (!onBrands) return [];
    const used: string[] = [];
    for (const [ingredientId, brand] of recipeSuggestions(r, catalog)) {
      if (livePicks(menu.shopping.brands?.[ingredientId], ingredientId, catalog).length > 0) continue;
      onBrands(ingredientId, [{ brandId: brand.id, qty: null }]);
      used.push(brand.name);
    }
    return used;
  }

  /** A food made on the fly joins the meal (or takes the swapped one's place) and is announced. */
  function foodAdded(res: FoodAdded) {
    const before = undoPoint();
    if (res.ingredient) onTyped?.(res.ingredient);
    onNewRecipe?.(res.recipe);
    if (swapId) {
      change({ recipeIds: before.recipeIds.map((x) => (x === swapId ? res.recipe.id : x)), recipeEdits: without(edits, swapId) });
      setSwapId(null);
      setStatus({ text: `Swapped ${recipeName(swapId)} for ${res.name}.`, undoTo: before });
    } else {
      change({ recipeIds: [...before.recipeIds, res.recipe.id] });
      setStatus({
        text: res.ingredient
          ? `${res.name} added to this meal as your new food — a leader will check it later. Set how much each person needs if it isn’t right.`
          : `${res.name} added.`,
        undoTo: null
      });
    }
    setNewFood(null);
    setRowOpen('food');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function pick(r: Recipe) {
    setNewFood(null);
    const before = undoPoint();
    const brandNote = (names: string[]) => (names.length > 0 ? ` Using ${names.join(', ')}, as the recipe suggests.` : '');
    if (swapId) {
      change({ recipeIds: before.recipeIds.map((x) => (x === swapId ? r.id : x)), recipeEdits: without(edits, swapId) });
      setStatus({ text: `Swapped ${recipeName(swapId)} for ${r.name}.${brandNote(applySuggestions(r))}`, undoTo: before });
      setSwapId(null);
    } else {
      change({ recipeIds: [...before.recipeIds, r.id] });
      setStatus({ text: `${r.name} added.${brandNote(applySuggestions(r))}`, undoTo: null });
    }
    clearSearch();
    setRowOpen('food');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function undo() {
    if (!status.undoTo) return;
    change(status.undoTo);
    setStatus({ text: 'Undone.', undoTo: null });
    inputRef.current?.focus();
  }

  /* ---- Brands (one set per ingredient, for the whole menu) ---- */
  const ingById = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const picksOf = (ingredientId: string) => menu.shopping.brands?.[ingredientId] ?? [];
  /** The quiet text beside an ingredient: "any brand", or the brands chosen. Null when it has no brands at all. */
  const brandText = (ingredientId: string) => {
    const text = brandSummary(picksOf(ingredientId), ingredientId, catalog);
    return text ? <span className={`${s.brandText} ${text === 'any brand' ? '' : s.brandSet}`}>{text}</span> : null;
  };
  /** Under the chooser, for the recipe's author: suggest the one chosen brand for the recipe, or stop suggesting. */
  const suggestLine = (rid: string, ingredientId: string) => {
    const recipe = byId.get(rid);
    if (!recipe?.mine || !onSuggestBrand) return null;
    const key = `${rid}:${ingredientId}`;
    const currentId = key in suggested ? suggested[key] : (recipe.brandSuggestions?.[ingredientId] ?? null);
    const current = currentId ? (livePicks([{ brandId: currentId, qty: null }], ingredientId, catalog)[0]?.brand ?? null) : null;
    const chosen = livePicks(picksOf(ingredientId), ingredientId, catalog);
    const offer = chosen.length === 1 && chosen[0].brand.id !== current?.id ? chosen[0].brand : null;
    if (!current && !offer) return null;
    const send = async (brand: Brand | null) => {
      const res = await onSuggestBrand(rid, ingredientId, brand?.id ?? null);
      if (!res.ok) return setStatus({ text: res.error, undoTo: null });
      setSuggested((cur) => ({ ...cur, [key]: brand?.id ?? null }));
      setStatus({ text: brand ? `${recipe.name} now suggests ${brand.name}.` : `${recipe.name} no longer suggests a brand here.`, undoTo: null });
    };
    return (
      <p className={s.foot}>
        {current && <>Your recipe suggests {current.name}. </>}
        {offer && (
          <button type="button" className={s.linkBtn} onClick={() => void send(offer)}>
            Suggest {offer.name} for the recipe
          </button>
        )}
        {current && !offer && (
          <button type="button" className={s.linkBtn} onClick={() => void send(null)}>
            Stop suggesting
          </button>
        )}
      </p>
    );
  };
  const brandSlot = (rid: string) => (ingredientId: string, name: string) => {
    const ing = ingById.get(ingredientId);
    if (!ing || !onBrands) return null;
    const known = (catalog.brands ?? []).some((b) => b.ingredientId === ingredientId && !b.retiredAt);
    // Nothing to choose and nothing can be typed: no control at all.
    if (!known && !onTypeBrand) return null;
    const key = `${rid}:${ingredientId}`;
    const open = brandOpen.has(key);
    const chosen = brandSummary(picksOf(ingredientId), ingredientId, catalog);
    const verb = chosen && chosen !== 'any brand' ? 'Change' : 'Choose brand(s)';
    return {
      text: (
        <>
          {brandText(ingredientId)}
          <button
            type="button"
            id={`${uid}-brand-${key}`}
            className={s.linkBtn}
            aria-expanded={open}
            aria-label={`${verb} for ${name}`}
            onClick={() =>
              setBrandOpen((cur) => {
                const next = new Set(cur);
                if (!next.delete(key)) next.add(key);
                return next;
              })
            }
          >
            {verb}
          </button>
        </>
      ),
      inset: open ? (
        <>
          <BrandChooser
            ingredient={ing}
            catalog={catalog}
            picks={picksOf(ingredientId)}
            line={lineFor?.(ingredientId)}
            onChange={(next) => onBrands(ingredientId, next)}
            onType={onTypeBrand ? (typed) => onTypeBrand(ingredientId, typed) : undefined}
            onAnnounce={(text) => setStatus({ text, undoTo: null })}
            onPackageAdded={onBrandPackage ? (a) => onBrandPackage(ingredientId, a) : undefined}
          />
          {suggestLine(rid, ingredientId)}
          {/* Patrick, 2026-10-04: a way to close the chooser once the brand is picked; the row above then shows it. */}
          <p className={s.brandDone}>
            <button
              type="button"
              className={s.linkBtn}
              aria-label={`Done choosing a brand for ${name}`}
              onClick={() => {
                setBrandOpen((cur) => {
                  const next = new Set(cur);
                  next.delete(key);
                  return next;
                });
                const said = brandSummary(picksOf(ingredientId), ingredientId, catalog);
                setStatus({ text: said && said !== 'any brand' ? `${name}: ${said}.` : `${name}: any brand.`, undoTo: null });
                // The chooser is gone: focus goes back to the control that opened it.
                requestAnimationFrame(() => document.getElementById(`${uid}-brand-${key}`)?.focus());
              }}
            >
              Done
            </button>
          </p>
        </>
      ) : null
    };
  };

  /** Closing the price form puts focus back on the badge that opened it. */
  const closePrice = () => {
    const rid = priceOpen?.rid;
    setPriceOpen(null);
    if (rid) requestAnimationFrame(() => document.getElementById(`${uid}-price-${rid}`)?.focus());
  };
  const priceAdded = (rid: string, ing: { id: string; name: string }, a: AddedPackage) => {
    onPackageAdded?.(ing.id, a);
    setPriceOpen(null);
    setStatus({
      text: a.status === 'held' ? `${ing.name} priced at ${money(a.pkg.price)}. A leader checks it first.` : `${ing.name} priced at ${money(a.pkg.price)}.`,
      undoTo: null
    });
    // The badge may be gone with the price; focus stays in the meal.
    requestAnimationFrame(() => (document.getElementById(`${uid}-price-${rid}`) ?? document.getElementById(`${uid}-recipe-${rid}`))?.focus());
  };
  /** The brand control plus, under the food being priced, the price form (the inset the brand chooser uses). */
  const itemSlot = (rid: string) => {
    const brand = brandSlot(rid);
    return (ingredientId: string, name: string) => {
      const b = brand(ingredientId, name);
      if (priceOpen?.rid !== rid || priceOpen.ingredientId !== ingredientId) return b;
      const ing = ingById.get(ingredientId);
      if (!ing) return b;
      const picked = livePicks(picksOf(ingredientId), ingredientId, catalog)[0]?.brand.name;
      const form = (
        <div id={`${uid}-price-form-${rid}`} ref={priceRef}>
          <AddPackageForm
            ingredient={ing}
            conversions={catalog.conversions}
            compact
            defaultName={picked ?? ing.name}
            onAdded={(a) => priceAdded(rid, ing, a)}
            onCancel={closePrice}
          />
        </div>
      );
      return { text: b?.text ?? null, inset: (<>{b?.inset}{form}</>) };
    };
  };

  /* ---- This menu's version of a recipe ---- */
  /** The diets with people on this meal, clamped like the engine does. */
  const mealDiets = effectiveRestrictions(plan);
  const rowsFor = (rid: string) => {
    const recipe = byId.get(rid);
    return recipe ? menuEditRows(recipe, edits[rid] ?? [], catalog, plan, view) : [];
  };
  const setOps = (rid: string, next: EditOp[]) => {
    const rest = without(edits, rid);
    change({ recipeEdits: next.length > 0 ? { ...rest, [rid]: next } : rest });
  };

  function onIngredientAction(rid: string, a: RowAction) {
    const ops = edits[rid] ?? [];
    if (a.type === 'add') {
      setOps(rid, opsWithAdded(ops, a.ingredientId, 1, a.scope));
      return;
    }
    const e = rowsFor(rid).find((r) => r.key === a.key)?.edit;
    if (!e) return;
    // A scope on the action is the diet the scout picked; without one, a diet row works on its own diet's op.
    const scope = a.type === 'amount' ? undefined : (a.scope ?? e.scope);
    if (a.type === 'amount') setOps(rid, opsWithAmount(ops, e, a.qtyPerPerson));
    else if (a.type === 'swap') setOps(rid, opsWithSwap(ops, e, a.to, defaultSwapQty(e, a.to, catalog), scope));
    else if (a.type === 'leave_out') setOps(rid, opsWithLeaveOut(ops, e, scope));
    else if (a.type === 'remove') setOps(rid, opsWithoutAdded(ops, e.ingredientId, e.scope));
    else setOps(rid, opsWithoutOp(ops, e, scope)); // put_back, reset
  }

  /** The warning's answers. The list opens under its recipe; a leave-out is applied at once and can be undone. */
  function askSwap(rid: string, ingredientId: string, scope: RestrictionKey) {
    openList(rid);
    setIntent((cur) => ({ kind: 'swap', ingredientId, scope, rid, n: (cur?.n ?? 0) + 1 }));
  }
  function askAdd(rid: string, scope: RestrictionKey) {
    openList(rid);
    setIntent((cur) => ({ kind: 'add', scope, rid, n: (cur?.n ?? 0) + 1 }));
  }
  function leaveOutFor(rid: string, ingredientId: string, scope: RestrictionKey, name: string) {
    const e = rowsFor(rid).find((r) => r.edit?.kind === 'base' && !r.edit.scope && r.edit.currentIngredientId === ingredientId)?.edit;
    if (!e) return;
    const before = undoPoint();
    setOps(rid, opsWithLeaveOut(edits[rid] ?? [], e, scope));
    openList(rid);
    setStatus({ text: `${name} left out for ${RESTRICTION_BY_KEY[scope].label.toLowerCase()} scouts.`, undoTo: before });
  }

  function backToTroop(rid: string) {
    const before = undoPoint();
    change({ recipeEdits: without(edits, rid) });
    setStatus({ text: `Back to the troop’s version of ${recipeName(rid)}.`, undoTo: before });
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!listOpen) setListOpen(true);
      else setActive(Math.min(act + 1, browseAt));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(act - 1, 0));
    } else if (e.key === 'Enter') {
      if (showList && act >= 0) {
        e.preventDefault();
        choose(act);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
      setSwapId(null);
    }
  }

  return (
    <div className={s.mealPanel}>
      {!readOnly && (
        <span className={s.mealPeople}>
          <span className={s.choiceLabel} aria-hidden="true">
            People for this meal
          </span>
          <span className={s.peopleBox}>
            <NumberBox id={`mm-people-${meal.id}`} value={plan.headcount} min={MIN_HEADCOUNT} max={MAX_HEADCOUNT} onCommit={setPeople} ariaLabel={`${title} people`} />
          </span>
          {plan.headcount !== menu.headcount && (
            <Button variant="ghost" onClick={() => setPeople(menu.headcount)}>
              Reset to {menu.headcount}
            </Button>
          )}
        </span>
      )}
      <ul className={s.card} aria-label={`Recipes in ${title}`}>
        {meal.recipeIds.length === 0 && <li className={s.empty}>Nothing yet.</li>}
        {meal.recipeIds.map((id) => {
          const name = recipeName(id);
          const open = openIds.has(id);
          const edited = edits[id]?.length ?? 0;
          const panel = `${uid}-ing-${id}`;
          return (
            <li key={id} className={s.row}>
              <div className={s.rowMain}>
                <button type="button" id={`${uid}-recipe-${id}`} className={s.rowName} aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => toggle(id)}>
                  {name}
                  <span className={s.chev} aria-hidden="true">
                    ›
                  </span>
                </button>
                {edited > 0 && <span className={s.meta}>Your version · {edited}</span>}
                {noPrice[id] &&
                  (onPackageAdded && !readOnly ? (
                    <button
                      type="button"
                      id={`${uid}-price-${id}`}
                      className={`${s.tag} ${s.tagBtn}`}
                      aria-expanded={priceOpen?.rid === id}
                      aria-controls={priceOpen?.rid === id ? `${uid}-price-form-${id}` : undefined}
                      aria-pressed={priceOpen?.rid === id}
                      title={noPrice[id].map((i) => i.name).join(', ')}
                      aria-label={`No price yet — add one: ${noPrice[id].map((i) => i.name).join(', ')}`}
                      onClick={() => {
                        if (priceOpen?.rid === id) return closePrice();
                        openList(id);
                        setPriceOpen({ rid: id, ingredientId: noPrice[id][0].id });
                        setStatus({ text: `Price for ${noPrice[id][0].name}.`, undoTo: null });
                      }}
                    >
                      No price yet
                      <span className={s.srOnly}>: {noPrice[id].map((i) => i.name).join(', ')}</span>
                    </button>
                  ) : (
                    <span className={s.tag} title={noPrice[id].map((i) => i.name).join(', ')}>
                      No price yet
                      <span className={s.srOnly}>: {noPrice[id].map((i) => i.name).join(', ')}</span>
                    </span>
                  ))}
              </div>
              <div className={s.cost}>{money(costOf(id))}</div>
              {warnings
                .filter((w) => w.recipe.id === id)
                .map((w) => {
                  const diet = w.restriction.label.toLowerCase();
                  return (
                    <Notice key={w.restriction.key} tone="warning" className={s.mealWarn}>
                      <span aria-hidden="true">⚠ </span>
                      {w.count === 1 ? '1 person is' : `${w.count} people are`} {diet} and this{' '}
                      {w.kind === 'unsuitable' ? 'isn’t for them' : `has ${w.ingredients.join(', ').toLowerCase()}`}. Plan something else for them.
                      {!readOnly && (
                        <span className={s.warnActions}>
                          {w.kind === 'unsuitable' ? (
                            // A single food has no ingredient row to add to: the answer is another food on the meal.
                            isSingleFood(authoringOf(w.recipe)) ? (
                              <button
                                type="button"
                                className={s.linkBtn}
                                onClick={() => {
                                  setRowOpen('food');
                                  requestAnimationFrame(() => inputRef.current?.focus());
                                }}
                              >
                                Add a food for {diet} scouts…
                              </button>
                            ) : (
                              <button type="button" className={s.linkBtn} onClick={() => askAdd(id, w.restriction.key)}>
                                Add something for {diet} scouts…
                              </button>
                            )
                          ) : (
                            w.ingredientIds.map((ingId, k) => {
                              const ing = (w.ingredients[k] ?? ingId).toLowerCase();
                              return (
                                <span key={ingId} className={s.warnPair}>
                                  <button type="button" className={s.linkBtn} onClick={() => askSwap(id, ingId, w.restriction.key)}>
                                    Swap {ing} for {diet} scouts…
                                  </button>
                                  <button type="button" className={s.linkBtn} onClick={() => leaveOutFor(id, ingId, w.restriction.key, w.ingredients[k] ?? ingId)}>
                                    Leave {ing} out for {diet} scouts
                                  </button>
                                </span>
                              );
                            })
                          )}
                        </span>
                      )}
                    </Notice>
                  );
                })}
              {!readOnly && (
                <RowMenu
                  label={`More for ${name}`}
                  items={[
                    {
                      label: 'Swap for…',
                      onSelect: () => {
                        setSwapId(id);
                        setRowOpen('food');
                        requestAnimationFrame(() => inputRef.current?.focus());
                      }
                    },
                    ...(edited > 0 ? [{ label: 'Back to the troop’s version', onSelect: () => backToTroop(id) }] : []),
                    // Phase 4C: a scout's saved version of a recipe can become a recipe of its own.
                    ...(edited > 0 && shareVersionMenuId
                      ? [{ label: 'Share this version as a new recipe…', href: `${RECIPES_HREF}/new?menu=${encodeURIComponent(shareVersionMenuId)}&meal=${encodeURIComponent(meal.id)}&recipe=${encodeURIComponent(id)}` }]
                      : []),
                    { label: 'Remove', danger: true, onSelect: () => remove(id) }
                  ]}
                />
              )}
              {open && (
                <div id={panel} className={s.inset}>
                  {readOnly ? (
                    <>
                      <IngredientList mode="read" dense ariaLabel={`${name} ingredients`} rows={rowsFor(id)} emptyText="No ingredients on this recipe yet." brandText={brandText} />
                      <StepsGear recipe={byId.get(id)} descriptions={gearNotes} />
                    </>
                  ) : (
                    <div className={s.foodCard}>
                      <IngredientList
                        key={intent?.rid === id ? intent.n : 0}
                        mode="menu-edit"
                        restrictions={mealDiets}
                        initialIntent={intent?.rid === id ? intent : undefined}
                        canAdd={!(byId.get(id) && isSingleFood(authoringOf(byId.get(id) as Recipe)))}
                        dense
                        ariaLabel={`${name} ingredients`}
                        rows={rowsFor(id)}
                        choices={choices}
                        emptyText="No ingredients on this recipe yet."
                        onAction={(a) => onIngredientAction(id, a)}
                        onAnnounce={(text) => setStatus({ text, undoTo: null })}
                        brandSlot={itemSlot(id)}
                        renderNew={
                          canTypeIn
                            ? (typedName, done, scope) => (
                                <MenuNewIngredient
                                  name={typedName}
                                  catalog={catalog}
                                  onCancel={() => done(null)}
                                  onAdded={(n) => {
                                    onTyped?.(n);
                                    // The "Add for" choice reaches a brand-new food too (Patrick, 2026-10-06).
                                    onIngredientAction(id, { type: 'add', ingredientId: n.key, ...(scope ? { scope } : {}) });
                                    setStatus({ text: `${n.name} added as a new ingredient${scope ? ` for ${RESTRICTION_BY_KEY[scope].label.toLowerCase()} scouts` : ''}. Set how much each person needs.`, undoTo: null });
                                    done(n.key);
                                  }}
                                />
                              )
                            : undefined
                        }
                      />
                      <StepsGear recipe={byId.get(id)} descriptions={gearNotes} />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {browsing && (
        <RecipeLibraryDialog catalog={catalog} menu={menu} meal={meal} swapping={swapping} onPick={pick} onClose={closeBrowse} />
      )}

      {(readOnly ? ownGear.length > 0 || foodGear.length > 0 : foodGear.length > 0 || (gearList != null && ownGear.length > 0)) ? (
        <section className={s.mealGear} aria-label="More gear for this meal">
          {foodGear.length > 0 && <GearList label="Gear for the foods" entries={foodGear} descriptions={gearNotes} />}
          {readOnly ? (
            ownGear.length > 0 && <GearList label="More gear for this meal" entries={ownGear} descriptions={gearNotes} />
          ) : (
            gearList != null && (
              <>
                <GearChips idPrefix={`${uid}-`} gear={ownGear} onChange={(next) => change({ gear: next.length > 0 ? next : undefined })} onAnnounce={(text) => setStatus({ text, undoTo: null })} />
              </>
            )
          )}
        </section>
      ) : null}
      {!readOnly && (
        <AddRow
          open={addOpen}
          onOpenChange={(id, reason) => {
            // The Browse popup and the new-food panel take focus from the search; a blur leaves the row up for them.
            // Cancel / Esc is a discard: it closes the new-food panel with the row.
            if (id === null && (browsing || (newFood !== null && reason === 'blur'))) return;
            if (id === null) setNewFood(null);
            setRowOpen(id);
            if (id === null) {
              clearSearch();
              setSwapId(null);
            }
          }}
          actions={[
            {
              id: 'food',
              label: 'Food',
              content: (
                <>
            <div className={s.addWrap}>
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                className={s.addInput}
                value={query}
                autoComplete="off"
                aria-label={addLabel}
                aria-expanded={showList}
                aria-controls={`${uid}-results`}
                aria-autocomplete="list"
                aria-activedescendant={showList && act >= 0 ? `${uid}-opt-${act}` : undefined}
                placeholder={swapping ? `Swap ${swapping} for…` : `Add to ${slotWord}`}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setListOpen(true);
                  setActive(null);
                }}
                onFocus={() => setListOpen(true)}
                onClick={() => setListOpen(true)}
                onBlur={() => setListOpen(false)}
                onKeyDown={onSearchKey}
              />
              <ul id={`${uid}-results`} role="listbox" aria-label={`${addLabel} — matches`} className={s.results} hidden={!showList}>
                {showList &&
                  matches.map((r, i) => (
                    <li
                      key={r.id}
                      id={`${uid}-opt-${i}`}
                      role="option"
                      aria-selected={i === act}
                      className={s.option}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => setActive(i)}
                      onClick={() => pick(r)}
                    >
                      {r.name}
                    </li>
                  ))}
                {showList && matches.length === 0 && query.trim() !== '' && (
                  <li role="none" className={s.noMatchItem}>
                    Nothing for this meal matches “{query.trim()}”.
                  </li>
                )}
                {showList &&
                  draftHits.map((d) => (
                    <li key={d.id} role="none" className={s.noMatchItem}>
                      {adminLinks ? (
                        <Link href={`/admin/library/menu-monster/recipes/${encodeURIComponent(d.id)}`} onMouseDown={(e) => e.preventDefault()}>
                          {d.name}
                        </Link>
                      ) : (
                        d.name
                      )}{' '}
                      is a draft in the troop’s list — a leader can publish it.
                    </li>
                  ))}
                {showList && addAt >= 0 && (
                  <li
                    id={`${uid}-opt-${addAt}`}
                    role="option"
                    aria-selected={act === addAt}
                    className={`${s.option} ${s.addFoodOption}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setActive(addAt)}
                    onClick={openNewFood}
                  >
                    Add “{query.trim()}” as a new food…
                  </li>
                )}
                {showList && (
                  <li
                    id={`${uid}-opt-${browseAt}`}
                    role="option"
                    aria-selected={act === browseAt}
                    className={`${s.option} ${s.browseOption}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setActive(browseAt)}
                    onClick={openBrowse}
                  >
                    Browse all recipes…
                  </li>
                )}
              </ul>
            </div>
            {newFood !== null && (
              <MealNewFood
                name={newFood}
                slot={meal.slot}
                meal={meal}
                catalog={catalog}
                onAdded={foodAdded}
                onPickRecipe={pick}
                onCancel={closeNewFood}
              />
            )}
                </>
              )
            },
            ...(gearList != null
              ? [
                  {
                    id: 'gear',
                    label: 'Gear',
                    content: (
                      <GearPicker
                        list={gearList}
                        taken={ownGear}
                        onPick={(name) => {
                          change({ gear: sortGear([...ownGear, name]) });
                          setStatus({ text: `${name} added to ${title}.`, undoTo: null });
                        }}
                        label={`More gear for ${title}`}
                        placeholder="More gear for this meal"
                      />
                    )
                  }
                ]
              : [])
          ]}
        />
      )}

      <p className={status.text ? s.statusLine : s.srOnly} role="status">
        {status.text}
        {status.undoTo && (
          <>
            {' '}
            <button type="button" ref={undoRef} className={s.linkBtn} onClick={undo}>
              Undo
            </button>
          </>
        )}
      </p>

    </div>
  );
}

/** The troop gear list's descriptions by name key; an item with none (or no list at all) is simply absent. */
function gearDescriptions(list: readonly GearItem[] | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const g of list ?? []) {
    const d = g.description?.trim();
    if (d) out.set(gearKey(g.name), d);
  }
  return out;
}

/**
 * Gear as a labelled bulleted list, one item per entry with "× n" when more than one — never one comma-joined
 * line (Patrick, 2026-10-06). An item whose master-list entry has a description shows it as a muted line under
 * it: the first place descriptions appear, so it stays quiet.
 */
function GearList({ label, entries, descriptions }: { label: string; entries: readonly string[]; descriptions: ReadonlyMap<string, string> }) {
  const uid = useId();
  return (
    <div className={s.gearBlock}>
      <p id={uid} className={s.blockLabel}>
        {label}
      </p>
      <ul className={s.gearList} aria-labelledby={uid}>
        {entries.map((entry, i) => {
          const { name, count } = parseGear(entry);
          const note = descriptions.get(gearKey(name));
          return (
            <li key={`${gearKey(name)}-${i}`}>
              {gearText(name, count)}
              {note && <span className={s.gearNote}>{note}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One quiet line under an open food's ingredients — "Steps · Gear (4)" — that opens how to make it and what
 * gear it needs (Patrick, 2026-10-03: available as the plan unfolds, without cluttering it), as two labelled
 * blocks: Steps, an ordered list, and Gear, a bulleted list; a block with nothing in it is left out
 * (2026-10-06). Nothing at all for a food with neither. The whole menu's gear adds up on the Gear tab.
 */
function StepsGear({ recipe, descriptions }: { recipe: Recipe | undefined; descriptions: ReadonlyMap<string, string> }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const steps = stepsFromText(recipe?.stepsMd);
  const gear = recipeGear(recipe);
  if (!recipe || (steps.length === 0 && gear.length === 0)) return null;
  const label = [steps.length > 0 ? 'Steps' : null, gear.length > 0 ? `Gear (${gear.length})` : null].filter(Boolean).join(' · ');
  return (
    <div className={s.stepsGear}>
      <button type="button" className={s.linkBtn} aria-expanded={open} aria-controls={open ? uid : undefined} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div id={uid}>
          {steps.length > 0 && (
            <div className={s.gearBlock}>
              <p className={s.blockLabel}>Steps</p>
              <ol className={s.stepList} aria-label={`How to make ${recipe.name}`}>
                {steps.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </div>
          )}
          {gear.length > 0 && <GearList label="Gear" entries={gear} descriptions={descriptions} />}
        </div>
      )}
    </div>
  );
}

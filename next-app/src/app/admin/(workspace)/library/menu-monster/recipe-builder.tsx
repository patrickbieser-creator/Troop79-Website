'use client';

/**
 * Menu Monster leader tools — Recipe builder (Plans/Menu-Monster-Leader-Tools.md,
 * Plans/Menu-Monster-Recipe-Variations.md).
 *
 * One screen-wide table of menu items, like the Price book (Patrick, 2026-10-05): kind, meals, what each
 * person gets, diets, cost and status (lib/menu-monster/food-list.ts builds the rows). A SINGLE FOOD opens
 * under its own row; a RECIPE's editor is too long for that and has its own page (recipe-screen.tsx,
 * recipes/[recipeId]) — the list's filters ride along in the URL so the way back lands where it left.
 *
 * A recipe is an EVERYONE tab (the base lines) plus a tab per
 * restriction a leader has added — each a small DIFF on the base (swap this
 * line for that, leave this out, add this) with a computed state chip:
 * Needs a look / Nothing to change / Substituted / Not suitable. "+ Add a
 * variation" lists the restrictions not yet added, flagged where a base
 * ingredient carries that restriction's avoid flag (Brad's concept-d
 * treatment ii; Jenna's four states; Patrick 2026-09-08).
 *
 * The diff compiles to the engine's serves-rule lines (lib/menu-monster/
 * variations.ts); the status pill, the issues list, the preview and the
 * "what the planner will compute" box all read the compiled lines, so a
 * leader sees exactly what a patrol will get. Save is dirty-gated over the
 * whole draft, variations included; Publish waits for a save and for zero
 * blocking issues — and the action enforces the same gate.
 *
 * CONTROLS (Jenna's hierarchy, Patrick 2026-10-05 — "too many competing for attention"): one sticky bar
 * holds every record-level command. Save is the one primary while the draft is dirty; Publish takes over
 * once it is saved and publishable; Duplicate, Retire / Restore, Make it a single food and Back to the
 * short form live in "More actions…". Section actions ("+ Add …") are quiet; a variation's state is a
 * segmented control. The form is never tabbed to hide fields: a version tab with a bad field is marked.
 *
 * A SAVE THE FORM CAN'T TAKE (same day): Save stays enabled. Clicking it saves nothing — it marks every
 * bad field in place, switches to the version tab that holds the first one, focuses it, and says
 * "Can't save yet: …" beside the button. Greyed means nothing to do, never not valid yet.
 *
 * A SINGLE FOOD (authoring.ts isSingleFood: one ingredient line for everyone — Cookies, Bacon; a diet swap is a
 * note on it, not a second kind of thing, since 2026-10-05)
 * opens in a short form instead (Patrick, 2026-10-04; prototype concept-f-kinds/admin-food.html): its name,
 * what each person gets, meal fit and food groups, then its brands and their packages. No ingredient line;
 * Steps and Gear show only when the food already has some (bacon), so Cookies stays three fields. "Open the
 * full editor" goes to the food's own page — the way to a second ingredient; the diets are answered in the
 * short form itself (Same as everyone / Instead… / Not suitable); saving a new
 * name renames the ingredient too while the two still match.
 */
import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '../../../_components/button';
import { FormPanel, FormSection } from '../../../_components/form-panel';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { TabStrip } from '../../_components/tab-strip';
import { SearchField } from '../../_components/search-field';
import { useGuardedNav } from '../../_components/guarded-nav';
import { IngredientListRow, ScoutFoodListRow } from './list-extra-rows';
import { DiscardButton, SaveButton, SaveFeedback, SaveProblem, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { ActionsMenu } from '../../_components/actions-menu';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { SegmentedControl } from '../../_components/segmented-control';
import { AdminCombobox, type ComboOption } from '../../_components/admin-combobox';
import { money } from '@/lib/event-money';
import {
  METHODS,
  asSingleFood,
  authoringIssues,
  swapsDropped,
  dropOrphanedChanges,
  authoringOf,
  compileAuthoring,
  isSingleFood,
  type DraftBaseLine,
  type DraftVariation,
  type DraftVariationLine,
  type RecipeAuthoring,
  type RecipeIssue
} from '@/lib/menu-monster/authoring';
import type { ScoutFood } from '@/lib/menu-monster/scout-recipes-store';
import { VIEW_LABEL, flaggedIngredients, type VariationView } from '@/lib/menu-monster/variations';
import { NO_FILTER, buildFoodRows, buildIngredientRows, foodListHref, inKind, isIngredientRow, listRows, numericBase, pillOf, recipeHref, viaIngredient, viewFor, type FoodFilter, type FoodRow, type ListKind, type Pill } from '@/lib/menu-monster/food-list';
import { buildLines, recipeSuggestions, ruleText, totalsOf, MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import { FOOD_GROUPS, MEALS, RESTRICTIONS, RESTRICTION_BY_KEY, SECTIONS, SECTION_ORDER, lineUnit, parseQty, perPersonText, supportedUnits } from '@/lib/menu-monster/units';
import type { Catalog, Ingredient, MealSlot, Plan, Recipe, RecipeLine, RestrictionKey, Section, VariationState } from '@/lib/menu-monster/types';
import { createIngredient, deleteRecipe, duplicateRecipe, saveRecipe, setRecipeStatus, updateIngredient } from './actions';
import { GearPicker } from './gear-picker';
import { DangerConfirm } from './danger-confirm';
import { gearKey, parseGear, type GearItem } from '@/lib/menu-monster/gear';
import { BrandsAndPrices } from './brands-prices';
import { NewFoodForm } from './new-food-form';
import lib from '../library.module.css';
import { SuggestedBrands } from './suggested-brands';
import type { MenusUsing } from '@/lib/menu-monster/recipe-delete-store';
import styles from './menu-monster.module.css';

const PILL_VARIANT: Record<Pill, 'danger' | 'warning' | 'success' | 'muted'> = {
  'Needs fixes': 'danger',
  Draft: 'warning',
  Published: 'success',
  Retired: 'muted'
};
const VIEW_VARIANT: Record<VariationView, 'danger' | 'warning' | 'success' | 'muted' | 'info'> = {
  not_needed: 'muted',
  needs_look: 'warning',
  nothing: 'success',
  substituted: 'info',
  unsuitable: 'danger'
};
export const NEW_ID = '__new__';
/** "Line 3: Bacon has no price" → "Bacon has no price", for the note under the line itself. */
const sansLine = (text: string) => text.replace(/^Line \d+: /, '');
type Tab = 'everyone' | RestrictionKey;

export const blankDraft = (): RecipeAuthoring => ({
  id: NEW_ID,
  name: '',
  status: 'draft',
  mealFit: [],
  foodGroups: [],
  camp: true,
  trail: false,
  method: null,
  stepsMd: '',
  base: [],
  variations: [],
  gear: []
});

/** Issues the TABLES cannot hold — these block Save, not only Publish. */
function saveBlocker(a: RecipeAuthoring, issues: RecipeIssue[]): string | null {
  if (!a.name.trim()) return 'Give the menu item a name.';
  for (const i of issues) {
    if (i.level !== 'error') continue;
    if (/pick an ingredient|isn't a number|type an amount|combine them|pick what replaces|pick the ingredient|is gone/.test(i.text)) return i.text;
  }
  return null;
}

/** The compiled lines a person on the selected tab actually gets, as a Recipe the engine can cost. */
function previewRecipe(a: RecipeAuthoring, tab: Tab): Recipe {
  const compiled = compileAuthoring(a).lines;
  const mine = compiled.filter((l) => {
    if (l.servesRule === 'everyone') return true;
    if (tab === 'everyone') return l.servesRule === 'except';
    return l.servesRule === 'except' ? !l.servesRestrictions.includes(tab) : l.servesRestrictions.includes(tab);
  });
  const lines: RecipeLine[] = mine
    .filter((l) => l.ingredientId && Number.isFinite(parseQty(l.amount)) && parseQty(l.amount) > 0)
    .map((l) => ({ ingredientId: l.ingredientId, qtyPerPerson: parseQty(l.amount), unitKey: l.unitKey, ...(l.scale === 'meal' ? { scale: 'meal' as const } : {}), servesRule: l.servesRule, servesRestrictions: l.servesRestrictions }));
  return {
    id: a.id || NEW_ID,
    name: a.name || 'Untitled',
    status: 'published',
    mealFit: a.mealFit,
    foodGroups: a.foodGroups,
    camp: a.camp,
    trail: a.trail,
    method: a.method,
    stepsMd: a.stepsMd,
    sortOrder: 0,
    lines,
    variations: []
  };
}

const KIND_TABS: readonly { key: ListKind; label: string; always: boolean }[] = [
  { key: 'all', label: 'All', always: true },
  { key: 'foods', label: 'Single foods', always: true },
  { key: 'recipes', label: 'Recipes', always: true },
  { key: 'ingredients', label: 'Ingredients', always: true },
  { key: 'fixes', label: 'Needs fixes', always: false },
  { key: 'retired', label: 'Retired', always: false }
];
const COLUMNS = 7;

/** `initialFilter` and `initialRecipeId` come from the URL (?kind= &meal= &q= &recipe=), so a link or the way back from a recipe's page lands on the same list. */
export function RecipeBuilder({
  catalog,
  initialRecipeId,
  initialFilter = NO_FILTER,
  stores = [],
  today = null,
  gearList = [],
  scoutFoods = []
}: {
  catalog: Catalog;
  initialRecipeId?: string;
  initialFilter?: FoodFilter;
  stores?: readonly string[];
  today?: string | null;
  /** The master gear list (active items): what the gear picker offers. */
  gearList?: readonly GearItem[];
  /** Scouts' own new single foods, waiting on a leader: each shows only when the search matches it. */
  scoutFoods?: readonly ScoutFood[];
}) {
  const router = useRouter();
  const { navigate, dialog } = useGuardedNav();
  const [selectedId, setSelectedId] = useState<string | null>(initialRecipeId ?? null);
  const [filter, setFilterState] = useState<FoodFilter>(initialFilter);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const rows = useMemo(() => buildFoodRows(catalog), [catalog]);
  const ingredientRows = useMemo(() => buildIngredientRows(catalog), [catalog]);
  // The open food stays listed whatever the filter, so its editor never vanishes mid-edit.
  const shown = listRows(rows, ingredientRows, filter, selectedId);
  const term = filter.q.trim().toLowerCase();
  // A scout's new food is listed only when searched for (leaders do not need every private draft in the list).
  const scoutShown =
    term === '' || filter.meal !== '' || (filter.kind !== 'all' && filter.kind !== 'foods')
      ? []
      : scoutFoods.filter((f) => f.name.toLowerCase().includes(term) || f.ingredientName.toLowerCase().includes(term));
  const count = (k: ListKind) => (k === 'all' ? rows.length + ingredientRows.length : k === 'ingredients' ? ingredientRows.length : rows.filter((x) => inKind(x, k)).length);
  const filtered = filter.q.trim() !== '' || filter.kind !== 'all' || filter.meal !== '';

  // The address keeps up with the list, so the browser's Back from a recipe's page returns to the same view.
  const remember = (f: FoodFilter, openId: string | null) => window.history.replaceState(null, '', foodListHref(f, openId));
  function setFilter(patch: Partial<FoodFilter>) {
    const next = { ...filter, ...patch };
    setFilterState(next);
    remember(next, selectedId);
  }
  function open(id: string | null) {
    setSelectedId(id);
    remember(filter, id);
  }
  /** An ingredient row or a scout's food finished: say what happened in words, and let the page reload behind it. */
  function done(message: string) {
    setNote(message);
    router.refresh();
  }
  /** A recipe's own page; asks first when the food open in the list has unsaved edits. */
  function toRecipe(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.listTools}>
        <TabStrip
          ariaLabel="Kinds of menu item"
          activeKey={filter.kind}
          items={KIND_TABS.filter((t) => t.always || count(t.key) > 0 || filter.kind === t.key).map((t) => ({
            key: t.key,
            label: t.label,
            count: count(t.key),
            onSelect: () => setFilter({ kind: t.key })
          }))}
        />
        <SearchField value={filter.q} onChange={(q) => setFilter({ q })} label="Search food and recipes" resultCount={shown.length + scoutShown.length} totalCount={rows.length + ingredientRows.length} />
        <select className={`${lib.selectInput} ${styles.mealFilter}`} aria-label="Meal" value={filter.meal} onChange={(e) => setFilter({ meal: e.target.value as MealSlot | '' })}>
          <option value="">Any meal</option>
          {MEALS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <span className={styles.spacer} />
        <Button variant="secondary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          + New single food
        </Button>
        <Button variant="secondary" href={recipeHref('new', filter)}>
          + New recipe
        </Button>
      </div>

      {note && <Notice variant="success">{note}</Notice>}
      {adding && (
        <div>
          <p className={styles.hint}>One thing each person gets, like cookies or an apple. Something with several ingredients or steps is a recipe.</p>
          <NewFoodForm
            title="New single food"
            menuFirst
            stores={stores}
            today={today}
            onDone={(res) => {
              setNote(res.ok ? (res.note ?? null) : null);
              if (res.ok) {
                setAdding(false);
                open(res.recipeId ?? null);
              }
              router.refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label="Food and recipes">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Meals</th>
              <th>Each person gets</th>
              <th>Variations</th>
              <th className={styles.numCell}>Cost / person</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              if (isIngredientRow(row)) return <IngredientListRow key={`ing-${row.ingredient.id}`} row={row} colSpan={COLUMNS} onDone={done} />;
              const { recipe: r } = row;
              const isOpen = row.food && r.id === selectedId;
              return (
                <Fragment key={r.id}>
                  <tr className={isOpen ? styles.rowSelected : undefined}>
                    <td>
                      {row.food ? (
                        // A single food opens right under its row; click it again to close it.
                        <button type="button" className={styles.rowBtn} aria-expanded={isOpen} onClick={() => open(isOpen ? null : r.id)}>
                          {r.name}
                        </button>
                      ) : (
                        <Link className={styles.rowBtn} href={recipeHref(r.id, filter)} onClick={(e) => toRecipe(e, recipeHref(r.id, filter))}>
                          {r.name}
                        </Link>
                      )}
                      {viaIngredient(row, filter.q) && <p className={styles.hint}>has {viaIngredient(row, filter.q)}</p>}
                    </td>
                    <td>{row.food ? (row.swaps ? 'Food · diet swaps' : 'Food') : 'Recipe'}</td>
                    <td>{r.mealFit.length === 0 ? '—' : MEALS.filter((m) => r.mealFit.includes(m.key)).map((m) => m.label).join(', ')}</td>
                    <td>{row.eachGets || '—'}</td>
                    <td>
                      <VariationFlags row={row} />
                    </td>
                    <td className={styles.numCell}>
                      {row.cost.kind === 'priced' ? money(row.cost.perPerson) : row.cost.kind === 'unpriced' ? <span className={styles.muted}>No price yet</span> : '—'}
                    </td>
                    <td>
                      <Badge variant={PILL_VARIANT[row.pill]}>{row.pill}</Badge>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className={styles.detailRow} aria-label={`Details for ${r.name}`}>
                      <td colSpan={COLUMNS}>
                        <RecipeEditor
                          key={r.id}
                          mode="inline"
                          initial={authoringOf(r)}
                          catalog={catalog}
                          stores={stores}
                          today={today}
                          gearList={gearList}
                          onSelect={open}
                          onOpenFull={() => navigate(recipeHref(r.id, filter))}
                          onChanged={() => router.refresh()}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {scoutShown.map((f) => (
              <ScoutFoodListRow key={f.id} food={f} onDone={done} />
            ))}
            {shown.length + scoutShown.length === 0 && (
              <tr>
                <td colSpan={COLUMNS} className={styles.muted}>
                  {rows.length + ingredientRows.length === 0 ? 'No menu items yet.' : 'No items match.'}
                  {rows.length + ingredientRows.length > 0 && filtered && (
                    <>
                      {' '}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setFilterState(NO_FILTER);
                          remember(NO_FILTER, selectedId);
                        }}
                      >
                        Clear filters
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {dialog}
    </div>
  );
}

/** The diets a leader has answered, and how many flagged ones nobody has. Never colour alone: each says what it is. */
function VariationFlags({ row }: { row: FoodRow }) {
  const look = row.toLook + row.diets.filter((d) => d.view === 'needs_look').length;
  const answered = row.diets.filter((d) => d.view !== 'needs_look');
  if (look === 0 && answered.length === 0) return <>—</>;
  return (
    <span className={styles.flags}>
      {answered.map((d) => {
        const label = RESTRICTION_BY_KEY[d.key].label;
        return d.view === 'unsuitable' ? (
          <Badge key={d.key} variant="danger">
            not {label.toLowerCase()}
          </Badge>
        ) : (
          <Badge key={d.key} variant="muted">
            {label}
          </Badge>
        );
      })}
      {look > 0 && <Badge variant="warning">{look === 1 ? '1 needs a look' : `${look} need a look`}</Badge>}
    </span>
  );
}

/* ── Editor ─────────────────────────────────────────────────────────────── */

/**
 * `mode` is where it sits: 'inline' under a single food's row in the list (the short form; the row above
 * already says its name and status), or 'page' on the item's own page (always the full editor; the page
 * title says its name).
 */
export function RecipeEditor({
  mode,
  initial,
  catalog,
  stores,
  today,
  gearList = [],
  onSelect,
  onChanged,
  onOpenFull,
  onShortForm,
  menusUsing,
  onDeleted
}: {
  mode: 'inline' | 'page';
  initial: RecipeAuthoring;
  catalog: Catalog;
  stores: readonly string[];
  today: string | null;
  /** The master gear list (active items): what the gear picker offers. */
  gearList?: readonly GearItem[];
  onSelect: (id: string) => void;
  onChanged: () => void;
  /** Inline: go to this food's own page for the full editor. */
  onOpenFull?: () => void;
  /** Page: go back to this single food's short form in the list. */
  onShortForm?: () => void;
  /** Page: the saved menus that still use this recipe (the delete dialog says so). */
  menusUsing?: MenusUsing;
  /** Page: where to go once the recipe is deleted. Without it there is no Delete at the foot. */
  onDeleted?: () => void;
}) {
  const [draft, setDraft] = useState<RecipeAuthoring>(initial);
  const [tab, setTab] = useState<Tab>('everyone');
  const [adding, setAdding] = useState(false);
  const [newIngredient, setNewIngredient] = useState(false);
  /** A new ingredient that was written before its form was cancelled: one line says it stayed. */
  const [keptFood, setKeptFood] = useState<string | null>(null);
  const snap = useDraftSnapshot(draft);
  const feedback = useSavePhase();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Gear the save did not keep because it is not on the master gear list. */
  const [gearDropped, setGearDropped] = useState<string[]>([]);
  const isNew = draft.id === NEW_ID;
  /** The leader tried to save or publish an incomplete form: the problems are said in words and marked in place. */
  const [attempted, setAttempted] = useState(false);
  /** After a blocked click: which version tab the first problem is on, so the next render can focus it. */
  const [focusAsk, setFocusAsk] = useState(0);
  const form = useRef<HTMLElement>(null);
  const [retiring, setRetiring] = useState(false);
  const retireDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (retiring) retireDialog.current?.showModal();
  }, [retiring]);
  const [deleting, setDeleting] = useState(false);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleting) deleteDialog.current?.showModal();
  }, [deleting]);
  /** The "Make it a single food" panel is open (a recipe only). */
  const [makingFood, setMakingFood] = useState(false);

  const issues = authoringIssues(draft, catalog);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const blocker = saveBlocker(draft, issues);
  // Publish is the primary once the record is saved and whole; before that Save is, and Publish waits quietly.
  const publishable = !isNew && snap.saved.status !== 'retired' && snap.saved.status !== 'published';
  const publishReady = publishable && !snap.dirty && errors.length === 0;
  const pill = pillOf(snap.saved, catalog);
  const ingredients = catalog.ingredients.filter((i) => !i.retiredAt);
  const ingById = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const compiled = compileAuthoring(draft).lines;
  // Where each blocking problem is, so the spot is marked as well as listed at the top.
  const badField = (f: 'name' | 'lines' | 'mealFit') => errors.some((i) => i.field === f);
  const lineProblems = (ingredientId: string) => errors.filter((i) => i.field == null && i.ingredientId === ingredientId).map((i) => sansLine(i.text));
  // Decided from what is SAVED, so typing never flips the form mid-edit.
  const single = !isNew && isSingleFood(snap.saved);
  // The short form lives in the list; a single food on its own page is there for the full editor.
  const compact = single && mode === 'inline';
  const food = compact ? (ingById.get(draft.base[0]?.ingredientId ?? '') ?? null) : null;
  // The one suggested brand on a single food's item (★ on its brand list): from the SAVED recipe's brand_suggestions.
  const savedRecipe = !isNew ? catalog.recipes.find((r) => r.id === draft.id) : undefined;
  const suggestedBrandId = food && savedRecipe ? (recipeSuggestions(savedRecipe, catalog).find(([id]) => id === food.id)?.[1].id ?? null) : null;
  const missing = RESTRICTIONS.filter((r) => !draft.variations.some((v) => v.restriction === r.key));
  const toLook = missing.filter((r) => viewFor(draft, r.key, catalog) === 'needs_look').length;
  const activeTab: Tab = tab === 'everyone' || draft.variations.some((v) => v.restriction === tab) ? tab : 'everyone';
  /** The version tab an issue's field is on: a swap or extra line names its ingredient on that variation. */
  const tabOf = (i: RecipeIssue): Tab => {
    if (i.ingredientId == null) return 'everyone';
    const v = draft.variations.find((x) => x.lines.some((l) => l.ingredientId === i.ingredientId));
    return v ? v.restriction : 'everyone';
  };
  const tabsWithErrors = new Set(errors.map(tabOf));
  const problems = attempted ? errors.filter((i) => saveBlocker(draft, [i]) != null || i.field != null) : [];
  const firstProblem = blocker ?? (attempted && errors.length > 0 ? errors[0].text : null);

  /** A click on Save or Publish the form can't take: say it, mark it, and go to it. */
  function refuse() {
    setAttempted(true);
    const first = errors[0];
    if (first) setTab(tabOf(first));
    setFocusAsk((n) => n + 1);
  }
  // The bad field may be on a tab that only just became visible: focus it once it has rendered.
  useEffect(() => {
    if (focusAsk === 0) return;
    const bad = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    bad?.scrollIntoView?.({ block: 'center' });
    bad?.focus();
  }, [focusAsk]);

  function run(fn: () => Promise<{ ok: boolean; error?: string; id?: string; dropped?: string[] }>, after?: (id?: string, dropped?: string[]) => void) {
    setError(null);
    setGearDropped([]);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      after?.(res.id, res.dropped);
      onChanged();
    });
  }

  function save() {
    feedback.start();
    // A single food's name is its ingredient's name: while the two still match, one rename covers both.
    // A menu item TIED to its food is renamed with it by the save itself (mm_save_recipe); the follow-up rename
    // below is only for an older single food that merely shares its food's name.
    const tied = snap.saved.foodIngredientId != null;
    const rename = !tied && food && food.name === snap.saved.name && draft.name.trim() && draft.name.trim() !== food.name ? food : null;
    run(
      async () => {
        const res = await saveRecipe(isNew ? { ...draft, id: '' } : draft);
        if (!res.ok || !rename) return res;
        const renamed = await updateIngredient(rename.id, { name: draft.name.trim(), section: rename.section, staple: rename.staple, avoid: rename.avoid });
        // The food IS saved: say what did not follow, and let the save land (the list and title refresh).
        if (!renamed.ok) setError(`Saved, but the ingredient is still called “${rename.name}”: ${renamed.error ?? 'it could not be renamed'}`);
        return res;
      },
      (id, dropped) => {
        feedback.done();
        if (dropped && dropped.length > 0) {
          // What the server kept is what is saved: take the dropped names off the form so it is not left dirty.
          const gone = new Set(dropped.map((d) => gearKey(d)));
          const kept = (draft.gear ?? []).filter((g) => !gone.has(gearKey(parseGear(g).name)));
          setDraft((d) => ({ ...d, gear: kept }));
          snap.markSavedAs({ ...draft, gear: kept });
          setGearDropped(dropped);
        } else snap.markSaved();
        setAttempted(false);
        if (isNew && id) {
          setDraft((d) => ({ ...d, id }));
          onSelect(id);
        }
      }
    );
  }

  function publish() {
    if (errors.length > 0) {
      refuse();
      return;
    }
    run(() => setRecipeStatus(draft.id, 'published'), () => setDraft((d) => ({ ...d, status: 'published' })));
  }

  // An Everyone line that goes (removed, or turned into another ingredient) takes its diet swaps with it.
  const setBase = (idx: number, patch: Partial<DraftBaseLine>) =>
    setDraft((d) => dropOrphanedChanges(d, { ...d, base: d.base.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  const [removingVariation, setRemovingVariation] = useState<RestrictionKey | null>(null);
  const removeVariation = (r: RestrictionKey) => {
    setDraft((d) => ({ ...d, variations: d.variations.filter((v) => v.restriction !== r) }));
    setTab('everyone');
  };
  const setVariation = (r: RestrictionKey, fn: (v: DraftVariation) => DraftVariation) =>
    setDraft((d) => ({ ...d, variations: d.variations.map((v) => (v.restriction === r ? fn(v) : v)) }));

  function addVariation(r: RestrictionKey) {
    const view = viewFor(draft, r, catalog);
    const state: VariationState = view === 'needs_look' ? 'substituted' : 'nothing';
    setDraft((d) => ({ ...d, variations: [...d.variations, { restriction: r, state, note: '', lines: [] }] }));
    setTab(r);
    setAdding(false);
  }

  return (
    <section ref={form} className={styles.editor} aria-label={isNew ? 'New recipe' : `Edit ${snap.saved.name}`}>
      {/* Under a row there is nothing to say until something is unsaved: the row has the name and the status. */}
      {(mode === 'page' || snap.dirty) && (
      <div className={styles.detailHead}>
        {mode === 'page' && <Badge variant={PILL_VARIANT[pill]}>{pill}</Badge>}
        {snap.dirty && <Badge variant="warning">Unsaved edits</Badge>}
      </div>
      )}
      {error && <Notice>{error}</Notice>}
      {gearDropped.length > 0 && <Notice variant="warning">Not on the gear list, so not kept: {gearDropped.join(', ')}. New gear is added on the Gear tab.</Notice>}
      {/* A single food that is being given a second ingredient: said before the save, not after. (A diet swap is
          a note on the food and changes nothing here.) */}
      {snap.saved.foodIngredientId && !isSingleFood(draft) && (
        <p className={styles.hint} role="status">
          Adding a second ingredient makes {snap.saved.name} a recipe. {ingById.get(snap.saved.foodIngredientId)?.name ?? 'The food'} stays in the Price book as an ingredient.
        </p>
      )}
      {makingFood && (
        <MakeSingleFood
          recipe={draft}
          ingredients={ingredients}
          onClose={() => setMakingFood(false)}
          tiedFoods={new Set(catalog.recipes.filter((r) => r.id !== draft.id && r.foodIngredientId).map((r) => r.foodIngredientId as string))}
          onUse={(ingredientId, amount, tie) => {
            setDraft((d) => asSingleFood(d, ingredientId, amount, tie));
            setTab('everyone');
            setMakingFood(false);
            // A new ingredient has to reach the catalog before the line can name it.
            onChanged();
          }}
        />
      )}
      {/* What "Needs fixes" means, right under the pill that says it — not below the whole form. */}
      {errors.length > 0 && (
        <Notice>
          <strong>{snap.saved.status === 'published' ? 'Needs fixing' : 'Needs fixing before it can publish'}</strong>
          <ul className={styles.fixList} aria-label="Needs fixing">
            {errors.map((i, n) => {
              const ing = i.ingredientId ? ingById.get(i.ingredientId) : undefined;
              return (
                <li key={n}>
                  {i.text}
                  {i.fix === 'price-book' && (
                    <>
                      {' '}
                      <Link href={`/admin/library/menu-monster?tab=prices${ing ? `&ingredient=${encodeURIComponent(ing.id)}` : ''}`}>
                        {ing ? `Add a price for ${ing.name} →` : 'Open the Price book →'}
                      </Link>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Notice>
      )}

      <FormPanel>
        {compact ? (
          <SingleFoodFields draft={draft} setDraft={setDraft} food={food} catalog={catalog} onFull={() => onOpenFull?.()} make={snap.saved.stepsMd.trim() !== '' || (snap.saved.gear ?? []).length > 0} gearList={gearList} bad={{ name: badField('name'), mealFit: badField('mealFit'), amount: lineProblems(food?.id ?? '').filter((t) => !/priced package/.test(t)) }} />
        ) : (
          <>
        <FormSection num={1} title="Basics">
          <div className={lib.fieldGrid}>
            <div className={lib.fieldFull}>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-r-name">
                Name
              </label>
              <input id="mm-r-name" className={badField('name') ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={badField('name') || undefined} value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Required" />
            </div>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-r-method">
                Cooking method
              </label>
              <select id="mm-r-method" className={lib.selectInput} value={draft.method ?? ''} onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value || null }))}>
                <option value="">— not set —</option>
                {METHODS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className={`adminLabel ${lib.fieldLabel}`}>Where it works</span>
              <label className={styles.listRow}>
                <input type="checkbox" checked={draft.camp} onChange={(e) => setDraft((d) => ({ ...d, camp: e.target.checked }))} /> Camp
              </label>
              <label className={styles.listRow}>
                <input type="checkbox" checked={draft.trail} onChange={(e) => setDraft((d) => ({ ...d, trail: e.target.checked }))} /> Trail (no fridge, light)
              </label>
            </div>
            <fieldset className={badField('mealFit') ? `${styles.fieldset} ${styles.bad}` : styles.fieldset}>
              <legend className={`adminLabel ${lib.fieldLabel}`}>Meal fit</legend>
              {MEALS.map((m) => (
                <label key={m.key} className={styles.listRow}>
                  <input type="checkbox" checked={draft.mealFit.includes(m.key)} onChange={(e) => setDraft((d) => ({ ...d, mealFit: toggle(d.mealFit, m.key, e.target.checked) }))} /> {m.label}
                </label>
              ))}
              {badField('mealFit') && <p className={styles.badNote}>Pick at least one meal.</p>}
            </fieldset>
            <fieldset className={styles.fieldset}>
              <legend className={`adminLabel ${lib.fieldLabel}`}>Food groups (MyPlate)</legend>
              {FOOD_GROUPS.map((g) => (
                <label key={g.key} className={styles.listRow}>
                  <input type="checkbox" checked={draft.foodGroups.includes(g.key)} onChange={(e) => setDraft((d) => ({ ...d, foodGroups: toggle(d.foodGroups, g.key, e.target.checked) }))} /> {g.label}
                </label>
              ))}
            </fieldset>
          </div>
        </FormSection>

        <FormSection num={2} title="Ingredients — what one person gets">
          <div className={styles.toolbar}>
            <TabStrip
              ariaLabel="Recipe versions"
              activeKey={activeTab}
              items={[
                { key: 'everyone', label: 'Everyone', onSelect: () => setTab('everyone'), alert: attempted && tabsWithErrors.has('everyone') },
                ...draft.variations.map((v) => ({ key: v.restriction, label: RESTRICTION_BY_KEY[v.restriction].label, onSelect: () => setTab(v.restriction), alert: attempted && tabsWithErrors.has(v.restriction) }))
              ]}
            />
            <span className={styles.spacer} />
            {missing.length > 0 && (
              <Button variant="quiet" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
                + Add a variation
                {/* The same amber "needs a look" the item list and the variation chips use, so it reads as a to-do. */}
                {toLook > 0 && <Badge variant="warning">{toLook === 1 ? '1 needs a look' : `${toLook} need a look`}</Badge>}
              </Button>
            )}
          </div>
          {adding && missing.length > 0 && (
            <div className={styles.addMenu} role="group" aria-label="Variations to add">
              {missing.map((r) => {
                const view = viewFor(draft, r.key, catalog);
                const flagged = flaggedIngredients(numericBase(draft), r.key, catalog);
                return (
                  <button key={r.key} type="button" className={styles.itemBtn} onClick={() => addVariation(r.key)}>
                    <span className={styles.grow}>
                      {r.label}
                      {flagged.length > 0 && <span className={styles.muted}> · flagged: {flagged.map((i) => i.name).join(', ')}</span>}
                    </span>
                    <Badge variant={VIEW_VARIANT[view]}>{VIEW_LABEL[view]}</Badge>
                  </button>
                );
              })}
            </div>
          )}

          {activeTab === 'everyone' ? (
            <div role="region" aria-label="Everyone version">
              <p className={styles.hint}>
                One line per ingredient — what an unrestricted person gets. Gluten-free, nut-free, dairy-free and vegetarian swaps go on their own
                tab, so this list stays the plain recipe.
              </p>
              {draft.base.length === 0 && <p className={badField('lines') ? styles.badNote : styles.muted}>No ingredients yet{badField('lines') ? ' — add at least one.' : '.'}</p>}
              <ul className={styles.lineList} aria-label="Ingredient lines">
                {draft.base.map((l, idx) => (
                  <BaseLineRow
                    key={idx}
                    idx={idx}
                    line={l}
                    ingredients={ingredients}
                    ingredient={ingById.get(l.ingredientId) ?? null}
                    catalog={catalog}
                    problems={lineProblems(l.ingredientId)}
                    onChange={(patch) => setBase(idx, patch)}
                    onRemove={() => setDraft((d) => dropOrphanedChanges(d, { ...d, base: d.base.filter((_, i) => i !== idx) }))}
                  />
                ))}
              </ul>
              <div className={lib.actionsRow}>
                <Button variant="quiet" onClick={() => setDraft((d) => ({ ...d, base: [...d.base, { ingredientId: '', amount: '', unitKey: null }] }))}>
                  + Add an ingredient
                </Button>
                <Button variant="quiet" aria-expanded={newIngredient} onClick={() => {
                    setKeptFood(null);
                    setNewIngredient((v) => !v);
                  }}>
                  Not in the list? New ingredient…
                </Button>
              </div>
              {newIngredient && (
                <NewFoodForm
                  title="New ingredient"
                  stores={stores}
                  today={today}
                  onDone={(res) => {
                    // It joins the pickers on the refresh; its line is added now so the leader only types the amount.
                    // A retry of the same food (finish mode) reports the same id: its line is only added once.
                    if (res.id) setDraft((d) => (d.base.some((l) => l.ingredientId === res.id) ? d : { ...d, base: [...d.base, { ingredientId: res.id as string, amount: '', unitKey: null }] }));
                    if (res.ok) setNewIngredient(false);
                    onChanged();
                  }}
                  onCancel={(kept) => {
                    setNewIngredient(false);
                    setKeptFood(kept ?? null);
                  }}
                />
              )}
              {keptFood && !newIngredient && <Notice variant="success">“{keptFood}” was already saved to the ingredient list; only the form was closed.</Notice>}
            </div>
          ) : (
            <VariationPanel
              restriction={activeTab}
              draft={draft}
              catalog={catalog}
              ingredients={ingredients}
              onChange={(fn) => setVariation(activeTab, fn)}
              onRemove={() => {
                const v = draft.variations.find((x) => x.restriction === activeTab);
                // Empty: nothing is lost, so no question. Holding changes, a note or an answer: say what goes.
                if (v && variationHolds(v).length > 0) setRemovingVariation(activeTab as RestrictionKey);
                else removeVariation(activeTab as RestrictionKey);
              }}
            />
          )}
          {removingVariation && (() => {
            const v = draft.variations.find((x) => x.restriction === removingVariation);
            const label = RESTRICTION_BY_KEY[removingVariation].label.toLowerCase();
            return (
              <DangerConfirm
                title={`Remove the ${label} version?`}
                sub={`${v ? sentenceOf(variationHolds(v)) : ''}. The Everyone list is not touched, and nothing is deleted until you save.`}
                confirmLabel="Remove version"
                onCancel={() => setRemovingVariation(null)}
                onConfirm={() => {
                  removeVariation(removingVariation);
                  setRemovingVariation(null);
                }}
              />
            );
          })()}
        </FormSection>

        <FormSection num={3} title="Steps">
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-r-steps">
            How to make it (optional)
          </label>
          <textarea id="mm-r-steps" className={lib.textArea} value={draft.stepsMd} maxLength={600} onChange={(e) => setDraft((d) => ({ ...d, stepsMd: e.target.value }))} />
        </FormSection>

        {/* Steps and gear are two things, kept apart on screen as they are in the data (Patrick, 2026-10-06). */}
        <FormSection num={4} title="Gear">
          <span id="mm-r-gear-label" className={`adminLabel ${lib.fieldLabel}`}>
            Gear you’ll need (optional)
          </span>
          <GearPicker labelledBy="mm-r-gear-label" gear={draft.gear ?? []} list={gearList} onChange={(gear) => setDraft((d) => ({ ...d, gear }))} />
        </FormSection>
          </>
        )}

        {warnings.length > 0 && (
          <div className={styles.issues}>
            <p className={`adminLabel ${styles.issuesTitle}`}>Worth a look</p>
            <ul className={styles.issueList} aria-label="Worth a look">
              {warnings.map((i, n) => {
                const ing = i.fix === 'price-book' && i.ingredientId ? ingById.get(i.ingredientId) : undefined;
                return (
                  <li key={n}>
                    {i.text}
                    {/* A single food has its prices right on this page; a recipe's ingredient is one click away. */}
                    {ing && !compact && (
                      <>
                        {' '}
                        <Link href={`/admin/library/menu-monster?tab=prices&ingredient=${encodeURIComponent(ing.id)}`}>Add a price for {ing.name} →</Link>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!compact && compiled.length > 0 && (
          <div className={styles.issues}>
            <p className={`adminLabel ${styles.issuesTitle}`}>What the planner will compute</p>
            <ul className={styles.compileList} aria-label="What the planner will compute">
              {compiled.map((l, n) => {
                const ing = ingById.get(l.ingredientId);
                const q = parseQty(l.amount);
                const what = ing ? (Number.isFinite(q) ? perPersonText(q, ing, lineUnit(l.unitKey, ing)) : `${l.amount || '?'} ${ing.name.toLowerCase()}`) : l.ingredientId || '(no ingredient)';
                return (
                  <li key={n}>
                    {what} <span className={styles.muted}>· {ruleText(l)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* ONE bar, pinned to the bottom of the window: Save and Discard on the left with the reason a save can't
            happen; Publish and "More actions…" on the right. (Patrick, 2026-10-05: the "Needs fixing" box was
            scrolled away, Save looked like it did nothing, and nine loose buttons fought for attention.) */}
        <div className={`${lib.actionsRow} ${styles.saveBar}`}>
          <SaveButton dirty={snap.dirty} pending={pending} isNew={isNew} newLabel="Save draft" blocked={blocker != null} blockedReason={blocker ?? undefined} onBlocked={refuse} onClick={save} />
          <DiscardButton
            dirty={snap.dirty}
            pending={pending}
            onClick={() => {
              setDraft(snap.saved);
              setAttempted(false);
            }}
          />
          <SaveFeedback phase={feedback.phase} />
          {attempted && firstProblem && <SaveProblem reason={firstProblem} more={Math.max(0, problems.length - 1)} />}
          <span className={styles.spacer} />
          {publishable && (
            <Button variant={publishReady ? 'primary' : 'secondary'} disabled={pending} onClick={snap.dirty ? () => (blocker ? refuse() : save()) : publish}>
              {snap.dirty ? 'Save, then publish' : 'Publish'}
            </Button>
          )}
          {!isNew && (
            <ActionsMenu
              ariaLabel="More actions"
              placeholder="More actions…"
              disabled={pending}
              options={[
                ...(!single && snap.saved.status !== 'retired' ? [{ value: 'food', label: 'Make it a single food', disabled: makingFood }] : []),
                ...(single && !compact && onShortForm ? [{ value: 'short', label: 'Back to the short form', disabled: snap.dirty }] : []),
                { value: 'duplicate', label: 'Duplicate', disabled: snap.dirty },
                snap.saved.status === 'retired' ? { value: 'restore', label: 'Restore as draft' } : { value: 'retire', label: 'Retire' }
              ]}
              onAction={(v) => {
                if (v === 'food') setMakingFood(true);
                else if (v === 'short') onShortForm?.();
                else if (v === 'duplicate') run(() => duplicateRecipe(draft.id), (id) => id && onSelect(id));
                else if (v === 'restore') run(() => setRecipeStatus(draft.id, 'draft'));
                else setRetiring(true);
              }}
            />
          )}
        </div>
        {snap.dirty && !isNew && <p className={styles.hint}>Duplicate and the short form wait for a save.</p>}
        {retiring && (
          <Dialog ref={retireDialog} danger onClose={() => setRetiring(false)}>
            <DialogHeader title={`Retire ${snap.saved.name}?`} sub="Patrols can’t pick it any more. Old plans keep their copy, and it can be restored as a draft later." />
            <DialogBody>{null}</DialogBody>
            <DialogActions>
              <Button variant="secondary" size="sm" onClick={() => setRetiring(false)}>
                Keep it
              </Button>
              <Button
                variant="dangerSolid"
                size="sm"
                onClick={() => {
                  setRetiring(false);
                  run(() => setRecipeStatus(draft.id, 'retired'));
                }}
              >
                Retire
              </Button>
            </DialogActions>
          </Dialog>
        )}
        {snap.saved.status === 'retired' && (
          <p className={styles.hint}>{snap.saved.name} is retired. Patrols can&rsquo;t pick it any more; old plans keep their copy.</p>
        )}
        {/* Delete is at the FOOT of the open recipe, away from the sticky bar (Patrick, 2026-10-06). Outlined danger, never primary. */}
        {!isNew && !compact && onDeleted && (
          <div className={styles.deleteFoot}>
            <Button variant="danger" size="sm" disabled={pending} onClick={() => setDeleting(true)}>
              Delete recipe
            </Button>
          </div>
        )}
        {deleting && (
          <Dialog ref={deleteDialog} danger onClose={() => setDeleting(false)}>
            {snap.saved.foodIngredientId ? (
              <>
                <DialogHeader title={`${snap.saved.name} is a single food`} sub="Use “Take it off the menu” on its food instead. A food keeps its brands and prices." />
                <DialogBody>{null}</DialogBody>
                <DialogActions>
                  <Button variant="secondary" size="sm" onClick={() => setDeleting(false)}>
                    Close
                  </Button>
                </DialogActions>
              </>
            ) : menusUsing && menusUsing.count > 0 ? (
              <>
                <DialogHeader
                  title={`${snap.saved.name} is on ${menusUsing.count} ${menusUsing.count === 1 ? 'menu' : 'menus'} (${menusUsing.names.join(', ')}${menusUsing.count > menusUsing.names.length ? '…' : ''})`}
                  sub="Take it off those menus first, or Retire it so no new menu picks it."
                />
                <DialogBody>{null}</DialogBody>
                <DialogActions>
                  <Button variant="secondary" size="sm" onClick={() => setDeleting(false)}>
                    Keep it
                  </Button>
                  {snap.saved.status !== 'retired' && (
                    <Button
                      variant="dangerSolid"
                      size="sm"
                      onClick={() => {
                        setDeleting(false);
                        run(() => setRecipeStatus(draft.id, 'retired'));
                      }}
                    >
                      Retire
                    </Button>
                  )}
                </DialogActions>
              </>
            ) : (
              <>
                <DialogHeader title={`Delete ${snap.saved.name}?`} sub="It is removed from the troop’s list for good." />
                <DialogBody>{null}</DialogBody>
                <DialogActions>
                  <Button variant="secondary" size="sm" onClick={() => setDeleting(false)}>
                    Keep it
                  </Button>
                  <Button
                    variant="dangerSolid"
                    size="sm"
                    onClick={() => {
                      setDeleting(false);
                      feedback.start();
                      setError(null);
                      // No refresh: the page it would reload is the one that was just deleted.
                      start(async () => {
                        const res = await deleteRecipe(draft.id);
                        if (!res.ok) {
                          feedback.fail();
                          setError(res.error ?? 'Something went wrong.');
                          return;
                        }
                        feedback.doneThen(() => onDeleted?.());
                      });
                    }}
                  >
                    Delete
                  </Button>
                </DialogActions>
              </>
            )}
          </Dialog>
        )}
      </FormPanel>

      {compact && food && (
        <FormPanel>
          <BrandsAndPrices ing={food} catalog={catalog} today={today} stores={stores} onChanged={onChanged} suggestFor={{ recipeId: draft.id, brandId: suggestedBrandId }} />
          <p className={styles.hint}>
            <Link href={`/admin/library/menu-monster?tab=prices&ingredient=${encodeURIComponent(food.id)}`}>Conversions and the unit for {food.name.toLowerCase()} are in the Price book →</Link>
          </p>
        </FormPanel>
      )}

      {/* A single food's suggestion lives on its brand list (★) since 2026-10-06; a recipe keeps the per-ingredient panel. */}
      {!isNew && !compact && <SuggestedBrands recipeId={draft.id} catalog={catalog} onChanged={onChanged} />}

      <Preview draft={draft} tab={activeTab} catalog={catalog} />
    </section>
  );
}

/* ── A recipe → a single food ─────────────────────────────────────────────── */

const NEW_INGREDIENT = '__new';
const FOOD_SECTIONS = Object.keys(SECTIONS) as Section[];

/**
 * "Cookies are listed under a recipe. I need a way to move it to a single food" (Patrick, 2026-10-05).
 * Nothing stores which kind a menu item is: one ingredient line for everyone IS a single food. So the move is
 * choosing that one thing — an ingredient on file, or a new one named after the recipe — and how many each
 * person gets. It lands in the draft like any other edit; Save changes writes it. Only a brand-new ingredient
 * is written at once, because the line has to name something that exists.
 */
function MakeSingleFood({
  recipe,
  ingredients,
  onClose,
  tiedFoods,
  onUse
}: {
  recipe: RecipeAuthoring;
  ingredients: Ingredient[];
  onClose: () => void;
  /** Foods another menu item is already tied to (one "by itself" item per food). */
  tiedFoods: ReadonlySet<string>;
  /** `tie`: the food has this recipe's name and nothing else is tied to it, so the two become one entry. */
  onUse: (ingredientId: string, amount: string, tie: boolean) => void;
}) {
  const sorted = [...ingredients].sort((a, b) => a.name.localeCompare(b.name));
  const wanted = recipe.name.trim().toLowerCase();
  const match = sorted.find((i) => i.name.toLowerCase() === wanted);
  const [pick, setPick] = useState(match?.id ?? NEW_INGREDIENT);
  const [name, setName] = useState(recipe.name.trim());
  const [one, setOne] = useState(wanted.endsWith('s') ? wanted.slice(0, -1) : wanted);
  const [many, setMany] = useState(wanted);
  const [section, setSection] = useState<Section>('dry');
  const [amount, setAmount] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  /** Pressed with something missing: the missing fields are marked and the reason is said beside the button. */
  const [tried, setTried] = useState(false);

  const isNewIngredient = pick === NEW_INGREDIENT;
  const amountOk = parseQty(amount) > 0;
  const ready = amountOk && (!isNewIngredient || (name.trim() !== '' && one.trim() !== '' && many.trim() !== ''));
  const replaced = [recipe.base.length > 0 ? `its ${recipe.base.length} ingredient${recipe.base.length === 1 ? '' : 's'}` : null].filter(Boolean);
  // Swaps OF the chosen food stay with it; leave-outs, extra lines and swaps of other ingredients go — said here, not after.
  const dropped = isNewIngredient ? recipe.variations.reduce((n, v) => n + v.lines.length, 0) : swapsDropped(recipe, pick);
  const title = `Make ${recipe.name.trim() || 'this'} a single food`;
  const idp = `mm-food-${recipe.id}`;

  const nameBad = tried && isNewIngredient && name.trim() === '';
  const amountBad = tried && !amountOk;
  const reason = !amountOk ? 'Type how many each person gets.' : 'Name it and say what one and several are called.';

  function use() {
    setError(null);
    if (!ready) {
      // Greyed means nothing to do, never not valid yet (D-331): say what is missing, in place.
      setTried(true);
      return;
    }
    if (!isNewIngredient) {
      const picked = sorted.find((i) => i.id === pick);
      onUse(pick, amount.trim(), picked?.name.trim().toLowerCase() === wanted && !tiedFoods.has(pick));
      return;
    }
    start(async () => {
      const res = await createIngredient({ name: name.trim(), unit: { kind: 'count', key: 'count', one: one.trim(), many: many.trim() }, section, staple: false, avoid: [] });
      if (!res.ok || !res.id) {
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      onUse(res.id, amount.trim(), name.trim().toLowerCase() === wanted);
    });
  }

  return (
    <FormPanel title={title} aria-label={title}>
      {error && <Notice>{error}</Notice>}
      <p className={styles.hint}>
        A single food is one thing each person gets, like cookies or an apple.
        {replaced.length > 0 ? ` This replaces ${replaced.join(' and ')} with that one thing.` : ''} Its name, meals, steps and gear stay.
        {dropped > 0 ? ` Drops ${dropped} diet ${dropped === 1 ? 'line' : 'lines'} that ${dropped === 1 ? 'does' : 'do'} not apply to that food; a swap of the food itself stays.` : ''}
      </p>
      <div className={lib.fieldGrid}>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-pick`}>
            What each person gets
          </label>
          <select id={`${idp}-pick`} className={lib.selectInput} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value={NEW_INGREDIENT}>A new ingredient…</option>
            {sorted.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-amount`}>
            How many each
          </label>
          <input id={`${idp}-amount`} className={amountBad ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={amountBad || undefined} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        {isNewIngredient && (
          <>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-name`}>
                Name
              </label>
              <input id={`${idp}-name`} className={nameBad ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={nameBad || undefined} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-section`}>
                Store section
              </label>
              <select id={`${idp}-section`} className={lib.selectInput} value={section} onChange={(e) => setSection(e.target.value as Section)}>
                {FOOD_SECTIONS.map((k) => (
                  <option key={k} value={k}>
                    {SECTIONS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-one`}>
                One is called
              </label>
              <input id={`${idp}-one`} className={tried && one.trim() === '' && isNewIngredient ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={(tried && one.trim() === '' && isNewIngredient) || undefined} value={one} maxLength={40} onChange={(e) => setOne(e.target.value)} placeholder="cookie" />
            </div>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-many`}>
                Several are called
              </label>
              <input id={`${idp}-many`} className={tried && many.trim() === '' && isNewIngredient ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={(tried && many.trim() === '' && isNewIngredient) || undefined} value={many} maxLength={40} onChange={(e) => setMany(e.target.value)} placeholder="cookies" />
            </div>
          </>
        )}
      </div>
      <div className={lib.actionsRow}>
        <Button variant="primary" disabled={pending} onClick={use}>
          {pending ? 'Adding…' : 'Use this'}
        </Button>
        {tried && !ready && <span className={styles.badNote} role="alert">{reason}</span>}
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </FormPanel>
  );
}

/** What a variation holds that would be lost with it: "its 3 changes", "its note", "its Not suitable answer". */
function variationHolds(v: { state: VariationState; note: string; lines: readonly unknown[] }): string[] {
  return [v.lines.length > 0 ? `${v.lines.length} ${v.lines.length === 1 ? 'change' : 'changes'}` : '', v.note.trim() !== '' ? 'note' : '', v.state === 'unsuitable' ? 'Not suitable answer' : ''].filter(Boolean);
}
/** "Its 3 changes and its note go too" / "Its 1 change goes too". */
function sentenceOf(parts: string[]): string {
  const withIts = parts.map((p) => `its ${p}`);
  const s = withIts.length > 1 ? `${withIts.slice(0, -1).join(', ')} and ${withIts[withIts.length - 1]}` : withIts[0];
  const plural = parts.length > 1 || /^[2-9]|^\d\d/.test(parts[0]);
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} ${plural ? 'go' : 'goes'} too`;
}

function toggle<T>(list: T[], key: T, on: boolean): T[] {
  return on ? (list.includes(key) ? list : [...list, key]) : list.filter((k) => k !== key);
}

/* ── Ingredient picker + unit select, shared by base and variation rows ─── */

function IngredientSelect({ id, label, value, ingredients, invalid = false, onChange }: { id: string; label: string; value: string; ingredients: Ingredient[]; invalid?: boolean; onChange: (id: string) => void }) {
  // Section by section, A to Z inside each; the section and unit words are searchable too ("cups", "bakery").
  const options = useMemo<ComboOption[]>(
    () =>
      SECTION_ORDER.flatMap((s) =>
        ingredients
          .filter((i) => i.section === s)
          .map((i) => ({ value: i.id, label: i.name, detail: SECTIONS[s], keywords: [i.unit.one, i.unit.many] }))
      ),
    [ingredients]
  );
  return <AdminCombobox id={id} label={label} options={options} value={value} invalid={invalid} placeholder="Type to search…" noMatch="No ingredient matches" onChange={onChange} />;
}

function UnitSelect({ id, label, ingredient, unitKey, catalog, onChange }: { id: string; label: string; ingredient: Ingredient | null; unitKey: string | null; catalog: Catalog; onChange: (k: string | null) => void }) {
  const units = ingredient ? supportedUnits(ingredient, catalog.conversions) : [];
  return (
    <select
      id={id}
      aria-label={label}
      className={lib.selectInput}
      value={unitKey ?? ingredient?.unit.key ?? ''}
      disabled={!ingredient || units.length <= 1}
      title={ingredient && units.length <= 1 ? `${ingredient.name} is only measured in ${ingredient.unit.many} — add a conversion in the Price book for more` : undefined}
      onChange={(e) => onChange(ingredient && e.target.value === ingredient.unit.key ? null : e.target.value)}
    >
      {!ingredient && <option value="">—</option>}
      {ingredient &&
        units.map((k) => (
          <option key={k} value={k}>
            {lineUnit(k, ingredient).many}
          </option>
        ))}
    </select>
  );
}

/* ── One base line (the Everyone tab) ──────────────────────────────────── */

function BaseLineRow({
  idx,
  line,
  ingredients,
  ingredient,
  catalog,
  problems = [],
  onChange,
  onRemove
}: {
  idx: number;
  line: DraftBaseLine;
  ingredients: Ingredient[];
  ingredient: Ingredient | null;
  catalog: Catalog;
  /** What is wrong with this line (the same sentences the Needs fixing box lists). */
  problems?: string[];
  onChange: (patch: Partial<DraftBaseLine>) => void;
  onRemove: () => void;
}) {
  const n = idx + 1;
  return (
    <li className={problems.length > 0 ? `${styles.lineRow} ${styles.bad}` : styles.lineRow}>
      <div className={styles.grow}>
        <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-l-${idx}-ing`}>
          Ingredient
        </label>
        <IngredientSelect id={`mm-l-${idx}-ing`} label={`Line ${n} ingredient`} value={line.ingredientId} ingredients={ingredients} invalid={problems.some((t) => !/amount/.test(t))} onChange={(id) => onChange({ ingredientId: id, unitKey: null })} />
      </div>
      <div className={styles.narrow}>
        <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-l-${idx}-amt`}>
          {line.scale === 'meal' ? 'Amount for the whole meal' : 'Amount per person'}
        </label>
        <input id={`mm-l-${idx}-amt`} aria-label={`Line ${n} amount`} className={lib.textInput} aria-invalid={problems.some((t) => /amount/.test(t)) || undefined} value={line.amount} placeholder="½" onChange={(e) => onChange({ amount: e.target.value })} />
      </div>
      <div>
        <span className={`adminLabel ${lib.fieldLabel}`}>For</span>
        <SegmentedControl
          name={`mm-l-${idx}-scale`}
          label={`Line ${n} amount is for`}
          value={line.scale === 'meal' ? 'meal' : 'person'}
          options={[
            { value: 'person', label: 'per person' },
            { value: 'meal', label: 'whole meal' }
          ]}
          onChange={(v) => onChange({ scale: v === 'meal' ? 'meal' : undefined })}
        />
      </div>
      <div className={styles.narrow}>
        <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-l-${idx}-unit`}>
          Unit
        </label>
        <UnitSelect id={`mm-l-${idx}-unit`} label={`Line ${n} unit`} ingredient={ingredient} unitKey={line.unitKey} catalog={catalog} onChange={(k) => onChange({ unitKey: k })} />
      </div>
      {line.ingredientId && (
        // The Price book opens on this ingredient in a new tab, so the recipe being edited stays as it is.
        <Button variant="quiet" size="sm" href={`/admin/library/menu-monster?tab=prices&ingredient=${encodeURIComponent(line.ingredientId)}`} target="_blank" aria-label={`Edit ingredient ${ingredient?.name ?? `on line ${n}`}`} title="Opens the Price book in a new tab">
          Edit ingredient
        </Button>
      )}
      <Button variant="quiet" size="sm" aria-label={`Remove line ${n}`} onClick={onRemove}>
        Remove
      </Button>
      {problems.map((text) => (
        <p key={text} className={styles.badNote}>
          {text}
        </p>
      ))}
    </li>
  );
}

/* ── A single food's short form ───────────────────────────────────────── */

function SingleFoodFields({
  draft,
  setDraft,
  food,
  catalog,
  onFull,
  make,
  bad,
  gearList
}: {
  gearList: readonly GearItem[];
  /** The food already has steps or gear: show both fields. */
  make: boolean;
  bad: { name: boolean; mealFit: boolean; amount: string[] };
  draft: RecipeAuthoring;
  setDraft: (fn: (d: RecipeAuthoring) => RecipeAuthoring) => void;
  food: Ingredient | null;
  catalog: Catalog;
  onFull: () => void;
}) {
  const line = draft.base[0];
  const foodName = food?.name ?? 'this food';
  const ingredients = catalog.ingredients.filter((i) => !i.retiredAt);
  const ingById = new Map(catalog.ingredients.map((i) => [i.id, i]));
  // Diets worth a row: one the food is flagged for (needs an answer), or one a leader has answered.
  const diets = RESTRICTIONS.map((r) => ({ r, v: draft.variations.find((x) => x.restriction === r.key) ?? null, view: viewFor(draft, r.key, catalog) })).filter((x) => x.v || x.view !== 'not_needed');
  const unanswered = RESTRICTIONS.filter((r) => !diets.some((d) => d.r.key === r.key));
  /** Set a diet's answer; "Instead…" starts one swap line of this food, with its amount. */
  const answerDiet = (key: RestrictionKey, state: VariationState) =>
    setDraft((d) => {
      const cur = d.variations.find((v) => v.restriction === key);
      const lines: DraftVariationLine[] =
        state !== 'substituted' ? [] : cur?.lines.some((l) => l.op === 'swap') ? cur.lines : [{ op: 'swap', baseIngredientId: line?.ingredientId ?? '', ingredientId: null, amount: line?.amount ?? '', unitKey: null }];
      const next: DraftVariation = { restriction: key, state, note: cur?.note ?? '', lines };
      return { ...d, variations: cur ? d.variations.map((v) => (v.restriction === key ? next : v)) : [...d.variations, next] };
    });
  // Dropping a diet's answer (Remove, or an answer that holds no swap) names what goes first; an empty one just goes.
  const [removingDiet, setRemovingDiet] = useState<RestrictionKey | null>(null);
  const [pendingDiet, setPendingDiet] = useState<{ key: RestrictionKey; state: VariationState } | null>(null);
  const removeDiet = (key: RestrictionKey) => setDraft((d) => ({ ...d, variations: d.variations.filter((x) => x.restriction !== key) }));
  const patchSwap = (key: RestrictionKey, patch: Partial<DraftVariationLine>) =>
    setDraft((d) => ({ ...d, variations: d.variations.map((v) => (v.restriction === key ? { ...v, lines: v.lines.map((l) => (l.op === 'swap' ? { ...l, ...patch } : l)) } : v)) }));
  return (
    <>
      <div className={lib.fieldGrid}>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-f-name">
            Name
          </label>
          <input id="mm-f-name" className={bad.name ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={bad.name || undefined} value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-f-amt">
            Each person gets
          </label>
          <div className={bad.amount.length > 0 ? `${styles.inlineForm} ${styles.bad}` : styles.inlineForm}>
            <input
              id="mm-f-amt"
              className={`${lib.textInput} ${styles.narrow}`}
              value={line?.amount ?? ''}
              placeholder="½"
              onChange={(e) => setDraft((d) => ({ ...d, base: d.base.map((l, i) => (i === 0 ? { ...l, amount: e.target.value } : l)) }))}
            />
            <div className={styles.narrow}>
              <UnitSelect
                id="mm-f-unit"
                label="Each person gets, unit"
                ingredient={food}
                unitKey={line?.unitKey ?? null}
                catalog={catalog}
                onChange={(k) => setDraft((d) => ({ ...d, base: d.base.map((l, i) => (i === 0 ? { ...l, unitKey: k } : l)) }))}
              />
            </div>
            {bad.amount.map((text) => (
              <p key={text} className={styles.badNote}>
                {text}
              </p>
            ))}
          </div>
        </div>
        <fieldset className={bad.mealFit ? `${styles.fieldset} ${styles.bad}` : styles.fieldset}>
          <legend className={`adminLabel ${lib.fieldLabel}`}>Meal fit</legend>
          {MEALS.map((m) => (
            <label key={m.key} className={styles.listRow}>
              <input type="checkbox" checked={draft.mealFit.includes(m.key)} onChange={(e) => setDraft((d) => ({ ...d, mealFit: toggle(d.mealFit, m.key, e.target.checked) }))} /> {m.label}
            </label>
          ))}
          {bad.mealFit && <p className={styles.badNote}>Pick at least one meal.</p>}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={`adminLabel ${lib.fieldLabel}`}>Food groups (MyPlate)</legend>
          {FOOD_GROUPS.map((g) => (
            <label key={g.key} className={styles.listRow}>
              <input type="checkbox" checked={draft.foodGroups.includes(g.key)} onChange={(e) => setDraft((d) => ({ ...d, foodGroups: toggle(d.foodGroups, g.key, e.target.checked) }))} /> {g.label}
            </label>
          ))}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={`adminLabel ${lib.fieldLabel}`}>Where it works</legend>
          <label className={styles.listRow}>
            <input type="checkbox" checked={draft.camp} onChange={(e) => setDraft((d) => ({ ...d, camp: e.target.checked }))} /> Camp
          </label>
          <label className={styles.listRow}>
            <input type="checkbox" checked={draft.trail} onChange={(e) => setDraft((d) => ({ ...d, trail: e.target.checked }))} /> Trail (no fridge, light)
          </label>
        </fieldset>
      </div>
      {/* Diets, answered right here (Patrick, 2026-10-05: there was "no obvious way to add a variation for vegetarian
          bacon", and the full editor turned it into a recipe). One row per diet the food is flagged for or a leader
          has answered; the rest come in through "Add a diet…". A swap is one line: what those scouts get instead. */}
      <fieldset className={styles.fieldset}>
        <legend className={`adminLabel ${lib.fieldLabel}`}>Diets</legend>
        {diets.length === 0 && <p className={styles.muted}>Nothing to answer — no diet is flagged for {foodName}.</p>}
        <div className={styles.dietRows}>
          {diets.map(({ r, v, view }) => {
            const lower = r.label.toLowerCase();
            const swap = v?.lines.find((l) => l.op === 'swap') ?? null;
            const swapIng = swap?.ingredientId ? (ingById.get(swap.ingredientId) ?? null) : null;
            const swapBad = swap != null && (!swap.ingredientId || !(parseQty(swap.amount) > 0));
            return (
              <div key={r.key} className={styles.dietRow}>
                <div className={styles.detailHead}>
                  <strong>{r.label}</strong>
                  {view === 'needs_look' && <Badge variant="warning">Needs an answer</Badge>}
                  <span className={styles.spacer} />
                  {v && (
                    <Button variant="quiet" size="sm" onClick={() => (variationHolds(v).length > 0 ? setRemovingDiet(r.key) : removeDiet(r.key))}>
                      Remove
                    </Button>
                  )}
                </div>
                <SegmentedControl
                  name={`mm-f-${r.key}`}
                  label={`What ${lower} scouts get`}
                  value={(v?.state ?? '') as VariationState | ''}
                  options={[
                    { value: 'nothing', label: 'Same as everyone' },
                    { value: 'substituted', label: 'Instead…' },
                    { value: 'unsuitable', label: 'Not suitable' }
                  ]}
                  onChange={(state) => {
                    if (!state) return;
                    if (state !== 'substituted' && (v?.lines.length ?? 0) > 0) setPendingDiet({ key: r.key, state });
                    else answerDiet(r.key, state);
                  }}
                />
                {pendingDiet?.key === r.key && (
                  <p className={styles.badNote} role="alert">
                    Switching drops {lower} scouts’ swap.{' '}
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => {
                        answerDiet(pendingDiet.key, pendingDiet.state);
                        setPendingDiet(null);
                      }}
                    >
                      Switch and drop it
                    </Button>
                    <Button variant="quiet" size="sm" onClick={() => setPendingDiet(null)}>
                      Keep it
                    </Button>
                  </p>
                )}
                {v?.state === 'nothing' && <p className={styles.hint}>{r.label} scouts get {foodName} as it is.</p>}
                {v?.state === 'unsuitable' && (
                  <p className={styles.hint}>
                    No {lower} version. The planner asks the patrol to plan something else for {lower} scouts.
                  </p>
                )}
                {v?.state === 'substituted' && swap && (
                  <div className={swapBad ? `${styles.lineRow} ${styles.bad}` : styles.lineRow}>
                    <div className={styles.grow}>
                      <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-f-${r.key}-ing`}>
                        {r.label} scouts get
                      </label>
                      <IngredientSelect id={`mm-f-${r.key}-ing`} label={`What ${lower} scouts get instead of ${foodName}`} value={swap.ingredientId ?? ''} ingredients={ingredients} invalid={!swap.ingredientId} onChange={(id) => patchSwap(r.key, { ingredientId: id || null, unitKey: null })} />
                    </div>
                    <div className={styles.narrow}>
                      <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-f-${r.key}-amt`}>
                        Each
                      </label>
                      <input id={`mm-f-${r.key}-amt`} aria-label={`Amount of ${swapIng?.name ?? 'the swap'} per ${lower} scout`} className={lib.textInput} aria-invalid={!!swap.ingredientId && !(parseQty(swap.amount) > 0) ? true : undefined} value={swap.amount} placeholder="½" onChange={(e) => patchSwap(r.key, { amount: e.target.value })} />
                    </div>
                    <div className={styles.narrow}>
                      <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-f-${r.key}-unit`}>
                        Unit
                      </label>
                      <UnitSelect id={`mm-f-${r.key}-unit`} label={`Unit for ${swapIng?.name ?? 'the swap'}`} ingredient={swapIng} unitKey={swap.unitKey} catalog={catalog} onChange={(k) => patchSwap(r.key, { unitKey: k })} />
                    </div>
                    {!swap.ingredientId && <p className={styles.badNote}>Pick what {lower} scouts get instead of {foodName}.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {removingDiet && (
          <DangerConfirm
            title={`Remove the ${RESTRICTION_BY_KEY[removingDiet].label.toLowerCase()} answer?`}
            sub={`${sentenceOf(variationHolds(draft.variations.find((x) => x.restriction === removingDiet) as DraftVariation))}. ${foodName} itself is not touched, and nothing is deleted until you save.`}
            confirmLabel="Remove answer"
            onCancel={() => setRemovingDiet(null)}
            onConfirm={() => {
              removeDiet(removingDiet);
              setRemovingDiet(null);
            }}
          />
        )}
        {unanswered.length > 0 && (
          <select
            className={`${lib.selectInput} ${styles.mealFilter}`}
            aria-label="Add a diet"
            value=""
            onChange={(e) => {
              if (e.target.value) answerDiet(e.target.value as RestrictionKey, 'nothing');
            }}
          >
            <option value="">Add a diet…</option>
            {unanswered.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      <div className={lib.fieldGrid}>
        {make && (
          <div className={lib.fieldFull}>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-f-steps">
              How to make it
            </label>
            <textarea id="mm-f-steps" className={lib.textArea} value={draft.stepsMd} maxLength={600} onChange={(e) => setDraft((d) => ({ ...d, stepsMd: e.target.value }))} />
          </div>
        )}
        {/* Gear is always here, even on a food with no steps: foil, a skillet, a cooler is a real need of a single food. */}
        <div className={lib.fieldFull}>
          <span id="mm-f-gear-label" className={`adminLabel ${lib.fieldLabel}`}>
            Gear you’ll need
          </span>
          <GearPicker labelledBy="mm-f-gear-label" gear={draft.gear ?? []} list={gearList} onChange={(gear) => setDraft((d) => ({ ...d, gear }))} />
        </div>
      </div>
      <p className={styles.hint}>
        <Button variant="quiet" size="sm" onClick={onFull}>
          Open the full editor
        </Button>{' '}
        to add a second ingredient (that makes {foodName} a recipe){make ? '' : ', or for steps'}.
      </p>
    </>
  );
}

/* ── One variation tab: state + the diff on the base ──────────────────── */

function VariationPanel({
  restriction,
  draft,
  catalog,
  ingredients,
  onChange,
  onRemove
}: {
  restriction: RestrictionKey;
  draft: RecipeAuthoring;
  catalog: Catalog;
  ingredients: Ingredient[];
  onChange: (fn: (v: DraftVariation) => DraftVariation) => void;
  onRemove: () => void;
}) {
  const v = draft.variations.find((x) => x.restriction === restriction) as DraftVariation;
  const label = RESTRICTION_BY_KEY[restriction].label;
  const lower = label.toLowerCase();
  const view = viewFor(draft, restriction, catalog);
  const flagged = flaggedIngredients(numericBase(draft), restriction, catalog);
  const ingById = new Map(catalog.ingredients.map((i) => [i.id, i]));
  // Switching to an answer that has no lines drops the ones it holds: said inline first, applied on a second click.
  const [pendingState, setPendingState] = useState<VariationState | null>(null);
  const applyState = (state: VariationState) => onChange((x) => ({ ...x, state, lines: state === 'substituted' ? x.lines : [] }));
  const setState = (state: VariationState) => {
    if (state !== 'substituted' && v.lines.length > 0) setPendingState(state);
    else applyState(state);
  };
  const baseIds = new Set(draft.base.map((b) => b.ingredientId));
  /** A swap or leave-out whose Everyone line is gone: kept visible with its own Remove, never hidden while it blocks Save. */
  const orphans = v.lines.map((l, i) => ({ l, i })).filter(({ l }) => (l.op === 'swap' || l.op === 'leave_out') && (!l.baseIngredientId || !baseIds.has(l.baseIngredientId)));

  /** The change recorded against one base ingredient, if any. */
  const opFor = (baseId: string) => v.lines.find((l) => (l.op === 'swap' || l.op === 'leave_out') && l.baseIngredientId === baseId);
  const setOp = (baseId: string, op: 'same' | 'swap' | 'leave_out') =>
    onChange((x) => {
      const rest = x.lines.filter((l) => !((l.op === 'swap' || l.op === 'leave_out') && l.baseIngredientId === baseId));
      if (op === 'same') return { ...x, lines: rest };
      const line: DraftVariationLine = { op, baseIngredientId: baseId, ingredientId: null, amount: '', unitKey: null };
      return { ...x, lines: [...rest, line] };
    });
  const patchOp = (baseId: string, patch: Partial<DraftVariationLine>) =>
    onChange((x) => ({ ...x, lines: x.lines.map((l) => (l.op === 'swap' && l.baseIngredientId === baseId ? { ...l, ...patch } : l)) }));
  const adds = v.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.op === 'add');
  const patchAdd = (i: number, patch: Partial<DraftVariationLine>) => onChange((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const removeAt = (i: number) => onChange((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }));

  return (
    <div role="region" aria-label={`${label} version`} className={styles.variation}>
      <div className={styles.detailHead}>
        <h3 className={styles.variationTitle}>{label} version</h3>
        <Badge variant={VIEW_VARIANT[view]}>{VIEW_LABEL[view]}</Badge>
        {flagged.length > 0 ? (
          <span className={styles.muted}>Flagged: {flagged.map((i) => i.name).join(', ')}</span>
        ) : (
          <span className={styles.muted}>No ingredient in the Everyone list is flagged for {lower}.</span>
        )}
        <span className={styles.spacer} />
        <Button variant="quiet" size="sm" onClick={onRemove}>
          Remove this variation
        </Button>
      </div>
      <div className={styles.stateRow}>
        <SegmentedControl
          name={`mm-v-${restriction}-state`}
          label={`What ${lower} scouts get`}
          value={v.state}
          options={[
            { value: 'substituted', label: 'Substitute' },
            { value: 'nothing', label: 'Nothing to change' },
            { value: 'unsuitable', label: 'Not suitable' }
          ]}
          onChange={setState}
        />
      </div>
      {pendingState && (
        <p className={styles.badNote} role="alert">
          Switching to {pendingState === 'unsuitable' ? 'Not suitable' : 'Nothing to change'} drops its {v.lines.length} {v.lines.length === 1 ? 'change' : 'changes'}.{' '}
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              applyState(pendingState);
              setPendingState(null);
            }}
          >
            Switch and drop them
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setPendingState(null)}>
            Keep them
          </Button>
        </p>
      )}

      {v.state === 'nothing' && <p className={styles.hint}>{label} scouts get the Everyone recipe as it is. The planner counts them with everyone else.</p>}
      {v.state === 'unsuitable' && (
        <p className={styles.hint}>
          No {lower} version of this. When a patrol enters {lower} scouts, the planner says so and asks them to plan something else for those scouts.
        </p>
      )}

      {v.state === 'substituted' && (
        <>
          <p className={styles.hint}>
            Changes from the Everyone recipe. A swap takes the base line away from {lower} scouts and gives them the new line instead; the planner sizes
            each by how many {lower} scouts are eating.
          </p>
          {orphans.length > 0 && (
            <ul className={styles.lineList} aria-label={`Changes with no Everyone line for ${lower} scouts`}>
              {orphans.map(({ l, i }) => (
                <li key={i} className={`${styles.lineRow} ${styles.bad}`}>
                  <div className={styles.grow}>
                    <span className={`adminLabel ${lib.fieldLabel}`}>{l.op === 'swap' ? 'A swap' : 'A leave-out'} of {ingById.get(l.baseIngredientId ?? '')?.name ?? 'a line that is gone'}</span>
                  </div>
                  <Button variant="quiet" size="sm" aria-label={`Remove the change ${i + 1}`} onClick={() => removeAt(i)}>
                    Remove
                  </Button>
                  <p className={styles.badNote}>The Everyone line it changes is gone — remove this change.</p>
                </li>
              ))}
            </ul>
          )}
          {draft.base.length === 0 ? (
            <p className={styles.muted}>Add the Everyone lines first.</p>
          ) : (
            <ul className={styles.lineList} aria-label={`Changes for ${lower} scouts`}>
              {draft.base.map((b) => {
                const ing = ingById.get(b.ingredientId);
                if (!ing) return null;
                const op = opFor(b.ingredientId);
                const q = parseQty(b.amount);
                const swapIng = op?.op === 'swap' && op.ingredientId ? (ingById.get(op.ingredientId) ?? null) : null;
                return (
                  <li key={b.ingredientId} className={styles.lineRow}>
                    <div className={styles.grow}>
                      <span className={`adminLabel ${lib.fieldLabel}`}>{ing.name}</span>
                      <span className={styles.muted}>{Number.isFinite(q) ? perPersonText(q, ing, lineUnit(b.unitKey, ing)) : b.amount}</span>
                    </div>
                    <div>
                      <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-v-${restriction}-${b.ingredientId}`}>
                        For {lower} scouts
                      </label>
                      <select
                        id={`mm-v-${restriction}-${b.ingredientId}`}
                        aria-label={`${ing.name} for ${lower} scouts`}
                        className={lib.selectInput}
                        value={op?.op ?? 'same'}
                        onChange={(e) => setOp(b.ingredientId, e.target.value as 'same' | 'swap' | 'leave_out')}
                      >
                        <option value="same">Same</option>
                        <option value="swap">Swap for…</option>
                        <option value="leave_out">Leave out</option>
                      </select>
                    </div>
                    {op?.op === 'swap' && (
                      <>
                        <div className={styles.grow}>
                          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-v-${restriction}-${b.ingredientId}-in`}>
                            Swap for
                          </label>
                          <IngredientSelect
                            id={`mm-v-${restriction}-${b.ingredientId}-in`}
                            label={`Swap ${ing.name} for`}
                            value={op.ingredientId ?? ''}
                            ingredients={ingredients}
                            onChange={(id) => patchOp(b.ingredientId, { ingredientId: id || null, unitKey: null })}
                          />
                        </div>
                        <div className={styles.narrow}>
                          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-v-${restriction}-${b.ingredientId}-amt`}>
                            Amount per person
                          </label>
                          <input
                            id={`mm-v-${restriction}-${b.ingredientId}-amt`}
                            aria-label={`Amount of ${swapIng?.name ?? 'the swap'} per person`}
                            className={op.ingredientId && !(parseQty(op.amount) > 0) ? `${lib.textInput} ${styles.bad}` : lib.textInput}
                            aria-invalid={(op.ingredientId && !(parseQty(op.amount) > 0)) || undefined}
                            value={op.amount}
                            placeholder="½"
                            onChange={(e) => patchOp(b.ingredientId, { amount: e.target.value })}
                          />
                        </div>
                        <div className={styles.narrow}>
                          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-v-${restriction}-${b.ingredientId}-unit`}>
                            Unit
                          </label>
                          <UnitSelect id={`mm-v-${restriction}-${b.ingredientId}-unit`} label={`Unit for the swap of ${ing.name}`} ingredient={swapIng} unitKey={op.unitKey} catalog={catalog} onChange={(k) => patchOp(b.ingredientId, { unitKey: k })} />
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {adds.length > 0 && (
            <ul className={styles.lineList} aria-label={`Extra lines for ${lower} scouts`}>
              {adds.map(({ l, i }, n) => {
                const ing = l.ingredientId ? (ingById.get(l.ingredientId) ?? null) : null;
                return (
                  <li key={i} className={styles.lineRow}>
                    <div className={styles.grow}>
                      <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-va-${restriction}-${i}-ing`}>
                        Extra ingredient
                      </label>
                      <IngredientSelect id={`mm-va-${restriction}-${i}-ing`} label={`Extra line ${n + 1} ingredient`} value={l.ingredientId ?? ''} ingredients={ingredients} onChange={(id) => patchAdd(i, { ingredientId: id || null, unitKey: null })} />
                    </div>
                    <div className={styles.narrow}>
                      <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-va-${restriction}-${i}-amt`}>
                        Amount per person
                      </label>
                      <input id={`mm-va-${restriction}-${i}-amt`} aria-label={`Extra line ${n + 1} amount`} className={l.ingredientId && !(parseQty(l.amount) > 0) ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={(l.ingredientId && !(parseQty(l.amount) > 0)) || undefined} value={l.amount} placeholder="½" onChange={(e) => patchAdd(i, { amount: e.target.value })} />
                    </div>
                    <div className={styles.narrow}>
                      <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-va-${restriction}-${i}-unit`}>
                        Unit
                      </label>
                      <UnitSelect id={`mm-va-${restriction}-${i}-unit`} label={`Extra line ${n + 1} unit`} ingredient={ing} unitKey={l.unitKey} catalog={catalog} onChange={(k) => patchAdd(i, { unitKey: k })} />
                    </div>
                    <Button variant="quiet" size="sm" aria-label={`Remove extra line ${n + 1}`} onClick={() => removeAt(i)}>
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className={lib.actionsRow}>
            <Button variant="quiet" size="sm" onClick={() => onChange((x) => ({ ...x, lines: [...x.lines, { op: 'add', baseIngredientId: null, ingredientId: null, amount: '', unitKey: null }] }))}>
              + Add a line just for {lower} scouts
            </Button>
          </div>
        </>
      )}

      <div className={lib.fieldGrid}>
        <div className={lib.fieldFull}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-v-${restriction}-note`}>
            Note for leaders (optional)
          </label>
          <input id={`mm-v-${restriction}-note`} className={lib.textInput} value={v.note} maxLength={200} onChange={(e) => onChange((x) => ({ ...x, note: e.target.value }))} placeholder="Why, or what to watch for" />
        </div>
      </div>
    </div>
  );
}

/* ── Preview: what one person on the selected tab gets, and the cost ─── */

function Preview({ draft, tab, catalog }: { draft: RecipeAuthoring; tab: Tab; catalog: Catalog }) {
  const [headcount, setHeadcount] = useState(10);
  const recipe = previewRecipe(draft, tab);
  const ingById = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const who = tab === 'everyone' ? 'person' : `${RESTRICTION_BY_KEY[tab].label.toLowerCase()} scout`;
  // Cost it as if everyone eating were on this tab: "only" lines size to the
  // full headcount, "except" lines to zero — the per-person cost of THIS version.
  const restrictions = { gf: 0, nut: 0, dairy: 0, veg: 0 };
  if (tab !== 'everyone') restrictions[tab] = headcount;
  const plan: Plan = {
    meal: (draft.mealFit[0] as MealSlot) ?? 'breakfast',
    headcount,
    restrictions,
    recipeIds: [recipe.id],
    packageChoice: {},
    qtyOverride: {},
    lineSource: {},
    budgetPerPerson: 0,
    date: '',
    patrol: ''
  };
  const lines = buildLines(plan, { ...catalog, recipes: [recipe] });
  const totals = totalsOf(lines, plan);

  return (
    <section className={styles.preview} aria-label="Preview">
      <p className={`adminLabel ${styles.issuesTitle}`}>What one {who} gets</p>
      {recipe.lines.length === 0 ? (
        <p className={styles.muted}>Nothing yet — add an ingredient line.</p>
      ) : (
        <ul className={styles.list}>
          {recipe.lines.map((l, i) => {
            const ing = ingById.get(l.ingredientId);
            if (!ing) return null;
            return <li key={i}>{perPersonText(l.qtyPerPerson, ing, lineUnit(l.unitKey, ing))}{l.scale === 'meal' ? ' (whole meal)' : ''}</li>;
          })}
        </ul>
      )}
      <div className={styles.previewCost}>
        <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-preview-people">
          People
        </label>
        <input
          id="mm-preview-people"
          type="number"
          min={MIN_HEADCOUNT}
          max={MAX_HEADCOUNT}
          className={`${lib.textInput} ${styles.narrow}`}
          value={headcount}
          onChange={(e) => setHeadcount(Math.min(MAX_HEADCOUNT, Math.max(MIN_HEADCOUNT, Number(e.target.value) || MIN_HEADCOUNT)))}
        />
        <p className={styles.readout}>
          <strong>{money(totals.perSpent)}</strong> spent per person · {money(totals.perUsed)} used
          {totals.unpriced.length > 0 ? <span className={styles.muted}> · not priced: {totals.unpriced.join(', ')}</span> : null}
        </p>
      </div>
      {lines.length > 0 && (
        <ul className={styles.list} aria-label="Cost by ingredient">
          {lines.map((l) => (
            <li key={l.ing.id} className={styles.listRow}>
              <span className={styles.grow}>
                {l.ing.name}
                {l.pkg ? <span className={styles.muted}> · {l.qty} × {l.pkg.name}</span> : <span className={styles.muted}> · not priced</span>}
              </span>
              <span>{money(l.spent)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

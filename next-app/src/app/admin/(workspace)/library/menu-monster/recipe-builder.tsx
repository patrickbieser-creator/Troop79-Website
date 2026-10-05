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
 * A SINGLE FOOD (authoring.ts isSingleFood: one ingredient, no diet swaps — Cookies, Bacon)
 * opens in a short form instead (Patrick, 2026-10-04; prototype concept-f-kinds/admin-food.html): its name,
 * what each person gets, meal fit and food groups, then its brands and their packages. No ingredient line;
 * Steps and Gear show only when the food already has some (bacon), so Cookies stays three fields. "Open the
 * full editor" goes to the food's own page — the way to a diet swap or a second ingredient; saving a new
 * name renames the ingredient too while the two still match.
 */
import { Fragment, useEffect, useMemo, useState, useTransition, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '../../../_components/button';
import { FormPanel, FormSection } from '../../../_components/form-panel';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { TabStrip } from '../../_components/tab-strip';
import { SearchField } from '../../_components/search-field';
import { useGuardedNav } from '../../_components/guarded-nav';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { money } from '@/lib/event-money';
import {
  METHODS,
  asSingleFood,
  authoringIssues,
  authoringOf,
  compileAuthoring,
  isSingleFood,
  type DraftBaseLine,
  type DraftVariation,
  type DraftVariationLine,
  type RecipeAuthoring,
  type RecipeIssue
} from '@/lib/menu-monster/authoring';
import { VIEW_LABEL, flaggedIngredients, type VariationView } from '@/lib/menu-monster/variations';
import { NO_FILTER, buildFoodRows, filterFoodRows, foodListHref, inKind, numericBase, pillOf, recipeHref, viewFor, type FoodFilter, type FoodRow, type ListKind, type Pill } from '@/lib/menu-monster/food-list';
import { buildLines, ruleText, totalsOf, MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import { FOOD_GROUPS, MEALS, RESTRICTIONS, RESTRICTION_BY_KEY, SECTIONS, SECTION_ORDER, lineUnit, parseQty, perPersonText, supportedUnits } from '@/lib/menu-monster/units';
import type { Catalog, Ingredient, MealSlot, Plan, Recipe, RecipeLine, RestrictionKey, Section, VariationState } from '@/lib/menu-monster/types';
import { createIngredient, duplicateRecipe, saveRecipe, setRecipeStatus, updateIngredient } from './actions';
import { BrandsAndPrices } from './brands-prices';
import { NewFoodForm } from './new-food-form';
import lib from '../library.module.css';
import { SuggestedBrands } from './suggested-brands';
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
const ARM_MS = 4000;
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
  gear: ''
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
    .map((l) => ({ ingredientId: l.ingredientId, qtyPerPerson: parseQty(l.amount), unitKey: l.unitKey, servesRule: l.servesRule, servesRestrictions: l.servesRestrictions }));
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

function useArmed(): { armed: boolean; arm: () => boolean } {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return {
    armed,
    arm: () => {
      if (armed) {
        setArmed(false);
        return true;
      }
      setArmed(true);
      return false;
    }
  };
}

const KIND_TABS: readonly { key: ListKind; label: string; always: boolean }[] = [
  { key: 'all', label: 'All', always: true },
  { key: 'foods', label: 'Single foods', always: true },
  { key: 'recipes', label: 'Recipes', always: true },
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
  today = null
}: {
  catalog: Catalog;
  initialRecipeId?: string;
  initialFilter?: FoodFilter;
  stores?: readonly string[];
  today?: string | null;
}) {
  const router = useRouter();
  const { navigate, dialog } = useGuardedNav();
  const [selectedId, setSelectedId] = useState<string | null>(initialRecipeId ?? null);
  const [filter, setFilterState] = useState<FoodFilter>(initialFilter);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const rows = useMemo(() => buildFoodRows(catalog), [catalog]);
  // The open food stays listed whatever the filter, so its editor never vanishes mid-edit.
  const shown = filterFoodRows(rows, filter, selectedId);
  const count = (k: ListKind) => rows.filter((x) => inKind(x, k)).length;
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
        <SearchField value={filter.q} onChange={(q) => setFilter({ q })} label="Search food and recipes" resultCount={shown.length} totalCount={rows.length} />
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
                    </td>
                    <td>{row.food ? 'Food' : 'Recipe'}</td>
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
            {shown.length === 0 && (
              <tr>
                <td colSpan={COLUMNS} className={styles.muted}>
                  {rows.length === 0 ? 'No menu items yet.' : 'No items match.'}
                  {rows.length > 0 && filtered && (
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
  onSelect,
  onChanged,
  onOpenFull,
  onShortForm
}: {
  mode: 'inline' | 'page';
  initial: RecipeAuthoring;
  catalog: Catalog;
  stores: readonly string[];
  today: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  /** Inline: go to this food's own page for the full editor. */
  onOpenFull?: () => void;
  /** Page: go back to this single food's short form in the list. */
  onShortForm?: () => void;
}) {
  const [draft, setDraft] = useState<RecipeAuthoring>(initial);
  const [tab, setTab] = useState<Tab>('everyone');
  const [adding, setAdding] = useState(false);
  const [newIngredient, setNewIngredient] = useState(false);
  const snap = useDraftSnapshot(draft);
  const feedback = useSavePhase();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const retire = useArmed();
  const isNew = draft.id === NEW_ID;
  /** The "Make it a single food" panel is open (a recipe only). */
  const [makingFood, setMakingFood] = useState(false);

  const issues = authoringIssues(draft, catalog);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const blocker = saveBlocker(draft, issues);
  const publishTitle = errors.length > 0 ? errors[0].text : snap.dirty ? 'Save changes first' : isNew ? 'Save it first' : undefined;
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
  const missing = RESTRICTIONS.filter((r) => !draft.variations.some((v) => v.restriction === r.key));
  const toLook = missing.filter((r) => viewFor(draft, r.key, catalog) === 'needs_look').length;
  const activeTab: Tab = tab === 'everyone' || draft.variations.some((v) => v.restriction === tab) ? tab : 'everyone';

  function run(fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, after?: (id?: string) => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      after?.(res.id);
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
      (id) => {
        feedback.done();
        snap.markSaved();
        if (isNew && id) {
          setDraft((d) => ({ ...d, id }));
          onSelect(id);
        }
      }
    );
  }

  const setBase = (idx: number, patch: Partial<DraftBaseLine>) =>
    setDraft((d) => ({ ...d, base: d.base.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
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
    <section className={styles.editor} aria-label={isNew ? 'New recipe' : `Edit ${snap.saved.name}`}>
      {/* Under a row there is nothing to say until something is unsaved: the row has the name and the status. */}
      {(mode === 'page' || snap.dirty) && (
      <div className={styles.detailHead}>
        {single && !compact && onShortForm && (
          <Button variant="quiet" size="sm" disabled={snap.dirty} title={snap.dirty ? 'Save or discard your changes first' : undefined} onClick={onShortForm}>
            Back to the short form
          </Button>
        )}
        {mode === 'page' && <Badge variant={PILL_VARIANT[pill]}>{pill}</Badge>}
        {snap.dirty && <Badge variant="warning">Unsaved edits</Badge>}
        {!isNew && !single && snap.saved.status !== 'retired' && (
          <>
            <span className={styles.spacer} />
            <Button variant="secondary" size="sm" disabled={makingFood} onClick={() => setMakingFood(true)}>
              Make it a single food
            </Button>
          </>
        )}
      </div>
      )}
      {error && <Notice>{error}</Notice>}
      {/* A single food that is being given a second ingredient or a diet swap: said before the save, not after. */}
      {snap.saved.foodIngredientId && !isSingleFood(draft) && (
        <p className={styles.hint} role="status">
          Saving this makes {snap.saved.name} a recipe. {ingById.get(snap.saved.foodIngredientId)?.name ?? 'The food'} stays in the Price book as an ingredient.
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
          <SingleFoodFields draft={draft} setDraft={setDraft} food={food} catalog={catalog} onFull={() => onOpenFull?.()} make={snap.saved.stepsMd.trim() !== '' || (snap.saved.gear ?? '').trim() !== ''} bad={{ name: badField('name'), mealFit: badField('mealFit'), amount: lineProblems(food?.id ?? '').filter((t) => !/priced package/.test(t)) }} />
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
                { key: 'everyone', label: 'Everyone', onSelect: () => setTab('everyone') },
                ...draft.variations.map((v) => ({ key: v.restriction, label: RESTRICTION_BY_KEY[v.restriction].label, onSelect: () => setTab(v.restriction) }))
              ]}
            />
            <span className={styles.spacer} />
            {missing.length > 0 && (
              <Button variant="secondary" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
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
                    onRemove={() => setDraft((d) => ({ ...d, base: d.base.filter((_, i) => i !== idx) }))}
                  />
                ))}
              </ul>
              <div className={lib.actionsRow}>
                <Button variant="secondary" onClick={() => setDraft((d) => ({ ...d, base: [...d.base, { ingredientId: '', amount: '', unitKey: null }] }))}>
                  + Add an ingredient
                </Button>
                <Button variant="quiet" aria-expanded={newIngredient} onClick={() => setNewIngredient((v) => !v)}>
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
                    if (res.id) setDraft((d) => ({ ...d, base: [...d.base, { ingredientId: res.id as string, amount: '', unitKey: null }] }));
                    if (res.ok) setNewIngredient(false);
                    onChanged();
                  }}
                  onCancel={() => setNewIngredient(false)}
                />
              )}
            </div>
          ) : (
            <VariationPanel
              restriction={activeTab}
              draft={draft}
              catalog={catalog}
              ingredients={ingredients}
              onChange={(fn) => setVariation(activeTab, fn)}
              onRemove={() => {
                setDraft((d) => ({ ...d, variations: d.variations.filter((v) => v.restriction !== activeTab) }));
                setTab('everyone');
              }}
            />
          )}
        </FormSection>

        <FormSection num={3} title="Steps">
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-r-steps">
            How to make it (optional)
          </label>
          <textarea id="mm-r-steps" className={lib.textArea} value={draft.stepsMd} maxLength={600} onChange={(e) => setDraft((d) => ({ ...d, stepsMd: e.target.value }))} />
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-r-gear">
            Gear you’ll need (optional, separated by commas)
          </label>
          <input id="mm-r-gear" className={lib.textInput} value={draft.gear ?? ''} maxLength={400} placeholder="Dutch oven, Tongs" onChange={(e) => setDraft((d) => ({ ...d, gear: e.target.value }))} />
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

        {/* On its own page the form is long: the save row stays in view, and says in words why a save is blocked
            (Patrick, 2026-10-05: the "Needs fixing" box was scrolled away and Save looked like it did nothing). */}
        <div className={mode === 'page' ? `${lib.actionsRow} ${styles.saveBar}` : lib.actionsRow}>
          <SaveButton dirty={snap.dirty} pending={pending} isNew={isNew} newLabel="Save draft" blocked={blocker != null} blockedReason={blocker ?? undefined} onClick={save} />
          <DiscardButton dirty={snap.dirty} pending={pending} onClick={() => setDraft(snap.saved)} />
          <SaveFeedback phase={feedback.phase} />
          {blocker && snap.dirty && (
            <span className={styles.saveBlocker} role="status">
              Can’t save yet: {blocker}
            </span>
          )}
          <span className={styles.spacer} />
          {!isNew && snap.saved.status !== 'retired' && snap.saved.status !== 'published' && (
            <Button variant="primary" disabled={pending || publishTitle != null} title={publishTitle} onClick={() => run(() => setRecipeStatus(draft.id, 'published'), () => setDraft((d) => ({ ...d, status: 'published' })))}>
              Publish
            </Button>
          )}
          {!isNew && snap.saved.status === 'retired' && (
            <Button variant="secondary" disabled={pending} onClick={() => run(() => setRecipeStatus(draft.id, 'draft'))}>
              Restore as draft
            </Button>
          )}
          {!isNew && (
            <Button variant="secondary" disabled={pending || snap.dirty} title={snap.dirty ? 'Save changes first' : undefined} onClick={() => run(() => duplicateRecipe(draft.id), (id) => id && onSelect(id))}>
              Duplicate
            </Button>
          )}
          {!isNew && snap.saved.status !== 'retired' && (
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (retire.arm()) run(() => setRecipeStatus(draft.id, 'retired'));
              }}
            >
              {retire.armed ? 'Click again to retire' : 'Retire'}
            </Button>
          )}
        </div>
        {snap.saved.status === 'retired' && (
          <p className={styles.hint}>{snap.saved.name} is retired. Patrols can&rsquo;t pick it any more; old plans keep their copy.</p>
        )}
      </FormPanel>

      {compact && food && (
        <FormPanel>
          <BrandsAndPrices ing={food} catalog={catalog} today={today} stores={stores} onChanged={onChanged} />
          <p className={styles.hint}>
            <Link href={`/admin/library/menu-monster?tab=prices&ingredient=${encodeURIComponent(food.id)}`}>Conversions and the unit for {food.name.toLowerCase()} are in the Price book →</Link>
          </p>
        </FormPanel>
      )}

      {!isNew && <SuggestedBrands recipeId={draft.id} catalog={catalog} onChanged={onChanged} />}

      <Preview draft={draft} tab={activeTab} catalog={catalog} />
    </section>
  );
}

/* ── A recipe → a single food ─────────────────────────────────────────────── */

const NEW_INGREDIENT = '__new';
const FOOD_SECTIONS = Object.keys(SECTIONS) as Section[];

/**
 * "Cookies are listed under a recipe. I need a way to move it to a single food" (Patrick, 2026-10-05).
 * Nothing stores which kind a menu item is: one ingredient and no diet swap IS a single food. So the move is
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

  const isNewIngredient = pick === NEW_INGREDIENT;
  const amountOk = parseQty(amount) > 0;
  const ready = amountOk && (!isNewIngredient || (name.trim() !== '' && one.trim() !== '' && many.trim() !== ''));
  const swaps = recipe.variations.filter((v) => v.lines.length > 0).length;
  const replaced = [
    recipe.base.length > 0 ? `its ${recipe.base.length} ingredient${recipe.base.length === 1 ? '' : 's'}` : null,
    swaps > 0 ? `${swaps} diet swap${swaps === 1 ? '' : 's'}` : null
  ].filter(Boolean);
  const title = `Make ${recipe.name.trim() || 'this'} a single food`;
  const idp = `mm-food-${recipe.id}`;

  function use() {
    setError(null);
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
          <input id={`${idp}-amount`} className={lib.textInput} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        {isNewIngredient && (
          <>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-name`}>
                Name
              </label>
              <input id={`${idp}-name`} className={lib.textInput} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
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
              <input id={`${idp}-one`} className={lib.textInput} value={one} maxLength={40} onChange={(e) => setOne(e.target.value)} placeholder="cookie" />
            </div>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`${idp}-many`}>
                Several are called
              </label>
              <input id={`${idp}-many`} className={lib.textInput} value={many} maxLength={40} onChange={(e) => setMany(e.target.value)} placeholder="cookies" />
            </div>
          </>
        )}
      </div>
      <div className={lib.actionsRow}>
        <Button variant="primary" disabled={pending || !ready} title={ready ? undefined : amountOk ? 'Name it and say what one and several are called' : 'Type how many each person gets'} onClick={use}>
          {pending ? 'Adding…' : 'Use this'}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </FormPanel>
  );
}

function toggle<T>(list: T[], key: T, on: boolean): T[] {
  return on ? (list.includes(key) ? list : [...list, key]) : list.filter((k) => k !== key);
}

/* ── Ingredient picker + unit select, shared by base and variation rows ─── */

function IngredientSelect({ id, label, value, ingredients, onChange }: { id: string; label: string; value: string; ingredients: Ingredient[]; onChange: (id: string) => void }) {
  return (
    <select id={id} aria-label={label} className={lib.selectInput} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— pick —</option>
      {SECTION_ORDER.map((s) => (
        <optgroup key={s} label={SECTIONS[s]}>
          {ingredients
            .filter((i) => i.section === s)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
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
        <IngredientSelect id={`mm-l-${idx}-ing`} label={`Line ${n} ingredient`} value={line.ingredientId} ingredients={ingredients} onChange={(id) => onChange({ ingredientId: id, unitKey: null })} />
      </div>
      <div className={styles.narrow}>
        <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-l-${idx}-amt`}>
          Amount per person
        </label>
        <input id={`mm-l-${idx}-amt`} aria-label={`Line ${n} amount`} className={lib.textInput} value={line.amount} placeholder="½" onChange={(e) => onChange({ amount: e.target.value })} />
      </div>
      <div className={styles.narrow}>
        <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-l-${idx}-unit`}>
          Unit
        </label>
        <UnitSelect id={`mm-l-${idx}-unit`} label={`Line ${n} unit`} ingredient={ingredient} unitKey={line.unitKey} catalog={catalog} onChange={(k) => onChange({ unitKey: k })} />
      </div>
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
  bad
}: {
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
  // Diets worth saying: a flagged ingredient with no answer yet, or an answer a leader gave.
  const diets = RESTRICTIONS.map((r) => ({ r, view: viewFor(draft, r.key, catalog) })).filter((x) => x.view !== 'not_needed');
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
      {diets.length > 0 && (
        <ul className={styles.list} aria-label="Diets">
          {diets.map(({ r, view }) => (
            <li key={r.key} className={styles.listRow}>
              <span>{r.label}</span>
              <Badge variant={VIEW_VARIANT[view]}>{VIEW_LABEL[view]}</Badge>
            </li>
          ))}
        </ul>
      )}
      {make && (
        <div className={lib.fieldGrid}>
          <div className={lib.fieldFull}>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-f-steps">
              How to make it
            </label>
            <textarea id="mm-f-steps" className={lib.textArea} value={draft.stepsMd} maxLength={600} onChange={(e) => setDraft((d) => ({ ...d, stepsMd: e.target.value }))} />
          </div>
          <div className={lib.fieldFull}>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-f-gear">
              Gear you’ll need (separated by commas)
            </label>
            <input id="mm-f-gear" className={lib.textInput} value={draft.gear ?? ''} maxLength={400} onChange={(e) => setDraft((d) => ({ ...d, gear: e.target.value }))} />
          </div>
        </div>
      )}
      <p className={styles.hint}>
        <Button variant="quiet" size="sm" onClick={onFull}>
          Open the full editor
        </Button>{' '}
        for {make ? '' : 'steps, gear, '}a diet swap or a second ingredient.
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
  const setState = (state: VariationState) => onChange((x) => ({ ...x, state, lines: state === 'substituted' ? x.lines : [] }));

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
      <div className={styles.stateRow} role="group" aria-label={`What ${lower} scouts get`}>
        <Button variant={v.state === 'substituted' ? 'primary' : 'secondary'} size="sm" aria-pressed={v.state === 'substituted'} onClick={() => setState('substituted')}>
          Substitute
        </Button>
        <Button variant={v.state === 'nothing' ? 'primary' : 'secondary'} size="sm" aria-pressed={v.state === 'nothing'} onClick={() => setState('nothing')}>
          Nothing to change
        </Button>
        <Button variant={v.state === 'unsuitable' ? 'primary' : 'secondary'} size="sm" aria-pressed={v.state === 'unsuitable'} onClick={() => setState('unsuitable')}>
          Not suitable
        </Button>
      </div>

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
            <Button variant="secondary" size="sm" onClick={() => onChange((x) => ({ ...x, lines: [...x.lines, { op: 'add', baseIngredientId: null, ingredientId: null, amount: '', unitKey: null }] }))}>
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
            return <li key={i}>{perPersonText(l.qtyPerPerson, ing, lineUnit(l.unitKey, ing))}</li>;
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

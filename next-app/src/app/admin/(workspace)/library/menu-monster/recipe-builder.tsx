'use client';

/**
 * Menu Monster leader tools — Recipe builder (Plans/Menu-Monster-Leader-Tools.md,
 * Plans/Menu-Monster-Recipe-Variations.md).
 *
 * Menu items grouped by meal on the left; the selected one's editor on the
 * right. A recipe is an EVERYONE tab (the base lines) plus a tab per
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
 */
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '../../../_components/button';
import { FormPanel, FormSection } from '../../../_components/form-panel';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { TabStrip } from '../../_components/tab-strip';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { money } from '@/lib/event-money';
import {
  METHODS,
  authoringIssues,
  authoringOf,
  blockingIssues,
  compileAuthoring,
  type DraftBaseLine,
  type DraftVariation,
  type DraftVariationLine,
  type RecipeAuthoring,
  type RecipeIssue
} from '@/lib/menu-monster/authoring';
import { VIEW_LABEL, flaggedIngredients, variationView, type BaseLine, type VariationView } from '@/lib/menu-monster/variations';
import { buildLines, ruleText, totalsOf, MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import { FOOD_GROUPS, MEALS, RESTRICTIONS, RESTRICTION_BY_KEY, SECTIONS, SECTION_ORDER, lineUnit, parseQty, perPersonText, supportedUnits } from '@/lib/menu-monster/units';
import type { Catalog, Ingredient, MealSlot, Plan, Recipe, RecipeLine, RestrictionKey, VariationState } from '@/lib/menu-monster/types';
import { duplicateRecipe, saveRecipe, setRecipeStatus } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

type Pill = 'Needs fixes' | 'Draft' | 'Published' | 'Retired';
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
const NEW_ID = '__new__';
const ARM_MS = 4000;
type Tab = 'everyone' | RestrictionKey;

const blankDraft = (): RecipeAuthoring => ({
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
  variations: []
});

/** The base as numbers, for the state rules (unparseable amounts count as 0). */
const numericBase = (a: RecipeAuthoring): BaseLine[] =>
  a.base.map((b) => ({ ingredientId: b.ingredientId, qtyPerPerson: parseQty(b.amount) || 0, unitKey: b.unitKey }));

function viewFor(a: RecipeAuthoring, r: RestrictionKey, catalog: Catalog): VariationView {
  return variationView(numericBase(a), a.variations.find((v) => v.restriction === r), r, catalog);
}

function pillOf(a: RecipeAuthoring, catalog: Catalog): Pill {
  if (a.status === 'retired') return 'Retired';
  if (blockingIssues(authoringIssues(a, catalog)).length > 0) return 'Needs fixes';
  return a.status === 'published' ? 'Published' : 'Draft';
}

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

export function RecipeBuilder({ catalog, initialRecipeId }: { catalog: Catalog; initialRecipeId?: string }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(initialRecipeId ?? null);
  const selected = selectedId === NEW_ID ? null : (catalog.recipes.find((r) => r.id === selectedId) ?? null);

  const groups = useMemo(() => {
    const by = new Map<string, Recipe[]>();
    for (const r of catalog.recipes) {
      const slot = r.mealFit[0] ?? 'unplaced';
      by.set(slot, [...(by.get(slot) ?? []), r]);
    }
    const out: { key: string; label: string; recipes: Recipe[] }[] = [];
    for (const m of MEALS) {
      const rs = by.get(m.key);
      if (rs?.length) out.push({ key: m.key, label: m.label, recipes: rs });
    }
    const rest = by.get('unplaced');
    if (rest?.length) out.push({ key: 'unplaced', label: 'No meal picked yet', recipes: rest });
    return out;
  }, [catalog.recipes]);

  return (
    <div className={styles.builder}>
      <nav className={styles.itemList} aria-label="Menu items">
        <div className={styles.toolbar}>
          <span className={styles.spacer} />
          <Button variant="secondary" size="sm" onClick={() => setSelectedId(NEW_ID)}>
            + New menu item
          </Button>
        </div>
        {groups.map((g) => (
          <div key={g.key} className={styles.itemGroup}>
            <p className={`adminLabel ${styles.itemGroupTitle}`}>{g.label}</p>
            {g.recipes.map((r) => {
              const a = authoringOf(r);
              const pill = pillOf(a, catalog);
              const toLook = RESTRICTIONS.filter((x) => viewFor(a, x.key, catalog) === 'needs_look').length;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={r.id === selectedId ? `${styles.itemBtn} ${styles.itemBtnOn}` : styles.itemBtn}
                  aria-current={r.id === selectedId ? 'true' : undefined}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span className={styles.grow}>
                    {r.name}
                    {toLook > 0 && <span className={styles.muted}> · {toLook} to look at</span>}
                  </span>
                  <Badge variant={PILL_VARIANT[pill]}>{pill}</Badge>
                </button>
              );
            })}
          </div>
        ))}
        {catalog.recipes.length === 0 && <p className={styles.muted}>No menu items yet.</p>}
      </nav>

      {selectedId === NEW_ID ? (
        <RecipeEditor key={NEW_ID} initial={blankDraft()} catalog={catalog} onSelect={setSelectedId} onChanged={() => router.refresh()} />
      ) : selected ? (
        <RecipeEditor key={selected.id} initial={authoringOf(selected)} catalog={catalog} onSelect={setSelectedId} onChanged={() => router.refresh()} />
      ) : (
        <p className={styles.muted}>{selectedId ? 'Refreshing…' : 'Pick a menu item, or add one.'}</p>
      )}
    </div>
  );
}

/* ── Editor ─────────────────────────────────────────────────────────────── */

function RecipeEditor({
  initial,
  catalog,
  onSelect,
  onChanged
}: {
  initial: RecipeAuthoring;
  catalog: Catalog;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<RecipeAuthoring>(initial);
  const [tab, setTab] = useState<Tab>('everyone');
  const [adding, setAdding] = useState(false);
  const snap = useDraftSnapshot(draft);
  const feedback = useSavePhase();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const retire = useArmed();
  const isNew = draft.id === NEW_ID;

  const issues = authoringIssues(draft, catalog);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const blocker = saveBlocker(draft, issues);
  const publishTitle = errors.length > 0 ? errors[0].text : snap.dirty ? 'Save changes first' : isNew ? 'Save it first' : undefined;
  const pill = pillOf(snap.saved, catalog);
  const ingredients = catalog.ingredients.filter((i) => !i.retiredAt);
  const ingById = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const compiled = compileAuthoring(draft).lines;
  const missing = RESTRICTIONS.filter((r) => !draft.variations.some((v) => v.restriction === r.key));
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
    run(
      () => saveRecipe(draft),
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
    <section className={styles.editor} aria-label={isNew ? 'New menu item' : `Edit ${snap.saved.name}`}>
      <div className={styles.detailHead}>
        <h2 className={styles.detailTitle}>{isNew ? 'New menu item' : snap.saved.name}</h2>
        <Badge variant={PILL_VARIANT[pill]}>{pill}</Badge>
        {snap.dirty && <Badge variant="warning">Unsaved edits</Badge>}
      </div>
      {error && <Notice>{error}</Notice>}

      <FormPanel>
        <FormSection num={1} title="Basics">
          <div className={lib.fieldGrid}>
            <div className={lib.fieldFull}>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-r-name">
                Name
              </label>
              <input id="mm-r-name" className={lib.textInput} value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Required" />
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
            <fieldset className={styles.fieldset}>
              <legend className={`adminLabel ${lib.fieldLabel}`}>Meal fit</legend>
              {MEALS.map((m) => (
                <label key={m.key} className={styles.listRow}>
                  <input type="checkbox" checked={draft.mealFit.includes(m.key)} onChange={(e) => setDraft((d) => ({ ...d, mealFit: toggle(d.mealFit, m.key, e.target.checked) }))} /> {m.label}
                </label>
              ))}
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
              <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
                + Add a variation
                {missing.some((r) => viewFor(draft, r.key, catalog) === 'needs_look') ? ` (${missing.filter((r) => viewFor(draft, r.key, catalog) === 'needs_look').length} need a look)` : ''}
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
              {draft.base.length === 0 && <p className={styles.muted}>No lines yet.</p>}
              <ul className={styles.lineList} aria-label="Ingredient lines">
                {draft.base.map((l, idx) => (
                  <BaseLineRow
                    key={idx}
                    idx={idx}
                    line={l}
                    ingredients={ingredients}
                    ingredient={ingById.get(l.ingredientId) ?? null}
                    catalog={catalog}
                    onChange={(patch) => setBase(idx, patch)}
                    onRemove={() => setDraft((d) => ({ ...d, base: d.base.filter((_, i) => i !== idx) }))}
                  />
                ))}
              </ul>
              <div className={lib.actionsRow}>
                <Button variant="secondary" size="sm" onClick={() => setDraft((d) => ({ ...d, base: [...d.base, { ingredientId: '', amount: '', unitKey: null }] }))}>
                  + Add a line
                </Button>
              </div>
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
        </FormSection>

        {errors.length > 0 && (
          <div className={styles.issues}>
            <p className={`adminLabel ${styles.issuesTitle}`}>Needs fixing before it can publish</p>
            <ul className={styles.issueList} aria-label="Needs fixing">
              {errors.map((i, n) => (
                <li key={n}>
                  {i.text}
                  {i.fix === 'price-book' && (
                    <>
                      {' '}
                      <Link href="/admin/library/menu-monster?tab=prices">Open the Price book</Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className={styles.issues}>
            <p className={`adminLabel ${styles.issuesTitle}`}>Worth a look</p>
            <ul className={styles.issueList} aria-label="Worth a look">
              {warnings.map((i, n) => (
                <li key={n}>{i.text}</li>
              ))}
            </ul>
          </div>
        )}

        {compiled.length > 0 && (
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

        <div className={lib.actionsRow}>
          <SaveButton dirty={snap.dirty} pending={pending} isNew={isNew} newLabel="Save draft" blocked={blocker != null} blockedReason={blocker ?? undefined} onClick={save} />
          <DiscardButton dirty={snap.dirty} pending={pending} onClick={() => setDraft(snap.saved)} />
          <SaveFeedback phase={feedback.phase} />
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

      <Preview draft={draft} tab={activeTab} catalog={catalog} />
    </section>
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
  onChange,
  onRemove
}: {
  idx: number;
  line: DraftBaseLine;
  ingredients: Ingredient[];
  ingredient: Ingredient | null;
  catalog: Catalog;
  onChange: (patch: Partial<DraftBaseLine>) => void;
  onRemove: () => void;
}) {
  const n = idx + 1;
  return (
    <li className={styles.lineRow}>
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
    </li>
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
                            className={lib.textInput}
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
                      <input id={`mm-va-${restriction}-${i}-amt`} aria-label={`Extra line ${n + 1} amount`} className={lib.textInput} value={l.amount} placeholder="½" onChange={(e) => patchAdd(i, { amount: e.target.value })} />
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

'use client';

/**
 * Menu Monster leader tools — Recipe builder (Plans/Menu-Monster-Leader-Tools.md).
 *
 * Menu items grouped by meal on the left; the selected one's editor on the
 * right — Basics, Ingredient lines (one line per ingredient with a "who gets
 * it" rule instead of a second recipe), Steps — with a live preview of what
 * one person gets and the cost per person at a chosen headcount. The status
 * pill is COMPUTED from recipeIssues(), never only a stored flag, so a
 * published item that lost its priced package reads "Needs fixes".
 *
 * Save is dirty-gated (the save-button standard); Publish waits for a save
 * and for zero blocking issues — and the action enforces the same gate.
 */
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '../../../_components/button';
import { FormPanel, FormSection } from '../../../_components/form-panel';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { money } from '@/lib/event-money';
import { METHODS, blockingIssues, recipeIssues, type DraftLine, type RecipeDraft, type RecipeIssue } from '@/lib/menu-monster/authoring';
import { buildLines, ruleText, totalsOf, MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import { FOOD_GROUPS, MEALS, RESTRICTIONS, SECTIONS, SECTION_ORDER, lineUnit, parseQty, perPersonText, supportedUnits } from '@/lib/menu-monster/units';
import type { Catalog, Ingredient, MealSlot, Plan, Recipe, RestrictionKey, ServesRule } from '@/lib/menu-monster/types';
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
const NEW_ID = '__new__';
const ARM_MS = 4000;

function draftOf(r: Recipe): RecipeDraft {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    mealFit: r.mealFit,
    foodGroups: r.foodGroups,
    camp: r.camp,
    trail: r.trail,
    method: r.method,
    stepsMd: r.stepsMd ?? '',
    lines: r.lines.map((l) => ({
      ingredientId: l.ingredientId,
      amount: String(l.qtyPerPerson),
      unitKey: l.unitKey,
      servesRule: l.servesRule,
      servesRestrictions: l.servesRestrictions
    }))
  };
}

const blankDraft = (): RecipeDraft => ({
  id: NEW_ID,
  name: '',
  status: 'draft',
  mealFit: [],
  foodGroups: [],
  camp: true,
  trail: false,
  method: null,
  stepsMd: '',
  lines: []
});

function pillOf(draft: RecipeDraft, catalog: Catalog): Pill {
  if (draft.status === 'retired') return 'Retired';
  if (blockingIssues(recipeIssues(draft, catalog)).length > 0) return 'Needs fixes';
  return draft.status === 'published' ? 'Published' : 'Draft';
}

/** Issues the TABLE cannot hold — these block Save, not only Publish. */
function saveBlocker(draft: RecipeDraft, issues: RecipeIssue[]): string | null {
  if (!draft.name.trim()) return 'Give the menu item a name.';
  for (const i of issues) {
    if (i.level !== 'error' || i.line == null) continue;
    if (/pick an ingredient|isn't a number|type an amount|combine them/.test(i.text)) return i.text;
  }
  return null;
}

/** A Recipe the engine can cost, from whatever parses in the draft. */
function previewRecipe(draft: RecipeDraft): Recipe {
  return {
    id: draft.id || NEW_ID,
    name: draft.name || 'Untitled',
    status: 'published',
    mealFit: draft.mealFit,
    foodGroups: draft.foodGroups,
    camp: draft.camp,
    trail: draft.trail,
    method: draft.method,
    stepsMd: draft.stepsMd,
    sortOrder: 0,
    lines: draft.lines
      .filter((l) => l.ingredientId && Number.isFinite(parseQty(l.amount)) && parseQty(l.amount) > 0)
      .map((l) => ({
        ingredientId: l.ingredientId,
        qtyPerPerson: parseQty(l.amount),
        unitKey: l.unitKey,
        servesRule: l.servesRule,
        servesRestrictions: l.servesRule === 'everyone' ? [] : l.servesRestrictions
      }))
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
              const pill = pillOf(draftOf(r), catalog);
              return (
                <button
                  key={r.id}
                  type="button"
                  className={r.id === selectedId ? `${styles.itemBtn} ${styles.itemBtnOn}` : styles.itemBtn}
                  aria-current={r.id === selectedId ? 'true' : undefined}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span className={styles.grow}>{r.name}</span>
                  <Badge variant={PILL_VARIANT[pill]}>{pill}</Badge>
                </button>
              );
            })}
          </div>
        ))}
        {catalog.recipes.length === 0 && <p className={styles.muted}>No menu items yet.</p>}
      </nav>

      {selectedId === NEW_ID ? (
        <RecipeEditor
          key={NEW_ID}
          initial={blankDraft()}
          catalog={catalog}
          onSelect={setSelectedId}
          onChanged={() => router.refresh()}
        />
      ) : selected ? (
        <RecipeEditor
          key={selected.id}
          initial={draftOf(selected)}
          catalog={catalog}
          onSelect={setSelectedId}
          onChanged={() => router.refresh()}
        />
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
  initial: RecipeDraft;
  catalog: Catalog;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<RecipeDraft>(initial);
  const snap = useDraftSnapshot(draft);
  const feedback = useSavePhase();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const retire = useArmed();
  const isNew = draft.id === NEW_ID;

  const issues = recipeIssues(draft, catalog);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const blocker = saveBlocker(draft, issues);
  const publishTitle = errors.length > 0 ? errors[0].text : snap.dirty ? 'Save changes first' : isNew ? 'Save it first' : undefined;
  const pill = pillOf(snap.saved, catalog);
  const ingredients = catalog.ingredients.filter((i) => !i.retiredAt);
  const ingById = new Map(catalog.ingredients.map((i) => [i.id, i]));

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

  const setLine = (idx: number, patch: Partial<DraftLine>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));

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
              <input id="mm-r-name" className={lib.textInput} value={draft.name} maxLength={60} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Required" />
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
                  <input
                    type="checkbox"
                    checked={draft.mealFit.includes(m.key)}
                    onChange={(e) => setDraft((d) => ({ ...d, mealFit: toggle(d.mealFit, m.key, e.target.checked) }))}
                  />{' '}
                  {m.label}
                </label>
              ))}
            </fieldset>
            <fieldset className={styles.fieldset}>
              <legend className={`adminLabel ${lib.fieldLabel}`}>Food groups (MyPlate)</legend>
              {FOOD_GROUPS.map((g) => (
                <label key={g.key} className={styles.listRow}>
                  <input
                    type="checkbox"
                    checked={draft.foodGroups.includes(g.key)}
                    onChange={(e) => setDraft((d) => ({ ...d, foodGroups: toggle(d.foodGroups, g.key, e.target.checked) }))}
                  />{' '}
                  {g.label}
                </label>
              ))}
            </fieldset>
          </div>
        </FormSection>

        <FormSection num={2} title="Ingredient lines — what one person gets">
          <p className={styles.hint}>
            One line per ingredient. Use &ldquo;Who gets it&rdquo; for swaps instead of a second recipe: set the regular line to
            &ldquo;everyone except gluten-free&rdquo; and add an &ldquo;only gluten-free&rdquo; line.
          </p>
          {draft.lines.length === 0 && <p className={styles.muted}>No lines yet.</p>}
          <ul className={styles.lineList} aria-label="Ingredient lines">
            {draft.lines.map((l, idx) => (
              <LineRow
                key={idx}
                idx={idx}
                line={l}
                ingredients={ingredients}
                ingredient={ingById.get(l.ingredientId) ?? null}
                catalog={catalog}
                onChange={(patch) => setLine(idx, patch)}
                onRemove={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== idx) }))}
              />
            ))}
          </ul>
          <div className={lib.actionsRow}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  lines: [...d.lines, { ingredientId: '', amount: '', unitKey: null, servesRule: 'everyone', servesRestrictions: [] }]
                }))
              }
            >
              + Add a line
            </Button>
          </div>
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

        <div className={lib.actionsRow}>
          <SaveButton
            dirty={snap.dirty}
            pending={pending}
            isNew={isNew}
            newLabel="Save draft"
            blocked={blocker != null}
            blockedReason={blocker ?? undefined}
            onClick={save}
          />
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

      <Preview draft={draft} catalog={catalog} />
    </section>
  );
}

function toggle<T>(list: T[], key: T, on: boolean): T[] {
  return on ? (list.includes(key) ? list : [...list, key]) : list.filter((k) => k !== key);
}

/* ── One ingredient line ──────────────────────────────────────────────── */

function LineRow({
  idx,
  line,
  ingredients,
  ingredient,
  catalog,
  onChange,
  onRemove
}: {
  idx: number;
  line: DraftLine;
  ingredients: Ingredient[];
  ingredient: Ingredient | null;
  catalog: Catalog;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const n = idx + 1;
  const units = ingredient ? supportedUnits(ingredient, catalog.conversions) : [];
  const unitValue = line.unitKey ?? ingredient?.unit.key ?? '';
  const who = line.servesRule === 'everyone' ? 'everyone' : `${line.servesRule}:${line.servesRestrictions[0] ?? ''}`;

  return (
    <li className={styles.lineRow}>
      <div className={styles.grow}>
        <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-l-${idx}-ing`}>
          Ingredient
        </label>
        <select
          id={`mm-l-${idx}-ing`}
          aria-label={`Line ${n} ingredient`}
          className={lib.selectInput}
          value={line.ingredientId}
          onChange={(e) => onChange({ ingredientId: e.target.value, unitKey: null })}
        >
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
        <select
          id={`mm-l-${idx}-unit`}
          aria-label={`Line ${n} unit`}
          className={lib.selectInput}
          value={unitValue}
          disabled={!ingredient || units.length <= 1}
          title={ingredient && units.length <= 1 ? `${ingredient.name} is only measured in ${ingredient.unit.many} — add a conversion in the Price book for more` : undefined}
          onChange={(e) => onChange({ unitKey: ingredient && e.target.value === ingredient.unit.key ? null : e.target.value })}
        >
          {!ingredient && <option value="">—</option>}
          {ingredient &&
            units.map((k) => (
              <option key={k} value={k}>
                {lineUnit(k, ingredient).many}
              </option>
            ))}
        </select>
      </div>
      <div>
        <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-l-${idx}-who`}>
          Who gets it
        </label>
        <select
          id={`mm-l-${idx}-who`}
          aria-label={`Line ${n} who gets it`}
          className={lib.selectInput}
          value={who}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'everyone') onChange({ servesRule: 'everyone', servesRestrictions: [] });
            else {
              const [rule, r] = v.split(':');
              onChange({ servesRule: rule as ServesRule, servesRestrictions: [r as RestrictionKey] });
            }
          }}
        >
          <option value="everyone">Everyone</option>
          {RESTRICTIONS.map((r) => (
            <option key={`except:${r.key}`} value={`except:${r.key}`}>
              Everyone except {r.label.toLowerCase()}
            </option>
          ))}
          {RESTRICTIONS.map((r) => (
            <option key={`only:${r.key}`} value={`only:${r.key}`}>
              Only {r.label.toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <Button variant="quiet" size="sm" aria-label={`Remove line ${n}`} onClick={onRemove}>
        Remove
      </Button>
    </li>
  );
}

/* ── Preview ──────────────────────────────────────────────────────────── */

function Preview({ draft, catalog }: { draft: RecipeDraft; catalog: Catalog }) {
  const [headcount, setHeadcount] = useState(10);
  const recipe = previewRecipe(draft);
  const ingById = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const plan: Plan = {
    meal: (draft.mealFit[0] as MealSlot) ?? 'breakfast',
    headcount,
    restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
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
      <p className={`adminLabel ${styles.issuesTitle}`}>What one person gets</p>
      {recipe.lines.length === 0 ? (
        <p className={styles.muted}>Nothing yet — add an ingredient line.</p>
      ) : (
        <ul className={styles.list}>
          {recipe.lines.map((l, i) => {
            const ing = ingById.get(l.ingredientId);
            if (!ing) return null;
            return (
              <li key={i}>
                {perPersonText(l.qtyPerPerson, ing, lineUnit(l.unitKey, ing))}
                {l.servesRule !== 'everyone' ? <span className={styles.muted}> · {ruleText(l)}</span> : null}
              </li>
            );
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

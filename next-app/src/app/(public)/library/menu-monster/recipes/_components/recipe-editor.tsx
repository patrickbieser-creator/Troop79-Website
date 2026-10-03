'use client';

/**
 * The scout recipe editor (Plans/Menu-Monster-Scout-Workspace.md, Phase 4A; a
 * port of the approved concept-e-scout-workspace/recipe-editor.html).
 *
 * Title line: the live recipe name + Save / Discard (the public save-button
 * standard) + Share with the troop. Left: the name, Good for and Food groups
 * chips, then Ingredients (People dialer and Total / Per person are a view, not
 * recipe data; IngredientList 'author' mode). Right: Steps (plain text, a grip
 * and a ⋯ per step). Save keeps a private draft the scout can use in their own
 * menus at once; Share publishes it with the frozen "Recipe by Sam K." credit
 * (saving first when there are unsaved changes). After sharing the scout can
 * keep editing (live); a retired recipe is read-only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { Button } from '@/app/_components/button';
import { Field, TextInput } from '@/app/_components/form';
import { Notice } from '@/app/_components/notice';
import { Stepper } from '@/app/_components/stepper';
import type { Catalog, FoodGroup, MealSlot } from '@/lib/menu-monster/types';
import { FOOD_GROUPS, MEALS } from '@/lib/menu-monster/units';
import { MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import type { AmountView } from '@/lib/menu-monster/ingredient-rows';
import { authorRows } from '@/lib/menu-monster/author-rows';
import { MAX_SCOUT_RECIPE_NAME, MAX_SCOUT_STEP, MAX_SCOUT_STEPS, shareProblems, type ScoutRecipeLine } from '@/lib/menu-monster/scout-recipes';
import type { RecipeStatus } from '@/lib/menu-monster/types';
import { saveScoutRecipeAction, shareScoutRecipeAction } from '../../../_tools/menu-monster/recipe-actions';
import { IngredientList } from '../../_components/ingredient-list';
import type { AuthorAction } from '../../_components/ingredient-list-author';
import { Grip, useDragReorder } from '../../_components/reorder';
import { RowMenu } from '../../menus/_components/row-menu';
import { SaveBar } from '../../menus/_components/save-bar';
import w from '../../menus/_components/workspace.module.css';
import s from './recipe-editor.module.css';
import { NewIngredientForm } from './new-ingredient-form';
import { overlayNewIngredients, type NewIngredient } from '@/lib/menu-monster/scout-ingredients';
import { RECIPES_HREF } from './paths';

const DEFAULT_PEOPLE = 8;

interface Draft {
  name: string;
  mealFit: MealSlot[];
  foodGroups: FoodGroup[];
  steps: { id: number; text: string }[];
  lines: ScoutRecipeLine[];
  /** Typed-in ingredients not saved yet (Phase 4B); lines name them by their new: key. */
  newIngredients: NewIngredient[];
}

export interface RecipeEditorProps {
  catalog: Catalog;
  /** null = a new recipe, not saved yet. */
  id: string | null;
  initial: { name: string; mealFit: MealSlot[]; foodGroups: FoodGroup[]; steps: string[]; lines: ScoutRecipeLine[]; originRecipeId: string | null };
  status: RecipeStatus;
  credit: string | null;
  updatedAt: string | null;
}

let stepSeq = 0;
const toDraft = (i: RecipeEditorProps['initial']): Draft => ({
  name: i.name,
  mealFit: [...i.mealFit],
  foodGroups: [...i.foodGroups],
  steps: i.steps.map((text) => ({ id: ++stepSeq, text })),
  lines: i.lines.map((l) => ({ ...l })),
  newIngredients: []
});
const keyOf = (d: Draft) => JSON.stringify({ ...d, steps: d.steps.map((x) => x.text.trim()).filter(Boolean) });
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const moveItem = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

export function RecipeEditor({ catalog, id: initialId, initial, status: initialStatus, credit: initialCredit, updatedAt }: RecipeEditorProps) {
  const router = useRouter();
  const [id, setId] = useState(initialId);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [savedKey, setSavedKey] = useState(() => keyOf(toDraft(initial)));
  const [savedDraft, setSavedDraft] = useState<Draft>(() => toDraft(initial));
  const [version, setVersion] = useState(updatedAt);
  const [status, setStatus] = useState(initialStatus);
  const [credit, setCredit] = useState(initialCredit);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [announce, setAnnounce] = useState('');
  const [people, setPeople] = useState(DEFAULT_PEOPLE);
  const [view, setView] = useState<AmountView>('total');
  const nameRef = useRef<HTMLInputElement | null>(null);
  const stepsRef = useRef<HTMLOListElement | null>(null);

  const isNew = id === null;
  const retired = status === 'retired';
  const dirty = keyOf(draft) !== savedKey;
  useLeaveGuard(dirty && !retired);

  // Typed-ins saved this visit but not in this page's catalog yet, keyed by their real id.
  const [savedTyped, setSavedTyped] = useState<NewIngredient[]>([]);
  const view$ = useMemo(() => overlayNewIngredients(catalog, [...savedTyped, ...draft.newIngredients]), [catalog, savedTyped, draft.newIngredients]);
  const rows = useMemo(() => authorRows(draft.lines, view$, people, view), [draft.lines, view$, people, view]);
  const choices = useMemo(() => view$.ingredients.map((i) => ({ id: i.id, name: i.name })), [view$.ingredients]);

  const edit = (f: (d: Draft) => Draft) => {
    setDraft(f);
    setJustSaved(false);
    setError(null);
  };

  function onIngredient(a: AuthorAction) {
    edit((d) => {
      if (a.type === 'add') return { ...d, lines: [...d.lines, { ingredientId: a.ingredientId, qtyPerPerson: 1, unitKey: null }] };
      if (a.type === 'remove') {
        return { ...d, lines: d.lines.filter((l) => l.ingredientId !== a.ingredientId), newIngredients: d.newIngredients.filter((n) => n.key !== a.ingredientId) };
      }
      if (a.type === 'move') return { ...d, lines: moveItem(d.lines, a.from, a.to) };
      return { ...d, lines: d.lines.map((l) => (l.ingredientId === a.ingredientId ? { ...l, qtyPerPerson: a.qtyPerPerson } : l)) };
    });
    if (a.type !== 'add') setProblems([]);
  }

  /* ---- Steps ---- */
  // Focus a step after React has rendered it (an added step's textarea doesn't exist yet when the click runs).
  const focusStep = useRef<number | null>(null);
  useEffect(() => {
    if (focusStep.current == null) return;
    stepsRef.current?.querySelectorAll('textarea')[focusStep.current]?.focus();
    focusStep.current = null;
  }, [draft.steps.length]);
  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= draft.steps.length || from === to) return;
    edit((d) => ({ ...d, steps: moveItem(d.steps, from, to) }));
    setAnnounce(`Step ${from + 1} moved to ${to + 1}.`);
  };
  const { itemProps, gripProps } = useDragReorder(moveStep);
  const addStep = () => {
    if (draft.steps.length >= MAX_SCOUT_STEPS) return;
    edit((d) => ({ ...d, steps: [...d.steps, { id: ++stepSeq, text: '' }] }));
    focusStep.current = draft.steps.length;
  };

  /* ---- Save / share ---- */
  async function save(): Promise<string | null> {
    if (!draft.name.trim()) {
      setError('Give your recipe a name.');
      nameRef.current?.focus();
      return null;
    }
    setBusy('save');
    setError(null);
    const sent = draft;
    const res = await saveScoutRecipeAction(
      {
        id,
        name: sent.name,
        mealFit: sent.mealFit,
        foodGroups: sent.foodGroups,
        steps: sent.steps.map((x) => x.text),
        lines: sent.lines,
        originRecipeId: initial.originRecipeId,
        newIngredients: sent.newIngredients
      },
      version
    ).catch(() => ({ ok: false as const, error: 'Couldn’t save your recipe. Your changes are still here — try again.' }));
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    // Typed-ins are real ingredients now: lines name their ids, and the overlay keeps them priced until the page reloads.
    const real = (k: string) => res.ids?.[k] ?? k;
    const landed: Draft = { ...sent, lines: sent.lines.map((l) => ({ ...l, ingredientId: real(l.ingredientId) })), newIngredients: [] };
    if (sent.newIngredients.length > 0) {
      setSavedTyped((prev) => [...prev, ...sent.newIngredients.map((n) => ({ ...n, key: real(n.key) }))]);
      setDraft((d) => (keyOf(d) === keyOf(sent) ? landed : d));
    }
    setSavedKey(keyOf(landed));
    setSavedDraft(landed);
    setVersion(res.updatedAt);
    setJustSaved(true);
    if (isNew) {
      setId(res.id);
      router.replace(`${RECIPES_HREF}/${res.id}`);
    }
    return res.id;
  }

  async function share() {
    const missing = shareProblems({ name: draft.name.trim(), mealFit: draft.mealFit, lines: draft.lines });
    setProblems(missing);
    if (missing.length > 0) return;
    const savedId = dirty || isNew ? await save() : id;
    if (!savedId) return;
    setBusy('share');
    const res = await shareScoutRecipeAction(savedId).catch(() => ({ ok: false as const, error: 'Couldn’t share your recipe. Try again.' }));
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setStatus('published');
    setCredit(res.credit);
    setAnnounce(`Shared with the troop as “Recipe by ${res.credit}”.`);
  }

  function discard() {
    setDraft(savedDraft);
    setError(null);
    setProblems([]);
  }

  const title = draft.name.trim() || (isNew ? 'New recipe' : 'Untitled recipe');

  return (
    <div>
      <div className={w.titleLine}>
        <h1 className={w.menuTitle}>{title}</h1>
        {!retired && (
          <span className={w.titleActions}>
            <SaveBar isNew={isNew} newLabel="Save draft" dirty={dirty} saving={busy === 'save'} saved={justSaved} onSave={() => void save()} onDiscard={discard} />
            {status !== 'published' && (
              <Button variant="secondary" onClick={() => void share()} disabled={busy !== null}>
                {busy === 'share' ? 'Sharing…' : 'Share with the troop'}
              </Button>
            )}
          </span>
        )}
      </div>
      <p className={w.foot}>{retired ? 'Retired by a leader · Read-only' : status === 'published' ? `Shared · Recipe by ${credit ?? ''}` : 'Draft · only you see it'}</p>
      <p className={w.srOnly} aria-live="polite">
        {announce}
      </p>

      {error && (
        <Notice tone="error" className={w.notice}>
          {error}
        </Notice>
      )}
      {problems.length > 0 && (
        <Notice tone="error" role="alert" className={w.notice}>
          <strong>Before sharing</strong>
          <ul className={s.problems}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}

      <fieldset className={s.fieldset} disabled={retired}>
        <div className={`${w.grid} ${s.grid}`}>
          <div className={w.col}>
            <section className={w.basics} aria-label="Recipe name, meals and food groups">
              <Field label="Recipe name">
                <TextInput ref={nameRef} value={draft.name} maxLength={MAX_SCOUT_RECIPE_NAME} autoComplete="off" placeholder="Campfire chili" onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))} />
              </Field>
              <ChipGroup label="Good for" options={MEALS} value={draft.mealFit} onToggle={(k) => edit((d) => ({ ...d, mealFit: toggle(d.mealFit, k) }))} />
              <ChipGroup label="Food groups" options={FOOD_GROUPS} value={draft.foodGroups} onToggle={(k) => edit((d) => ({ ...d, foodGroups: toggle(d.foodGroups, k) }))} />
            </section>

            <section aria-labelledby="re-ing-h">
              <div className={w.secHead}>
                <h2 id="re-ing-h" className={w.heading}>
                  Ingredients
                </h2>
                <div className={w.seg} role="group" aria-label="Show amounts as">
                  {(
                    [
                      ['total', 'Total to buy'],
                      ['person', 'Per person']
                    ] as const
                  ).map(([k, label]) => (
                    <button key={k} type="button" className={w.segBtn} aria-pressed={view === k} onClick={() => setView(k)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={w.line}>
                <Stepper id="re-people" label="People" value={people} min={MIN_HEADCOUNT} max={MAX_HEADCOUNT} onChange={setPeople} groupLabel="People" lessLabel="One fewer person" moreLabel="One more person" />
              </div>
              <div className={s.listCard}>
                <IngredientList
                  mode="author"
                  ariaLabel="Ingredients"
                  rows={rows}
                  choices={retired ? [] : choices}
                  emptyText="No ingredients yet."
                  onAction={onIngredient}
                  onAnnounce={setAnnounce}
                  renderNew={(name, done) => (
                    <NewIngredientForm
                      initialName={name}
                      catalog={view$}
                      onCancel={() => done(null)}
                      onAdd={(n) => {
                        edit((d) => ({ ...d, newIngredients: [...d.newIngredients, n], lines: [...d.lines, { ingredientId: n.key, qtyPerPerson: 1, unitKey: null }] }));
                        setAnnounce(`${n.name} added as a new ingredient. Set how much each person needs.`);
                        done(n.key);
                      }}
                    />
                  )}
                />
              </div>
            </section>
          </div>

          <div className={w.col}>
            <section aria-labelledby="re-steps-h">
              <h2 id="re-steps-h" className={w.heading}>
                Steps
              </h2>
              <ol className={s.steps} ref={stepsRef}>
                {draft.steps.map((step, i) => (
                  <li key={step.id} className={s.step} {...itemProps(i)}>
                    <Grip label={`step ${i + 1}`} onMove={(by) => moveStep(i, i + by)} dragProps={gripProps(i)} />
                    <span className={s.stepNum} aria-hidden="true">
                      {i + 1}
                    </span>
                    <textarea
                      className={s.stepText}
                      rows={2}
                      value={step.text}
                      maxLength={MAX_SCOUT_STEP}
                      aria-label={`Step ${i + 1}`}
                      placeholder="What happens next?"
                      onChange={(e) => edit((d) => ({ ...d, steps: d.steps.map((x) => (x.id === step.id ? { ...x, text: e.target.value } : x)) }))}
                    />
                    <RowMenu
                      label={`More for step ${i + 1}`}
                      items={[
                        ...(i > 0 ? [{ label: 'Move up', onSelect: () => moveStep(i, i - 1) }] : []),
                        ...(i < draft.steps.length - 1 ? [{ label: 'Move down', onSelect: () => moveStep(i, i + 1) }] : []),
                        {
                          label: 'Remove',
                          danger: true,
                          onSelect: () => {
                            edit((d) => ({ ...d, steps: d.steps.filter((x) => x.id !== step.id) }));
                            setAnnounce(`Step ${i + 1} removed.`);
                          }
                        }
                      ]}
                    />
                  </li>
                ))}
              </ol>
              {!retired && (
                <Button variant="ghost" onClick={addStep} disabled={draft.steps.length >= MAX_SCOUT_STEPS}>
                  Add a step
                </Button>
              )}
            </section>
          </div>
        </div>
      </fieldset>
    </div>
  );
}

function ChipGroup<K extends string>({ label, options, value, onToggle }: { label: string; options: readonly { key: K; label: string }[]; value: K[]; onToggle: (k: K) => void }) {
  return (
    <div className={w.choice} role="group" aria-label={label}>
      <span className={w.choiceLabel} aria-hidden="true">
        {label}
      </span>
      <div className={w.chips}>
        {options.map((o) => (
          <button key={o.key} type="button" className={w.chip} aria-pressed={value.includes(o.key)} onClick={() => onToggle(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

'use client';

/**
 * Menu Monster planner — the scout-facing half of the Cooking MB meal tool
 * (Plans/Menu-Monster.md). Behaviour and copy are ported from the validated
 * Concept A prototype (D:\Projects\Troop Menu Monster\prototypes\
 * concept-a-headcount-dial); the CSS is the site's, not the prototype's.
 *
 * Six steps on one screen, in the order a patrol works: (1) pick the meal,
 * (2) tick menu items, (3) say who's eating, (4) read the cost and the
 * shopping list, (5) print it, (6) write actuals on the sheet at the store.
 * Everything a scout edits is the `Plan`; the list and totals are DERIVED by
 * the pure engine on every render, never stored.
 *
 * Client state: the seed plan renders on first paint (the page is never
 * empty), then ONE mount effect folds the localStorage draft on top —
 * the library/mb-grid.tsx hydration pattern. Saves happen in commit(), not
 * an effect, so the seed never overwrites a stored draft before hydration.
 *
 * Rules kept from the prototype: no accordions for menu items or
 * restrictions (D-070 — package alternatives DO sit behind a click on the
 * line, directly under its header); status is icon + text, never colour
 * alone; 44px targets; aria-live totals; two-click Start over (no confirm());
 * inline notes instead of alert().
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { money } from '@/lib/event-money';
import { Badge } from '@/app/_components/badge';
import { Button } from '@/app/_components/button';
import { EmptyState } from '@/app/_components/empty-state';
import { Notice } from '@/app/_components/notice';
import { SectionDivider } from '@/app/_components/section-divider';
import { DateField } from '@/app/_components/date-field';
import { Field, FieldError, SelectInput, TextInput } from '@/app/_components/form';
import type {
  Catalog,
  LineSource,
  MealSlot,
  Package,
  Plan,
  RestrictionKey,
  ShoppingLine,
  Totals
} from '@/lib/menu-monster/types';
import { MEALS, RESTRICTIONS, SECTIONS, SOURCE_LABELS, lineUnit, perPersonText, qtyText } from '@/lib/menu-monster/units';
import {
  MAX_HEADCOUNT,
  MAX_QTY,
  MIN_HEADCOUNT,
  buildLines,
  isUsable,
  lineSentence,
  mathText,
  packCount,
  packNoun,
  plural,
  recipesForMeal,
  restorePlan,
  restrictionWarnings,
  ruleText,
  seedPlan,
  sourcesText,
  totalsOf,
  withMeal
} from '@/lib/menu-monster/engine';
import { PrintSheet } from './print-sheet';
import s from './planner.module.css';

export const PLAN_STORAGE_KEY = 'troop79.menuMonster.plan.v1';
const SUGGEST_HREF = '/library/submit?target=topic%3Amenu-monster';
const RESET_LABEL = 'Start over with the sample plan';
const RESET_ARMED_LABEL = 'Click again to throw away this draft';
const RESET_DISARM_MS = 4000;
const EPS = 1e-9;

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const mealLabel = (m: MealSlot) => MEALS.find((x) => x.key === m)?.label ?? cap(m);

/* ---- Budget readout: never colour-only (icon + sentence + role=status) ---- */

export type BudgetState = { tone: 'ok' | 'near' | 'over'; icon: string; msg: string };

export function budgetState(t: Totals, budget: number): BudgetState {
  if (t.perSpent <= budget + EPS) {
    return { tone: 'ok', icon: '✓', msg: `Under budget by ${money(budget - t.perSpent)} per person` };
  }
  if (t.perSpent <= budget * 1.1) {
    return { tone: 'near', icon: '!', msg: `Close: ${money(t.perSpent - budget)} per person over the target` };
  }
  return { tone: 'over', icon: '✗', msg: `Over budget by ${money(t.perSpent - budget)} per person` };
}

/* ---- A number box that commits on blur / Enter, not on every keystroke ----
   Typing "16" into a 2–16 field must not clamp "1" to 2 halfway through.
   Prop changes (the +/− buttons, a restore) reset the draft during render —
   React's derive-from-props pattern, no effect needed. */

function NumberBox({
  id,
  value,
  min,
  max,
  step = 1,
  onCommit,
  ariaLabel,
  describedBy,
  invalid
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (n: number) => void;
  ariaLabel?: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const show = (n: number) => (step < 1 ? n.toFixed(2) : String(n));
  const [prev, setPrev] = useState(value);
  const [draft, setDraft] = useState(() => show(value));
  if (prev !== value) {
    setPrev(value);
    setDraft(show(value));
  }
  function commit() {
    const raw = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(raw)) {
      setDraft(show(value));
      return;
    }
    const rounded = step < 1 ? Math.round(raw * 100) / 100 : Math.round(raw);
    const next = Math.min(max, Math.max(min, rounded));
    setDraft(show(next));
    onCommit(next);
  }
  return (
    <input
      type="number"
      inputMode={step < 1 ? 'decimal' : 'numeric'}
      id={id}
      className={s.numIn}
      value={draft}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

function Stepper({
  id,
  value,
  min,
  max,
  onChange,
  groupLabel,
  lessLabel,
  moreLabel,
  describedBy,
  invalid,
  small
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  groupLabel: string;
  lessLabel: string;
  moreLabel: string;
  describedBy?: string;
  invalid?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={[s.stepper, small ? s.stepperSmall : null, invalid ? s.stepperInvalid : null].filter(Boolean).join(' ')}
      role="group"
      aria-label={groupLabel}
    >
      <button
        type="button"
        className={s.stepBtn}
        aria-label={lessLabel}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <NumberBox id={id} value={value} min={min} max={max} onCommit={onChange} describedBy={describedBy} invalid={invalid} />
      <button
        type="button"
        className={s.stepBtn}
        aria-label={moreLabel}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}

/** Status pill: an icon AND words, so colour never carries the meaning alone. */
function StatusPill({ tone, icon, children }: { tone: 'ok' | 'short' | 'staple' | 'unpriced'; icon: string; children: ReactNode }) {
  return (
    <span className={`${s.status} ${s[`status_${tone}`]}`}>
      <span className={s.statusIco} aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}

/* ========================================================================== */

export function MenuMonsterPlanner({ catalog }: { catalog: Catalog }) {
  const [plan, setPlan] = useState<Plan>(() => seedPlan(catalog));
  const [openLines, setOpenLines] = useState<Set<string>>(() => new Set());
  const [resetArmed, setResetArmed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = useId();

  // Hydrate the saved draft once, after first paint (library/mb-grid.tsx pattern).
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(PLAN_STORAGE_KEY);
    } catch {
      // Private mode / blocked storage — the seed plan is fine.
    }
    if (!raw) return;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlan(restorePlan(parsed, catalog));
  }, [catalog]);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  function commit(next: Plan) {
    setPlan(next);
    try {
      window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Autosave is a convenience, not a feature.
    }
  }
  const patch = (f: (p: Plan) => Plan) => commit(f(plan));

  const lines = buildLines(plan, catalog);
  const totals = totalsOf(lines, plan);
  const warnings = restrictionWarnings(plan, catalog);
  const recipes = recipesForMeal(catalog, plan.meal);
  const ING = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const budget = budgetState(totals, plan.budgetPerPerson);
  const H = plan.headcount;

  const liveText = `${H} people. Spent ${money(totals.perSpent)} per person, ${money(totals.spent)} total. ${budget.msg}.`;

  /* ---- Plan edits ---- */
  const setHeadcount = (n: number) =>
    patch((p) => ({ ...p, headcount: Math.min(MAX_HEADCOUNT, Math.max(MIN_HEADCOUNT, Math.round(n) || MIN_HEADCOUNT)) }));
  const setRestriction = (k: RestrictionKey, n: number) =>
    patch((p) => ({ ...p, restrictions: { ...p.restrictions, [k]: Math.min(MAX_HEADCOUNT, Math.max(0, Math.round(n) || 0)) } }));
  const toggleRecipe = (id: string, on: boolean) =>
    patch((p) => ({ ...p, recipeIds: on ? [...new Set([...p.recipeIds, id])] : p.recipeIds.filter((x) => x !== id) }));
  const choosePackage = (ingId: string, pkgId: string) =>
    patch((p) => {
      const qtyOverride = { ...p.qtyOverride };
      delete qtyOverride[ingId];
      return { ...p, packageChoice: { ...p.packageChoice, [ingId]: pkgId }, qtyOverride };
    });
  const setQty = (l: ShoppingLine, n: number) => {
    if (!l.pkg) return;
    const q = Math.min(MAX_QTY, Math.max(0, Math.round(n) || 0));
    const pkgId = l.pkg.id;
    patch((p) => {
      const qtyOverride = { ...p.qtyOverride };
      if (q === l.autoQty) delete qtyOverride[l.ing.id];
      else qtyOverride[l.ing.id] = { packageId: pkgId, qty: q };
      return { ...p, qtyOverride };
    });
  };
  const resetQty = (ingId: string) =>
    patch((p) => {
      const qtyOverride = { ...p.qtyOverride };
      delete qtyOverride[ingId];
      return { ...p, qtyOverride };
    });
  const setSource = (ingId: string, source: LineSource) =>
    patch((p) => {
      const cur = p.lineSource[ingId] ?? { source: 'buy', note: '' };
      const qtyOverride = { ...p.qtyOverride };
      if (source !== 'buy') delete qtyOverride[ingId];
      return { ...p, lineSource: { ...p.lineSource, [ingId]: { source, note: cur.note } }, qtyOverride };
    });
  const setNote = (ingId: string, note: string) =>
    patch((p) => {
      const cur = p.lineSource[ingId] ?? { source: 'buy', note: '' };
      return { ...p, lineSource: { ...p.lineSource, [ingId]: { source: cur.source, note } } };
    });
  const toggleOpen = (ingId: string) =>
    setOpenLines((prev) => {
      const next = new Set(prev);
      if (next.has(ingId)) next.delete(ingId);
      else next.add(ingId);
      return next;
    });

  function startOver() {
    // Two clicks instead of confirm() — blocked in embedded/sandboxed pages.
    if (resetArmed) {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      setResetArmed(false);
      setOpenLines(new Set());
      commit(seedPlan(catalog));
      return;
    }
    setResetArmed(true);
    resetTimer.current = setTimeout(() => setResetArmed(false), RESET_DISARM_MS);
  }

  /* ---- Rail ---- */
  const hasItems = plan.recipeIds.length > 0;
  const rail: { label: string; note: string; state: 'done' | 'now' | 'todo' }[] = [
    { label: 'Meal', note: `${mealLabel(plan.meal)}, camp`, state: 'done' },
    { label: 'Menu items', note: hasItems ? `${plan.recipeIds.length} chosen` : 'on this screen', state: hasItems ? 'done' : 'now' },
    { label: 'Who’s eating', note: `${H} people`, state: 'now' },
    { label: 'Cost & list', note: 'on this screen', state: hasItems ? 'now' : 'todo' },
    { label: 'Shopping', note: 'print the list', state: 'todo' },
    { label: 'Actuals', note: 'after the store', state: 'todo' }
  ];

  const buyCount = lines.filter((l) => l.status !== 'staple' && l.status !== 'unpriced' && l.status !== 'bring').length;
  const bringCount = lines.filter((l) => l.status === 'bring').length;
  const totalNotes: string[] = [];
  if (totals.stapleUsed > 0) totalNotes.push(`Plus about ${money(totals.stapleUsed)} of patrol-box staples (in Used, not bought).`);
  if (totals.bring.length) totalNotes.push(`Bringing, not buying: ${totals.bring.join(', ')} (about ${money(totals.bringUsed)} in Used, not Spent).`);
  if (totals.unpriced.length) totalNotes.push(`Not in the totals: ${totals.unpriced.join(', ')} (no price yet).`);
  if (totals.short.length) totalNotes.push(`⚠ Short on ${totals.short.join(', ')} — fix before printing.`);

  return (
    <div className={s.root} id="menu-monster-planner">
      <div className={s.screen}>
        {/* ---- Masthead: title, print, date, patrol, autosave, start over ---- */}
        <div className={s.masthead}>
          <div className={s.kicker}>Troop 79 · Menu Monster · Camp cooking plan</div>
          <div className={s.titleRow}>
            <h2 className={s.title}>
              {mealLabel(plan.meal)} — {plan.patrol.trim() || 'Your patrol'}{' '}
              <Badge tone="info" className={s.reqBadge}>
                Cooking 5b
              </Badge>
            </h2>
            <Button variant="primary" onClick={() => window.print()}>
              Print shopping list
            </Button>
          </div>
          <div className={s.metaRow}>
            <Field label="Meal date" className={s.metaField}>
              <DateField value={plan.date} onChange={(iso) => patch((p) => ({ ...p, date: iso || p.date }))} />
            </Field>
            <Field label="Patrol" className={s.metaField}>
              <TextInput
                value={plan.patrol}
                maxLength={60}
                placeholder="e.g. Shooting Star Patrol"
                onChange={(e) => patch((p) => ({ ...p, patrol: e.target.value }))}
              />
            </Field>
            <div className={s.metaSide}>
              <p className={s.autosave}>Draft saves itself on this computer.</p>
              <Button
                variant={resetArmed ? 'danger' : 'ghost'}
                size="sm"
                onClick={startOver}
                aria-live="polite"
                className={s.resetBtn}
              >
                {resetArmed ? RESET_ARMED_LABEL : RESET_LABEL}
              </Button>
            </div>
          </div>
          <ol className={s.rail} aria-label="Planning steps">
            {rail.map((st, i) => (
              <li
                key={st.label}
                className={`${s.railStep} ${s[`rail_${st.state}`]}`}
                aria-current={st.state === 'now' && i === 2 ? 'step' : undefined}
              >
                <span className={s.railNum} aria-hidden="true">
                  {st.state === 'done' ? '✓' : i + 1}
                </span>
                <span className={s.railLabel}>{st.label}</span>
                <span className={s.railNote}>{st.note}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className={s.grid}>
          {/* ================= Left column: meal + menu items ================= */}
          <div className={s.col}>
            <section aria-labelledby={`${uid}-meal-h`}>
              <SectionDivider label={<span id={`${uid}-meal-h`}>Step 1 · Meal</span>} />
              <fieldset className={s.mealSet}>
                <legend className={s.help}>
                  Which meal is the patrol cooking? Changing it keeps the headcount and restrictions and drops menu items that
                  don&rsquo;t fit.
                </legend>
                <div className={s.chips}>
                  {MEALS.map((m) => (
                    <label key={m.key} className={`${s.chip} ${plan.meal === m.key ? s.chipOn : ''}`}>
                      <input
                        type="radio"
                        name={`${uid}-meal`}
                        value={m.key}
                        checked={plan.meal === m.key}
                        onChange={() => patch((p) => withMeal(p, m.key, catalog))}
                        className={s.chipInput}
                      />
                      <span>{m.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>

            <section aria-labelledby={`${uid}-menu-h`}>
              <SectionDivider label={<span id={`${uid}-menu-h`}>Step 2 · Menu items</span>} />
              <p className={s.help}>
                Check what the patrol is cooking. Each item lists what one person gets. The shopping list rebuilds as you
                go.
              </p>
              {recipes.length === 0 ? (
                <EmptyState>No {mealLabel(plan.meal).toLowerCase()} items in the troop recipe book yet.</EmptyState>
              ) : (
                <ul className={s.menuList}>
                  {recipes.map((r) => {
                    const on = plan.recipeIds.includes(r.id);
                    const w = warnings.filter((x) => x.recipe.id === r.id);
                    const cbId = `${uid}-pick-${r.id}`;
                    return (
                      <li key={r.id} className={`${s.menuItem} ${on ? s.menuItemOn : ''}`}>
                        <label className={s.pick} htmlFor={cbId}>
                          <input
                            type="checkbox"
                            id={cbId}
                            className={s.pickBox}
                            checked={on}
                            onChange={(e) => toggleRecipe(r.id, e.target.checked)}
                          />
                          <span className={s.pickName}>{r.name}</span>
                        </label>
                        <ul className={s.lines} aria-label={`What one person gets for ${r.name}`}>
                          {r.lines.map((ln, i) => {
                            const ing = ING.get(ln.ingredientId);
                            if (!ing) return null;
                            return (
                              <li key={`${ln.ingredientId}-${i}`} className={s.lineRow}>
                                <span>
                                  {perPersonText(ln.qtyPerPerson, ing, lineUnit(ln.unitKey, ing))}
                                  {ing.staple && <span className={s.muted}> (patrol box)</span>}
                                </span>
                                {ln.servesRule !== 'everyone' && (
                                  <Badge tone={ln.servesRule === 'only' ? 'info' : 'warning'} caps={false}>
                                    {ruleText(ln)}
                                  </Badge>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {w.map((x) => (
                          <Notice key={x.restriction.key} tone="warning" className={s.warnInline}>
                            <span aria-hidden="true">⚠ </span>
                            {x.count === 1 ? '1 person is' : `${x.count} people are`} {x.restriction.label.toLowerCase()} and
                            this has {x.ingredients.join(', ').toLowerCase()}. Plan something else for them.
                          </Notice>
                        ))}
                        <div className={s.menuFoot}>
                          <span className={s.help}>
                            {r.lines.length} ingredient{r.lines.length === 1 ? '' : 's'} per person
                          </span>
                          <Link href={SUGGEST_HREF} className={s.linkBtn}>
                            Suggest a change
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className={s.help}>
                Scouts can&rsquo;t change these recipes. Use <em>Suggest a change</em> and a leader will review it.
              </p>
            </section>
          </div>

          {/* ============ Right column: who's eating, totals, list, print ============ */}
          <div className={s.col}>
            <section aria-labelledby={`${uid}-who-h`}>
              <SectionDivider label={<span id={`${uid}-who-h`}>Step 3 · Who&rsquo;s eating</span>} />
              <div className={s.who}>
                <div className={s.dial}>
                  <label className={s.dialLabel} htmlFor={`${uid}-hc`}>
                    People eating <span className={s.muted}>(scouts and adults together)</span>
                  </label>
                  <Stepper
                    id={`${uid}-hc`}
                    value={H}
                    min={MIN_HEADCOUNT}
                    max={MAX_HEADCOUNT}
                    onChange={setHeadcount}
                    groupLabel="People eating"
                    lessLabel="One fewer person"
                    moreLabel="One more person"
                    describedBy={`${uid}-hc-help`}
                  />
                  <p className={s.help} id={`${uid}-hc-help`}>
                    Between {MIN_HEADCOUNT} and {MAX_HEADCOUNT}. Adults eat with the patrol and count toward the cost.
                  </p>
                </div>
                <div>
                  <p className={s.help}>
                    <strong className={s.strong}>Food restrictions</strong> — how many people, not who. Someone with two
                    restrictions counts in both.
                  </p>
                  <ul className={s.restrictions}>
                    {RESTRICTIONS.map((r) => {
                      const v = plan.restrictions[r.key] || 0;
                      const invalid = v > H;
                      const errId = `${uid}-r-${r.key}-err`;
                      const err = invalid
                        ? `${r.label} is set to ${v}, but only ${H} people are eating. Lower it or raise the headcount. Using ${H} until you do.`
                        : '';
                      return (
                        <li key={r.key} className={s.restriction}>
                          <label className={s.rLabel} htmlFor={`${uid}-r-${r.key}`}>
                            {r.label} <small>{r.hint} · number of people</small>
                          </label>
                          <Stepper
                            small
                            id={`${uid}-r-${r.key}`}
                            value={v}
                            min={0}
                            max={MAX_HEADCOUNT}
                            onChange={(n) => setRestriction(r.key, n)}
                            groupLabel={`${r.label} people`}
                            lessLabel={`One fewer ${r.label.toLowerCase()} person`}
                            moreLabel={`One more ${r.label.toLowerCase()} person`}
                            describedBy={invalid ? errId : undefined}
                            invalid={invalid}
                          />
                          <FieldError id={errId} className={s.rError}>
                            {err}
                          </FieldError>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </section>

            {/* ---- Totals strip (sticky) ---- */}
            <section className={s.totals} aria-labelledby={`${uid}-totals-h`}>
              <h3 id={`${uid}-totals-h`} className={s.srOnly}>
                Cost totals
              </h3>
              <div className={s.totalsGrid}>
                <div className={`${s.tile} ${s.tileHeadline}`}>
                  <div className={s.tLabel}>Spent — per person</div>
                  <div className={s.tMain}>{money(totals.perSpent)}</div>
                  <div className={s.tSub}>
                    {money(totals.spent)} for the meal, {H} people
                  </div>
                  <div className={s.tWhy}>What you pay at the register, divided by everyone eating.</div>
                </div>
                <div className={s.tile}>
                  <div className={s.tLabel}>Used</div>
                  <div className={s.tMain}>{money(totals.perUsed)}</div>
                  <div className={s.tSub}>{money(totals.used)} for the meal</div>
                  <div className={s.tWhy}>The true cost of what the recipes eat.</div>
                </div>
                <div className={s.tile}>
                  <div className={s.tLabel}>Leftover</div>
                  <div className={s.tMain}>{money(totals.perLeft)}</div>
                  <div className={s.tSub}>{money(totals.left)} for the meal</div>
                  <div className={s.tWhy}>Spent minus Used. Goes home or into the patrol box.</div>
                </div>
                <div className={`${s.tile} ${s.tileBudget}`}>
                  <label className={s.tLabel} htmlFor={`${uid}-budget`}>
                    Budget target, $ per person
                  </label>
                  <NumberBox
                    id={`${uid}-budget`}
                    value={plan.budgetPerPerson}
                    min={0}
                    max={999}
                    step={0.25}
                    onCommit={(n) => patch((p) => ({ ...p, budgetPerPerson: n }))}
                  />
                  <div className={`${s.readout} ${s[`readout_${budget.tone}`]}`} role="status">
                    <span className={s.statusIco} aria-hidden="true">
                      {budget.icon}
                    </span>
                    <span>{budget.msg}</span>
                  </div>
                </div>
              </div>
              <div className={s.totalsNote}>
                {totalNotes.length ? (
                  totalNotes.map((n) => <span key={n}>{n}</span>)
                ) : (
                  <span>Spent − Used = Leftover. Both totals include adults eating with the patrol.</span>
                )}
              </div>
              <div className={s.srOnly} aria-live="polite" aria-atomic="true">
                {liveText}
              </div>
            </section>

            {/* ---- Shopping list ---- */}
            <section aria-labelledby={`${uid}-list-h`}>
              <SectionDivider label={<span id={`${uid}-list-h`}>Step 4 · Cost &amp; shopping list</span>} />
              <p className={s.help}>
                Scaled amounts are estimates — round up for hungry scouts. Open a line to see other package choices.
              </p>
              {!hasItems ? (
                <EmptyState>Pick at least one menu item to build a shopping list.</EmptyState>
              ) : (
                <ul className={s.linesList}>
                  {lines.map((l) => (
                    <ShoppingLineCard
                      key={l.ing.id}
                      line={l}
                      uid={uid}
                      open={openLines.has(l.ing.id)}
                      onToggle={() => toggleOpen(l.ing.id)}
                      onQty={(n) => setQty(l, n)}
                      onResetQty={() => resetQty(l.ing.id)}
                      onPackage={(pid) => choosePackage(l.ing.id, pid)}
                      onSource={(src) => setSource(l.ing.id, src)}
                      onNote={(t) => setNote(l.ing.id, t)}
                    />
                  ))}
                </ul>
              )}
              {hasItems && (
                <p className={s.listFoot}>
                  {buyCount} thing{buyCount === 1 ? '' : 's'} to buy
                  {bringCount ? `, ${bringCount} being brought` : ''}, grouped by store section. Prices are from the troop
                  price book and may be a few weeks old.
                </p>
              )}
            </section>

            <section aria-labelledby={`${uid}-print-h`}>
              <SectionDivider label={<span id={`${uid}-print-h`}>Step 5 · Print</span>} />
              <div className={s.printRow}>
                <p className={s.help}>
                  The printed sheet has the list by store section with blank boxes for what you bought and what it cost,
                  plus a counselor summary. Step 6 happens at the store: fill in the boxes, then type them back in here.
                </p>
                <Button variant="primary" onClick={() => window.print()}>
                  Print shopping list
                </Button>
              </div>
            </section>
          </div>
        </div>
      </div>

      <PrintSheet plan={plan} catalog={catalog} lines={lines} totals={totals} warnings={warnings} />
    </div>
  );
}

/* ========================================================================== */

function ShoppingLineCard({
  line: l,
  uid,
  open,
  onToggle,
  onQty,
  onResetQty,
  onPackage,
  onSource,
  onNote
}: {
  line: ShoppingLine;
  uid: string;
  open: boolean;
  onToggle: () => void;
  onQty: (n: number) => void;
  onResetQty: () => void;
  onPackage: (pkgId: string) => void;
  onSource: (src: LineSource) => void;
  onNote: (note: string) => void;
}) {
  const u = l.ing.unit;
  const id = l.ing.id;
  const head = (
    <span className={s.lineWho}>
      <span className={s.lineIng}>{l.ing.name}</span>
      <span className={s.lineFrom}>
        {sourcesText(l)} · {SECTIONS[l.ing.section]}
      </span>
    </span>
  );
  const sourceRow = (
    <div className={s.lineSource}>
      <div className={s.srcField}>
        <label className={s.qLbl} htmlFor={`${uid}-src-${id}`}>
          Where from
        </label>
        <SelectInput
          id={`${uid}-src-${id}`}
          value={l.source}
          onChange={(e) => onSource(e.target.value as LineSource)}
          className={s.srcSelect}
        >
          {(Object.keys(SOURCE_LABELS) as LineSource[]).map((k) => (
            <option key={k} value={k}>
              {SOURCE_LABELS[k]}
            </option>
          ))}
        </SelectInput>
      </div>
      <div className={s.noteField}>
        <label className={s.qLbl} htmlFor={`${uid}-note-${id}`}>
          Note
        </label>
        <TextInput
          id={`${uid}-note-${id}`}
          value={l.note}
          maxLength={120}
          placeholder={l.source === 'buy' ? 'e.g. get the thick-cut if they have it' : 'e.g. Sam is bringing it from the pantry'}
          onChange={(e) => onNote(e.target.value)}
        />
      </div>
    </div>
  );

  if (l.status === 'staple') {
    return (
      <li className={s.line}>
        <div className={s.lineHead}>
          <div className={s.lineGrid}>
            {head}
            <span className={s.cell}>
              <span className={s.lbl}>Need</span>
              <span className={s.val}>{qtyText(l.need, u)}</span>
            </span>
            <span className={s.cell}>
              <span className={s.lbl}>Buy</span>
              <span className={s.val}>Nothing</span>
              <span className={s.math}>Patrol box staple</span>
            </span>
          </div>
        </div>
        <div className={s.lineBody}>
          <Mini label="Spent" value="$0" />
          <Mini label="Used" value={money(l.used)} sub={l.pkg ? `from ${l.pkg.name}` : undefined} />
          <Mini label="Leftover" value="—" />
          <div>
            <div className={s.sentence}>Comes from the patrol box, so nothing to buy. Counts in Used, not Spent.</div>
            <StatusPill tone="staple" icon="☰">
              Patrol box — check it&rsquo;s stocked
            </StatusPill>
          </div>
        </div>
      </li>
    );
  }

  if (l.status === 'bring') {
    const from = l.source === 'pantry' ? 'the troop pantry' : 'home';
    return (
      <li className={`${s.line} ${s.lineBring}`}>
        <div className={s.lineHead}>
          <div className={s.lineGrid}>
            {head}
            <span className={s.cell}>
              <span className={s.lbl}>Need</span>
              <span className={s.val}>{qtyText(l.need, u)}</span>
            </span>
            <span className={s.cell}>
              <span className={s.lbl}>Buy</span>
              <span className={s.val}>Nothing</span>
              <span className={s.math}>Coming from {from}</span>
            </span>
          </div>
        </div>
        <div className={s.lineBody}>
          <Mini label="Spent" value="$0" sub="not bought this trip" />
          <Mini label="Used" value={l.pkg ? money(l.used) : '?'} sub={l.pkg ? `based on ${l.pkg.name}` : 'no price yet'} />
          <Mini label="Leftover" value="—" />
          <div>
            <div className={s.sentence}>
              Someone is bringing {qtyText(l.need, u)} from {from}, so it stays off the store list. It still counts in
              Used.
            </div>
            <StatusPill tone="staple" icon="☰">
              Bringing from {from}
              {l.note ? ` — ${l.note}` : ''}
            </StatusPill>
          </div>
        </div>
        {sourceRow}
      </li>
    );
  }

  if (l.status === 'unpriced' || !l.pkg || !isUsable(l.pkg)) {
    return (
      <li className={s.line}>
        <div className={s.lineHead}>
          <div className={s.lineGrid}>
            {head}
            <span className={s.cell}>
              <span className={s.lbl}>Need</span>
              <span className={s.val}>{qtyText(l.need, u)}</span>
            </span>
            <span className={s.cell}>
              <span className={s.lbl}>Buy</span>
              <span className={s.val}>No package priced yet</span>
              <span className={s.math}>Write the price on the printed list</span>
            </span>
          </div>
        </div>
        <div className={s.lineBody}>
          <Mini label="Spent" value="?" />
          <Mini label="Used" value="?" />
          <Mini label="Leftover" value="?" />
          <div>
            <div className={s.sentence}>
              Nobody has added a package for {l.ing.name.toLowerCase()} yet, so it isn&rsquo;t in the totals.
            </div>
            <StatusPill tone="unpriced" icon="?">
              Not priced — ask a leader to add a package
            </StatusPill>
          </div>
        </div>
        {sourceRow}
      </li>
    );
  }

  const pk = l.pkg;
  const noun = packNoun(pk);
  const optId = `${uid}-opt-${id}`;
  const recPick = l.rec && l.rec.id !== pk.id && isUsable(l.rec) ? l.rec : null;
  const recQty = recPick ? Math.max(1, Math.ceil(l.need / recPick.yield - EPS)) : 0;
  const qtyLabel = plural(2, noun) === 'each' ? 'How many' : cap(plural(2, noun));

  return (
    <li className={s.line}>
      <div className={s.lineHead}>
        <button
          type="button"
          className={`${s.lineGrid} ${s.lineToggle}`}
          aria-expanded={open}
          aria-controls={optId}
          onClick={onToggle}
        >
          {head}
          <span className={s.cell}>
            <span className={s.lbl}>Need</span>
            <span className={s.val}>{qtyText(l.need, u)}</span>
          </span>
          <span className={s.cell}>
            <span className={s.lbl}>Buy</span>
            <span className={s.val} data-testid={`mm-buy-${id}`}>
              {packCount(l.qty, pk)} · {pk.name}
            </span>
            <span className={s.math}>{mathText(l)}</span>
          </span>
          <span className={s.chev}>
            {l.all.length} option{l.all.length === 1 ? '' : 's'} {open ? '▴' : '▾'}
          </span>
        </button>
        <div className={s.lineQty}>
          <label className={s.qLbl} htmlFor={`${uid}-qty-${id}`}>
            {qtyLabel} to buy
          </label>
          <Stepper
            small
            id={`${uid}-qty-${id}`}
            value={l.qty}
            min={0}
            max={MAX_QTY}
            onChange={onQty}
            groupLabel={`${l.ing.name} ${plural(2, noun)} to buy`}
            lessLabel="Buy one fewer"
            moreLabel="Buy one more"
          />
          {l.overridden ? (
            <Button variant="ghost" onClick={onResetQty} className={s.resetQty}>
              Reset to {l.autoQty}
            </Button>
          ) : (
            <span className={`${s.muted} ${s.resetQty}`}>Suggested: {l.autoQty}</span>
          )}
        </div>
      </div>

      {/* Package alternatives — behind the line's own click, directly under its header. */}
      <div className={s.lineOptions} id={optId} hidden={!open}>
        <fieldset className={s.optSet}>
          <legend className={s.optLegend}>Package choices for {l.ing.name.toLowerCase()} — pick one</legend>
          <div className={s.cards}>
            {l.all.map((p) => (
              <PackageCard key={p.id} p={p} line={l} chosen={p.id === pk.id} uid={uid} onPick={() => onPackage(p.id)} />
            ))}
          </div>
        </fieldset>
      </div>

      <div className={s.lineBody}>
        <Mini label="Spent" value={money(l.spent)} sub={`${l.qty} × ${money(pk.price)}`} />
        <Mini label="Used" value={money(l.used)} sub="what the recipes eat" />
        <Mini
          label="Leftover"
          value={l.status === 'short' ? '—' : qtyText(l.leftQty, u)}
          sub={l.status === 'short' ? 'nothing left' : `${money(l.leftMoney)} of what you paid`}
        />
        <div>
          <div className={s.sentence}>{lineSentence(l)}</div>
          {l.status === 'short' ? (
            <span className={s.statusRow}>
              <StatusPill tone="short" icon="⚠">
                Short by {qtyText(l.shortQty, u)}
              </StatusPill>
              <Button variant="secondary" size="sm" onClick={() => onQty(l.qty + 1)}>
                Buy one more
              </Button>
            </span>
          ) : (
            <StatusPill tone="ok" icon="✓">
              Covered{l.overridden ? ' (you changed the amount)' : ''}
            </StatusPill>
          )}
          {recPick && (
            <div className={s.mSub}>
              Cheapest that covers: {recPick.name} at {money(recQty * recPick.price)}
            </div>
          )}
        </div>
      </div>
      {sourceRow}
    </li>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={s.mini}>
      <div className={s.mLbl}>{label}</div>
      <div className={s.mVal}>{value}</div>
      {sub && <div className={s.mSub}>{sub}</div>}
    </div>
  );
}

function PackageCard({
  p,
  line: l,
  chosen,
  uid,
  onPick
}: {
  p: Package;
  line: ShoppingLine;
  chosen: boolean;
  uid: string;
  onPick: () => void;
}) {
  const u = l.ing.unit;
  const radioId = `${uid}-pk-${p.id}`;
  if (!isUsable(p)) {
    const why = p.yieldUnitLabel ?? 'that size';
    return (
      <label className={`${s.card} ${s.cardUnusable}`} htmlFor={radioId}>
        <input type="radio" id={radioId} name={`${uid}-pkg-${l.ing.id}`} disabled aria-describedby={`${radioId}-why`} />
        <span className={s.cName}>{p.name}</span>
        <span className={s.cPack}>
          {money(p.price)} · sold by the {why}
        </span>
        <span className={s.cNums} id={`${radioId}-why`}>
          <span aria-hidden="true">⚠ </span>Can&rsquo;t use yet: the recipe counts {u.many}, and nobody has said how many{' '}
          {u.many} a {why} makes.
        </span>
      </label>
    );
  }
  const q = Math.max(1, Math.ceil(l.need / p.yield - EPS));
  const spent = q * p.price;
  const used = (l.need / p.yield) * p.price;
  const left = q * p.yield - l.need;
  const isRec = l.rec?.id === p.id;
  const per = packNoun(p) === 'each' ? 'one' : packNoun(p);
  return (
    <label className={`${s.card} ${chosen ? s.cardChosen : ''}`} htmlFor={radioId}>
      <input type="radio" id={radioId} name={`${uid}-pkg-${l.ing.id}`} value={p.id} checked={chosen} onChange={onPick} />
      {isRec ? (
        <Badge tone="success" className={s.cTag}>
          Recommended
        </Badge>
      ) : chosen ? (
        <Badge tone="accent" className={s.cTag}>
          Your pick
        </Badge>
      ) : null}
      <span className={s.cName}>{p.name}</span>
      <span className={s.cPack}>
        {money(p.price)} · {qtyText(p.yield, u)} per {per}
        {p.store ? ` · ${p.store}` : ''}
        {p.note ? ` · ${p.note}` : ''}
      </span>
      <span className={s.cNums}>
        Buy {packCount(q, p)} → <b>Spent {money(spent)}</b> · Used {money(used)} · Leftover {qtyText(left, u)} (
        {money(spent - used)})
      </span>
    </label>
  );
}

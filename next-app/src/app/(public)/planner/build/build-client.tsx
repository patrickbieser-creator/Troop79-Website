'use client';

/**
 * Build a Plan's client side (Plans/Build-A-Plan.md, B1): the plan list, the summary rail and the Suggested column
 * (a sheet on a phone). The page renders it with the plan as loaded; every write lays its returned slice over the
 * rows here (no whole-board reload, no revalidatePath per click) and keeps the stamp it returned, so the poller only
 * refreshes for someone else's change.
 *
 * Seed holders (canSeed) get Add on each suggestion and a ⋯ menu per row; Remove is for seeded rows only, behind a
 * danger dialog that names the consequence, and a row scouts picked or a teacher offered says why it can't go.
 * Viewers see the plan with no controls. Suggestions stream in behind Suspense (SuggestionsFeed hands them over), so
 * the plan never waits for the engine.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/app/_components/button';
import { Drawer } from '@/app/_components/drawer';
import { useDisclosure } from '@/app/(public)/library/menu-monster/menus/_components/use-disclosure';
import {
  addedRow,
  afterRemove,
  cannotRemoveReason,
  ORIGIN_LABEL,
  planSummary,
  removeConsequence,
  STATE_LABEL,
  SUGGESTION_LIMIT,
  type PlanRow,
  type SuggestionView
} from '@/lib/build-plan';
import { plannerAddOfferingAction, plannerRemoveOfferingAction } from '../build-actions';
import { PlannerPoller } from '../planner-poller';
import s from './build.module.css';

const SAVE_FAILED = 'That didn’t save. Check your connection and try again.';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Feed = { status: 'loading' } | { status: 'ready'; list: SuggestionView[] } | { status: 'failed' };
const FeedCtx = createContext<((f: Feed) => void) | null>(null);

/** Streams in behind Suspense: hands the engine's suggestions to the view and renders nothing itself. */
export function SuggestionsFeed({ list }: { list: SuggestionView[] | null }) {
  const set = useContext(FeedCtx);
  useEffect(() => {
    set?.(list ? { status: 'ready', list } : { status: 'failed' });
  }, [list, set]);
  return null;
}

export function BuildPlanView({
  entryId,
  rows: initialRows,
  canSeed,
  stamp,
  heading,
  feed
}: {
  entryId: number;
  rows: PlanRow[];
  canSeed: boolean;
  stamp: string;
  heading: ReactNode;
  /** The Suspense-wrapped SuggestionsFeed (seed holders only). */
  feed?: ReactNode;
}) {
  const [rows, setRows] = useState(initialRows);
  const [suggestions, setSuggestions] = useState<Feed>({ status: 'loading' });
  const [sheet, setSheet] = useState(false);
  const [removing, setRemoving] = useState<PlanRow | null>(null);
  const stampRef = useRef(stamp);
  const onFeed = useCallback((f: Feed) => setSuggestions(f), []);

  const onPlan = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);
  const shown = suggestions.status === 'ready' ? suggestions.list.filter((x) => !onPlan.has(x.key)).slice(0, SUGGESTION_LIMIT) : [];
  const sum = planSummary(rows);

  const add = async (x: SuggestionView): Promise<string | null> => {
    const res = await plannerAddOfferingAction({ entryId, keys: [x.key] }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    if (!res.ok) return res.error;
    stampRef.current = res.stamp;
    setRows((rs) => (rs.some((r) => r.key === x.key) ? rs : [...rs, addedRow(x)]));
    return null;
  };

  const remove = async (row: PlanRow): Promise<string | null> => {
    const res = await plannerRemoveOfferingAction({ entryId, key: row.key }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    if (!res.ok) return res.error;
    stampRef.current = res.stamp;
    setRows((rs) => rs.flatMap((r) => (r.key === row.key ? (afterRemove(r, res.stays) ?? []) : [r])));
    return null;
  };

  const suggestedList = <SuggestedList feed={suggestions} shown={shown} onAdd={add} />;
  return (
    <FeedCtx.Provider value={onFeed}>
      {heading}
      <div className={s.rail}>
        <p className={s.railText}>
          {plural(sum.offerings, 'offering')} · {sum.withTeachers} with {sum.withTeachers === 1 ? 'a teacher' : 'teachers'} · {plural(sum.scouts, 'scout')} signed up ·{' '}
          <PlannerPoller entryId={entryId} stamp={stamp} build stampRef={stampRef} />
        </p>
        {canSeed ? (
          <button type="button" className={s.railSheet} onClick={() => setSheet(true)} aria-haspopup="dialog">
            Suggested{shown.length ? ` · ${shown.length}` : ''}
          </button>
        ) : null}
      </div>
      <div className={canSeed ? s.layout : s.layoutSolo}>
        <section aria-labelledby="build-plan">
          <h2 id="build-plan" className={s.sectionTitle}>
            The plan
          </h2>
          {rows.length ? (
            <ul className={s.list}>
              {rows.map((r) => (
                <PlanRowView key={r.key} row={r} canSeed={canSeed} onRemove={() => setRemoving(r)} />
              ))}
            </ul>
          ) : (
            <p className={s.empty}>{canSeed ? 'Nothing planned yet. Start from a suggestion.' : 'Nothing planned yet.'}</p>
          )}
        </section>
        {canSeed ? (
          <aside className={s.suggested} aria-labelledby="build-suggested">
            <h2 id="build-suggested" className={s.sectionTitle}>
              Suggested
            </h2>
            {suggestedList}
          </aside>
        ) : null}
      </div>
      {sheet ? (
        <Drawer title="Suggested" onClose={() => setSheet(false)}>
          {suggestedList}
        </Drawer>
      ) : null}
      {removing ? <RemoveDialog row={removing} onRemove={() => remove(removing)} onClose={() => setRemoving(null)} /> : null}
      {feed}
    </FeedCtx.Provider>
  );
}

function teacherLine(r: PlanRow): string {
  if (r.teachers.length) return r.teachers.join(', ');
  return r.canTeach ? `${plural(r.canTeach, 'person', 'people')} could teach it` : 'Nobody listed can teach it yet';
}

function scoutLine(r: PlanRow): string {
  const parts = [r.scouts ? `${r.scouts} signed up` : null, r.likely ? `${r.likely} likely, not yet asked` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No scouts yet';
}

const STATE_CLASS = { ready: s.stateReady, 'needs-teacher': s.stateTeacher, 'needs-scouts': s.stateScouts } as const;

function PlanRowView({ row, canSeed, onRemove }: { row: PlanRow; canSeed: boolean; onRemove: () => void }) {
  return (
    <li className={s.row}>
      <div>
        <p className={s.rowTitle}>
          {row.codeLabel ? <span className={s.code}>{row.codeLabel}</span> : null}
          {row.title}
          <span className={s.origin}>{ORIGIN_LABEL[row.origin]}</span>
        </p>
        <p className={s.rowLine}>{teacherLine(row)}</p>
        <p className={s.rowLine}>{scoutLine(row)}</p>
      </div>
      <span className={STATE_CLASS[row.state]}>{STATE_LABEL[row.state]}</span>
      {canSeed ? <RowMenu row={row} onRemove={onRemove} /> : null}
    </li>
  );
}

/** The row's ⋯: Remove, last; for a row the planner didn't add, Remove is greyed with the reason under it. */
function RowMenu({ row, onRemove }: { row: PlanRow; onRemove: () => void }) {
  const { open, wrapRef, triggerRef, onBlur, toggle, close } = useDisclosure();
  const why = cannotRemoveReason(row);
  return (
    <div className={s.menuWrap} ref={wrapRef} onBlur={onBlur}>
      <button type="button" ref={triggerRef} className={s.menuBtn} aria-label={`More for ${row.title}`} aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div className={s.menuPop}>
          <button
            type="button"
            className={s.menuItem}
            disabled={why != null}
            onClick={() => {
              close();
              onRemove();
            }}
          >
            Remove
          </button>
          {why ? <p className={s.menuWhy}>{why}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The danger confirm: names what Remove does, then unseeds. */
function RemoveDialog({ row, onRemove, onClose }: { row: PlanRow; onRemove: () => Promise<string | null>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (dlg && typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    else dlg?.setAttribute('open', '');
  }, []);
  const go = async () => {
    setBusy(true);
    const err = await onRemove();
    setBusy(false);
    if (err) setProblem(err);
    else onClose();
  };
  return (
    <dialog
      ref={ref}
      className={s.confirm}
      aria-labelledby="build-remove-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="build-remove-title" className={s.confirmTitle}>
        Remove {row.codeLabel || row.title}?
      </h2>
      <p className={s.confirmText}>{removeConsequence(row)}</p>
      {problem ? (
        <p className={s.problem} role="alert">
          {problem}
        </p>
      ) : null}
      <div className={s.confirmActions}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={go} disabled={busy}>
          {busy ? 'Removing…' : 'Remove'}
        </Button>
      </div>
    </dialog>
  );
}

function SuggestedList({ feed, shown, onAdd }: { feed: Feed; shown: SuggestionView[]; onAdd: (x: SuggestionView) => Promise<string | null> }) {
  if (feed.status === 'loading') return <p className={s.empty}>Finding suggestions…</p>;
  if (feed.status === 'failed') return <p className={s.empty}>Suggestions didn’t load. Reload the page to try again.</p>;
  if (!shown.length) return <p className={s.empty}>No suggestions: every shared need is on the plan.</p>;
  return (
    <ul className={s.suggestList}>
      {shown.map((x) => (
        <SuggestionRow key={x.key} x={x} onAdd={onAdd} />
      ))}
    </ul>
  );
}

function SuggestionRow({ x, onAdd }: { x: SuggestionView; onAdd: (x: SuggestionView) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Two clicks in one frame both reach the handler before the disabled button renders; the ref lets only one add.
  const inFlight = useRef(false);
  const add = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    const err = await onAdd(x);
    inFlight.current = false;
    setBusy(false);
    if (err) setProblem(err);
  };
  return (
    <li className={s.suggestion}>
      <div>
        <p className={s.suggestTitle}>
          <span className={s.code}>{x.codeLabel}</span>
          {x.title}
        </p>
        <p className={s.suggestMeta}>
          {x.need} need it{x.bestTeacher ? ` · best teacher: ${x.bestTeacher}` : ''}
        </p>
        {problem ? (
          <p className={s.problem} role="alert">
            {problem}
          </p>
        ) : null}
      </div>
      <Button variant="secondary" size="sm" className={s.addBtn} onClick={add} disabled={busy} aria-label={`Add ${x.codeLabel} ${x.title}`}>
        {busy ? 'Adding…' : 'Add'}
      </Button>
    </li>
  );
}

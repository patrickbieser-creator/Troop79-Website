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
 *
 * B2: seed holders get the quiet adds on "The plan" heading's line (+ Requirement, + Focus set, + New mix:
 * ./add-offering; the open one sits under the heading, above the list: Patrick, 2026-10-22), and each row a quiet Edit
 * (./edit-offering): its teacher for editors, a mix's requirements for seed holders.
 *
 * B3: once the plan has an offering, editors get the one primary "Invite…" in a sticky bottom bar (./invite-sheet:
 * one digest email per recipient), and adults a quiet per-row Invite scoped to that row. For a scout editor (the SPL)
 * the button is greyed with the reason; the server refuses regardless. The rail gains "N invited".
 *
 * A row says only what's exceptional (Patrick, 2026-10-22): no origin tag on the planner's own rows, no scout line when
 * nobody signed up and nobody is likely. The likely scouts stream in behind Suspense too (LikelyFeed).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Drawer } from '@/app/_components/drawer';
import { useDisclosure } from '@/app/_components/use-disclosure';
import {
  afterRemove,
  cannotRemoveReason,
  ORIGIN_LABEL,
  planSummary,
  removeConsequence,
  STATE_LABEL,
  SUGGESTION_LIMIT,
  scoutLine,
  teacherLine,
  keepWriteStamp,
  withAdded,
  withTeachers,
  mixName,
  type PlanRow,
  type SuggestionView
} from '@/lib/build-plan';
import { FOCUS_LABEL } from '@/lib/meeting-board-picklist';
import type { FocusSearchRow, FocusSetView } from '@/lib/meeting-focus';
import {
  plannerAddFocusSetAction,
  plannerAddOfferingAction,
  plannerNewMixAction,
  plannerRemoveOfferingAction,
  type BuildClassResult,
  type BuildTeacherResult
} from '../build-actions';
import { AddOffering } from './add-offering';
import { EditOffering } from './edit-offering';
import { InviteSheet } from './invite-sheet';
import { rowCode } from './requirement-search';
import { PlannerPoller } from '../planner-poller';
import s from './build.module.css';

const SAVE_FAILED = 'That didn’t save. Check your connection and try again.';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Feed = { status: 'loading' } | { status: 'ready'; list: SuggestionView[] } | { status: 'failed' };
const FeedCtx = createContext<((f: Feed) => void) | null>(null);
type Likely = Record<string, string[]>;
const LikelyCtx = createContext<((l: Likely) => void) | null>(null);

/** Streams in behind Suspense: hands the engine's suggestions to the view and renders nothing itself. */
export function SuggestionsFeed({ list }: { list: SuggestionView[] | null }) {
  const set = useContext(FeedCtx);
  useEffect(() => {
    set?.(list ? { status: 'ready', list } : { status: 'failed' });
  }, [list, set]);
  return null;
}

/** Streams in behind Suspense: hands each row's likely scouts (by key) to the view; null (the read failed) shows none. */
export function LikelyFeed({ byKey }: { byKey: Likely | null }) {
  const set = useContext(LikelyCtx);
  useEffect(() => {
    if (byKey) set?.(byKey);
  }, [byKey, set]);
  return null;
}

export function BuildPlanView({
  entryId,
  rows: initialRows,
  canSeed,
  canEdit = false,
  canEmail = false,
  invited: initialInvited = 0,
  dayLabel = '',
  stamp,
  heading,
  feed
}: {
  entryId: number;
  rows: PlanRow[];
  canSeed: boolean;
  /** meeting_planner.edit: an offering's teacher (B2). */
  canEdit?: boolean;
  /** An adult editor: sends invites (B3). */
  canEmail?: boolean;
  /** People invited (teach or offer) on this meeting so far. */
  invited?: number;
  /** 'Oct 25': a new mix's name until typed over. */
  dayLabel?: string;
  stamp: string;
  heading: ReactNode;
  /** The Suspense-wrapped feeds: LikelyFeed, and SuggestionsFeed for seed holders. */
  feed?: ReactNode;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  // A refresh (the poller, or a write that found someone else's change) hands in fresh rows: they replace what is shown,
  // while dialogs, the sheet and errors stay open (the page keys this view on the meeting only; qa-lead, 2026-10-22).
  const [loaded, setLoaded] = useState(initialRows);
  if (loaded !== initialRows) {
    setLoaded(initialRows);
    setRows(initialRows);
  }
  const [suggestions, setSuggestions] = useState<Feed>({ status: 'loading' });
  const [sheet, setSheet] = useState(false);
  /** The Invite sheet: every offering (''), or one row's key. */
  const [inviting, setInviting] = useState<string | null>(null);
  const [invited, setInvited] = useState(initialInvited);
  const [loadedInvited, setLoadedInvited] = useState(initialInvited);
  if (loadedInvited !== initialInvited) {
    setLoadedInvited(initialInvited);
    setInvited(initialInvited);
  }
  const [removing, setRemoving] = useState<{ row: PlanRow; trigger: HTMLElement | null } | null>(null);
  /** The row whose Edit is open, as it was when opened: the drawer stays (saying so) if the row leaves the plan. */
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const stampRef = useRef(stamp);
  const listHeadRef = useRef<HTMLHeadingElement | null>(null);
  const onFeed = useCallback((f: Feed) => setSuggestions(f), []);
  const [likely, setLikely] = useState<Likely>({});

  /** A write landed: keep its stamp when nothing else changed the board since; otherwise refresh to show the rest. */
  const landed = (res: { prior: string; stamp: string }) => {
    if (keepWriteStamp(stampRef.current, res.prior)) stampRef.current = res.stamp;
    else router.refresh();
  };

  const onPlan = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);
  const shown = suggestions.status === 'ready' ? suggestions.list.filter((x) => !onPlan.has(x.key)).slice(0, SUGGESTION_LIMIT) : [];
  const sum = planSummary(rows);

  const add = async (x: SuggestionView): Promise<string | null> => {
    const res = await plannerAddOfferingAction({ entryId, keys: [x.key] }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    if (!res.ok) return res.error;
    landed(res);
    setRows((rs) => withAdded(rs, x, res.teachers[x.key] ?? []));
    return null;
  };

  const remove = async (row: PlanRow): Promise<string | null> => {
    const res = await plannerRemoveOfferingAction({ entryId, key: row.key }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    if (!res.ok) return res.error;
    landed(res);
    setRows((rs) => rs.flatMap((r) => (r.key === row.key ? (afterRemove(r, res.stays) ?? []) : [r])));
    return null;
  };

  /** B2: a class (a focus set or a new mix) the server added. */
  const addClass = (res: Extract<BuildClassResult, { ok: true }>) => {
    landed(res);
    setRows((rs) => withAdded(rs, { key: res.key, codeLabel: FOCUS_LABEL, title: res.title }, res.teachers));
  };
  const addRequirement = async (r: FocusSearchRow): Promise<string | null> => {
    const res = await plannerAddOfferingAction({ entryId, keys: [r.key] }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    if (!res.ok) return res.error;
    landed(res);
    setRows((rs) => withAdded(rs, { key: r.key, codeLabel: rowCode(r), title: r.label }, res.teachers[r.key] ?? []));
    return null;
  };
  const addSet = async (x: FocusSetView): Promise<string | null> => {
    const res = await plannerAddFocusSetAction({ entryId, setId: x.id }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    if (!res.ok) return res.error;
    addClass({ ...res, title: res.title || x.name });
    return null;
  };
  const newMix = async (name: string, items: FocusSearchRow[]): Promise<string | null> => {
    const res = await plannerNewMixAction({ entryId, name, items: items.map((i) => i.key) }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    if (!res.ok) return res.error;
    addClass(res);
    return null;
  };
  const onTeachers = (key: string, res: Extract<BuildTeacherResult, { ok: true }>) => {
    landed(res);
    setRows((rs) => rs.flatMap((r) => (r.key === key ? (withTeachers(r, res.teachers, res.onBoard) ?? []) : [r])));
  };
  const onMix = (key: string, res: Extract<BuildClassResult, { ok: true }>) => {
    landed(res);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, title: res.title } : r)));
  };
  const editingRow = editing ? (rows.find((r) => r.key === editing.key) ?? null) : null;

  const suggestedList = <SuggestedList feed={suggestions} shown={shown} onAdd={add} />;
  return (
    <LikelyCtx.Provider value={setLikely}>
      <FeedCtx.Provider value={onFeed}>
        {heading}
        <div className={s.rail}>
          <p className={s.railText}>
            {plural(sum.offerings, 'offering')} · {sum.withTeachers} with {sum.withTeachers === 1 ? 'a teacher' : 'teachers'} · {plural(sum.scouts, 'scout')} signed up · {invited} invited ·{' '}
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
            <div className={s.planHead}>
              <h2 id="build-plan" className={s.sectionTitle} ref={listHeadRef} tabIndex={-1}>
                The plan
              </h2>
              {canSeed ? <AddOffering onPlan={onPlan} defaultMixName={mixName(dayLabel)} addRequirement={addRequirement} addSet={addSet} newMix={newMix} /> : null}
            </div>
            {rows.length ? (
              <ul className={s.list}>
                {rows.map((r) => (
                  <PlanRowView
                    key={r.key}
                    row={r}
                    likely={likely[r.key]}
                    canSeed={canSeed}
                    canEdit={canEdit || (canSeed && r.key.startsWith('fg:'))}
                    onEdit={() => setEditing(r)}
                    onInvite={canEmail ? () => setInviting(r.key) : undefined}
                    onRemove={(trigger) => setRemoving({ row: r, trigger })}
                  />
                ))}
              </ul>
            ) : (
              <p className={s.empty}>Nothing planned yet.</p>
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
        {editing ? (
          <EditOffering
            entryId={entryId}
            row={editingRow ?? editing}
            gone={!editingRow}
            canEdit={canEdit}
            canSeed={canSeed}
            onTeachers={(res) => onTeachers(editing.key, res)}
            onMix={(res) => onMix(editing.key, res)}
            onClose={() => setEditing(null)}
          />
        ) : null}
        {canEdit && rows.length ? (
          <div className={s.inviteBar}>
            {canEmail ? null : <span className={s.inviteWhy}>Only adults send email</span>}
            <Button variant="primary" onClick={() => setInviting('')} disabled={!canEmail} aria-haspopup="dialog">
              Invite…
            </Button>
          </div>
        ) : null}
        {inviting !== null && canEmail ? (
          <InviteSheet
            entryId={entryId}
            rows={rows}
            only={inviting || null}
            onSent={(res) => {
              landed(res);
              setInvited(res.invited);
            }}
            onClose={() => setInviting(null)}
          />
        ) : null}
        {removing ? (
          <RemoveDialog
            row={removing.row}
            onRemove={() => remove(removing.row)}
            onClose={() => {
              const trigger = removing.trigger;
              setRemoving(null);
              // Back to the row's ⋯ when the row is still there; to the list's heading when it went.
              requestAnimationFrame(() => (trigger?.isConnected ? trigger.focus() : listHeadRef.current?.focus()));
            }}
          />
        ) : null}
        {feed}
      </FeedCtx.Provider>
    </LikelyCtx.Provider>
  );
}

const STATE_CLASS = { ready: s.stateReady, 'needs-teacher': s.stateTeacher, 'needs-scouts': s.stateScouts } as const;

function PlanRowView({
  row,
  likely,
  canSeed,
  canEdit,
  onEdit,
  onInvite,
  onRemove
}: {
  row: PlanRow;
  /** Its likely scouts by name, once streamed in. */
  likely?: string[];
  canSeed: boolean;
  canEdit: boolean;
  onEdit: () => void;
  /** Adults only: the Invite sheet for this row. */
  onInvite?: () => void;
  onRemove: (trigger: HTMLElement | null) => void;
}) {
  const teachers = teacherLine(row);
  const scouts = scoutLine(row, likely);
  return (
    <li className={s.row}>
      <div>
        <p className={s.rowTitle}>
          {row.codeLabel ? <span className={s.code}>{row.codeLabel}</span> : null}
          {row.title}
          {/* The planner's rows are the rule; only the exceptions say where they came from (Patrick, 2026-10-22). */}
          {row.origin === 'planner' ? null : <span className={s.origin}>{ORIGIN_LABEL[row.origin]}</span>}
        </p>
        {teachers ? <p className={s.rowLine}>{teachers}</p> : null}
        {scouts ? <p className={s.rowLine}>{scouts}</p> : null}
      </div>
      {/* The state label and the row's buttons: one flex line, centred on each other (Patrick, 2026-10-22). */}
      <span className={s.rowEnd}>
        <span className={STATE_CLASS[row.state]}>{STATE_LABEL[row.state]}</span>
        {canEdit || canSeed ? (
          <span className={s.rowActions}>
            {canEdit ? (
              <button type="button" className={s.editBtn} onClick={onEdit} aria-haspopup="dialog" aria-label={`Edit ${row.title}`}>
                Edit
              </button>
            ) : null}
            {onInvite ? (
              <button type="button" className={s.editBtn} onClick={onInvite} aria-haspopup="dialog" aria-label={`Invite for ${row.title}`}>
                Invite
              </button>
            ) : null}
            {canSeed ? <RowMenu row={row} onRemove={onRemove} /> : null}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** The row's ⋯: Remove, last; for a row the planner didn't add, Remove is greyed with the reason under it. */
function RowMenu({ row, onRemove }: { row: PlanRow; onRemove: (trigger: HTMLElement | null) => void }) {
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
              onRemove(triggerRef.current);
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

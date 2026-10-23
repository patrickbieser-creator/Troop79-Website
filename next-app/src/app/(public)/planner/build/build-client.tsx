'use client';

/**
 * Build a Plan's client side (Plans/Build-A-Plan.md, B1): the plan list and the summary rail. The page renders it with
 * the plan as loaded; every write lays its returned slice over the rows here (no whole-board reload, no revalidatePath
 * per click) and keeps the stamp it returned, so the poller only refreshes for someone else's change.
 *
 * Seed holders (canSeed) get a ⋯ menu per row; Remove is for seeded rows only, behind a danger dialog that names the
 * consequence, and a row scouts picked or a teacher offered says why it can't go. Viewers see the plan with no controls.
 *
 * One persistent bar on every sub-view (Patrick, 2026-10-22; lib/build-plan-view): "The plan · Suggestions ·
 * + Requirement · + Focus set · + New mix" (viewers: the first two), the current one highlighted. Each view is linkable
 * (?view=suggestions|add-requirement|add-set|new-mix). The plan and the three adds switch in place (history.pushState;
 * popstate follows Back/Forward); Suggestions needs the server's engine read, so going to or from it navigates. Every
 * sub-view starts with "← Back to the plan" and its heading; focus moves to the new view's heading (the plan's, on the
 * way back). Esc leaves Suggestions and the adds, as before.
 *
 * B5 (Suggestions mode): the workspace (./suggestions) takes the main area and the plan shrinks to a slim live rail on
 * the left (one line per item and the count; a "Plan (n)" Drawer on a phone). The one engine read streams in behind
 * Suspense (SuggestionsFeed). Adds go through the batched action, ADD_MAX keys per call.
 *
 * B2: seed holders get the adds (./add-offering, one sub-view each, above the plan list), and each row a quiet Edit
 * (./edit-offering): its teacher for editors, a mix's requirements for seed holders.
 *
 * B6: invites moved to their own tab (/planner/invite). Once the plan has an offering, the bottom bar's one primary is
 * "Next: Invite →"; a row's ⋯ menu keeps Invite as an afterthought (above Remove), opening that tab on the row's
 * offering. "N invited" lives only in the Invite tab's summary.
 *
 * A row says only what's exceptional (Patrick, 2026-10-22): no origin tag on the planner's own rows, no scout line when
 * nobody signed up and nobody is likely. The likely scouts stream in behind Suspense too (LikelyFeed).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Drawer } from '@/app/_components/drawer';
import { TabStrip } from '@/app/_components/tab-strip';
import { BUILD_NAV, isAddView, parseBuildView, VIEW_TITLE, viewHref, type BuildView } from '@/lib/build-plan-view';
import { useDisclosure } from '@/app/_components/use-disclosure';
import {
  afterRemove,
  cannotRemoveReason,
  ORIGIN_LABEL,
  planSummary,
  removeConsequence,
  STATE_LABEL,
  scoutLine,
  teacherLine,
  keepWriteStamp,
  withAdded,
  withTeachers,
  mixName,
  type PlanRow
} from '@/lib/build-plan';
import { addChunks, type SuggestionsData, type SuggestItem } from '@/lib/build-plan-suggest';
import { FOCUS_LABEL } from '@/lib/meeting-board-picklist';
import type { FocusSearchRow, FocusSetView } from '@/lib/meeting-focus';
import {
  plannerAddFocusSetAction,
  plannerAddOfferingAction,
  plannerTeachingChipAction,
  plannerNewMixAction,
  plannerRemoveOfferingAction,
  type BuildClassResult,
  type BuildTeacherResult
} from '../build-actions';
import { AddPanel } from './add-offering';
import { EditOffering } from './edit-offering';
import { rowCode } from './requirement-search';
import { PlannerPoller } from '../planner-poller';
import { ItemAction, SuggestionsWorkspace, type SuggestFeed } from './suggestions';
import { orphanScouts, orphansLabel, type OrphansData, type OrphanScout } from '@/lib/build-plan-orphans';
import s from './build.module.css';

const SAVE_FAILED = 'That didn’t save. Check your connection and try again.';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const FeedCtx = createContext<((f: SuggestFeed) => void) | null>(null);

/**
 * Set when Suggestions mode is left for another view (Esc, the bar, "Back to the plan"): the view that mounts next puts
 * focus on its heading (qa-lead B5 #3). Client-side navigation keeps module state; a full load starts it false.
 */
let focusOnArrival = false;

/** A click the page may take over: the main button, no modifier (those open a new tab or window). */
const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
type Likely = Record<string, string[]>;
const LikelyCtx = createContext<((l: Likely) => void) | null>(null);
const OrphansCtx = createContext<((o: OrphansData) => void) | null>(null);

/** Streams in behind Suspense (Suggestions mode): hands the one engine read to the view and renders nothing itself. */
export function SuggestionsFeed({ data }: { data: SuggestionsData | null }) {
  const set = useContext(FeedCtx);
  useEffect(() => {
    set?.(data ? { status: 'ready', data } : { status: 'failed' });
  }, [data, set]);
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

/** B9: streams in behind Suspense: hands the orphan data to the view; null (the read failed) shows no count. */
export function OrphansFeed({ data }: { data: OrphansData | null }) {
  const set = useContext(OrphansCtx);
  useEffect(() => {
    if (data) set?.(data);
  }, [data, set]);
  return null;
}

export function BuildPlanView({
  entryId,
  rows: initialRows,
  canSeed,
  canEdit = false,
  dayLabel = '',
  stamp,
  heading,
  feed,
  mode = 'plan',
  view: initialView = 'plan',
  planHref: planHrefProp = '',
  suggestionsHref = '',
  switcher,
  lookupsHref
}: {
  /** Lookups, for a leader who holds roster.manage: "Edit in Lookups" in the Teaching lens. */
  lookupsHref?: string;
  /** B5: the plan (default), or Suggestions mode (?view=suggestions): the workspace with the plan as a slim rail. */
  mode?: 'plan' | 'suggestions';
  /** Plan mode: the view it opens on (?view=add-requirement|add-set|new-mix; the plan by default). */
  view?: BuildView;
  /** This meeting's plan (where Esc, The plan and "Back to the plan" go). */
  planHref?: string;
  /** This meeting in Suggestions mode (the bar's Suggestions). */
  suggestionsHref?: string;
  /** Suggestions mode: the meeting switcher, which moves into the workspace's sticky bar. */
  switcher?: ReactNode;
  entryId: number;
  rows: PlanRow[];
  canSeed: boolean;
  /** meeting_planner.edit: an offering's teacher (B2). */
  canEdit?: boolean;
  /** 'Oct 25': a new mix's name until typed over. */
  dayLabel?: string;
  stamp: string;
  heading: ReactNode;
  /** The Suspense-wrapped feeds: LikelyFeed (the plan), SuggestionsFeed (Suggestions mode). */
  feed?: ReactNode;
}) {
  const router = useRouter();
  const planHref = planHrefProp || `/planner/build?meeting=${entryId}`;
  const hrefOf = (v: BuildView) => (v === 'suggestions' && suggestionsHref ? suggestionsHref : viewHref(planHref, v));
  const [rows, setRows] = useState(initialRows);
  // A refresh (the poller, or a write that found someone else's change) hands in fresh rows: they replace what is shown,
  // while dialogs, the sheet and errors stay open (the page keys this view on the meeting only; qa-lead, 2026-10-22).
  const [loaded, setLoaded] = useState(initialRows);
  if (loaded !== initialRows) {
    setLoaded(initialRows);
    setRows(initialRows);
  }
  const [suggestions, setSuggestions] = useState<SuggestFeed>({ status: 'loading' });
  /** Suggestions mode on a phone: the plan in the Drawer. */
  const [planSheet, setPlanSheet] = useState(false);
  const [removing, setRemoving] = useState<{ row: PlanRow; trigger: HTMLElement | null } | null>(null);
  /** The row whose Edit is open, as it was when opened: the drawer stays (saying so) if the row leaves the plan. */
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const stampRef = useRef(stamp);
  const listHeadRef = useRef<HTMLHeadingElement | null>(null);
  /** The current sub-view's heading (Suggestions, or an add). */
  const viewHeadRef = useRef<HTMLHeadingElement | null>(null);

  // ── the sub-views ──
  const [view, setView] = useState<BuildView>(() => (mode === 'suggestions' ? 'suggestions' : parseBuildView(initialView === 'suggestions' ? 'plan' : initialView, canSeed)));
  const focusView = useRef(false);
  const focusHeading = useCallback((v: BuildView) => (v === 'plan' ? listHeadRef.current : viewHeadRef.current)?.focus(), []);
  // Arriving: Suggestions always takes focus to its heading (it was entered on purpose); the plan or an add only when
  // reached from Suggestions (a full load of the plan leaves focus alone). On mount only: later switches focus below.
  const [arrivedView] = useState(view);
  useEffect(() => {
    if (mode === 'suggestions') {
      focusHeading('suggestions');
      return;
    }
    if (!focusOnArrival) return;
    focusOnArrival = false;
    focusHeading(arrivedView);
  }, [mode, arrivedView, focusHeading]);
  useEffect(() => {
    if (!focusView.current) return;
    focusView.current = false;
    focusHeading(view);
  }, [view, focusHeading]);
  // Back/Forward between the plan and the adds: the URL is the view (Suggestions entries are Next's own navigations).
  useEffect(() => {
    if (mode !== 'plan') return;
    const onPop = () => {
      const v = parseBuildView(new URLSearchParams(window.location.search).get('view'), canSeed);
      if (v !== 'suggestions') setView(v);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [mode, canSeed]);
  /** Go to a view: in place between the plan and the adds; a navigation to or from Suggestions. */
  const go = (v: BuildView) => {
    if (v === view) {
      focusHeading(v);
      return;
    }
    if (mode === 'suggestions' || v === 'suggestions') {
      if (mode === 'suggestions') focusOnArrival = true;
      router.push(hrefOf(v));
      return;
    }
    window.history.pushState(null, '', hrefOf(v));
    focusView.current = true;
    setView(v);
  };
  const onFeed = useCallback((f: SuggestFeed) => setSuggestions(f), []);
  const [likely, setLikely] = useState<Likely>({});
  const [orphanData, setOrphanData] = useState<OrphansData | null>(null);
  const [orphanSheet, setOrphanSheet] = useState(false);

  /** A write landed: keep its stamp when nothing else changed the board since; otherwise refresh to show the rest. */
  const landed = (res: { prior: string; stamp: string }) => {
    if (keepWriteStamp(stampRef.current, res.prior)) stampRef.current = res.stamp;
    else router.refresh();
  };
  /**
   * B9 qa: an add from the heading's row (a searched requirement, a focus set, a new mix) may cover a scout through a key
   * outside the orphan universe, so it always refreshes once to recompute the streamed count. Suggestion adds stay on
   * `landed` (their keys recount on the client; no double refresh).
   */
  const landedRecount = (res: { prior: string; stamp: string }) => {
    if (keepWriteStamp(stampRef.current, res.prior)) stampRef.current = res.stamp;
    router.refresh();
  };

  const inviteHref = `/planner/invite?meeting=${entryId}`;
  const onPlan = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);
  const sum = planSummary(rows);
  // B9: recounted from the rows on every Add or Remove; no reload.
  const orphans = useMemo(() => (orphanData ? orphanScouts(orphanData, onPlan) : []), [orphanData, onPlan]);
  const orphanText = orphansLabel(orphans.length, rows.length);

  /**
   * B5: add suggestions to the plan through the one batched action, at most ADD_MAX keys per call (in order; a failure
   * stops there and says why, and what went before stays added). Each call's slice lands as it returns.
   */
  const addItems = async (items: SuggestItem[]): Promise<string | null> => {
    for (const chunk of addChunks(items)) {
      const res = await plannerAddOfferingAction({ entryId, keys: chunk.map((x) => x.key) }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
      if (!res.ok) return res.error;
      landed(res);
      setRows((rs) => chunk.reduce((acc, x) => withAdded(acc, x, res.teachers[x.key] ?? []), rs));
    }
    return null;
  };

  // Suggestions and the adds: Esc goes back to the plan (unless a dialog is open, or the key belongs to a field; in an
  // add's box an empty field lets Esc through, as the old add row did).
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    if (view === 'plan') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && (t as HTMLInputElement).type !== 'checkbox' && (t as HTMLInputElement).type !== 'radio') {
        if (view === 'suggestions' || t.tagName !== 'INPUT' || (t as HTMLInputElement).value !== '') return;
      }
      goRef.current('plan');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view]);

  const remove = async (row: PlanRow): Promise<string | null> => {
    const res = await plannerRemoveOfferingAction({ entryId, key: row.key }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    if (!res.ok) return res.error;
    landed(res);
    setRows((rs) => rs.flatMap((r) => (r.key === row.key ? (afterRemove(r, res.stays) ?? []) : [r])));
    return null;
  };

  /** B2: a class (a focus set or a new mix) the server added. */
  const addClass = (res: Extract<BuildClassResult, { ok: true }>) => {
    landedRecount(res);
    setRows((rs) => withAdded(rs, { key: res.key, codeLabel: FOCUS_LABEL, title: res.title }, res.teachers));
  };
  const addRequirement = async (r: FocusSearchRow): Promise<string | null> => {
    const res = await plannerAddOfferingAction({ entryId, keys: [r.key] }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    if (!res.ok) return res.error;
    landedRecount(res);
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
  /**
   * Suggestions › Teaching: a chip sets that leader as the teacher, adding the offering first when it isn't on the plan
   * (one server action). Resolves to an error (or the "added, but…" problem) to show on the chip, or null.
   */
  const teachChip = async (item: SuggestItem, personId: number): Promise<string | null> => {
    const res = await plannerTeachingChipAction({ entryId, key: item.key, personId }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    if (!res.ok) return res.error;
    landed(res);
    setRows((rs) => {
      const withRow = res.added ? withAdded(rs, item, []) : rs;
      return withRow.flatMap((r) => {
        if (r.key !== item.key) return [r];
        const ids = res.problem ? r.teacherIds : [...new Set([...(r.teacherIds ?? []), personId])];
        return withTeachers(r, res.teachers, res.onBoard, ids) ?? [];
      });
    });
    return res.problem ?? null;
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

  /** The persistent bar (Patrick, 2026-10-22): real links, so a view opens in a new tab too; a plain click is go(). */
  const navBar = (
    <div className={s.buildNav}>
      <TabStrip
        ariaLabel="Build a Plan"
        scroll
        activeKey={view}
        items={BUILD_NAV.filter((n) => canSeed || !isAddView(n.view)).map((n) => ({ key: n.view, label: n.label, href: hrefOf(n.view), onSelect: () => go(n.view) }))}
      />
    </div>
  );
  /** A sub-view's top: "← Back to the plan", then its heading (where focus lands). */
  const subHead = (title: string) => (
    <div className={s.subHead}>
      <Link
        href={planHref}
        className={s.backLink}
        onClick={(e) => {
          if (!plainClick(e)) return;
          e.preventDefault();
          go('plan');
        }}
      >
        <span aria-hidden="true">← </span>Back to the plan
      </Link>
      <h2 id="build-view-title" className={s.sectionTitle} ref={viewHeadRef} tabIndex={-1}>
        {title}
      </h2>
    </div>
  );
  if (mode === 'suggestions') {
    const railList = rows.length ? (
      <ul className={s.railList}>
        {rows.map((r) => (
          <li key={r.key} className={s.railItem} title={`${r.codeLabel} ${r.title}`}>
            {r.codeLabel && r.codeLabel !== FOCUS_LABEL ? <span className={s.code}>{r.codeLabel}</span> : null}
            {r.title}
          </li>
        ))}
      </ul>
    ) : (
      <p className={s.empty}>Nothing planned yet.</p>
    );
    return (
      <FeedCtx.Provider value={onFeed}>
        {heading}
        {navBar}
        {subHead(VIEW_TITLE.suggestions)}
        <div className={s.suggestLayout}>
          <aside className={s.planRail} aria-labelledby="build-plan">
            <h2 id="build-plan" className={s.sectionTitle} ref={listHeadRef} tabIndex={-1}>
              The plan <span className={s.railCount}>({rows.length})</span>
            </h2>
            {railList}
            <p className={s.railPoll}>
              <PlannerPoller entryId={entryId} stamp={stamp} build stampRef={stampRef} />
            </p>
          </aside>
          <SuggestionsWorkspace
            feed={suggestions}
            rows={rows}
            canSeed={canSeed}
            switcher={switcher}
            onOpenPlan={() => setPlanSheet(true)}
            addItems={addItems}
            canEdit={canEdit}
            onTeach={teachChip}
            onRemove={(row, trigger) => setRemoving({ row, trigger })}
            lookupsHref={lookupsHref}
            dayLabel={dayLabel}
          />
        </div>
        {planSheet ? (
          <Drawer title={`The plan (${rows.length})`} onClose={() => setPlanSheet(false)}>
            {railList}
          </Drawer>
        ) : null}
        {removing ? (
          <RemoveDialog
            row={removing.row}
            onRemove={() => remove(removing.row)}
            onClose={() => {
              const trigger = removing.trigger;
              setRemoving(null);
              requestAnimationFrame(() => (trigger?.isConnected ? trigger.focus() : listHeadRef.current?.focus()));
            }}
          />
        ) : null}
        {feed}
      </FeedCtx.Provider>
    );
  }

  return (
    <LikelyCtx.Provider value={setLikely}>
      <OrphansCtx.Provider value={setOrphanData}>
        <FeedCtx.Provider value={onFeed}>
          {heading}
          {navBar}
          <div className={s.rail}>
            <p className={s.railText}>
              {plural(sum.offerings, 'offering')} · {sum.withTeachers} with {sum.withTeachers === 1 ? 'a teacher' : 'teachers'} · {plural(sum.scouts, 'scout')} signed up ·{' '}
              {/* B9 qa: always mounted, so a recount after an Add is announced politely. */}
              <span aria-live="polite">
                {orphanText ? (
                  <>
                    <button type="button" className={s.railLink} onClick={() => setOrphanSheet(true)} aria-haspopup="dialog">
                      {orphanText}
                    </button>{' '}
                    ·{' '}
                  </>
                ) : null}
              </span>
              <PlannerPoller entryId={entryId} stamp={stamp} build stampRef={stampRef} />
            </p>
          </div>
          {isAddView(view) && canSeed ? (
            <section className={s.subView} aria-labelledby="build-view-title">
              {subHead(VIEW_TITLE[view])}
              <AddPanel key={view} view={view} onPlan={onPlan} defaultMixName={mixName(dayLabel)} addRequirement={addRequirement} addSet={addSet} newMix={newMix} onDone={() => go('plan')} />
            </section>
          ) : null}
          <div className={s.layoutSolo}>
            <section aria-labelledby="build-plan">
              <h2 id="build-plan" className={s.sectionTitle} ref={listHeadRef} tabIndex={-1}>
                The plan
              </h2>
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
                      inviteHref={canEdit || canSeed ? `${inviteHref}&offering=${encodeURIComponent(r.key)}` : undefined}
                      onRemove={(trigger) => setRemoving({ row: r, trigger })}
                    />
                  ))}
                </ul>
              ) : (
                <p className={s.empty}>Nothing planned yet.</p>
              )}
            </section>
          </div>
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
          {rows.length ? (
            <div className={s.inviteBar}>
              <Button variant="primary" href={inviteHref}>
                Next: Invite →
              </Button>
            </div>
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
          {orphanSheet ? (
            <OrphansDrawer
              orphans={orphans}
              rows={rows}
              canSeed={canSeed}
              addItems={addItems}
              onRemove={(row, trigger) => setRemoving({ row, trigger })}
              onClose={() => {
                setOrphanSheet(false);
                // The count's button is gone when nobody is left: back to the plan's heading, never body.
                if (!orphans.length) requestAnimationFrame(() => listHeadRef.current?.focus());
              }}
            />
          ) : null}
          {feed}
        </FeedCtx.Provider>
      </OrphansCtx.Provider>
    </LikelyCtx.Provider>
  );
}

/**
 * B9: the scouts with nothing on this plan, each with their likely next items (the engine's) and an Add (seed right;
 * the page's batched add). After an Add the list recounts; a scout now covered leaves it, and focus moves to the next
 * Add still there, else the list. Viewers see the list without Add.
 */
function OrphansDrawer({
  orphans,
  rows,
  canSeed,
  addItems,
  onRemove,
  onClose
}: {
  orphans: readonly OrphanScout[];
  rows: readonly PlanRow[];
  canSeed: boolean;
  addItems: (items: SuggestItem[]) => Promise<string | null>;
  onRemove: (row: PlanRow, trigger: HTMLElement | null) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const onAdd = async (item: SuggestItem, trigger: HTMLElement | null) => {
    const all = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-suggest-add]') ?? []);
    const at = trigger ? all.indexOf(trigger) : -1;
    const next = [...all.slice(at + 1), ...all.slice(0, Math.max(at, 0))].filter((b) => b.dataset.suggestAdd !== item.key);
    const err = await addItems([item]);
    if (!err) requestAnimationFrame(() => (next.find((b) => b.isConnected) ?? listRef.current)?.focus());
    return err;
  };
  return (
    <Drawer title={orphansLabel(orphans.length) ?? 'Everyone has something on this plan'} onClose={onClose}>
      <div ref={listRef} tabIndex={-1} className={s.orphanList}>
        {orphans.length ? (
          <ul className={s.orphanRows}>
            {orphans.map((o) => (
              <li key={o.scoutId} className={s.orphan}>
                <p className={s.orphanWho}>
                  {o.name}
                  {o.rankLabel ? <span className={s.orphanMeta}>{o.rankLabel}</span> : null}
                </p>
                {o.items.length ? (
                  <ul className={s.orphanItems}>
                    {o.items.map((i) => (
                      <li key={i.key} className={s.orphanItem}>
                        <p className={s.orphanTitle}>
                          <span className={s.code}>
                            {i.eagle ? '★ ' : ''}
                            {i.codeLabel}
                          </span>
                          {i.title}
                        </p>
                        <ItemAction item={i} row={rowByKey.get(i.key)} canSeed={canSeed} onAdd={onAdd} onRemove={onRemove} />
                      </li>
                    ))}
                  </ul>
                ) : o.reason ? (
                  <p className={s.orphanReason}>{o.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

const STATE_CLASS = { ready: s.stateReady, 'needs-teacher': s.stateTeacher, 'needs-scouts': s.stateScouts } as const;

function PlanRowView({
  row,
  likely,
  canSeed,
  canEdit,
  onEdit,
  inviteHref,
  onRemove
}: {
  row: PlanRow;
  /** Its likely scouts by name, once streamed in. */
  likely?: string[];
  canSeed: boolean;
  canEdit: boolean;
  onEdit: () => void;
  /** The Invite tab on this row's offering (B6: an afterthought in the ⋯ menu, above Remove). */
  inviteHref?: string;
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
            {canSeed || inviteHref ? <RowMenu row={row} inviteHref={inviteHref} canRemove={canSeed} onRemove={onRemove} /> : null}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * The row's ⋯: Invite (B6, opens the Invite tab on this offering), then Remove, last, for seed holders; for a row the
 * planner didn't add, Remove is greyed with the reason under it.
 */
function RowMenu({ row, inviteHref, canRemove, onRemove }: { row: PlanRow; inviteHref?: string; canRemove: boolean; onRemove: (trigger: HTMLElement | null) => void }) {
  const { open, wrapRef, triggerRef, onBlur, toggle, close } = useDisclosure();
  const why = cannotRemoveReason(row);
  return (
    <div className={s.menuWrap} ref={wrapRef} onBlur={onBlur}>
      <button type="button" ref={triggerRef} className={s.menuBtn} aria-label={`More for ${row.title}`} aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div className={s.menuPop}>
          {inviteHref ? (
            <Link href={inviteHref} className={s.menuLink}>
              Invite
            </Link>
          ) : null}
          {canRemove ? (
            <>
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
            </>
          ) : null}
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

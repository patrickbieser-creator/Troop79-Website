'use client';

/**
 * Meeting Live (Plans/Meeting-Planner-II.md P4; prototypes/meeting-plan-II/Meeting Live.dc.html and phone/live.html).
 * Desktop: a Not scheduled column, then one column per rotation. Phone (≤ 640 px): one column at a time under a sticky
 * rotation switcher. Each card: code, title, a repeat tag, the teacher, the scouts (a small star when it's a retake,
 * 8c), and its conflict lines (shown, never enforced, 8d).
 *
 * P4a: read-only, with one "Start Meeting Live" for editors before anyone has started it.
 * P4b: editors (the SPL included) edit in place: "Move to" on every card, the teacher and each scout open a sheet (the
 * shared Drawer, full screen on a phone), ⋯ repeats or removes a card, a rotation's location, "+ Add rotation",
 * "+ Add an offer", and drag-and-drop on a fine pointer (a mouse), which calls the same actions as the buttons. The first
 * edit starts Meeting Live on the server. When someone else got there first, the screen says so and refreshes.
 * View-only users get no controls (and the server refuses them anyway).
 * B8 (D-429): here / not here is a draft, recorded after the meeting through the approval checklist. Start asks to
 * confirm when the meeting is in the future. "More actions…" holds "Discard Live arrangement" behind a danger Dialog
 * that names what goes and what stays. Every write tells the server whether this screen showed Live started, so a tab
 * left open after a Discard gets "someone else changed this" instead of silently restarting Live.
 * Rotations L0 (Plans/Build-A-Plan.md, "Rotations"): on a started arrangement, "Needs attention (n)" at the top lists
 * where the plan and the arrangement disagree, each with its one-click fix (editors only; viewers see the list). Each
 * case is also marked in place: the card or chip outlined in red, the sentence on the card. Keep / Keep as extra hide a
 * line for this visit only (component state: nothing is saved, a reload brings it back; L1 makes it stick).
 * L0 qa: a fix's buttons stay focusable while it saves (aria-disabled + a guard); when its line goes, focus moves to
 * the next line's first button, or the strip heading (tabIndex -1) when none follows, and the persistent status says
 * "Fixed · n left" / "All fixed" (the B8 focusStart pattern). Make a class names any scout it couldn't place.
 */
import { useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Drawer } from '@/app/_components/drawer';
import { ConfirmDialog, LiveMoreActions } from './live-dialogs';
import { driftText, type LiveCard, type LiveDrift, type LiveView } from '@/lib/meeting-live-shared';
import {
  plannerLiveAddClassAction,
  plannerLiveAddRotationAction,
  plannerLiveDropRotationAction,
  plannerLiveMoveClassAction,
  plannerLiveMoveScoutAction,
  plannerLiveRemoveClassAction,
  plannerLiveRepeatClassAction,
  plannerLiveSetLocationAction,
  plannerLiveAddVisitorAction,
  plannerLiveDiscardAction,
  plannerLiveSetPresentAction,
  plannerLiveSetTeacherAction,
  plannerLiveStartAction,
  plannerLiveMakeClassAction,
  plannerLiveUseClassTeacherAction,
  type LiveWriteResult
} from '../live-actions';
import styles from './live.module.css';

const FAILED = 'That didn’t save. Check your connection and try again.';
const STALE = 'Someone else changed this. Here’s the latest.';
const DRAG = 'application/x-live';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const rotWord = (r: number | null) => (r == null ? 'Not scheduled' : `Rotation ${r}`);

export interface LiveChoicesProp {
  teachers: { personId: number; name: string }[];
  topics: { key: string; label: string }[];
  scouts: { personId: number; name: string }[];
}

interface Column {
  key: string;
  rotation: number | null;
  label: string;
  short: string;
  location: string | null;
}

type Drag = { t: 'card'; id: string; version: number } | { t: 'scout'; personId: number; from: string | null };

type Sheet =
  | { kind: 'teacher'; card: LiveCard }
  | { kind: 'scout'; personId: number; name: string; from: LiveCard | null }
  | { kind: 'more'; card: LiveCard }
  | { kind: 'addScout'; card: LiveCard | null }
  | { kind: 'addClass'; rotation: number | null }
  | { kind: 'location'; number: number; location: string | null }
  | null;

const EMPTY_CHOICES: LiveChoicesProp = { teachers: [], topics: [], scouts: [] };

/** P4c: here / not here is open on the meeting day only; `note` says why it isn't. B8: the taps are a draft. */
export interface LiveAttendanceProp {
  open: boolean;
  note: string | null;
}

/** B8: Start asks to confirm for a meeting in the future; `label` names its day ('Sun, Oct 25'). */
export interface LiveMeetingProp {
  label: string;
  future: boolean;
}

export const DISCARD_LOST = 'The classes, rotations, moves and here / not-here ticks made on Meeting Live are deleted.';
/** B8 qa: the first edit on a future meeting's preview starts Live; say so quietly, and where the way back is. */
export const LIVE_STARTED_NOTE = 'Meeting Live started. Discard is in More actions.';
export const DISCARD_KEPT = 'Recorded attendance, visitors, offerings and teacher sign-ups stay. The board goes back to the matcher and follows new sign-ups again.';
export const startConfirmText = (label: string) => `Start Meeting Live for ${label}? Changes you make there stop following new sign-ups until you discard it.`;
const CLOSED: LiveAttendanceProp = { open: false, note: null };

/** A chip's spoken name: who, whether they're here (on the meeting day), retake, visitor. Undefined = just the name. */
function chipLabel(name: string, m: { present?: boolean; retake?: boolean; visitor?: boolean; picks?: readonly string[] }, open: boolean): string | undefined {
  const picked = m.picks?.length ? `, picked ${m.picks.join(', ')}` : '';
  const label = `${name}${open ? (m.present ? ', here' : ', not here') : ''}${m.retake ? ', retake: already completed this' : ''}${m.visitor ? ', visitor' : ''}`;
  if (label === name) return undefined;
  return `${label}${picked}`;
}

/** A chip's face: ✓ when here (meeting day), the name, a visitor tag, the retake star. */
function ChipFace({ name, present, visitor, retake, open, picks }: { name: string; present?: boolean; visitor?: boolean; retake?: boolean; open: boolean; picks?: readonly string[] }) {
  return (
    <>
      {open && present ? '✓ ' : ''}
      {name}
      {picks?.length ? <span className={styles.chipPicks}>{picks.join(', ')}</span> : null}
      {visitor ? <span className={styles.visitorTag}>visitor</span> : null}
      {retake ? (
        <span className={styles.star} aria-hidden="true">
          ★
        </span>
      ) : null}
    </>
  );
}

export function LiveBoard({
  view,
  canEdit,
  entryId,
  choices = EMPTY_CHOICES,
  attendance = CLOSED,
  meeting = null
}: {
  view: LiveView;
  canEdit: boolean;
  entryId: number;
  choices?: LiveChoicesProp;
  attendance?: LiveAttendanceProp;
  meeting?: LiveMeetingProp | null;
}) {
  const router = useRouter();
  const columns: Column[] = [
    {
      key: 'u',
      rotation: null,
      label: 'Not scheduled',
      short: 'Not scheduled',
      location: null
    },
    ...view.rotations.map((r) => ({
      key: String(r.number),
      rotation: r.number,
      label: `Rotation ${r.number}`,
      short: `R${r.number}`,
      location: r.location
    }))
  ];
  const maxRotation = view.rotations.reduce((n, r) => Math.max(n, r.number), 0);
  const [tab, setTab] = useState(columns[1]?.key ?? 'u');
  const [start, setStart] = useState<'idle' | 'starting' | string>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [fine, setFine] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'start' | 'discard' | null>(null);
  const [startedNote, setStartedNote] = useState(false);
  /** L0: lines hidden with Keep / Keep as extra, for this visit only. */
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const drift = view.started ? view.drift.filter((d) => !kept.has(d.id)) : [];
  /** L0 qa: the line a fix was pressed on (and where it sat), until it leaves the list. */
  const [fixing, setFixing] = useState<{ id: string; index: number } | null>(null);
  /** Where focus goes once that line has gone: the line now at its place, or the heading. `n` makes each one new. */
  const [focusTo, setFocusTo] = useState<{ index: number; n: number } | null>(null);
  /** The persistent status's words after a fix ("Fixed · 3 left"); a problem notice wins over it. */
  const [said, setSaid] = useState<string | null>(null);
  const [allFixed, setAllFixed] = useState(false);
  if (fixing && !drift.some((d) => d.id === fixing.id)) {
    // Adjusting state to the new list during render (not in an effect): the line went, say so and move focus.
    setFixing(null);
    setSaid(drift.length ? `Fixed · ${drift.length} left` : 'All fixed');
    setAllFixed(!drift.length);
    setFocusTo({ index: fixing.index, n: (focusTo?.n ?? 0) + 1 });
  }
  const attentionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!focusTo) return;
    const root = attentionRef.current;
    const next = root?.querySelectorAll('li')[focusTo.index]?.querySelector<HTMLElement>('button');
    (next ?? root?.querySelector<HTMLElement>('h2'))?.focus();
  }, [focusTo]);
  const startFix = (d: LiveDrift) => setFixing({ id: d.id, index: drift.findIndex((x) => x.id === d.id) });
  const keep = (d: LiveDrift) => {
    startFix(d);
    setKept((k) => new Set([...k, d.id]));
  };
  // Marked in place: a card's sentences, and the chips (placed or waiting) a line is about.
  const cardProblems = new Map<string, string[]>();
  const badMember = new Set<string>();
  const badPool = new Map<number, string[]>();
  for (const d of drift) {
    if (d.kind === 'pick') badPool.set(d.personId, [...(badPool.get(d.personId) ?? []), driftText(d)]);
    if (d.kind === 'offering' || d.kind === 'pick') continue;
    cardProblems.set(d.classId, [...(cardProblems.get(d.classId) ?? []), driftText(d)]);
    if (d.kind === 'cant' || d.kind === 'dropped') badMember.add(`${d.classId}|${d.personId}`);
  }
  // After a Discard, the More actions trigger is gone: focus goes to Start once the refreshed view shows it (B8 qa).
  const focusStart = useRef(false);
  const startWrap = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!focusStart.current || view.started) return;
    startWrap.current?.querySelector('button')?.focus();
    focusStart.current = false;
  }, [view.started]);
  const cardsIn = (c: Column) => view.cards.filter((x) => x.rotation === c.rotation);
  /** A waiting chip's spoken name, with its problem when it has one (L0 qa: the outline alone isn't heard). */
  const poolLabel = (p: LiveView['pool'][number]) => {
    const base = chipLabel(p.name, p, attendance.open);
    const problems = badPool.get(p.personId);
    return problems ? `${base ?? p.name}. ${problems.join('. ')}` : base;
  };

  // Drag-and-drop only where there's a mouse; touch uses "Move to" and the sheets.
  useEffect(() => {
    if (!canEdit || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: fine)');
    const set = () => setFine(!!mq?.matches);
    set();
    mq?.addEventListener?.('change', set);
    return () => mq?.removeEventListener?.('change', set);
  }, [canEdit]);

  const begin = async () => {
    setConfirming(null);
    setStart('starting');
    try {
      const res = await plannerLiveStartAction({ entryId });
      if (!res.ok) return setStart(res.error);
      setStart('idle');
      router.refresh();
    } catch {
      setStart(FAILED);
    }
  };

  /** Every edit: one write, then the latest from the server. Someone else first = say so and show theirs. */
  const run = async (write: () => Promise<LiveWriteResult>) => {
    setBusy(true);
    setSheet(null);
    setSaid(null);
    const fromPreview = !view.started;
    try {
      const res = await write();
      if (res.ok && fromPreview && meeting?.future) setStartedNote(true);
      if (res.ok) setNotice(res.note ?? null);
      else setNotice(res.stale ? STALE : res.error);
      router.refresh();
    } catch {
      setNotice(FAILED);
    } finally {
      setBusy(false);
    }
  };

  const moveClass = (card: LiveCard, rotation: number | null) =>
    run(() =>
      plannerLiveMoveClassAction({
        entryId,
        classId: card.id,
        version: card.version,
        rotation
      })
    );
  const moveScout = (personId: number, from: string | null, to: string | null) => run(() => plannerLiveMoveScoutAction({ entryId, personId, from, to }));

  // ── drag-and-drop ──
  const dragStart = (e: DragEvent, payload: Drag) => {
    e.stopPropagation();
    e.dataTransfer.setData(DRAG, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };
  const payloadOf = (e: DragEvent): Drag | null => {
    try {
      return JSON.parse(e.dataTransfer.getData(DRAG)) as Drag;
    } catch {
      return null;
    }
  };
  const dropZone = (key: string, onDrop: (d: Drag) => void) =>
    canEdit
      ? {
          onDragOver: (e: DragEvent) => {
            if (!Array.from(e.dataTransfer.types ?? []).includes(DRAG)) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(key);
          },
          onDragLeave: () => setOver((o) => (o === key ? null : o)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(null);
            const d = payloadOf(e);
            if (d) onDrop(d);
          }
        }
      : {};
  const cardById = (id: string) => view.cards.find((x) => x.id === id) ?? null;
  const onColumnDrop = (c: Column) => (d: Drag) => {
    if (d.t === 'card') {
      const card = cardById(d.id);
      if (card && card.rotation !== c.rotation) void moveClass(card, c.rotation);
    } else if (c.rotation == null && d.from) void moveScout(d.personId, d.from, null);
  };
  const onCardDrop = (card: LiveCard) => (d: Drag) => {
    if (d.t === 'scout' && d.from !== card.id && !card.members.some((m) => m.personId === d.personId)) void moveScout(d.personId, d.from, card.id);
    if (d.t === 'card') {
      const moving = cardById(d.id);
      if (moving && moving.rotation !== card.rotation) void moveClass(moving, card.rotation);
    }
  };

  const setPresent = (personId: number, present: boolean) => run(() => plannerLiveSetPresentAction({ entryId, personId, present }));
  const addVisitor = (name: string, to: string | null) => run(() => plannerLiveAddVisitorAction({ entryId, name, to }));
  /** Start: straight away for today's meeting; a future one asks first (B8). */
  const askStart = () => (meeting?.future ? setConfirming('start') : void begin());
  /** Discard: returns the problem to show in the Dialog, or null when it went. */
  const discard = async (): Promise<string | null> => {
    try {
      const res = await plannerLiveDiscardAction({ entryId });
      if (!res.ok) return res.error;
      setNotice(null);
      setStartedNote(false);
      focusStart.current = true;
      router.refresh();
      return null;
    } catch {
      return FAILED;
    }
  };
  const started = view.started;
  const dayNote = canEdit && !attendance.open ? attendance.note : null;
  const showBar = !view.started || view.overlaps > 0 || notice != null || dayNote != null || (canEdit && view.started);
  return (
    <div className={styles.live} aria-busy={busy}>
      {!canEdit ? (
        <div className={styles.roBanner} role="alert">
          <strong>View only: you can’t record attendance here.</strong> You can see every class, but changes and attendance are off.
        </div>
      ) : null}
      {showBar ? (
        <div className={styles.bar}>
          {!view.started ? (
            <p className={styles.preview}>
              The board’s match so far. It changes as answers come in until Meeting Live starts
              {canEdit ? ', or until the first change here' : ''}.
            </p>
          ) : null}
          {!view.started && canEdit ? (
            <span className={styles.startWrap} ref={startWrap}>
              <Button onClick={askStart} disabled={start === 'starting'}>
                {start === 'starting' ? 'Starting…' : 'Start Meeting Live'}
              </Button>
              {start !== 'idle' && start !== 'starting' ? (
                <span className={styles.problem} role="alert">
                  {start}
                </span>
              ) : null}
            </span>
          ) : null}
          {dayNote ? <p className={styles.preview}>{dayNote}</p> : null}
          {startedNote ? (
            <p className={styles.preview} role="status">
              {LIVE_STARTED_NOTE}
            </p>
          ) : null}
          {/* Persistent, so a fix's "Fixed · n left" is heard (L0 qa); a problem notice shows instead. */}
          <p className={notice ? styles.notice : styles.srOnly} role="status">
            {notice ?? said ?? ''}
          </p>
          {view.overlaps ? <span className={styles.overlaps}>{plural(view.overlaps, 'overlap')}</span> : null}
          {canEdit && view.started ? <LiveMoreActions onDiscard={() => setConfirming('discard')} /> : null}
        </div>
      ) : null}
      {confirming === 'start' && meeting ? (
        <ConfirmDialog title="Start Meeting Live?" confirm="Start Meeting Live" onConfirm={begin} onClose={() => setConfirming(null)}>
          <p className={styles.confirmText}>{startConfirmText(meeting.label)}</p>
        </ConfirmDialog>
      ) : null}
      {confirming === 'discard' ? (
        <ConfirmDialog title="Discard the Live arrangement?" confirm="Discard arrangement" busyLabel="Discarding…" danger onConfirm={discard} onClose={() => setConfirming(null)}>
          <p className={styles.confirmText}>{DISCARD_LOST}</p>
          <p className={styles.confirmText}>{DISCARD_KEPT}</p>
        </ConfirmDialog>
      ) : null}

      {drift.length || (allFixed && view.started) ? (
        <NeedsAttention
          drift={drift}
          canEdit={canEdit}
          busy={busy}
          sectionRef={attentionRef}
          onKeep={keep}
          onMakeClass={(d) => {
            startFix(d);
            void run(() => plannerLiveMakeClassAction({ entryId, key: d.key }));
          }}
          onRemoveScout={(d) => {
            startFix(d);
            void moveScout(d.personId, d.classId, null);
          }}
          onUsePlan={(d) => {
            startFix(d);
            void run(() => plannerLiveSetTeacherAction({ entryId, classId: d.classId, version: d.version, teacherId: d.plan.personId }));
          }}
          onUseClass={(d, teacherId) => {
            startFix(d);
            void run(() => plannerLiveUseClassTeacherAction({ entryId, classId: d.classId, version: d.version, teacherId }));
          }}
          onRemoveClass={(d) => {
            startFix(d);
            void run(() => plannerLiveRemoveClassAction({ entryId, classId: d.classId, version: d.version }));
          }}
        />
      ) : null}

      <div className={styles.switcher}>
        <div className={styles.tabs} role="tablist" aria-label="Rotations">
          {columns.map((c) => {
            const n = cardsIn(c).length + (c.rotation == null && view.pool.length ? 1 : 0);
            const warn = cardsIn(c).some((x) => x.conflicts.length);
            return (
              <button
                key={c.key}
                type="button"
                role="tab"
                id={`live-tab-${c.key}`}
                aria-selected={tab === c.key}
                aria-controls={`live-col-${c.key}`}
                aria-label={`${c.label}${c.location ? `, ${c.location}` : ''}, ${plural(n, c.rotation == null ? 'item' : 'class', c.rotation == null ? 'items' : 'classes')}${warn ? ', has overlaps' : ''}`}
                className={styles.tab}
                onClick={() => setTab(c.key)}
              >
                <span className={styles.tabLabel}>
                  {c.short}
                  <span className={styles.tabCount}>{n}</span>
                </span>
                {c.location ? <span className={styles.tabLoc}>{c.location}</span> : null}
                {warn ? <span className={styles.tabWarn} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
        {canEdit ? (
          <button
            type="button"
            className={styles.tabAdd}
            aria-label="+ Add rotation"
            disabled={busy}
            onClick={() =>
              run(() =>
                plannerLiveAddRotationAction({
                  entryId,
                  expectMax: maxRotation,
                  expectStarted: started
                })
              )
            }
          >
            +
          </button>
        ) : null}
      </div>

      <div className={styles.columns}>
        {columns.map((c) => {
          const cards = cardsIn(c);
          const scouts = new Set(cards.flatMap((x) => x.members.map((m) => m.personId))).size;
          const teachers = new Set(cards.map((x) => x.teacher?.personId).filter((id) => id != null)).size;
          const droppable = c.rotation != null && c.rotation === maxRotation && c.rotation > 2 && !cards.length;
          return (
            <section
              key={c.key}
              id={`live-col-${c.key}`}
              aria-labelledby={`live-h-${c.key}`}
              data-phone={tab === c.key ? 'shown' : 'hidden'}
              data-over={over === c.key ? 'true' : undefined}
              className={c.rotation == null ? styles.unscheduledCol : styles.column}
              {...dropZone(c.key, onColumnDrop(c))}
            >
              <header className={styles.colHead}>
                <h2 id={`live-h-${c.key}`} className={styles.colTitle}>
                  {c.label}
                </h2>
                {c.rotation != null && canEdit ? (
                  <button
                    type="button"
                    className={styles.locBtn}
                    aria-label={c.location ? `Location: ${c.location}. Edit` : `Add a location for ${c.label}`}
                    onClick={() =>
                      setSheet({
                        kind: 'location',
                        number: c.rotation!,
                        location: c.location
                      })
                    }
                  >
                    {c.location ?? '+ Add a location'}
                  </button>
                ) : c.location ? (
                  <p className={styles.location}>{c.location}</p>
                ) : null}
                {c.rotation != null && cards.length ? (
                  <p className={styles.colSum}>
                    {plural(cards.length, 'class', 'classes')} · {plural(scouts, 'scout')} · {plural(teachers, 'teacher')}
                  </p>
                ) : null}
              </header>
              {c.rotation == null ? (
                <section
                  className={styles.pool}
                  aria-labelledby="live-pool"
                  data-over={over === 'pool' ? 'true' : undefined}
                  {...dropZone('pool', (d) => d.t === 'scout' && d.from && moveScout(d.personId, d.from, null))}
                >
                  <h3 id="live-pool" className={styles.poolTitle}>
                    Not in a class yet · {view.pool.length}
                  </h3>
                  {view.pool.length ? (
                    <ul className={styles.chips}>
                      {view.pool.map((p) => (
                        <li
                          key={p.personId}
                          className={canEdit ? styles.chipItem : attendance.open && !p.present ? styles.chipOut : styles.chip}
                          aria-label={canEdit ? undefined : poolLabel(p)}
                          data-problem={badPool.has(p.personId) ? 'true' : undefined}
                        >
                          {canEdit ? (
                            <button
                              type="button"
                              className={attendance.open && !p.present ? styles.chipBtnOut : styles.chipBtn}
                              aria-label={poolLabel(p)}
                              draggable={fine}
                              onDragStart={(e) =>
                                dragStart(e, {
                                  t: 'scout',
                                  personId: p.personId,
                                  from: null
                                })
                              }
                              onClick={() =>
                                setSheet({
                                  kind: 'scout',
                                  personId: p.personId,
                                  name: p.name,
                                  from: null
                                })
                              }
                            >
                              <ChipFace name={p.name} present={p.present} visitor={p.visitor} open={attendance.open} picks={p.picks} />
                            </button>
                          ) : (
                            <ChipFace name={p.name} present={p.present} visitor={p.visitor} open={attendance.open} picks={p.picks} />
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.quiet}>Everyone has a class.</p>
                  )}
                  {canEdit && attendance.open ? (
                    <button type="button" className={styles.chipAdd} onClick={() => setSheet({ kind: 'addScout', card: null })}>
                      + Add a scout
                    </button>
                  ) : null}
                </section>
              ) : null}
              {cards.map((x) => (
                <LiveCardView
                  key={x.id}
                  card={x}
                  canEdit={canEdit}
                  open={attendance.open}
                  draggable={fine}
                  over={over === x.id}
                  problems={cardProblems.get(x.id) ?? []}
                  badMember={(personId) => badMember.has(`${x.id}|${personId}`)}
                  rotations={view.rotations.map((r) => r.number)}
                  onMove={(r) => moveClass(x, r)}
                  onTeacher={() => setSheet({ kind: 'teacher', card: x })}
                  onScout={(personId, name) => setSheet({ kind: 'scout', personId, name, from: x })}
                  onAdd={() => setSheet({ kind: 'addScout', card: x })}
                  onMore={() => setSheet({ kind: 'more', card: x })}
                  onDragStartCard={(e) => dragStart(e, { t: 'card', id: x.id, version: x.version })}
                  onDragStartScout={(e, personId) => dragStart(e, { t: 'scout', personId, from: x.id })}
                  drop={dropZone(x.id, onCardDrop(x))}
                />
              ))}
              {c.rotation != null && !cards.length ? <p className={styles.empty}>{c.label} is empty.</p> : null}
              {canEdit ? (
                <div className={styles.colActions}>
                  <button type="button" className={styles.quietBtn} onClick={() => setSheet({ kind: 'addClass', rotation: c.rotation })}>
                    + Add an offer
                  </button>
                  {droppable ? (
                    <button
                      type="button"
                      className={styles.quietBtn}
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          plannerLiveDropRotationAction({
                            entryId,
                            number: c.rotation!,
                            expectStarted: started
                          })
                        )
                      }
                    >
                      Remove {c.label}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
        {canEdit ? (
          <button
            type="button"
            className={styles.addColumn}
            disabled={busy}
            onClick={() =>
              run(() =>
                plannerLiveAddRotationAction({
                  entryId,
                  expectMax: maxRotation,
                  expectStarted: started
                })
              )
            }
          >
            + Add rotation
          </button>
        ) : null}
      </div>
      {view.cards.some((x) => x.members.some((m) => m.retake)) ? (
        <p className={styles.legend}>
          <span className={styles.legendStar} aria-hidden="true">
            ★
          </span>{' '}
          retake: already completed this
        </p>
      ) : null}

      {sheet ? (
        <LiveSheet
          sheet={sheet}
          view={view}
          choices={choices}
          open={attendance.open}
          onPresent={setPresent}
          onVisitor={addVisitor}
          onClose={() => setSheet(null)}
          onSetTeacher={(card, teacherId) =>
            run(() =>
              plannerLiveSetTeacherAction({
                entryId,
                classId: card.id,
                version: card.version,
                teacherId
              })
            )
          }
          onMoveScout={moveScout}
          onRepeat={(card, rotation) =>
            run(() =>
              plannerLiveRepeatClassAction({
                entryId,
                classId: card.id,
                version: card.version,
                rotation
              })
            )
          }
          onRemove={(card) =>
            run(() =>
              plannerLiveRemoveClassAction({
                entryId,
                classId: card.id,
                version: card.version
              })
            )
          }
          onAddClass={(what, teacherId, rotation) =>
            run(() =>
              plannerLiveAddClassAction({
                entryId,
                key: what.key,
                title: what.title,
                teacherId,
                rotation,
                expectStarted: started
              })
            )
          }
          onLocation={(number, location) => run(() => plannerLiveSetLocationAction({ entryId, number, location, expectStarted: started }))}
        />
      ) : null}
    </div>
  );
}

function LiveCardView({
  card,
  canEdit,
  open,
  draggable,
  over,
  problems,
  badMember,
  rotations,
  onMove,
  onTeacher,
  onScout,
  onAdd,
  onMore,
  onDragStartCard,
  onDragStartScout,
  drop
}: {
  card: LiveCard;
  canEdit: boolean;
  open: boolean;
  draggable: boolean;
  over: boolean;
  /** L0: what the plan disagrees with on this card (outlined in red, each sentence on the card). */
  problems: string[];
  badMember: (personId: number) => boolean;
  rotations: number[];
  onMove: (rotation: number | null) => void;
  onTeacher: () => void;
  onScout: (personId: number, name: string) => void;
  onAdd: () => void;
  onMore: () => void;
  onDragStartCard: (e: DragEvent) => void;
  onDragStartScout: (e: DragEvent, personId: number) => void;
  drop: object;
}) {
  const kind =
    card.rotation == null
      ? styles.cardUn
      : card.kind === 'mb'
        ? styles.cardMb
        : card.kind === 'rank' || card.kind === 'focus'
          ? styles.cardRank
          : styles.cardOther;
  return (
    <article
      className={`${styles.card} ${kind}`}
      aria-labelledby={`live-card-${card.id}`}
      data-over={over ? 'true' : undefined}
      data-problem={problems.length ? 'true' : undefined}
      draggable={canEdit && draggable}
      onDragStart={canEdit ? onDragStartCard : undefined}
      {...drop}
    >
      <div className={styles.cardHead}>
        <p className={styles.code}>
          {card.codeLabel ? <span>{card.codeLabel}</span> : null}
          {card.repeats.length ? (
            <span className={styles.repeat}>{`Repeat · also ${card.repeats.map((r) => (r == null ? 'unscheduled' : `R${r}`)).join(', ')}`}</span>
          ) : null}
        </p>
        {canEdit ? (
          <button type="button" className={styles.moreBtn} aria-label={`More for ${card.title}`} onClick={onMore}>
            ⋯
          </button>
        ) : null}
      </div>
      <h3 id={`live-card-${card.id}`} className={styles.cardTitle}>
        {card.title}
      </h3>
      <p className={styles.teacherRow}>
        <span className={styles.teacherLabel}>Teacher</span>
        {canEdit ? (
          <button
            type="button"
            className={card.teacher ? styles.teacherBtn : styles.teacherBtnNone}
            aria-label={card.teacher ? `Teacher: ${card.teacher.name}. Change` : 'Teacher: none. Pick one'}
            onClick={onTeacher}
          >
            {card.teacher ? card.teacher.name : 'Pick a teacher'} <span aria-hidden="true">▾</span>
          </button>
        ) : card.teacher ? (
          <span className={styles.teacher}>{card.teacher.name}</span>
        ) : (
          <span className={styles.noTeacher}>No teacher yet</span>
        )}
      </p>
      {card.members.length || canEdit ? (
        <ul className={styles.chips}>
          {card.members.map((m) =>
            canEdit ? (
              <li key={m.personId} className={styles.chipItem} data-problem={badMember(m.personId) ? 'true' : undefined}>
                <button
                  type="button"
                  className={open && !m.present ? styles.chipBtnOut : styles.chipBtn}
                  aria-label={chipLabel(m.name, m, open)}
                  draggable={draggable}
                  onDragStart={(e) => onDragStartScout(e, m.personId)}
                  onClick={() => onScout(m.personId, m.name)}
                >
                  <ChipFace name={m.name} present={m.present} visitor={m.visitor} retake={m.retake} open={open} />
                </button>
              </li>
            ) : (
              <li
                key={m.personId}
                className={open && !m.present ? styles.chipOut : styles.chip}
                aria-label={chipLabel(m.name, m, open)}
                data-problem={badMember(m.personId) ? 'true' : undefined}
              >
                <ChipFace name={m.name} present={m.present} visitor={m.visitor} retake={m.retake} open={open} />
              </li>
            )
          )}
          {canEdit ? (
            <li className={styles.chipItem}>
              <button type="button" className={styles.chipAdd} aria-label={`Add a scout to ${card.title}`} onClick={onAdd}>
                + Add
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className={styles.quiet}>No scouts yet.</p>
      )}
      {card.conflicts.map((line) => (
        <p key={line} className={styles.conflict}>
          {line}
        </p>
      ))}
      {problems.map((line) => (
        <p key={line} className={styles.conflict}>
          {line}
        </p>
      ))}
      {canEdit ? (
        <div className={styles.moveRow} role="group" aria-label={`Move ${card.title} to`}>
          <span className={styles.moveLabel}>Move to</span>
          {[null, ...rotations].map((r) => (
            <button
              key={r ?? 'u'}
              type="button"
              className={styles.moveBtn}
              aria-pressed={card.rotation === r}
              aria-label={rotWord(r)}
              onClick={() => card.rotation !== r && onMove(r)}
            >
              {r ?? '—'}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Rotations L0: "Needs attention (n)". One line per drift case, each with its fix. Viewers get the lines only. Each
 * button's name is its visible words; the line it fixes is its description.
 */
function NeedsAttention({
  drift,
  canEdit,
  busy,
  sectionRef,
  onKeep,
  onMakeClass,
  onRemoveScout,
  onUsePlan,
  onUseClass,
  onRemoveClass
}: {
  drift: LiveDrift[];
  canEdit: boolean;
  busy: boolean;
  sectionRef: RefObject<HTMLElement | null>;
  onKeep: (d: LiveDrift) => void;
  onMakeClass: (d: Extract<LiveDrift, { kind: 'offering' | 'pick' }>) => void;
  onRemoveScout: (d: Extract<LiveDrift, { kind: 'cant' | 'dropped' }>) => void;
  onUsePlan: (d: Extract<LiveDrift, { kind: 'teacher' }>) => void;
  onUseClass: (d: Extract<LiveDrift, { kind: 'teacher' }>, teacherId: number) => void;
  onRemoveClass: (d: Extract<LiveDrift, { kind: 'orphan' }>) => void;
}) {
  // While a write is out the buttons stay focusable (aria-disabled, not disabled) and a press does nothing (L0 qa).
  const guard = (fn: () => void) => () => {
    if (!busy) fn();
  };
  const fixes = (d: LiveDrift, textId: string): ReactNode => {
    const common = { size: 'sm' as const, 'aria-disabled': busy || undefined, 'aria-describedby': textId };
    switch (d.kind) {
      case 'offering':
        return (
          <Button {...common} onClick={guard(() => onMakeClass(d))}>
            Make a class
          </Button>
        );
      case 'pick':
        return (
          <Button {...common} onClick={guard(() => onMakeClass(d))}>
            Create class and place
          </Button>
        );
      case 'cant':
      case 'dropped':
        return (
          <>
            <Button {...common} onClick={guard(() => onRemoveScout(d))}>
              Remove from class
            </Button>
            <Button {...common} variant="ghost" onClick={guard(() => onKeep(d))}>
              Keep
            </Button>
          </>
        );
      case 'teacher':
        return (
          <>
            <Button {...common} variant="secondary" onClick={guard(() => onUsePlan(d))}>
              {`Use ${d.plan.name}`}
            </Button>
            {d.current ? (
              <Button {...common} variant="secondary" onClick={guard(() => onUseClass(d, d.current!.personId))}>
                {`Use ${d.current.name}`}
              </Button>
            ) : null}
          </>
        );
      case 'orphan':
        return (
          <>
            <Button {...common} variant="ghost" onClick={guard(() => onKeep(d))}>
              Keep as extra
            </Button>
            <Button {...common} variant="danger" onClick={guard(() => onRemoveClass(d))}>
              Remove class
            </Button>
          </>
        );
    }
  };
  return (
    <section ref={sectionRef} className={drift.length ? styles.attention : styles.attentionDone} aria-labelledby="live-attention">
      <h2 id="live-attention" className={styles.attentionTitle} tabIndex={-1}>
        {`Needs attention (${drift.length})`}
      </h2>
      {drift.length ? null : <p className={styles.attentionText}>All fixed.</p>}
      <ul className={styles.attentionList}>
        {drift.map((d, i) => {
          const textId = `live-attention-${i}`;
          return (
            <li key={d.id} className={styles.attentionItem}>
              <p id={textId} className={styles.attentionText}>
                {driftText(d)}
              </p>
              {canEdit ? <span className={styles.attentionActions}>{fixes(d, textId)}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SheetRow({
  children,
  note,
  onClick,
  current,
  danger
}: {
  children: ReactNode;
  note?: string;
  onClick?: () => void;
  current?: boolean;
  danger?: boolean;
}) {
  return (
    <li>
      <button type="button" className={danger ? styles.sheetRowDanger : styles.sheetRow} aria-current={current || undefined} onClick={onClick}>
        <span className={styles.sheetRowMain}>{children}</span>
        {note ? <span className={styles.sheetNote}>{note}</span> : null}
      </button>
    </li>
  );
}

function LiveSheet({
  sheet,
  view,
  choices,
  open,
  onPresent,
  onVisitor,
  onClose,
  onSetTeacher,
  onMoveScout,
  onRepeat,
  onRemove,
  onAddClass,
  onLocation
}: {
  sheet: NonNullable<Sheet>;
  view: LiveView;
  choices: LiveChoicesProp;
  open: boolean;
  onPresent: (personId: number, present: boolean) => void;
  onVisitor: (name: string, to: string | null) => void;
  onClose: () => void;
  onSetTeacher: (card: LiveCard, teacherId: number | null) => void;
  onMoveScout: (personId: number, from: string | null, to: string | null) => void;
  onRepeat: (card: LiveCard, rotation: number | null) => void;
  onRemove: (card: LiveCard) => void;
  onAddClass: (what: { key: string | null; title: string | null }, teacherId: number | null, rotation: number | null) => void;
  onLocation: (number: number, location: string) => void;
}) {
  const [what, setWhat] = useState('');
  const [title, setTitle] = useState('');
  const [teacher, setTeacher] = useState('');
  const [loc, setLoc] = useState(sheet.kind === 'location' ? (sheet.location ?? '') : '');
  const [problem, setProblem] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (name: string) => words.every((w) => name.toLowerCase().includes(w));
  const finder = (
    <input type="search" className={styles.input} placeholder="Find a name…" aria-label="Find a name" value={find} onChange={(e) => setFind(e.target.value)} />
  );

  if (sheet.kind === 'teacher') {
    const c = sheet.card;
    const busyIn = (personId: number) =>
      c.rotation == null ? null : view.cards.find((o) => o.id !== c.id && o.rotation === c.rotation && o.teacher?.personId === personId);
    const teachingAt = (personId: number) =>
      view.cards.filter((o) => o.id !== c.id && o.teacher?.personId === personId && o.rotation != null).map((o) => `R${o.rotation}`);
    return (
      <Drawer eyebrow="Teacher" title={c.title} sub={rotWord(c.rotation)} onClose={onClose}>
        {open && c.teacher ? (
          <ul className={styles.sheetList}>
            <SheetRow note={c.teacher.present ? 'Not here, for the attendance check' : 'Here, for the attendance check'} onClick={() => onPresent(c.teacher!.personId, !c.teacher!.present)}>
              {`${c.teacher.present ? 'Mark not present' : 'Mark here'}: ${c.teacher.name}`}
            </SheetRow>
          </ul>
        ) : null}
        {finder}
        <ul className={styles.sheetList}>
          {[...choices.teachers]
            .sort((a, b) => Number(b.personId === c.teacher?.personId) - Number(a.personId === c.teacher?.personId))
            .filter((t) => matches(t.name))
            .map((t) => {
              const busy = busyIn(t.personId);
              const at = teachingAt(t.personId);
              const note =
                c.teacher?.personId === t.personId ? 'current' : busy ? `busy: ${busy.title}` : at.length ? `teaching in ${at.join(', ')}` : undefined;
              return (
                <SheetRow key={t.personId} note={note} current={c.teacher?.personId === t.personId} onClick={() => onSetTeacher(c, t.personId)}>
                  {t.name}
                </SheetRow>
              );
            })}
          {c.teacher ? (
            <SheetRow danger onClick={() => onSetTeacher(c, null)}>
              No teacher yet
            </SheetRow>
          ) : null}
        </ul>
      </Drawer>
    );
  }

  if (sheet.kind === 'scout') {
    const { personId, from } = sheet;
    const inRotation = (r: number | null) =>
      r == null ? null : view.cards.find((o) => o.id !== from?.id && o.rotation === r && o.members.some((m) => m.personId === personId));
    const inTopic = (key: string, id: string) =>
      view.cards.find((o) => o.id !== id && o.id !== from?.id && o.topicKey === key && o.members.some((m) => m.personId === personId));
    const targets = view.cards.filter((o) => o.id !== from?.id);
    const isHere = (from ? from.members : view.pool).find((m) => m.personId === personId)?.present ?? false;
    return (
      <Drawer eyebrow={from ? `${from.title} · ${rotWord(from.rotation)}` : 'Not in a class yet'} title={sheet.name} onClose={onClose}>
        <ul className={styles.sheetList}>
          {open ? (
            <SheetRow note={isHere ? 'Not here, for the attendance check' : 'Here, for the attendance check'} onClick={() => onPresent(personId, !isHere)}>
              {isHere ? 'Mark not present' : 'Mark here'}
            </SheetRow>
          ) : null}
          {from ? (
            <SheetRow danger note="Back to “Not in a class yet”" onClick={() => onMoveScout(personId, from.id, null)}>
              Remove from this class
            </SheetRow>
          ) : null}
        </ul>
        <h3 className={styles.sheetGroup}>{from ? 'Move to another class' : 'Put in a class'}</h3>
        <ul className={styles.sheetList}>
          {targets.map((o) => {
            const here = o.members.some((m) => m.personId === personId);
            const clash = inRotation(o.rotation);
            const note = here
              ? 'already in this class'
              : clash
                ? `already in ${clash.title}`
                : inTopic(o.topicKey, o.id)
                  ? 'in another repeat of this'
                  : undefined;
            return (
              <SheetRow key={o.id} note={note} onClick={here ? undefined : () => onMoveScout(personId, from?.id ?? null, o.id)}>
                {`${o.title} · ${rotWord(o.rotation)}`}
                <span className={styles.sheetMeta}>
                  {o.teacher ? o.teacher.name : 'No teacher yet'} · {plural(o.members.length, 'scout')}
                </span>
              </SheetRow>
            );
          })}
        </ul>
      </Drawer>
    );
  }

  if (sheet.kind === 'more') {
    const c = sheet.card;
    return (
      <Drawer eyebrow={rotWord(c.rotation)} title={c.title} onClose={onClose}>
        <h3 className={styles.sheetGroup}>Repeat this class in</h3>
        <ul className={styles.sheetList}>
          {view.rotations
            .filter((r) => r.number !== c.rotation)
            .map((r) => (
              <SheetRow key={r.number} note="its own teacher and scouts" onClick={() => onRepeat(c, r.number)}>
                {`Rotation ${r.number}`}
              </SheetRow>
            ))}
        </ul>
        <ul className={styles.sheetList}>
          <SheetRow
            danger
            note={c.members.length ? `${plural(c.members.length, 'scout')} go back to “Not in a class yet”` : undefined}
            onClick={() => onRemove(c)}
          >
            Remove this class
          </SheetRow>
        </ul>
      </Drawer>
    );
  }

  if (sheet.kind === 'addScout') {
    const c = sheet.card;
    const pool = new Set(view.pool.map((p) => p.personId));
    const herePool = new Set(view.pool.filter((p) => p.present).map((p) => p.personId));
    const typed = find.trim();
    // Scouts in no class yet; a placed scout moves from their own chip (a move is compare-and-set from that class).
    const placed = new Set(view.cards.flatMap((o) => o.members.map((m) => m.personId)));
    const list = choices.scouts
      .filter((s) => !placed.has(s.personId) && (c != null || !herePool.has(s.personId)))
      .sort((a, b) => Number(!pool.has(a.personId)) - Number(!pool.has(b.personId)));
    return (
      <Drawer eyebrow="Add a scout" title={c ? c.title : 'Here, nothing assigned'} sub={c ? rotWord(c.rotation) : undefined} onClose={onClose}>
        {finder}
        <ul className={styles.sheetList}>
          {list
            .filter((s) => matches(s.name))
            .map((s) => (
              <SheetRow
                key={s.personId}
                note={pool.has(s.personId) ? 'not in a class yet' : undefined}
                onClick={() => (c ? onMoveScout(s.personId, null, c.id) : onPresent(s.personId, true))}
              >
                {s.name}
              </SheetRow>
            ))}
          {open && typed.length >= 2 ? (
            <SheetRow onClick={() => onVisitor(typed, c ? c.id : null)}>
              {`+ Add “${typed}” as a visitor`}
            </SheetRow>
          ) : null}
        </ul>
      </Drawer>
    );
  }

  if (sheet.kind === 'location') {
    return (
      <Drawer
        eyebrow="Location"
        title={`Rotation ${sheet.number}`}
        onClose={onClose}
        footer={
          <Button disabled={loc.trim() === (sheet.location ?? '')} onClick={() => onLocation(sheet.number, loc)}>
            {loc.trim() === (sheet.location ?? '') ? 'Saved' : 'Save changes'}
          </Button>
        }
      >
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Where</span>
          <input className={styles.input} value={loc} maxLength={40} placeholder="e.g. Back room" onChange={(e) => setLoc(e.target.value)} />
        </label>
      </Drawer>
    );
  }

  // addClass
  const rotation = sheet.rotation;
  const freeText = what === '__title';
  const add = () => {
    if (!what || (freeText && !title.trim())) return setProblem(freeText ? 'Can’t add yet: give it a title.' : 'Can’t add yet: choose what it is.');
    onAddClass(freeText ? { key: null, title: title.trim() } : { key: what, title: null }, teacher ? Number(teacher) : null, rotation);
  };
  return (
    <Drawer
      eyebrow="Add an offer"
      title={rotWord(rotation)}
      onClose={onClose}
      footer={
        <span className={styles.startWrap}>
          <Button onClick={add}>{`Add to ${rotWord(rotation)}`}</Button>
          {problem ? (
            <span className={styles.problem} role="alert">
              {problem}
            </span>
          ) : null}
        </span>
      }
    >
      <label className={styles.field}>
        <span className={styles.fieldLabel}>What</span>
        <select className={styles.input} value={what} aria-invalid={!!problem && !what} onChange={(e) => (setWhat(e.target.value), setProblem(null))}>
          <option value="">Choose…</option>
          {choices.topics.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
          <option value="__title">Something else…</option>
        </select>
      </label>
      {freeText ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Title</span>
          <input
            className={styles.input}
            value={title}
            maxLength={80}
            aria-invalid={!!problem && !title.trim()}
            onChange={(e) => (setTitle(e.target.value), setProblem(null))}
          />
        </label>
      ) : null}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Teacher</span>
        <select className={styles.input} value={teacher} onChange={(e) => setTeacher(e.target.value)}>
          <option value="">No teacher yet</option>
          {choices.teachers.map((t) => (
            <option key={t.personId} value={t.personId}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </Drawer>
  );
}

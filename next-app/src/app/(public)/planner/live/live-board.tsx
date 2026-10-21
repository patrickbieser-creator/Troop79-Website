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
 */
import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Drawer } from '@/app/_components/drawer';
import type { LiveCard, LiveView } from '@/lib/meeting-live-shared';
import {
  plannerLiveAddClassAction,
  plannerLiveAddRotationAction,
  plannerLiveDropRotationAction,
  plannerLiveMoveClassAction,
  plannerLiveMoveScoutAction,
  plannerLiveRemoveClassAction,
  plannerLiveRepeatClassAction,
  plannerLiveSetLocationAction,
  plannerLiveSetTeacherAction,
  plannerLiveStartAction,
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
  | { kind: 'addScout'; card: LiveCard }
  | { kind: 'addClass'; rotation: number | null }
  | { kind: 'location'; number: number; location: string | null }
  | null;

const EMPTY_CHOICES: LiveChoicesProp = { teachers: [], topics: [], scouts: [] };

export function LiveBoard({
  view,
  canEdit,
  entryId,
  choices = EMPTY_CHOICES
}: {
  view: LiveView;
  canEdit: boolean;
  entryId: number;
  choices?: LiveChoicesProp;
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
  const cardsIn = (c: Column) => view.cards.filter((x) => x.rotation === c.rotation);

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
    try {
      const res = await write();
      if (res.ok) setNotice(null);
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

  const showBar = !view.started || view.overlaps > 0 || notice != null;
  return (
    <div className={styles.live} aria-busy={busy}>
      {showBar ? (
        <div className={styles.bar}>
          {!view.started ? (
            <p className={styles.preview}>
              The board’s match so far. It changes as answers come in until Meeting Live starts
              {canEdit ? ', or until the first change here' : ''}.
            </p>
          ) : null}
          {!view.started && canEdit ? (
            <span className={styles.startWrap}>
              <Button onClick={begin} disabled={start === 'starting'}>
                {start === 'starting' ? 'Starting…' : 'Start Meeting Live'}
              </Button>
              {start !== 'idle' && start !== 'starting' ? (
                <span className={styles.problem} role="alert">
                  {start}
                </span>
              ) : null}
            </span>
          ) : null}
          {notice ? (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          ) : null}
          {view.overlaps ? <span className={styles.overlaps}>{plural(view.overlaps, 'overlap')}</span> : null}
        </div>
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
                  expectMax: maxRotation
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
                    Coming, nothing assigned · {view.pool.length}
                  </h3>
                  {view.pool.length ? (
                    <ul className={styles.chips}>
                      {view.pool.map((p) => (
                        <li key={p.personId} className={canEdit ? styles.chipItem : styles.chip}>
                          {canEdit ? (
                            <button
                              type="button"
                              className={styles.chipBtn}
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
                              {p.name}
                            </button>
                          ) : (
                            p.name
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.quiet}>Everyone has a class.</p>
                  )}
                </section>
              ) : null}
              {cards.map((x) => (
                <LiveCardView
                  key={x.id}
                  card={x}
                  canEdit={canEdit}
                  draggable={fine}
                  over={over === x.id}
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
                            number: c.rotation!
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
                  expectMax: maxRotation
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
                rotation
              })
            )
          }
          onLocation={(number, location) => run(() => plannerLiveSetLocationAction({ entryId, number, location }))}
        />
      ) : null}
    </div>
  );
}

function LiveCardView({
  card,
  canEdit,
  draggable,
  over,
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
  draggable: boolean;
  over: boolean;
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
  const retakeLabel = (name: string, retake: boolean) => (retake ? `${name}, retake: already completed this` : undefined);
  return (
    <article
      className={`${styles.card} ${kind}`}
      aria-labelledby={`live-card-${card.id}`}
      data-over={over ? 'true' : undefined}
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
              <li key={m.personId} className={styles.chipItem}>
                <button
                  type="button"
                  className={styles.chipBtn}
                  aria-label={retakeLabel(m.name, m.retake)}
                  draggable={draggable}
                  onDragStart={(e) => onDragStartScout(e, m.personId)}
                  onClick={() => onScout(m.personId, m.name)}
                >
                  {m.name}
                  {m.retake ? (
                    <span className={styles.star} aria-hidden="true">
                      ★
                    </span>
                  ) : null}
                </button>
              </li>
            ) : (
              <li key={m.personId} className={styles.chip} aria-label={retakeLabel(m.name, m.retake)}>
                {m.name}
                {m.retake ? (
                  <span className={styles.star} aria-hidden="true">
                    ★
                  </span>
                ) : null}
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
    return (
      <Drawer eyebrow={from ? `${from.title} · ${rotWord(from.rotation)}` : 'Coming, nothing assigned'} title={sheet.name} onClose={onClose}>
        <ul className={styles.sheetList}>
          {from ? (
            <SheetRow danger note="Back to “nothing assigned”" onClick={() => onMoveScout(personId, from.id, null)}>
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
            note={c.members.length ? `${plural(c.members.length, 'scout')} go back to “nothing assigned”` : undefined}
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
    const list = choices.scouts
      .filter((s) => !c.members.some((m) => m.personId === s.personId))
      .sort((a, b) => Number(!pool.has(a.personId)) - Number(!pool.has(b.personId)));
    return (
      <Drawer eyebrow="Add a scout" title={c.title} sub={rotWord(c.rotation)} onClose={onClose}>
        {finder}
        <ul className={styles.sheetList}>
          {list
            .filter((s) => matches(s.name))
            .map((s) => (
              <SheetRow
                key={s.personId}
                note={pool.has(s.personId) ? 'coming, nothing assigned' : undefined}
                onClick={() => onMoveScout(s.personId, null, c.id)}
              >
                {s.name}
              </SheetRow>
            ))}
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

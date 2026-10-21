'use client';

/**
 * One scout's side of the meeting board (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md; prototype
 * prototypes/meeting-board/meeting.html). Coming / Not sure yet / Can't make it, plus up to five picks from a list in
 * earning order. EVERYTHING SAVES ON TAP with an inline "Saved": this is a weekly answer, not a standing profile, so
 * there is no Save button (jenna's review).
 *
 *   - A pick made while "Can't make it" asks in place: Later (primary, the likely answer) or At Sunday's meeting,
 *     which also marks the scout Coming.
 *   - A 6th pick stays tappable and says in place why it didn't take.
 *   - Ranking is optional ("Put them in order"), Up/Down buttons, never drag-and-drop.
 *   - An outing-only row is disabled; its "Needs an outing" line says why (Patrick's one exception).
 *
 * Used by the scout, a parent (one scout at a time), and a leader entering on someone's behalf.
 */
import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { INTENT_LABEL, MAX_PICKS, effectiveIntent, type Intent } from '@/lib/meeting-board-shared';
import type { PickListView, PickRow, ScoutBoardView, TrayPick } from '@/lib/meeting-board-picklist';
import type { MatchLine } from '@/lib/meeting-board-match';
import type { MbScoutLines } from '@/lib/meeting-board-rotations';
import {
  meetingAddPickAction,
  meetingRemovePickAction,
  meetingSetIntentAction,
  meetingSetNoteAction,
  meetingSetOrderAction,
  type MeetingActionResult
} from './actions';
import { TopicParts } from './topic-parts';
import styles from './meeting.module.css';

const FULL = `You have ${MAX_PICKS}. Take one off to add this.`;
const FLASH_MS = 1800;

export interface ScoutBoardProps {
  entryId: number;
  mode: 'rank' | 'merit_badge';
  mbName: string | null;
  /** 'Sunday', from the meeting date. */
  dayName: string;
  subject: { personId: number; firstName: string; isSelf: boolean };
  initial: ScoutBoardView;
  pickList: PickListView;
  onBehalf: boolean;
  readOnly: boolean;
  /** Phase 3a: what the live match gives this scout so far ("So far, you're in First aid, your #2"), by block. Empty
   *  once the agenda is published: the page links to the agenda instead. */
  assigned?: MatchLine[];
  /** Phase 3b, a merit badge night: whether they have the badge, where a leader placed them, and their group and night
   *  so far. Null once the agenda is published (the page links to it) or before stations are set. */
  mbNight?: MbScoutLines | null;
}

/** "So far, you're in Group B": a merit badge night's rotation draft before the agenda is published (Phase 3b). */
export function RotationCard({ night, isSelf, name }: { night: MbScoutLines; isSelf: boolean; name: string }) {
  if (night.hasBadge) {
    if (!night.helping && !night.otherWork) return null;
    return (
      <div className={styles.assignCard}>
        <p className={styles.assignHead}>
          {night.helping
            ? `So far, ${isSelf ? 'you’re' : `${name} is`} helping at ${night.helping}.`
            : `So far, a leader has other work for ${isSelf ? 'you' : name} tonight.`}
        </p>
        <p className={styles.helper}>Leaders set the plan before the meeting, so this can still change.</p>
      </div>
    );
  }
  if (!night.group) return null;
  return (
    <div className={styles.assignCard}>
      <p className={styles.assignHead}>
        So far, {isSelf ? 'you’re' : `${name} is`} in Group {night.group}
      </p>
      <ul className={styles.assignList}>
        {night.stops.map((s) => (
          <li key={s.rotation}>
            Rotation {s.rotation} ·{' '}
            {s.free ? (
              <>
                <b>Free: help out</b>
                <span className={styles.meta}> · already done {s.title}</span>
              </>
            ) : (
              <>
                <b>{s.title}</b>
                <span className={styles.meta}>
                  {s.place ? ` · ${s.place}` : ''}
                  {s.teacher ? ` · ${s.teacher}` : ''}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className={styles.helper}>Leaders set the plan before the meeting, so this can still change.</p>
    </div>
  );
}

/** "So far, you're in First aid, your #2, then Knots": the live match before the agenda is published. */
export function AssignedCard({ lines, isSelf, name }: { lines: MatchLine[]; isSelf: boolean; name: string }) {
  const parts = lines.map((l) => (l.pickNo ? `${l.title}, ${isSelf ? 'your' : 'pick'} #${l.pickNo}` : l.title));
  const who = isSelf ? 'you’re' : `${name} is`;
  const head = `So far, ${who} in ${parts.join(', then ')}`;
  return (
    <div className={styles.assignCard}>
      <p className={styles.assignHead}>{head}</p>
      <ul className={styles.assignList}>
        {lines.map((l, i) => (
          <li key={i}>
            {l.block && <>{l.block} · </>}
            <b>{l.title}</b>
            <span className={styles.meta}>
              {' '}
              · {l.codeLabel}
              {l.teacher ? ` · ${l.teacher}` : ''}
            </span>
            <TopicParts parts={l.parts} title={l.title} />
          </li>
        ))}
      </ul>
      {lines.some((l) => l.placed) && <p className={styles.helper}>Picked from what {isSelf ? 'you need' : `${name} needs`} next.</p>}
      <p className={styles.helper}>Leaders set the plan before the meeting, so this can still change.</p>
    </div>
  );
}

export function ScoutBoard(props: ScoutBoardProps) {
  const { entryId, subject, pickList, onBehalf, readOnly } = props;
  const router = useRouter();
  const [view, setView] = useState(props.initial);
  const [errKey, setErrKey] = useState<string | null>(null);
  const [askWhen, setAskWhen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [rankMode, setRankMode] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [flash, setFlash] = useState<{ intent: number; picks: number }>({ intent: 0, picks: 0 });
  const [live, setLive] = useState('');
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const ids = useId();

  const picked = new Set(view.picks.map((p) => p.key));
  const intent = effectiveIntent(view.intent, view.picks);
  const notComing = view.intent === 'not_coming';
  const ranked = view.picks.some((p) => p.priority != null);
  const target = { entryId, personId: subject.personId, onBehalf };
  const name = subject.firstName;

  function run(call: () => Promise<MeetingActionResult>, after: { what: 'intent' | 'picks'; say: (v: ScoutBoardView) => string; errorAt?: string }) {
    if (readOnly || busy.current) return;
    busy.current = true;
    setProblem(null);
    start(async () => {
      try {
        const res = await call();
        if (!res.ok) {
          if (after.errorAt) setErrKey(after.errorAt);
          setProblem(res.error);
          setLive(res.error);
          return;
        }
        setView(res.view);
        setErrKey(null);
        const stamp = Date.now();
        setFlash((f) => ({ ...f, [after.what]: stamp }));
        setTimeout(() => setFlash((f) => (f[after.what] === stamp ? { ...f, [after.what]: 0 } : f)), FLASH_MS);
        setLive(after.say(res.view));
        router.refresh();
      } finally {
        busy.current = false;
      }
    });
  }

  const count = (v: ScoutBoardView) => `Saved. ${v.picks.length} of ${MAX_PICKS} picked.`;

  function chooseIntent(next: Intent) {
    if (next === view.intent) return;
    setAskWhen(null);
    run(() => meetingSetIntentAction({ ...target, intent: next }), { what: 'intent', say: () => `Saved: ${INTENT_LABEL[next]}` });
  }

  function tap(key: string) {
    if (readOnly) return;
    setAskWhen(null);
    if (picked.has(key)) {
      run(() => meetingRemovePickAction({ ...target, key }), { what: 'picks', say: count });
      return;
    }
    if (view.picks.length >= MAX_PICKS) {
      setErrKey(key);
      setProblem(null);
      setLive(FULL);
      return;
    }
    setErrKey(null);
    if (notComing) {
      setAskWhen(key);
      return;
    }
    run(() => meetingAddPickAction({ ...target, key }), { what: 'picks', say: count, errorAt: key });
  }

  function answerWhen(later: boolean) {
    const key = askWhen;
    if (!key) return;
    setAskWhen(null);
    run(() => meetingAddPickAction({ ...target, key, later, markComing: !later }), {
      what: 'picks',
      say: () => (later ? 'Saved for a later meeting.' : 'Saved. Marked coming.'),
      errorAt: key
    });
  }

  function saveOrder(keys: string[] | null, say: string) {
    run(() => meetingSetOrderAction({ ...target, keys }), { what: 'picks', say: () => say });
  }

  function move(key: string, by: -1 | 1) {
    const order = view.picks.map((p) => p.key);
    const i = order.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const label = view.picks[i].label;
    saveOrder(order, `Saved. ${label} is now number ${j + 1}.`);
  }

  function toggleRankMode() {
    if (rankMode) {
      setRankMode(false);
      return;
    }
    setRankMode(true);
    if (!ranked) saveOrder(view.picks.map((p) => p.key), 'Saved. Use the arrows to put them in order.');
  }

  // ── merit badge night: no pick list (Decision 10). Rank picks are held for the next regular meeting. ──
  if (props.mode === 'merit_badge') {
    const night = props.mbNight ?? null;
    return (
      <>
        {night && view.intent !== 'not_coming' && <RotationCard night={night} isSelf={subject.isSelf} name={name} />}
        <div className={styles.notice}>
          <p>
            <strong className={styles.big}>Merit badge night{props.mbName ? `: ${props.mbName}` : ''}.</strong>
          </p>
          <p>
            {night?.hasBadge
              ? `${subject.isSelf ? 'You have' : `${name} has`} this badge, so ${subject.isSelf ? 'you’ll' : 'they’ll'} help teach or work on something else.`
              : `${subject.isSelf ? 'You’ll' : `${name} will`} be assigned a rotation.`}
          </p>
        </div>
        <IntentControl
          groupName={`${ids}-intent`}
          label={subject.isSelf ? 'Are you coming?' : `Is ${name} coming?`}
          value={view.intent}
          options={['coming', 'not_coming']}
          helper={view.intent === 'not_coming' ? 'Got it. Thanks for letting us know.' : null}
          saved={flash.intent > 0}
          disabled={readOnly}
          onChange={chooseIntent}
        />
        {view.picks.length > 0 && (
          <p className={styles.meta}>
            {subject.isSelf ? 'Your' : `${name}’s`} picks are saved for next time ({view.picks.length}).
          </p>
        )}
        <p className={styles.sr} aria-live="polite">
          {live}
        </p>
      </>
    );
  }

  const whose = subject.isSelf ? 'Your picks' : `${name}’s picks`;
  const term = search.trim().toLowerCase();
  const working = [...pickList.working, ...pickList.badges.filter((b) => picked.has(b.key))];
  const found = term ? pickList.badges.filter((b) => !picked.has(b.key) && b.label.toLowerCase().includes(term)).slice(0, 8) : [];

  const row = (r: PickRow, showCode = true) => (
    <li key={r.key} className={styles.pickWrap}>
      <button
        type="button"
        className={r.outing ? `${styles.pick} ${styles.outing}` : styles.pick}
        aria-pressed={picked.has(r.key)}
        disabled={readOnly || (r.outing && !picked.has(r.key))}
        onClick={() => tap(r.key)}
      >
        <span className={styles.box} aria-hidden="true">
          {picked.has(r.key) ? '✓' : ''}
        </span>
        <span>
          <span className={styles.ttl}>
            {showCode && r.code && <span className={styles.code}>{r.code}</span>}
            <b>{r.label}</b>
          </span>
          {r.teacher && <span className={styles.teacherTag}>Teacher: {r.teacher}</span>}
          {(r.outing || r.others) && (
            <span className={styles.who}>{r.outing ? `Needs an outing${r.others ? ` · ${r.others}` : ''}` : r.others}</span>
          )}
        </span>
      </button>
      <TopicParts parts={r.parts} title={r.label} />
      {errKey === r.key && (
        <p className={styles.badNote} role="alert">
          {problem ?? FULL}
        </p>
      )}
      {askWhen === r.key && (
        <div className={styles.whenAsk} role="group" aria-label="When">
          <span>Work on this at {props.dayName}’s meeting, or later?</span>
          <Button size="sm" autoFocus onClick={() => answerWhen(true)}>
            Later
          </Button>
          <Button size="sm" variant="secondary" onClick={() => answerWhen(false)}>
            At {props.dayName}’s meeting
          </Button>
        </div>
      )}
    </li>
  );

  return (
    <>
      {props.assigned && props.assigned.length > 0 && !notComing && (
        <AssignedCard lines={props.assigned} isSelf={subject.isSelf} name={name} />
      )}
      <IntentControl
        groupName={`${ids}-intent`}
        label={subject.isSelf ? 'Are you coming?' : `Is ${name} coming?`}
        value={view.intent}
        implied={view.intent == null && intent === 'coming'}
        options={['coming', 'undecided', 'not_coming']}
        helper={
          view.intent === 'undecided'
            ? 'We’ll find something that fits.'
            : view.intent === 'not_coming'
              ? `Got it. ${subject.isSelf ? 'Your' : `${name}’s`} picks are saved for next week.`
              : null
        }
        saved={flash.intent > 0}
        disabled={readOnly}
        onChange={chooseIntent}
      />

      <p className={styles.lede}>
        {notComing
          ? 'Want to work on something at a later meeting? Pick it here.'
          : `Pick up to ${MAX_PICKS} things to work on. You’ll do one or two of them.`}
      </p>

      <section className={errKey ? `${styles.tray} ${styles.trayBad}` : styles.tray} aria-label={whose}>
        <div className={styles.trayHead}>
          <span>
            <strong>
              {whose} ({view.picks.length} of {MAX_PICKS})
            </strong>
            <Saved on={flash.picks > 0} />
          </span>
          {!readOnly && view.picks.length > 1 && (
            <span>
              {rankMode && ranked && (
                <>
                  <button type="button" className={`${styles.linkBtn} ${styles.quiet}`} onClick={() => { setRankMode(false); saveOrder(null, 'Saved. Order cleared.'); }}>
                    Clear order
                  </button>
                  {' · '}
                </>
              )}
              <button type="button" className={styles.linkBtn} onClick={toggleRankMode}>
                {rankMode ? 'Done' : ranked ? 'Change order' : 'Put them in order'}
              </button>
            </span>
          )}
        </div>
        {view.picks.length ? (
          <ul className={styles.trayList}>
            {view.picks.map((p, i) => (
              <TrayItem
                key={p.key}
                pick={p}
                n={ranked || rankMode ? i + 1 : null}
                first={i === 0}
                last={i === view.picks.length - 1}
                rankMode={rankMode && !readOnly}
                readOnly={readOnly}
                noteOpen={noteFor === p.key}
                onNoteOpen={() => setNoteFor(p.key)}
                onNoteSave={(note) => {
                  setNoteFor(null);
                  run(() => meetingSetNoteAction({ ...target, key: p.key, note }), { what: 'picks', say: () => 'Saved.' });
                }}
                onUp={() => move(p.key, -1)}
                onDown={() => move(p.key, 1)}
                onRemove={() => tap(p.key)}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.trayEmpty}>Nothing picked yet.</p>
        )}
        {problem && !errKey && (
          <p className={styles.badNote} role="alert">
            {problem}
          </p>
        )}
      </section>

      {pickList.offered.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupHead}>Also offered this week</h3>
          <ul className={styles.picks}>{pickList.offered.map((r) => row(r, false))}</ul>
        </div>
      )}

      {pickList.groups.map((g) =>
        g.next ? (
          <div key={g.rankId} className={styles.group}>
            <h3 className={styles.groupHead}>
              {g.title} <span className={styles.meta}>{g.rows.length ? `next rank · ${g.rows.length} left` : ''}</span>
            </h3>
            {g.rows.length ? (
              <ul className={styles.picks}>{g.rows.map((r) => row(r))}</ul>
            ) : (
              <p className={styles.emptyLine}>Nothing left for {g.title} that you can do at a meeting. Pick a merit badge.</p>
            )}
          </div>
        ) : (
          <details key={g.rankId} className={styles.group} open={g.rows.some((r) => picked.has(r.key)) || undefined}>
            <summary>
              {g.title}
              <span className={styles.meta}>{g.rows.length}</span>
            </summary>
            <ul className={styles.picks}>{g.rows.map((r) => row(r))}</ul>
          </details>
        )
      )}

      <div className={styles.group}>
        <h3 className={styles.groupHead}>
          Merit badges <span className={styles.meta}>make-up work</span>
        </h3>
        {working.length > 0 && (
          <>
            <p className={styles.subMeta}>Badges you’re working on</p>
            <ul className={styles.picks}>{working.map((r) => row(r, false))}</ul>
          </>
        )}
        <label className={styles.searchLabel} htmlFor={`${ids}-mbq`}>
          Find a badge
        </label>
        <input
          id={`${ids}-mbq`}
          className={styles.search}
          type="search"
          autoComplete="off"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSearch('');
          }}
        />
        {term &&
          (found.length ? (
            <ul className={styles.picks}>{found.map((r) => row(r, false))}</ul>
          ) : (
            <p className={styles.emptyLine}>No badge matches “{search}”.</p>
          ))}
      </div>

      <p className={styles.sr} aria-live="polite">
        {pending ? '' : live}
      </p>
    </>
  );
}

export function Saved({ on }: { on: boolean }) {
  return (
    <span className={on ? `${styles.saved} ${styles.savedOn}` : styles.saved} aria-hidden="true">
      {on ? 'Saved' : ''}
    </span>
  );
}

/** Coming / Not sure yet / Can't make it: a real radio group (arrow keys move), saved the moment it changes. */
export function IntentControl({
  groupName,
  label,
  value,
  implied = false,
  options,
  helper,
  saved,
  disabled,
  onChange
}: {
  groupName: string;
  label: string;
  value: Intent | null;
  implied?: boolean;
  options: Intent[];
  helper: string | null;
  saved: boolean;
  disabled: boolean;
  onChange: (v: Intent) => void;
}) {
  const labelId = `${groupName}-label`;
  return (
    <div className={styles.block}>
      <div className={styles.fieldLabel} id={labelId}>
        {label}
      </div>
      <div className={styles.intentRow}>
        <div className={styles.seg} role="radiogroup" aria-labelledby={labelId}>
          {options.map((o) => (
            <label key={o} className={o === value || (implied && o === 'coming') ? `${styles.segOption} ${styles.segOn}` : styles.segOption}>
              <input
                type="radio"
                className={styles.segInput}
                name={groupName}
                value={o}
                checked={o === value}
                disabled={disabled}
                onChange={() => onChange(o)}
              />
              {INTENT_LABEL[o]}
            </label>
          ))}
        </div>
        <Saved on={saved} />
      </div>
      {helper && <p className={styles.helper}>{helper}</p>}
    </div>
  );
}

function TrayItem({
  pick,
  n,
  first,
  last,
  rankMode,
  readOnly,
  noteOpen,
  onNoteOpen,
  onNoteSave,
  onUp,
  onDown,
  onRemove
}: {
  pick: TrayPick;
  n: number | null;
  first: boolean;
  last: boolean;
  rankMode: boolean;
  readOnly: boolean;
  noteOpen: boolean;
  onNoteOpen: () => void;
  onNoteSave: (note: string) => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const [note, setNote] = useState(pick.note ?? '');
  const bits = [pick.codeLabel];
  if (pick.later) bits.push('For a later meeting');
  if (pick.note) bits.push(pick.note);
  if (pick.addedBy) bits.push(`added by ${pick.addedBy}`);
  return (
    <li>
      {n != null && (
        <span className={styles.n} aria-label={`Number ${n}`}>
          {n}
        </span>
      )}
      <span className={styles.t}>
        {pick.label}
        <small>{bits.filter(Boolean).join(' · ')}</small>
        {pick.kind === 'mb' && !readOnly &&
          (noteOpen ? (
            <span className={styles.noteRow}>
              <input type="text" aria-label="Note for the teacher" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button size="sm" variant="secondary" onClick={() => onNoteSave(note.trim())}>
                Done
              </Button>
            </span>
          ) : (
            <button type="button" className={`${styles.linkBtn} ${styles.quiet} ${styles.small}`} onClick={onNoteOpen}>
              {pick.note ? 'Change note' : 'Add a note'}
            </button>
          ))}
      </span>
      {rankMode && (
        <>
          <button type="button" className={styles.iconBtn} aria-label={`Move ${pick.label} up`} disabled={first} onClick={onUp}>
            ↑
          </button>
          <button type="button" className={styles.iconBtn} aria-label={`Move ${pick.label} down`} disabled={last} onClick={onDown}>
            ↓
          </button>
        </>
      )}
      {!readOnly && (
        <button type="button" className={styles.iconBtn} aria-label={`Take off ${pick.label}`} onClick={onRemove}>
          ✕
        </button>
      )}
    </li>
  );
}

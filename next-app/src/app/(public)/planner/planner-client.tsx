'use client';

/**
 * The planner's client side (Plans/Meeting-Planner-II.md P2a): one context the board's names and buttons use to open
 * the person drawer or the Add an offer drawer, and that keeps the poller off a write in flight (tech-lead,
 * 2026-10-21: the poller skips while a save is pending, then takes the stamp the save returned, so it doesn't refresh
 * over a result the drawer already shows; the board behind refreshes once when the save settles).
 * Perf (2026-10-22): a write from the person drawer is `defer`red: the board behind is NOT refreshed per tick, only
 * once when the drawer closes (or when the last write still in flight lands after it closed). The poller has already
 * adopted each save's stamp, so without that refresh on close the board would stay stale.
 *
 * Viewers (no edit right) get plain names and no buttons: PersonName renders a span, the buttons render nothing.
 * P2b: Send request renders for adult editors only (canEmail); a scout editor (the SPL) sees AdultsSendEmails instead.
 * P3: a seed holder (canSeed) may leave an offer's teacher blank: Build a Plan's own add puts it on the plan (B4).
 * B4 (Build a Plan "Consolidation"): the seed drawer and the nudge drawer retired with the cards that opened them
 * (Build's Invite… offers a class to families); the plan strip's PlanLink opens this meeting on /planner/build.
 * P5b: reminders, adult editors only: "Remind" in the person drawer and "Remind everyone…" on the Haven't answered
 * card. Who was reminded this visit is kept here, so the drawer and the card agree.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { plannerAssignAction, plannerSendRemindersAction, plannerSendRequestAction } from './actions';
import { PersonDrawerView } from './person-drawer';
import { OfferDrawer } from './offer-drawer';
import styles from './planner.module.css';

export const SAVE_FAILED = 'That didn’t save. Check your connection and try again.';

export interface PlannerAdult {
  personId: number;
  name: string;
}

type Open =
  | { mode: 'person'; personId: number }
  | { mode: 'offer'; teacherId: number | null; back: number | null }
  | null;

interface Sync {
  /** The last board stamp the page has seen or written. */
  stamp: RefObject<string>;
  /** A save is pending: the poller waits. */
  busy: () => boolean;
  /** `defer`: don't refresh the board for this write; it refreshes once when the drawer closes. */
  run: <T extends { ok: boolean; stamp?: string }>(write: () => Promise<T>, opts?: { defer?: boolean }) => Promise<T>;
  /**
   * One person's writes (and the drawer's load) one at a time, in click order: the first write on a new board turns a
   * scout's carried picks into their own, so two at once could race. Kept here, not in the drawer, so a drawer closed
   * and reopened mid-save still loads after the writes before it.
   */
  serial: <T>(personId: number, task: () => Promise<T>) => Promise<T>;
}

interface PlannerCtx {
  entryId: number;
  canEdit: boolean;
  /** An adult editor: may send requests and reminders. */
  canEmail: boolean;
  /** The planning team (P3): may put an offering on the plan without a teacher. */
  canSeed: boolean;
  /** People reminded this visit (P5b). */
  reminded: ReadonlySet<number>;
  markReminded: (personIds: readonly number[]) => void;
  adults: readonly PlannerAdult[];
  openPerson: (personId: number) => void;
  openOffer: (teacherId?: number | null, back?: number | null) => void;
  sync: Sync;
}

const Ctx = createContext<PlannerCtx | null>(null);

export function usePlanner(): PlannerCtx | null {
  return useContext(Ctx);
}

export function PlannerProvider({
  entryId,
  canEdit,
  canEmail = false,
  canSeed = false,
  adults,
  stamp,
  children
}: {
  entryId: number;
  canEdit: boolean;
  canEmail?: boolean;
  canSeed?: boolean;
  adults: readonly PlannerAdult[];
  stamp: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [reminded, setReminded] = useState<ReadonlySet<number>>(new Set());
  const stampRef = useRef(stamp);
  const pending = useRef(0);
  /** A deferred write landed: the board behind owes one refresh. */
  const owed = useRef(false);
  /** A drawer is open (deferred writes wait for it to close). */
  const showing = useRef(false);

  const refreshNow = useCallback(() => {
    owed.current = false;
    router.refresh();
  }, [router]);

  const run = useCallback(
    async <T extends { ok: boolean; stamp?: string }>(write: () => Promise<T>, opts?: { defer?: boolean }): Promise<T> => {
      pending.current++;
      if (opts?.defer) owed.current = true;
      try {
        const res = await write();
        if (res.ok && res.stamp) stampRef.current = res.stamp;
        return res;
      } catch {
        // A dropped connection or a server error: say so in place instead of leaving the control stuck.
        return { ok: false, error: SAVE_FAILED } as unknown as T;
      } finally {
        pending.current--;
        if (pending.current === 0 && (!opts?.defer || (owed.current && !showing.current))) refreshNow();
      }
    },
    [refreshNow]
  );

  const queues = useRef(new Map<number, Promise<unknown>>());
  const serial = useCallback(<T,>(personId: number, task: () => Promise<T>): Promise<T> => {
    const next = (queues.current.get(personId) ?? Promise.resolve()).then(task, task);
    const tail = next.catch(() => undefined);
    queues.current.set(personId, tail);
    void tail.then(() => {
      if (queues.current.get(personId) === tail) queues.current.delete(personId);
    });
    return next;
  }, []);

  const show = useCallback(
    (next: Open) => {
      showing.current = next != null;
      setOpen(next);
      if (next == null && owed.current && pending.current === 0) refreshNow();
    },
    [refreshNow]
  );

  // Its own memo, so a refresh (new `adults` array) doesn't hand the poller a new sync and restart its timer.
  const sync = useMemo<Sync>(() => ({ stamp: stampRef, busy: () => pending.current > 0, run, serial }), [run, serial]);
  const value = useMemo<PlannerCtx>(
    () => ({
      entryId,
      canEdit,
      canEmail: canEdit && canEmail,
      canSeed,
      reminded,
      markReminded: (ids) => setReminded((r) => new Set([...r, ...ids])),
      adults,
      openPerson: (personId) => show({ mode: 'person', personId }),
      openOffer: (teacherId = null, back = null) => show({ mode: 'offer', teacherId, back }),
      sync
    }),
    [entryId, canEdit, canEmail, canSeed, reminded, adults, sync, show]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {open?.mode === 'person' ? <PersonDrawerView key={open.personId} personId={open.personId} onClose={() => show(null)} /> : null}
      {open?.mode === 'offer' ? (
        <OfferDrawer teacherId={open.teacherId} onClose={() => show(open.back != null ? { mode: 'person', personId: open.back } : null)} />
      ) : null}
    </Ctx.Provider>
  );
}

/** A name on the board: opens their drawer for an editor, plain text for a viewer. */
export function PersonName({ personId, name, className }: { personId: number; name: string; className?: string }) {
  const p = usePlanner();
  if (!p?.canEdit) return <span className={className}>{name}</span>;
  return (
    <button type="button" className={`${className ?? ''} ${styles.nameBtn}`} onClick={() => p.openPerson(personId)}>
      {name}
    </button>
  );
}

/** The plan strip's link to this meeting on Build a Plan (B4): "Edit the plan" for editors and the planning team. */
export function PlanLink({ entryId }: { entryId: number }) {
  const p = usePlanner();
  return (
    <Link href={`/planner/build?meeting=${entryId}`} className={styles.planLink}>
      {p?.canEdit || p?.canSeed ? 'Edit the plan' : 'See the plan'}
    </Link>
  );
}

/** "+ Add an offer" on a card header. Editors and the planning team (a teacher-less offer is a seed). */
export function AddOfferButton() {
  const p = usePlanner();
  if (!p?.canEdit && !p?.canSeed) return null;
  return (
    <button type="button" className={styles.bandAction} onClick={() => p.openOffer()}>
      + Add an offer
    </button>
  );
}

/** Assign: this person teaches this topic and is marked Coming (for the day of the meeting). Editors only. */
export function AssignButton({ personId, name, topicKey, title }: { personId: number; name: string; topicKey: string; title: string }) {
  const p = usePlanner();
  const [state, setState] = useState<'idle' | 'saving' | 'done' | string>('idle');
  if (!p?.canEdit) return null;
  const assign = async () => {
    setState('saving');
    const res = await p.sync.run(() => plannerAssignAction({ entryId: p.entryId, personId, key: topicKey }));
    setState(res.ok ? 'done' : res.error);
  };
  if (state === 'done') return <span className={styles.assigned}>✓ Assigned</span>;
  return (
    <span className={styles.assignWrap}>
      <button type="button" className={styles.assignBtn} onClick={assign} disabled={state === 'saving'} aria-label={`Assign ${name} to ${title}`}>
        {state === 'saving' ? 'Assigning…' : 'Assign'}
      </button>
      {state !== 'idle' && state !== 'saving' ? (
        <span className={styles.rowProblem} role="alert">
          {state}
        </span>
      ) : null}
    </span>
  );
}

/** Send request: the Troop 79 Bugler asks this adult to teach the request. Adult editors only. */
export function SendRequestButton({ personId, name, topicKey, title, requested }: { personId: number; name: string; topicKey: string; title: string; requested: boolean }) {
  const p = usePlanner();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>(requested ? 'sent' : 'idle');
  if (!p?.canEmail) return null;
  if (state === 'sent') return <span className={styles.assigned}>✓ Request sent</span>;
  const send = async () => {
    setState('sending');
    const res = await p.sync.run(() => plannerSendRequestAction({ entryId: p.entryId, topicKey, personId }));
    if (!res.ok) setState(res.error);
    else if (res.sent.length) setState('sent');
    else setState(`Not sent: ${res.skipped.map((s) => s.reason).join(', ') || 'nobody to email'}.`);
  };
  return (
    <span className={styles.assignWrap}>
      <button type="button" className={styles.requestBtn} onClick={send} disabled={state === 'sending'} aria-label={`Send ${name} a request to teach ${title}`}>
        {state === 'sending' ? 'Sending…' : 'Send request'}
      </button>
      {state !== 'idle' && state !== 'sending' ? (
        <span className={styles.rowProblem} role="alert">
          {state}
        </span>
      ) : null}
    </span>
  );
}

/** For a scout editor (the SPL): one line where the email buttons would be. */
export function AdultsSendEmails() {
  const p = usePlanner();
  if (!p?.canEdit || p.canEmail) return null;
  return <p className={styles.emailNote}>Requests are emailed by adults.</p>;
}

/** "Not sent: 2 reminded in the last 24 hours, Finn P (no parent with an email in their household)." */
export function notSentText(skipped: readonly { name: string; reason: string }[]): string {
  const by = new Map<string, string[]>();
  for (const s of skipped) by.set(s.reason, [...(by.get(s.reason) ?? []), s.name]);
  const parts = [...by].map(([reason, names]) => (names.length === 1 ? `${names[0]} (${reason})` : `${names.length} ${reason}`));
  return parts.length ? `Not sent: ${parts.join(', ')}.` : '';
}

type RemindState = { phase: 'idle' | 'confirm' | 'sending' } | { phase: 'done'; sent: number; note: string } | { phase: 'problem'; text: string };

/** Send reminders and say what happened: "✓ Reminded …", plus who wasn't sent to and why. */
function useRemind(personIds: readonly number[]) {
  const p = usePlanner();
  const [state, setState] = useState<RemindState>({ phase: 'idle' });
  // Two clicks in one frame both reach the handler before the disabled button renders; the ref lets only one send.
  const inFlight = useRef(false);
  const send = async () => {
    if (!p || inFlight.current) return;
    inFlight.current = true;
    setState({ phase: 'sending' });
    const res = await p.sync.run(() => plannerSendRemindersAction({ entryId: p.entryId, personIds: [...personIds] })).finally(() => {
      inFlight.current = false;
    });
    if (!res.ok) return setState({ phase: 'problem', text: res.error });
    if (!res.sent.length) return setState({ phase: 'problem', text: notSentText(res.skipped) || 'Nobody to remind.' });
    p.markReminded(res.reminded);
    setState({ phase: 'done', sent: res.sent.length, note: notSentText(res.skipped) });
  };
  return { p, state, setState, send };
}

/** "Remind" in the person drawer, for someone who hasn't answered. Adult editors only. */
export function RemindButton({ personId, name }: { personId: number; name: string }) {
  const { p, state, send } = useRemind([personId]);
  if (!p?.canEmail) return null;
  if (state.phase === 'done' || (state.phase === 'idle' && p.reminded.has(personId))) return <p className={styles.assigned}>✓ Reminded · just now</p>;
  return (
    <div className={styles.remindRow}>
      <button type="button" className={styles.quickBtn} onClick={send} disabled={state.phase === 'sending'} aria-label={`Remind ${name}`}>
        {state.phase === 'sending' ? 'Sending…' : 'Remind'}
      </button>
      {state.phase === 'problem' ? (
        <p className={styles.rowProblem} role="alert">
          {state.text}
        </p>
      ) : null}
    </div>
  );
}

/** "Remind everyone…" on the Haven't answered card: one confirm, then one email per family or adult. Adult editors only. */
export function RemindEveryone({ personIds }: { personIds: readonly number[] }) {
  const { p, state, setState, send } = useRemind(personIds);
  if (!p?.canEmail || !personIds.length) return null;
  const n = personIds.length;
  if (state.phase === 'done') {
    return (
      <div className={styles.remindRow}>
        <p className={styles.assigned}>✓ Reminded {state.sent === 1 ? '1 person' : `${state.sent} people`} · just now</p>
        {state.note ? <p className={styles.meta}>{state.note}</p> : null}
      </div>
    );
  }
  if (state.phase === 'confirm' || state.phase === 'sending') {
    return (
      <div className={styles.remindRow}>
        <p className={styles.remindAsk}>Email a reminder about {n === 1 ? '1 person' : `${n} people`}? A scout’s goes to their parents.</p>
        <button type="button" className={styles.requestBtn} onClick={send} disabled={state.phase === 'sending'}>
          {state.phase === 'sending' ? 'Sending…' : 'Send reminders'}
        </button>
        <button type="button" className={styles.quickBtn} onClick={() => setState({ phase: 'idle' })} disabled={state.phase === 'sending'}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className={styles.remindRow}>
      <button type="button" className={styles.quickBtn} onClick={() => setState({ phase: 'confirm' })}>
        Remind everyone…
      </button>
      {state.phase === 'problem' ? (
        <p className={styles.rowProblem} role="alert">
          {state.text}
        </p>
      ) : null}
    </div>
  );
}

export interface SomeoneRow {
  personId: number;
  name: string;
  role: 'Scout' | 'Adult';
  /** 'Coming', 'Not sure', 'Can’t', 'No answer'. */
  answer: string;
}

/** "Enter for someone": find a person who phoned or texted and open their drawer. Editors only. */
export function EnterForSomeone({ people }: { people: readonly SomeoneRow[] }) {
  const p = usePlanner();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'Scout' | 'Adult' | null>(null);
  if (!p?.canEdit) return null;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown =
    words.length || filter
      ? people.filter((x) => (!filter || filter === 'all' || x.role === filter) && words.every((w) => x.name.toLowerCase().includes(w)))
      : [];
  return (
    <section className={styles.enterCard} aria-labelledby="planner-enter">
      <h2 id="planner-enter" className={styles.enterTitle}>
        Enter for someone
      </h2>
      <p className={styles.enterSub}>Took an answer by phone or text? Find the person.</p>
      <input type="search" className={styles.enterInput} placeholder="Type a name…" aria-label="Find a person" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className={styles.pills} role="group" aria-label="Show">
        {(
          [
            ['all', 'Everyone'],
            ['Scout', 'Scouts'],
            ['Adult', 'Adults']
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" className={filter === v ? styles.pillOn : styles.pill} aria-pressed={filter === v} onClick={() => setFilter(filter === v ? null : v)}>
            {label}
          </button>
        ))}
      </div>
      {shown.length ? (
        <ul className={styles.enterList}>
          {shown.map((x) => (
            <li key={x.personId}>
              <button type="button" className={styles.enterRow} onClick={() => p.openPerson(x.personId)}>
                <span className={styles.enterName}>{x.name}</span>
                <span className={x.role === 'Scout' ? styles.roleScout : styles.roleAdult}>{x.role}</span>
                <span className={styles.enterAnswer}>{x.answer}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : words.length || filter ? (
        <p className={styles.enterEmpty}>Nobody by that name.</p>
      ) : null}
    </section>
  );
}

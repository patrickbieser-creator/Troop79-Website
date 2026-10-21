'use client';

/**
 * The planner's client side (Plans/Meeting-Planner-II.md P2a): one context the board's names and buttons use to open
 * the person drawer or the Add an offer drawer, and that keeps the poller off a write in flight (tech-lead,
 * 2026-10-21: the poller skips while a save is pending, then takes the stamp the save returned, so it doesn't refresh
 * over a result the drawer already shows; the board behind refreshes once when the save settles).
 *
 * Viewers (no edit right) get plain names and no buttons: PersonName renders a span, the buttons render nothing.
 * P2b: Send request and "Choose families to nudge…" render for adult editors only (canEmail); a scout editor (the SPL)
 * sees AdultsSendEmails instead.
 * P3: a seed holder (canSeed) gets "Seed this meeting" on the Meeting focus strip, and may leave an offer's teacher blank.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { plannerAssignAction, plannerSendRequestAction } from './actions';
import { PersonDrawerView } from './person-drawer';
import { OfferDrawer } from './offer-drawer';
import { NudgeDrawer } from './nudge-drawer';
import { SeedDrawer } from './seed-drawer';
import type { FocusChip } from '@/lib/meeting-planner-board';
import styles from './planner.module.css';

export const SAVE_FAILED = 'That didn’t save. Check your connection and try again.';

export interface PlannerAdult {
  personId: number;
  name: string;
}

export interface NudgeTopic {
  topicKey: string;
  title: string;
  codeLabel: string;
  teachers: string;
}

type Open =
  | { mode: 'person'; personId: number }
  | { mode: 'offer'; teacherId: number | null; back: number | null }
  | ({ mode: 'nudge' } & NudgeTopic)
  | { mode: 'seed'; focus: readonly FocusChip[] }
  | null;

interface Sync {
  /** The last board stamp the page has seen or written. */
  stamp: RefObject<string>;
  /** A save is pending: the poller waits. */
  busy: () => boolean;
  run: <T extends { ok: boolean; stamp?: string }>(write: () => Promise<T>) => Promise<T>;
}

interface PlannerCtx {
  entryId: number;
  canEdit: boolean;
  /** An adult editor: may send requests and nudges. */
  canEmail: boolean;
  /** The planning team (P3): may seed this meeting. */
  canSeed: boolean;
  openSeed: (focus: readonly FocusChip[]) => void;
  /** Families nudged this visit, by topic key ("✓ Nudged 5 families · just now"). */
  nudged: ReadonlyMap<string, number>;
  openNudge: (topic: NudgeTopic) => void;
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
  const [nudged, setNudged] = useState<ReadonlyMap<string, number>>(new Map());
  const stampRef = useRef(stamp);
  const pending = useRef(0);

  const run = useCallback(
    async <T extends { ok: boolean; stamp?: string }>(write: () => Promise<T>): Promise<T> => {
      pending.current++;
      try {
        const res = await write();
        if (res.ok && res.stamp) stampRef.current = res.stamp;
        return res;
      } catch {
        // A dropped connection or a server error: say so in place instead of leaving the control stuck.
        return { ok: false, error: SAVE_FAILED } as unknown as T;
      } finally {
        pending.current--;
        if (pending.current === 0) router.refresh();
      }
    },
    [router]
  );

  // Its own memo, so a refresh (new `adults` array) doesn't hand the poller a new sync and restart its timer.
  const sync = useMemo<Sync>(() => ({ stamp: stampRef, busy: () => pending.current > 0, run }), [run]);
  const value = useMemo<PlannerCtx>(
    () => ({
      entryId,
      canEdit,
      canEmail: canEdit && canEmail,
      canSeed,
      openSeed: (focus) => setOpen({ mode: 'seed', focus }),
      nudged,
      openNudge: (topic) => setOpen({ mode: 'nudge', ...topic }),
      adults,
      openPerson: (personId) => setOpen({ mode: 'person', personId }),
      openOffer: (teacherId = null, back = null) => setOpen({ mode: 'offer', teacherId, back }),
      sync
    }),
    [entryId, canEdit, canEmail, canSeed, nudged, adults, sync]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {open?.mode === 'person' ? <PersonDrawerView key={open.personId} personId={open.personId} onClose={() => setOpen(null)} /> : null}
      {open?.mode === 'offer' ? (
        <OfferDrawer teacherId={open.teacherId} onClose={() => setOpen(open.back != null ? { mode: 'person', personId: open.back } : null)} />
      ) : null}
      {open?.mode === 'seed' ? <SeedDrawer focus={open.focus} onClose={() => setOpen(null)} /> : null}
      {open?.mode === 'nudge' ? (
        <NudgeDrawer
          topicKey={open.topicKey}
          title={open.title}
          codeLabel={open.codeLabel}
          teachers={open.teachers}
          onSent={(n) => setNudged((m) => new Map(m).set(open.topicKey, n))}
          onClose={() => setOpen(null)}
        />
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

/** "Seed this meeting" on the Meeting focus strip. The planning team only (P3). */
export function SeedButton({ focus }: { focus: readonly FocusChip[] }) {
  const p = usePlanner();
  if (!p?.canSeed) return null;
  return (
    <button type="button" className={styles.seedBtn} onClick={() => p.openSeed(focus)}>
      Seed this meeting
    </button>
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

/** "Choose families to nudge…" on an offer nobody picked (rank requirements only, as v1). Adult editors only. */
export function NudgeButton(topic: NudgeTopic) {
  const p = usePlanner();
  if (!p?.canEmail) return null;
  const n = p.nudged.get(topic.topicKey);
  if (n) return <span className={styles.assigned}>✓ Nudged {n === 1 ? '1 family' : `${n} families`} · just now</span>;
  return (
    <button type="button" className={styles.nudgeBtn} onClick={() => p.openNudge(topic)}>
      Choose families to nudge…
    </button>
  );
}

/** For a scout editor (the SPL): one line where the email buttons would be. */
export function AdultsSendEmails() {
  const p = usePlanner();
  if (!p?.canEdit || p.canEmail) return null;
  return <p className={styles.emailNote}>Requests and nudges are emailed by adults.</p>;
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

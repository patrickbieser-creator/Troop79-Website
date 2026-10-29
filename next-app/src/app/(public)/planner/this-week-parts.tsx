'use client';

/**
 * This week's small pieces (Plans/Meeting-Planner-III.md): the name chip, the teacher slot, the place menu, and the
 * shared write runner. Kept apart from this-week-client.tsx so each stays readable.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useDisclosure } from '@/app/_components/use-disclosure';
import { joinNames, type TwColumn, type TwPerson, type TwTeacher } from '@/lib/this-week';
import { usePlanner, SAVE_FAILED } from './planner-client';
import type { TwResult } from './this-week-actions';
import s from './this-week.module.css';

const INTENT_WORD = { coming: 'coming', undecided: 'not sure', not_coming: 'can’t come' } as const;

/**
 * A group card's requirement row: code, label, how many in the group still need it. One with sub-requirements (4a →
 * 4a.1…4a.8) is a toggle that lists them, each with its own count; closed by default so the card stays short.
 */
export function ReqItem({ col }: { col: TwColumn }) {
  const [open, setOpen] = useState(false);
  const line = (
    <>
      <span className={s.reqCode}>{col.code}</span>{' '}
      <span className={s.reqLabel}>{col.label}</span>
    </>
  );
  if (!col.subs.length) {
    return (
      <li className={s.req}>
        {line}
        <span className={s.reqNeed}>{col.need} need it</span>
      </li>
    );
  }
  return (
    <li className={s.reqWrap}>
      <div className={s.req}>
        <button type="button" className={s.reqToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
          {line}
          <span className={s.reqCaret} aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>
        <span className={s.reqNeed}>{col.need} need it</span>
      </div>
      {open ? (
        <ul className={s.reqSubs}>
          {col.subs.map((x) => (
            <li key={x.key} className={s.req}>
              <span className={s.reqCode}>{x.code}</span>
              <span className={s.reqLabel}>{x.label}</span>
              <span className={s.reqNeed}>{x.need} need it</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Run one write through the planner's sync (the poller waits, the page refreshes once it lands); returns the error. */
export function useWrite() {
  const p = usePlanner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (write: () => Promise<TwResult>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = p ? await p.sync.run(write) : await write();
      if (!res.ok) setError(res.error);
      return res.ok;
    } catch {
      setError(SAVE_FAILED);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, setError };
}

/**
 * A scout's name chip. `tone`: 'rank' wears the rank they hold (the checklist), 'rsvp' wears their answer (group
 * cards). The rank or the answer is always in the accessible name, so colour is never the only cue. Editors open the
 * person drawer.
 */
export function NameChip({ person, tone }: { person: TwPerson; tone: 'rank' | 'rsvp' }) {
  const p = usePlanner();
  const cls =
    tone === 'rank'
      ? `${s.chip} ${s[`rank-${person.rank ?? 'new'}`] ?? ''}`
      : `${s.chip} ${person.intent === 'coming' || person.intent === 'not_coming' ? s[`rsvp-${person.intent}`] : ''}`;
  const said = tone === 'rank' ? person.rankName : person.intent ? INTENT_WORD[person.intent] : 'no answer yet';
  const label = `${person.name}, ${said}`;
  if (!p?.canEdit) {
    return (
      <span className={cls} title={said} aria-label={label}>
        {person.name}
      </span>
    );
  }
  return (
    <button type="button" className={cls} title={said} aria-label={label} onClick={() => p.openPerson(person.personId)}>
      {person.name}
    </button>
  );
}

const EDGE = 8;
const GAP = 8;

/** Where a menu panel goes: below its trigger, above it when below is short, and inside the window whatever happens
 *  (a panel taller than the window scrolls within itself). Left-aligned to the trigger, or right-aligned with `right`. */
export function placePanel(
  trigger: { top: number; bottom: number; left: number; right: number },
  panel: { w: number; h: number },
  view: { w: number; h: number },
  right: boolean
): { top: number; left: number; maxHeight: number } {
  const maxHeight = view.h - 2 * EDGE;
  const h = Math.min(panel.h, maxHeight);
  const below = trigger.bottom + GAP;
  const above = trigger.top - GAP - h;
  const top = below + h <= view.h - EDGE ? below : above >= EDGE ? above : Math.min(Math.max(below, EDGE), view.h - EDGE - h);
  const left = Math.min(Math.max(right ? trigger.right - panel.w : trigger.left, EDGE), view.w - EDGE - panel.w);
  return { top, left, maxHeight };
}

/** A small disclosure: a trigger and a panel. The panel floats over the page (fixed, placed by placePanel), so one
 *  opened inside the checklist's scroll box or at the foot of the window is never clipped or out of view. */
export function Popover({
  label,
  trigger,
  triggerClass,
  children,
  wide = false,
  right = false,
  ariaLabel
}: {
  label: ReactNode;
  trigger?: (open: boolean) => ReactNode;
  triggerClass: string;
  children: (close: () => void) => ReactNode;
  wide?: boolean;
  right?: boolean;
  ariaLabel: string;
}) {
  const { open, wrapRef, triggerRef, onBlur, toggle, close } = useDisclosure();
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const panel = panelRef.current;
      const t = triggerRef.current?.getBoundingClientRect();
      if (!panel || !t) return;
      panel.style.maxHeight = '';
      const at = placePanel(t, { w: panel.offsetWidth, h: panel.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }, right);
      panel.style.top = `${at.top}px`;
      panel.style.left = `${at.left}px`;
      panel.style.maxHeight = `${at.maxHeight}px`;
    };
    place();
    // Follow the trigger while the page (or the checklist's scroll box) scrolls, or the window resizes.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, right, triggerRef]);
  return (
    <div className={s.popWrap} ref={wrapRef} onBlur={onBlur}>
      <button type="button" ref={triggerRef} className={triggerClass} aria-expanded={open} onClick={toggle}>
        {trigger ? trigger(open) : label}
      </button>
      {open ? (
        <div ref={panelRef} role="region" aria-label={ariaLabel} className={wide ? s.pop : s.popNarrow}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A group's or class's teachers, any number. Editors open a list: anyone already teaching, then the qualified (with
 * "Counselor" / "Scout instructor"), each a toggle that adds or takes off that one person, then "Someone else"
 * (everyone who may teach), then Clear. The list stays open so a planner can pick several. Viewers see the names or
 * "No teachers yet". An empty slot is flagged, never blocking.
 */
export function TeacherSlot({
  slotKey,
  title,
  teachers,
  candidates,
  everyone,
  onSet,
  onAsk
}: {
  slotKey: string;
  title: string;
  teachers: readonly TwTeacher[];
  candidates: readonly TwTeacher[];
  everyone: readonly TwTeacher[];
  /** Add (`on`) or take off one teacher; a null personId clears them all. */
  onSet: (key: string, personId: number | null, on: boolean) => Promise<boolean>;
  /** Adult editors: email this person the teacher ask (the digest and its answer page). Returns what happened. */
  onAsk?: (key: string, personId: number) => Promise<string>;
}) {
  const p = usePlanner();
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState<Record<number, string>>({});
  const names = joinNames(teachers.map((t) => t.name));
  const text = !teachers.length ? 'No teachers yet' : `${teachers.length > 1 ? 'Teachers' : 'Teacher'}: ${names}`;
  if (!p?.canEdit) return <span className={teachers.length ? s.slotText : s.slotTextEmpty}>{text}</span>;
  const teaching = new Set(teachers.map((t) => t.personId));
  const listed = [...teachers.filter((t) => !candidates.some((c) => c.personId === t.personId)), ...candidates];
  const shown = new Set(listed.map((c) => c.personId));
  const term = q.trim().toLowerCase();
  const others = everyone.filter((e) => !shown.has(e.personId) && (!term || e.name.toLowerCase().includes(term))).slice(0, 30);
  const answer = (t: TwTeacher) => (t.intent ? INTENT_WORD[t.intent] : 'no answer yet');
  return (
    <Popover label={`${text} ▾`} triggerClass={teachers.length ? s.slot : s.slotEmpty} ariaLabel={`Teachers for ${title}`}>
      {(close) => (
        <>
          <div className={s.menuHead}>Can teach {title} · pick one or more</div>
          <ul className={s.popList}>
            {listed.length ? null : <li className={s.popEmpty}>Nobody’s skills match yet. Pick someone else below.</li>}
            {listed.map((c) => {
              const on = teaching.has(c.personId);
              return (
                <li key={c.personId} className={s.popItem}>
                  <button type="button" className={s.menuBtn} aria-pressed={on} onClick={() => void onSet(slotKey, c.personId, !on)}>
                    <span className={on ? s.pickOn : s.pickOff} aria-hidden="true">
                      {on ? '✓' : ''}
                    </span>
                    {c.name}
                    <span className={s.menuNote}>{[c.note, answer(c), asked[c.personId]].filter(Boolean).join(' · ')}</span>
                  </button>
                  {onAsk && p.canEmail && c.kind === 'adult' && !on ? (
                    <button
                      type="button"
                      className={s.quiet}
                      aria-label={`Ask ${c.name} by email to teach ${title}`}
                      disabled={!!asked[c.personId]}
                      onClick={async () => setAsked({ ...asked, [c.personId]: await onAsk(slotKey, c.personId) })}
                    >
                      Ask by email
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className={s.popHead}>
            <label className={s.fieldLabel}>
              Someone else
              <input className={s.search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" aria-label="Search everyone who may teach" />
            </label>
          </div>
          {term ? (
            <ul className={s.popList}>
              {others.length ? null : <li className={s.popEmpty}>Nobody by that name.</li>}
              {others.map((c) => (
                <li key={c.personId}>
                  <button
                    type="button"
                    className={s.menuBtn}
                    onClick={async () => {
                      if (await onSet(slotKey, c.personId, true)) setQ('');
                    }}
                  >
                    {c.name}
                    <span className={s.menuNote}>{answer(c)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className={s.popFoot}>
            {teachers.length ? (
              <button type="button" className={s.quiet} onClick={() => void onSet(slotKey, null, false)}>
                {teachers.length > 1 ? 'Clear the teachers' : 'Clear the teacher'}
              </button>
            ) : null}
            <button type="button" className={s.quiet} onClick={close}>
              Done
            </button>
          </div>
        </>
      )}
    </Popover>
  );
}

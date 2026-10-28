'use client';

/**
 * This week's small pieces (Plans/Meeting-Planner-III.md): the name chip, the teacher slot, the place menu, and the
 * shared write runner. Kept apart from this-week-client.tsx so each stays readable.
 */
import { useState, type ReactNode } from 'react';
import { useDisclosure } from '@/app/_components/use-disclosure';
import type { TwPerson, TwTeacher } from '@/lib/this-week';
import { usePlanner, SAVE_FAILED } from './planner-client';
import type { TwResult } from './this-week-actions';
import s from './this-week.module.css';

const INTENT_WORD = { coming: 'coming', undecided: 'not sure', not_coming: 'can’t come' } as const;

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

/** A small disclosure: a trigger and a panel. */
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
  return (
    <div className={s.popWrap} ref={wrapRef} onBlur={onBlur}>
      <button type="button" ref={triggerRef} className={triggerClass} aria-expanded={open} onClick={toggle}>
        {trigger ? trigger(open) : label}
      </button>
      {open ? (
        <div role="region" aria-label={ariaLabel} className={`${wide ? s.pop : s.popNarrow} ${right ? s.popRight : ''}`}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A group's or class's one teacher. Editors open a list: the qualified first (with "Counselor" / "Scout instructor"),
 * then "Someone else" (everyone who may teach), then Clear. Viewers see the name or "No teacher yet". An empty slot is
 * flagged, never blocking.
 */
export function TeacherSlot({
  slotKey,
  title,
  teacher,
  candidates,
  everyone,
  onSet
}: {
  slotKey: string;
  title: string;
  teacher: TwTeacher | null;
  candidates: readonly TwTeacher[];
  everyone: readonly TwTeacher[];
  onSet: (key: string, personId: number | null) => Promise<boolean>;
}) {
  const p = usePlanner();
  const [q, setQ] = useState('');
  const text = teacher ? `Teacher: ${teacher.name}` : 'No teacher yet';
  if (!p?.canEdit) return <span className={teacher ? s.slotText : s.slotTextEmpty}>{text}</span>;
  const shown = new Set(candidates.map((c) => c.personId));
  const term = q.trim().toLowerCase();
  const others = everyone.filter((e) => !shown.has(e.personId) && (!term || e.name.toLowerCase().includes(term))).slice(0, 30);
  const answer = (t: TwTeacher) => (t.intent ? INTENT_WORD[t.intent] : 'no answer yet');
  return (
    <Popover label={`${text} ▾`} triggerClass={teacher ? s.slot : s.slotEmpty} ariaLabel={`Teacher for ${title}`}>
      {(close) => (
        <>
          <div className={s.menuHead}>Can teach {title}</div>
          <ul className={s.popList}>
            {candidates.length ? null : <li className={s.popEmpty}>Nobody’s skills match yet. Pick someone else below.</li>}
            {candidates.map((c) => (
              <li key={c.personId}>
                <button
                  type="button"
                  className={s.menuBtn}
                  aria-current={teacher?.personId === c.personId ? 'true' : undefined}
                  onClick={async () => {
                    if (await onSet(slotKey, c.personId)) close();
                  }}
                >
                  {c.name}
                  <span className={s.menuNote}>{[c.note, answer(c)].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
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
                      if (await onSet(slotKey, c.personId)) close();
                    }}
                  >
                    {c.name}
                    <span className={s.menuNote}>{answer(c)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {teacher ? (
            <div className={s.popFoot}>
              <button
                type="button"
                className={s.quiet}
                onClick={async () => {
                  if (await onSet(slotKey, null)) close();
                }}
              >
                Clear the teacher
              </button>
            </div>
          ) : null}
        </>
      )}
    </Popover>
  );
}

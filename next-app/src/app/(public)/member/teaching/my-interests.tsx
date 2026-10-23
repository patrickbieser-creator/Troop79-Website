'use client';

/**
 * Build a Plan B10d: "Also enjoy teaching" on /member/teaching. The person's interests (from a teacher answer page or
 * added here), each with Remove, and "Add to what I can teach" when its requirement is tied to a skill they may hold
 * and don't yet (the same signed-in set_teaching_skills path as the checklist above). Interests don't expire
 * (Patrick); Remove is how one goes. Below the list, the same picker as the answer page, without "Also this Sunday".
 * Notes are plain text (React escapes them; never links). A leader proxy-viewing sees the list read-only.
 *
 * Accessibly (qa-lead B10c #3/#4): each button names its item; a removed interest leaves the list at once and focus
 * moves to the next one's Remove, or to the heading when none is left (never dropped on the page body).
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { SaveProblem } from '@/app/_components/form';
import { fmtDate } from '@/lib/format-date';
import { addInterestToSkillsAction, addMyInterestsAction, removeMyInterestAction, searchMyInterestsAction } from './actions';
import { InterestPicker } from './interest-picker';
import styles from './interest-picker.module.css';
import page from './teaching.module.css';

export interface MyInterestRow {
  id: number;
  short: string;
  note: string | null;
  createdAt: string;
  /** The skill "Add to what I can teach" would add; null when there is none to add (no skill, held, or not offered). */
  addSkill: { id: string; name: string } | null;
}

export function MyInterests({ items, readOnly }: { items: MyInterestRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<number>>(new Set());
  const listRef = useRef<HTMLUListElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const focusAt = useRef<number | null>(null);
  const shown = items.filter((i) => !gone.has(i.id));

  useEffect(() => {
    // Once the buttons are enabled again (a disabled button can't take focus).
    const at = focusAt.current;
    if (at == null || pending) return;
    focusAt.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-remove]');
    if (buttons?.length) buttons[Math.min(at, buttons.length - 1)].focus();
    else headingRef.current?.focus();
  }, [gone, pending]);

  function remove(row: MyInterestRow) {
    setProblem(null);
    setMessage(null);
    const at = shown.findIndex((i) => i.id === row.id);
    start(async () => {
      const res = await removeMyInterestAction(row.id);
      if (!res.ok) {
        setProblem(res.error);
        return;
      }
      focusAt.current = Math.max(at, 0);
      setGone((g) => new Set(g).add(row.id));
      setMessage(`Removed ${row.short}.`);
      router.refresh();
    });
  }

  function addToSkills(row: MyInterestRow) {
    setProblem(null);
    setMessage(null);
    start(async () => {
      const res = await addInterestToSkillsAction(row.id);
      if (!res.ok) setProblem(res.error);
      else {
        setMessage(`Added ${row.addSkill?.name ?? 'that skill'} to what you can teach.`);
        router.refresh();
      }
    });
  }

  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className={page.subHead}>
        Also enjoy teaching
      </h2>
      <p className={page.fine}>Requirements and merit badges you&rsquo;d enjoy teaching, now or some day. The troop&rsquo;s meeting planners see these when they plan.</p>
      {shown.length ? (
        <ul className={styles.list} ref={listRef}>
          {shown.map((i) => (
            <li key={i.id} className={styles.item}>
              <span className={styles.itemText}>
                <span>{i.short}</span>
                {i.note && <span className={styles.itemNote}>{i.note}</span>}
                <span className={styles.meta}>Added {fmtDate(i.createdAt)}</span>
              </span>
              {!readOnly && (
                <span className={styles.itemActions}>
                  {i.addSkill && (
                    <Button variant="secondary" size="sm" disabled={pending} onClick={() => addToSkills(i)} aria-label={`Add ${i.short} to what I can teach`}>
                      Add to what I can teach
                    </Button>
                  )}
                  <Button variant="ghost" data-remove="" disabled={pending} onClick={() => remove(i)} aria-label={`Remove ${i.short}`}>
                    Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.meta}>Nothing yet. Add anything you&rsquo;d enjoy teaching some day.</p>
      )}
      <span role="status" aria-live="polite" className={styles.meta}>
        {problem ? null : message}
      </span>
      {problem && <SaveProblem reason={problem} />}
      {!readOnly && (
        <InterestPicker
          allowNow={false}
          search={(q) => searchMyInterestsAction(q)}
          save={async (picks) => {
            const res = await addMyInterestsAction(picks);
            return res.ok ? { ok: true, message: `Saved ${res.saved === 1 ? '1 interest' : `${res.saved} interests`}.` } : res;
          }}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}

'use client';

/**
 * Build a Plan B10d: "Also enjoy teaching" on /member/teaching. The person's interests (from a teacher answer page or
 * added here), each with Remove, and "Add to what I can teach" when its requirement is tied to a skill they may hold
 * and don't yet (the same signed-in set_teaching_skills path as the checklist above). Interests don't expire
 * (Patrick); Remove is how one goes. Below the list, the same picker as the answer page, without "Also this Sunday".
 * Notes are plain text (React escapes them; never links). A leader proxy-viewing sees the list read-only.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { SaveProblem } from '@/app/_components/form';
import { fmtDate } from '@/lib/format-date';
import { addInterestToSkillsAction, addMyInterestsAction, removeMyInterestAction, searchMyInterestsAction } from './actions';
import { InterestPicker } from './interest-picker';
import styles from './interest-picker.module.css';

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

  function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setProblem(null);
    setMessage(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setProblem(res.error);
      else {
        setMessage(done);
        router.refresh();
      }
    });
  }

  return (
    <>
      {items.length ? (
        <ul className={styles.list} aria-label="Also enjoy teaching">
          {items.map((i) => (
            <li key={i.id} className={styles.item}>
              <span className={styles.itemText}>
                <span>{i.short}</span>
                {i.note && <span className={styles.itemNote}>{i.note}</span>}
                <span className={styles.meta}>Added {fmtDate(i.createdAt)}</span>
              </span>
              {!readOnly && (
                <span className={styles.itemActions}>
                  {i.addSkill && (
                    <Button variant="secondary" size="sm" disabled={pending} onClick={() => act(() => addInterestToSkillsAction(i.id), `Added ${i.addSkill!.name} to what you can teach.`)}>
                      Add to what I can teach
                    </Button>
                  )}
                  <Button variant="ghost" disabled={pending} onClick={() => act(() => removeMyInterestAction(i.id), `Removed ${i.short}.`)} aria-label={`Remove ${i.short}`}>
                    Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.meta}>Nothing yet. Add anything you&rsquo;d enjoy teaching some day; leaders see it when they plan.</p>
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

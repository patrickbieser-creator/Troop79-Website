'use client';

/**
 * The "What I can teach" checklist: a standing profile, so it keeps the house edit-form rules (dirty-gated Save, with
 * Discard changes back to the last saved set). Saving writes the same rows Admin › Lookups shows and counts right away.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { SaveProblem } from '@/app/_components/form';
import type { TeachingSkillOption } from '@/lib/teaching-skills';
import { saveMyTeachingSkillsAction } from './actions';
import styles from './teaching.module.css';

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function TeachingForm({ skills, junior, readOnly }: { skills: TeachingSkillOption[]; junior: boolean; readOnly: boolean }) {
  const initial = skills.filter((s) => s.held).map((s) => s.id);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = !same(draft, saved);
  const nameOf = (id: string) => skills.find((s) => s.id === id)?.name ?? id;

  function toggle(id: string, on: boolean) {
    setMessage(null);
    setDraft((d) => (on ? [...d, id] : d.filter((x) => x !== id)));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setProblem(null);
    start(async () => {
      const res = await saveMyTeachingSkillsAction(draft);
      if (!res.ok) {
        setProblem(res.error);
        return;
      }
      setSaved(draft);
      const parts = [
        res.added.length ? `added ${res.added.map(nameOf).join(', ')}` : '',
        res.removed.length ? `removed ${res.removed.map(nameOf).join(', ')}` : ''
      ].filter(Boolean);
      setMessage(parts.length ? `Saved: ${parts.join('; ')}.` : 'Saved.');
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} noValidate aria-label="What I can teach">
      <fieldset className={styles.list}>
        <legend className={styles.legend}>Skills</legend>
        {skills.map((s) => {
          const on = draft.includes(s.id);
          let note: string | null = s.adultOnlyNote;
          if (junior && s.finished) {
            const { done, total } = s.finished;
            note = total
              ? `${done} of ${total} requirements finished${done === 0 ? '. Finish one first to teach it in a meeting.' : done < total && on ? '. You can teach the ones you’ve finished.' : ''}`
              : 'Not tied to a rank requirement';
          }
          return (
            <label key={s.id} className={styles.row}>
              <input type="checkbox" checked={on} disabled={readOnly} onChange={(e) => toggle(s.id, e.target.checked)} />
              <span>
                <span className={styles.name}>{s.name}</span>
                {note && <span className={styles.note}>{note}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      {!readOnly && (
        <div className={styles.foot}>
          <Button type="submit" disabled={!dirty || pending} title={dirty ? undefined : 'No changes to save yet'}>
            {pending ? 'Saving changes…' : dirty ? 'Save changes' : 'Saved'}
          </Button>
          <Button
            variant="secondary"
            disabled={!dirty || pending}
            onClick={() => {
              setDraft(saved);
              setProblem(null);
            }}
          >
            Discard changes
          </Button>
          <span role="status" aria-live="polite" className={styles.status}>
            {problem ? null : dirty ? 'Unsaved changes' : (message ?? 'Changes count right away. Leaders see a list of them.')}
          </span>
          {problem && <SaveProblem reason={problem} />}
        </div>
      )}
    </form>
  );
}

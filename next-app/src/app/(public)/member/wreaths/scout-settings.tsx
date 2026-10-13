'use client';

/**
 * One small form per scout on Members › Wreath sale: the goal (whole number 0 to 999, or empty for none) and the
 * delivery message (optional plain text that replaces "delivers your order in person…" on the scout's public page).
 * Dirty-gated Save ("Save changes" / "Saved") with Discard changes back to the last saved values; live when saved.
 * Only rendered for the scout or a parent; the action re-checks the viewer's right against the session.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Field, SaveProblem, TextInput } from '@/app/_components/form';
import { setScoutSettingsAction } from './actions';
import styles from './wreaths.module.css';

export function ScoutSettings({ personId, firstName, goal, deliveryMessage }: { personId: number; firstName: string; goal: number | null; deliveryMessage: string | null }) {
  const initial = { goal: goal == null ? '' : String(goal), message: deliveryMessage ?? '' };
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = draft.goal !== saved.goal || draft.message !== saved.message;
  const problemFor = (f: string) => (problem?.field === f ? problem.message : undefined);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    start(async () => {
      const res = await setScoutSettingsAction(personId, { goal: draft.goal, deliveryMessage: draft.message });
      if (res.ok) {
        setSaved({ goal: draft.goal.trim(), message: draft.message.trim() });
        setDraft({ goal: draft.goal.trim(), message: draft.message.trim() });
        router.refresh();
      } else setProblem({ field: res.field, message: res.error });
    });
  }

  return (
    <form className={styles.settings} onSubmit={save} noValidate aria-label={`${firstName}’s goal and delivery message`}>
      <Field label={<>Goal <span className={styles.opt}>wreaths</span></>} problem={problemFor('goal')}>
        <TextInput type="text" inputMode="numeric" autoComplete="off" value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} />
      </Field>
      <Field
        label={<>Delivery message <span className={styles.opt}>optional</span></>}
        hint={`Shown on ${firstName}’s page instead of “delivers your order in person”.`}
        problem={problemFor('deliveryMessage')}
      >
        <TextInput type="text" maxLength={200} placeholder="I’ll bring your wreath the week of Nov 22" autoComplete="off" value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
      </Field>
      <div className={styles.settingsFoot}>
        <Button type="submit" disabled={!dirty || pending} title={dirty ? undefined : 'No changes to save yet'}>
          {pending ? 'Saving changes…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
        <Button variant="secondary" disabled={!dirty || pending} onClick={() => { setDraft(saved); setProblem(null); }}>
          Discard changes
        </Button>
        {problem && !problem.field && <SaveProblem reason={problem.message} />}
      </div>
    </form>
  );
}

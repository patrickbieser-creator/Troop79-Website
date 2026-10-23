'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { FormCard, FieldHint } from '@/app/_components/form';
import { minutesText } from '@/lib/meeting-board-picklist';
import { scoutsHelpedText } from '@/lib/meeting-invite-digest';
import { shortCode } from '@/lib/rank-abbrev';
import type { TeachPageLine, TeachPageState } from '@/lib/meeting-teach-pages';
import { answerTeachPageAction } from '../actions';
import styles from './teach-page.module.css';

type Choice = 'yes' | 'no' | null;

/** Submit: greyed only when nothing would change (the save-button standard); its label says the state. */
function SubmitButton({ dirty, answeredBefore }: { dirty: boolean; answeredBefore: boolean }) {
  const { pending } = useFormStatus();
  const label = pending ? 'Saving…' : !dirty ? (answeredBefore ? 'Saved' : 'Send my answers') : answeredBefore ? 'Save changes' : 'Send my answers';
  return (
    <Button variant="primary" type="submit" disabled={!dirty || pending} title={!dirty && !pending ? 'No changes to save yet' : undefined}>
      {label}
    </Button>
  );
}

/**
 * A teacher's answer page (Build a Plan B10b): each class the digest asked about, as the send snapshotted it (short
 * code, title, minutes, the scouts it would help), with Yes / Not this week starting at the current answer and ONE
 * submit. Until 6 PM on the meeting day an answer can be changed; a class left blank stays open. A class that is no
 * longer this page's to answer reads "No longer available". It says plainly who it is for, and never signs anyone in.
 */
export function TeachPageCard(props: {
  state: TeachPageState;
  token: string;
  recipientName: string;
  day: string;
  lines: TeachPageLine[];
  err: string | null;
  saved: boolean;
  failed: number[];
}) {
  const open = props.lines.filter((l) => l.available);
  const [choices, setChoices] = useState<Record<number, Choice>>(() => Object.fromEntries(open.map((l) => [l.inviteId, l.answer])));
  const dirty = open.some((l) => (choices[l.inviteId] ?? null) !== l.answer);
  // After a submit the page reloads at the top (qa-lead B10b #4): focus the first line that failed, else the result
  // Notice, so it is announced where the eye and the screen reader land.
  const resultRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const firstFailed = props.failed[0];
  const hasResult = props.saved || Boolean(props.err);
  useEffect(() => {
    if (firstFailed != null) formRef.current?.querySelector<HTMLInputElement>(`input[name="line-${firstFailed}"]`)?.focus();
    else if (hasResult) resultRef.current?.focus();
  }, [firstFailed, hasResult]);
  const answeredBefore = open.some((l) => l.answer != null);
  const signIn = (
    <Link href={`/signin?next=${encodeURIComponent('/member/meeting')}`}>sign in to your Sunday page</Link>
  );
  const errText: Record<string, string> = {
    busy: 'Too many tries from here. Please try again in an hour.',
    limit: 'This page has been saved many times already. To change anything else, sign in to your Sunday page.',
    save: 'That didn’t save. Please try again.'
  };

  if (props.state !== 'open') {
    return (
      <FormCard>
        {props.state === 'expired' && <Notice tone="info">This page closed at 6:00 PM on the meeting day. You can still {signIn}.</Notice>}
        {props.state === 'superseded' && (
          <Notice tone="info">A newer email replaced this page. Use the button in the newest email, or {signIn}.</Notice>
        )}
        {(props.state === 'void' || props.state === 'unknown') && <Notice tone="info">This link doesn’t work any more. You can still {signIn}.</Notice>}
      </FormCard>
    );
  }

  return (
    <FormCard>
      {props.err && errText[props.err] && (
        <Notice tone="error" tabIndex={-1} ref={resultRef}>
          {errText[props.err]}
        </Notice>
      )}
      {props.saved && !props.err && (
        <Notice tone="success" tabIndex={-1} ref={resultRef}>
          Saved. Thank you! You can change an answer here until 6:00 PM on {props.day || 'the meeting day'}.
        </Notice>
      )}
      {props.failed.length > 0 && <Notice tone="error">Some classes couldn’t be saved; they’re marked below.</Notice>}
      <p className={styles.meta}>{props.day}</p>
      <FieldHint>For {props.recipientName}; if that isn’t you, don’t answer.</FieldHint>
      <form action={answerTeachPageAction} className={styles.form} ref={formRef}>
        <input type="hidden" name="token" value={props.token} />
        <ul className={styles.lines}>
          {props.lines.map((l) => {
            const name = `line-${l.inviteId}`;
            const bad = props.failed.includes(l.inviteId);
            const noteId = `line-${l.inviteId}-problem`;
            return (
              <li key={l.inviteId} className={bad ? `${styles.line} ${styles.bad}` : styles.line}>
                {/* One radio group per class, named by its legend; a failed line marks the group and points at its note. */}
                <fieldset
                  className={styles.fieldset}
                  disabled={!l.available}
                  role={l.available ? 'radiogroup' : undefined}
                  aria-invalid={bad || undefined}
                  aria-describedby={bad ? noteId : undefined}
                >
                  <legend className={styles.legend}>
                    <strong>{shortCode(l.code)}</strong> {l.topic}
                  </legend>
                  <p className={styles.meta}>{[minutesText(l.minutes), scoutsHelpedText(l.helped)].filter(Boolean).join(' · ')}</p>
                  {l.available ? (
                    <div className={styles.choice}>
                      {(
                        [
                          ['yes', 'Yes, I’ll teach it'],
                          ['no', 'Not this week']
                        ] as const
                      ).map(([value, label]) => (
                        <label key={value} className={styles.option}>
                          <input
                            type="radio"
                            name={name}
                            value={value}
                            checked={choices[l.inviteId] === value}
                            onChange={() => setChoices((c) => ({ ...c, [l.inviteId]: value }))}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.gone}>No longer available</p>
                  )}
                  {bad && (
                    <p id={noteId} className={styles.badNote}>
                      Couldn’t save this one. Please try again.
                    </p>
                  )}
                </fieldset>
              </li>
            );
          })}
        </ul>
        {open.length > 0 && (
          <div className={styles.actions}>
            <SubmitButton dirty={dirty} answeredBefore={answeredBefore} />
          </div>
        )}
      </form>
    </FormCard>
  );
}

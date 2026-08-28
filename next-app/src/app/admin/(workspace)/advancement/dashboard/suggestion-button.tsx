'use client';

/**
 * "Make a Suggestion" (Leader Dashboard, Patrick 2026-08-28): a standard
 * secondary button in the PageTitle's right slot that opens the shared
 * Dialog with a feedback form. The leader is already signed in, so who is
 * asking is shown, not typed — only the suggestion is a field.
 */
import { useId, useRef, useState, useTransition } from 'react';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { Button } from '../../../_components/button';
import { SUGGESTION_MAX, validateSuggestion } from '@/lib/suggestion-email';
import type { SuggestionResult } from './suggestion-actions';
import styles from './suggestion-button.module.css';

export function SuggestionButton({
  actorName,
  actorEmail,
  action
}: {
  actorName: string;
  actorEmail: string | null;
  action: (text: string) => Promise<SuggestionResult>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  function reset() {
    setText('');
    setError(null);
    setSent(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateSuggestion(text);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setError(null);
    start(async () => {
      const res = await action(v.text);
      if (res.ok) setSent(true);
      else setError(res.error);
    });
  }

  return (
    <>
      <Button type="button" onClick={() => ref.current?.showModal()}>
        Make a Suggestion
      </Button>
      <Dialog ref={ref} onClose={reset}>
        <DialogHeader
          title="Make a Suggestion"
          sub="Ideas for improving the troop website go to the troop inbox and the site's maintainer."
        />
        <form onSubmit={submit} noValidate>
          <DialogBody>
            {sent ? (
              <p role="status" className={styles.thanks}>Thanks — your suggestion was sent.</p>
            ) : (
              <>
                <dl className={styles.from}>
                  <dt>From</dt>
                  <dd>{actorName}</dd>
                  <dt>Email</dt>
                  <dd>{actorEmail ?? <span className={styles.muted}>no email on file</span>}</dd>
                </dl>
                <label htmlFor={id} className={styles.label}>
                  Your suggestion
                </label>
                <textarea
                  id={id}
                  className={styles.textarea}
                  rows={7}
                  maxLength={SUGGESTION_MAX}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="What would make the website more useful?"
                  disabled={pending}
                />
                {error ? (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                ) : null}
              </>
            )}
          </DialogBody>
          <DialogActions>
            {sent ? (
              <Button type="button" variant="primary" onClick={() => ref.current?.close()}>
                Done
              </Button>
            ) : (
              <>
                <Button type="button" onClick={() => ref.current?.close()} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending ? 'Sending…' : 'Send'}
                </Button>
              </>
            )}
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}

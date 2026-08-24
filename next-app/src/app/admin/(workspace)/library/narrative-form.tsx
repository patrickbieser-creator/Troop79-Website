'use client';

/**
 * The Library narrative editor's form shell — a client island inside the
 * server-rendered admin Library page so it can follow the Save standard
 * (AGENTS.md "Save buttons", 2026-08-24): the form is still a plain server
 * action (it reloads with ?saved=1, which the page turns into the "Saved."
 * banner), but Save is off and reads "Saved" until the text differs, and a
 * "Saving changes…" overlay covers the round trip.
 */
import { useRef, useState } from 'react';
import { DiscardButton, SaveButton, SaveFeedback, useFormDirty } from '../_components/save-state';

export function NarrativeForm({
  action,
  className,
  buttonClassName,
  children
}: {
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  buttonClassName?: string;
  /** The hidden target, label, textarea and any meta — rendered by the page. */
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const { dirty, reset } = useFormDirty(ref);
  const [submitting, setSubmitting] = useState(false);
  return (
    <form ref={ref} action={action} className={className} onSubmit={() => setSubmitting(true)}>
      {children}
      <DiscardButton dirty={dirty} pending={submitting} onClick={reset} />
      <SaveButton type="submit" className={buttonClassName} dirty={dirty} pending={submitting} dirtyLabel="Save narrative" />
      <SaveFeedback phase={submitting ? 'saving' : 'idle'} />
    </form>
  );
}

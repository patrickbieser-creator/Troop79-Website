'use client';

/**
 * One shelf (topic) row on the Library workstation's Topics tab — a client
 * island inside the server-rendered page so the row's Save follows the Save
 * standard (AGENTS.md "Save buttons", 2026-08-24) like every other admin
 * edit form. Same shape as narrative-form.tsx on this screen: the form is
 * still a plain server action, the island only supplies the dirty gate and
 * the feedback.
 *
 * Before this, every shelf row showed a permanently-live "Save" that looked
 * identical whether or not anything had been typed, and there was no way
 * back from a half-made edit except reloading the page (Patrick,
 * 2026-09-20).
 *
 * Retire/Restore deliberately stays OUTSIDE the gate: it is a one-click
 * action, and the click itself is its gate — the standard exempts those.
 * It keeps `formAction` to override the form's own action; Save just
 * submits the form.
 */

import { useRef, useState } from 'react';
import { Button } from '../../_components/button';
import { DiscardButton, SaveButton, SaveFeedback, useFormDirty } from '../_components/save-state';

export function TopicRow({
  updateAction,
  toggleRetiredAction,
  className,
  actionsClassName,
  retired,
  children
}: {
  updateAction: (formData: FormData) => void | Promise<void>;
  toggleRetiredAction: (formData: FormData) => void | Promise<void>;
  className?: string;
  actionsClassName?: string;
  retired: boolean;
  /** The hidden ids and the four text inputs — rendered by the page. */
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const { dirty, reset } = useFormDirty(ref);
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      ref={ref}
      action={updateAction}
      className={className}
      onSubmit={() => setSubmitting(true)}
    >
      {children}
      <span className={actionsClassName}>
        <DiscardButton dirty={dirty} pending={submitting} onClick={reset} />
        <SaveButton type="submit" dirty={dirty} pending={submitting} />
        <Button
          variant="danger"
          type="submit"
          formAction={toggleRetiredAction}
          disabled={submitting}
        >
          {retired ? 'Restore' : 'Retire'}
        </Button>
      </span>
      <SaveFeedback phase={submitting ? 'saving' : 'idle'} />
    </form>
  );
}

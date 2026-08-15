'use client';

import type { ReactNode } from 'react';
import styles from './profile.module.css';

/** What a field's control must spread onto itself to be labelled and described. */
export interface FieldAttrs {
  id: string;
  'aria-describedby'?: string;
}

/**
 * One labelled field in a /profile editor, plus the "awaiting review" marker.
 *
 * Extracted when the editors started showing PENDING values rather than live
 * ones (see lib/profile-draft.ts). Once a form shows what was proposed, the
 * live value is no longer visible anywhere — and it is the one a leader is
 * still looking at, so hiding it entirely would make the form a worse record
 * than the banner it replaced. Each pending field therefore carries its
 * previous value underneath.
 *
 * THE LABEL BINDS BY htmlFor, NOT BY WRAPPING. An implicit <label> around the
 * control folds every word inside it into the control's accessible name, so a
 * pending field would announce as "Phone awaiting review Record still says
 * (414) 555-1234" — the name, the status and the old value running together as
 * if they were all what the field is called. Splitting them puts the status and
 * the previous value in aria-describedby, where a screen reader reads them
 * after the name rather than as part of it.
 *
 * The id comes from the column name rather than useId(): only one member's
 * form is mounted at a time, so a column is unique on the page, and a readable
 * id survives in the DOM for anyone debugging it.
 *
 * The control is a function child because it needs that id, and cloning an
 * unknown element to inject props is the fragile way to hand it over.
 */
export function EditField({
  name,
  label,
  full = false,
  queued,
  previous,
  children
}: {
  /** The column this field edits — its id, and its key into `queued`. */
  name: string;
  label: string;
  /** Spans both grid columns — addresses and the free-text note. */
  full?: boolean;
  /** Fields in the update currently awaiting review. */
  queued: Set<string>;
  /** The live record's value, shown only while pending. Already formatted for
   *  display, so a <select> can pass its option label rather than a code. */
  previous?: string;
  children: (attrs: FieldAttrs) => ReactNode;
}) {
  const pending = queued.has(name);
  const id = `pf-${name}`;
  const noteId = `${id}-note`;

  return (
    <div className={full ? styles.editFieldFull : styles.editField}>
      <label className={styles.editLabel} htmlFor={id}>
        {label}
      </label>
      {/* Outside the <label>, and hidden from assistive tech: anything inside
          a label becomes part of the control's accessible name, so the tag
          would rename the field to "Phone awaiting review". The same fact is
          announced properly by the describedby note below. */}
      {pending && (
        <span className={styles.pendingTag} aria-hidden="true">
          awaiting review
        </span>
      )}
      {children(pending ? { id, 'aria-describedby': noteId } : { id })}
      {pending && (
        <span className={styles.pendingWas} id={noteId}>
          Awaiting review. Record still says:{' '}
          {previous && previous.trim() !== '' ? previous : 'nothing'}
        </span>
      )}
    </div>
  );
}

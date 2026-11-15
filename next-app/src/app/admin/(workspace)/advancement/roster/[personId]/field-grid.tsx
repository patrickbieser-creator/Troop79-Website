/**
 * The labelled field grid the crossover card and the pending-update banner use (kept from
 * the retired section-card.tsx when the record page moved to one form, one Save).
 */
import type { ReactNode } from 'react';
import styles from './person-record.module.css';

/** The two-column field grid every section form uses. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

/** One labelled field. Wraps the control in its <label>, so the label text
 *  is the control's accessible name. */
export function Field({
  label,
  required = false,
  full = false,
  error,
  children
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  /** Inline validation line under the control (a blank required name). */
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className={full ? `${styles.field} ${styles.full}` : styles.field}>
      <span>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </span>
      {children}
      {error ? <span className={styles.err}>{error}</span> : null}
    </label>
  );
}

/** A value shown inside the form that cannot be edited here (internal id, derived rank). */

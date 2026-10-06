/**
 * Shared public form kit — Field (label + hint + error with automatic
 * htmlFor/aria-describedby wiring), TextInput, SelectInput, TextArea,
 * FieldHint, FieldError, FormCard. Promoted from library.module.css's form
 * cluster; error styling moves onto the status tokens. Canonical rendering:
 * /admin/styleguide/public.
 */
'use client';

import {
  createContext,
  useContext,
  useId,
  type ComponentProps,
  type ReactNode
} from 'react';
import s from './form.module.css';

/* Exported for sibling field controls (date-field.tsx) — screen code should
   never consume this directly; put controls inside <Field> instead. */
export const FieldContext = createContext<{ id?: string; describedBy?: string; invalid?: boolean }>({});
const FieldCtx = FieldContext;

export function FormCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={[s.formCard, className].filter(Boolean).join(' ')}>{children}</div>;
}

export function Field({
  label,
  hint,
  error,
  problem,
  className,
  children
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** The blocked-save mark (D-331): a plain red sentence under the field, and the control outlined + aria-invalid. */
  problem?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = hint != null ? `${id}-hint` : undefined;
  const errorId = error != null ? `${id}-err` : undefined;
  const hasProblem = problem != null && problem !== false && problem !== '';
  const problemId = hasProblem ? `${id}-problem` : undefined;
  const describedBy = [hintId, errorId, problemId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={[s.fieldRow, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={s.fieldLabel}>
        {label}
      </label>
      <FieldCtx.Provider value={{ id, describedBy, invalid: hasProblem }}>{children}</FieldCtx.Provider>
      {hint != null && (
        <p id={hintId} className={s.fieldHint}>
          {hint}
        </p>
      )}
      {error != null && <FieldError id={errorId}>{error}</FieldError>}
      {hasProblem && (
        <p id={problemId} className={s.fieldProblem}>
          {problem}
        </p>
      )}
    </div>
  );
}

export function TextInput({ className, ...rest }: ComponentProps<'input'>) {
  const ctx = useContext(FieldCtx);
  return (
    <input
      id={ctx.id}
      aria-describedby={ctx.describedBy}
      aria-invalid={ctx.invalid || undefined}
      {...rest}
      className={[s.textInput, className].filter(Boolean).join(' ')}
    />
  );
}

export function SelectInput({ className, children, ...rest }: ComponentProps<'select'>) {
  const ctx = useContext(FieldCtx);
  return (
    <select
      id={ctx.id}
      aria-describedby={ctx.describedBy}
      aria-invalid={ctx.invalid || undefined}
      {...rest}
      className={[s.selectInput, className].filter(Boolean).join(' ')}
    >
      {children}
    </select>
  );
}

export function TextArea({ className, ...rest }: ComponentProps<'textarea'>) {
  const ctx = useContext(FieldCtx);
  return (
    <textarea
      id={ctx.id}
      aria-describedby={ctx.describedBy}
      aria-invalid={ctx.invalid || undefined}
      {...rest}
      className={[s.textArea, className].filter(Boolean).join(' ')}
    />
  );
}

export function FieldHint({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={[s.fieldHint, className].filter(Boolean).join(' ')}>{children}</p>;
}

/** Renders nothing when empty so callers can pass conditional errors directly. */
export function FieldError({
  id,
  className,
  children
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  if (children == null || children === false || children === '') return null;
  return (
    <div role="alert" id={id} className={[s.fieldError, className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

/** A problem marked in place under something that is not a single field (a chip group, a list). */
export function FieldProblem({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  if (children == null || children === false || children === '') return null;
  return (
    <p id={id} className={[s.fieldProblem, className].filter(Boolean).join(' ')}>
      {children}
    </p>
  );
}

/**
 * "Can't save yet: <reason> (+N more)" beside a Save/Add/Share button that was pressed while the form was
 * incomplete (D-331; the public twin of the admin SaveProblem). Render it only after a try; it goes when the
 * form is whole. Renders nothing without a reason.
 */
export function SaveProblem({ reason, more = 0, action = 'save', className }: { reason?: string | null; more?: number; action?: string; className?: string }) {
  if (!reason) return null;
  return (
    <span role="alert" className={[s.saveProblem, className].filter(Boolean).join(' ')}>
      Can’t {action} yet: {reason}
      {more > 0 && <span className={s.saveProblemMore}> (+{more} more)</span>}
    </span>
  );
}

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

const FieldCtx = createContext<{ id?: string; describedBy?: string }>({});

export function FormCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={[s.formCard, className].filter(Boolean).join(' ')}>{children}</div>;
}

export function Field({
  label,
  hint,
  error,
  className,
  children
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = hint != null ? `${id}-hint` : undefined;
  const errorId = error != null ? `${id}-err` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={[s.fieldRow, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={s.fieldLabel}>
        {label}
      </label>
      <FieldCtx.Provider value={{ id, describedBy }}>{children}</FieldCtx.Provider>
      {hint != null && (
        <p id={hintId} className={s.fieldHint}>
          {hint}
        </p>
      )}
      {error != null && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

export function TextInput({ className, ...rest }: ComponentProps<'input'>) {
  const ctx = useContext(FieldCtx);
  return (
    <input
      id={ctx.id}
      aria-describedby={ctx.describedBy}
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

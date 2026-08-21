/**
 * Shared public DateField — a styled NATIVE <input type="date">, the
 * Phase C decoupling decision (Patrick, 2026-08-21, option b): the public
 * profile editors stop importing admin's DatePickerField (the one true
 * admin↔public coupling; its 31 triple-fallback chains existed solely to
 * survive out here). Native date inputs are the better control on phones —
 * where families actually edit profiles — and inherit the form kit's
 * sizing. Slots into <Field> for label/hint/error wiring like TextInput.
 */
'use client';

import { useContext, type ComponentProps } from 'react';
import { FieldContext } from './form';
import s from './form.module.css';

export function DateField({ className, ...rest }: Omit<ComponentProps<'input'>, 'type'>) {
  const ctx = useContext(FieldContext);
  return (
    <input
      type="date"
      id={ctx.id}
      aria-describedby={ctx.describedBy}
      {...rest}
      className={[s.textInput, className].filter(Boolean).join(' ')}
    />
  );
}

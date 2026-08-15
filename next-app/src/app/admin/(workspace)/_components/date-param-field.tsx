'use client';

/**
 * A DatePickerField for a plain `method="get"` form on a Server Component page.
 *
 * The report screens (Scoutbook Export, meeting attendance) keep their date
 * range in the QUERY STRING on purpose — the preview and the download route
 * then agree on the same window with no client state to sync. That means the
 * field must submit itself by `name`, which a controlled component can't do
 * from a server page. This is the whole adapter: own the value locally,
 * submit it through DatePickerField's hidden input, and let the form's own
 * navigation reset it on the next render.
 */

import { useState } from 'react';
import { DatePickerField } from './date-picker-field';

interface Props {
  name: string;
  id?: string;
  defaultValue: string;
  className?: string;
}

export function DateParamField({ name, id, defaultValue, className }: Props) {
  const [value, setValue] = useState(defaultValue);
  return (
    <DatePickerField id={id} name={name} value={value} onChange={setValue} className={className} />
  );
}

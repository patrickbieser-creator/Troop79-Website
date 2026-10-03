'use client';

/**
 * A dashed search over catalog ingredients, on the shared SearchCombobox. Used
 * twice by the menu-edit ingredient list: the persistent "Add an ingredient"
 * row at the end, and the transient "Swap X for…" row that opens under a row.
 */

import type { Ref } from 'react';
import { SearchCombobox } from './search-combobox';

export interface IngredientChoice {
  id: string;
  name: string;
}

export function IngredientSearch({
  label,
  placeholder,
  choices,
  onPick,
  onCancel,
  autoFocus,
  inputRef
}: {
  /** The accessible name: 'Swap Pancake mix for'. */
  label: string;
  placeholder: string;
  choices: readonly IngredientChoice[];
  onPick: (choice: IngredientChoice) => void;
  /** Escape with nothing typed (the swap row uses it to close itself). */
  onCancel?: () => void;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <SearchCombobox
      label={label}
      placeholder={placeholder}
      listLabel={`${label} — matching ingredients`}
      options={(query) => {
        const q = query.trim().toLowerCase();
        return choices.filter((c) => c.name.toLowerCase().includes(q)).map((c) => ({ id: c.id, label: c.name }));
      }}
      onPick={(o) => {
        const c = choices.find((x) => x.id === o.id);
        if (c) onPick(c);
      }}
      onCancel={onCancel}
      noMatch={(q) => `No ingredient matches “${q}”.`}
      autoFocus={autoFocus}
      inputRef={inputRef}
    />
  );
}

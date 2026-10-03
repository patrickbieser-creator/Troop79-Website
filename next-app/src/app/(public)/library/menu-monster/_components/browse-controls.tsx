'use client';

/**
 * The two controls above every Menu Monster browse list (Recipe Library,
 * Ingredients, the Plan tab's recipe popup): a search box with a magnifier, and a
 * "Show" row of toggle chips where All clears the filter and pressing the
 * pressed chip again does too. Look: workspace.module.css .libSearch / .chip.
 */

import type { Ref } from 'react';
import w from '../menus/_components/workspace.module.css';

export function SearchBox({ label, value, onChange, inputRef }: { label: string; value: string; onChange: (v: string) => void; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <div className={w.libSearchWrap}>
      <span className={w.libSearchIcon} aria-hidden="true">
        ⌕
      </span>
      <input ref={inputRef} type="search" className={w.libSearch} value={value} autoComplete="off" aria-label={label} placeholder={label} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function FilterChips<K extends string>({ options, value, onChange }: { options: readonly { key: K; label: string }[]; value: K | null; onChange: (k: K | null) => void }) {
  return (
    <div className={w.libFilters} role="group" aria-label="Show only">
      <span className={w.choiceLabel} aria-hidden="true">
        Show
      </span>
      <div className={w.chips}>
        <button type="button" className={w.chip} aria-pressed={value === null} onClick={() => onChange(null)}>
          All
        </button>
        {options.map((o) => (
          <button key={o.key} type="button" className={w.chip} aria-pressed={value === o.key} onClick={() => onChange(value === o.key ? null : o.key)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

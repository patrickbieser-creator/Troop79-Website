'use client';

/**
 * Admin combobox (2026-10-06) — pick ONE value from a list too long for a plain select. The input shows the
 * current pick; typing filters the list by a case-insensitive CONTAINS match on each option's label and
 * keywords. ArrowDown/ArrowUp move the active option (aria-activedescendant), Enter picks it, Escape closes
 * and restores the current pick, and leaving the box restores it too. A × clears the pick (an empty value),
 * and `invalid` marks the field (red outline + aria-invalid). Same keyboard contract as the Menu Monster gear
 * picker (library/menu-monster/gear-picker.tsx), which is a multi-pick with chips and so keeps its own markup.
 * Specimen: /admin/styleguide/admin -> Combobox.
 */
import { useId, useState, type KeyboardEvent } from 'react';
import s from './admin-combobox.module.css';

export interface ComboOption {
  value: string;
  label: string;
  /** Quiet second column (a section, a unit); not part of the option's name. */
  detail?: string;
  /** Extra words that also match (unit words), never shown. */
  keywords?: readonly string[];
}

export function filterOptions(options: readonly ComboOption[], query: string): ComboOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter((o) => o.label.toLowerCase().includes(q) || (o.keywords ?? []).some((k) => k.toLowerCase().includes(q)));
}

export function AdminCombobox({
  id,
  label,
  options,
  value,
  onChange,
  invalid = false,
  placeholder = 'Type to search…',
  noMatch = 'Nothing matches'
}: {
  id: string;
  /** The accessible name (the visible label may sit beside it). */
  label: string;
  options: readonly ComboOption[];
  /** The picked option's value; '' = nothing picked. */
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  placeholder?: string;
  noMatch?: string;
}) {
  const uid = useId();
  // null = not typing: the box shows the current pick.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const picked = options.find((o) => o.value === value);
  const shown = filterOptions(options, query ?? '');
  const act = Math.min(active, Math.max(0, shown.length - 1));
  const showList = open && shown.length > 0;
  const typed = (query ?? '').trim();

  const close = () => {
    setQuery(null);
    setOpen(false);
  };
  const pick = (v: string) => {
    onChange(v);
    close();
  };
  const openList = () => {
    if (open) return;
    setOpen(true);
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  };

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else setActive(Math.min(act + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openList();
      else setActive(Math.max(act - 1, 0));
    } else if (e.key === 'Enter') {
      // Enter never submits the surrounding form; it picks the highlighted option when the list is open.
      e.preventDefault();
      if (showList) pick(shown[act].value);
    } else if (e.key === 'Escape') {
      if (open || query !== null) {
        e.preventDefault();
        close();
      }
    }
  }

  return (
    <div className={s.wrap}>
      <input
        id={id}
        type="text"
        role="combobox"
        className={s.input}
        value={query ?? picked?.label ?? ''}
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-expanded={showList}
        aria-controls={`${uid}-options`}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${uid}-opt-${act}` : undefined}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={(e) => {
          openList();
          e.currentTarget.select?.();
        }}
        onClick={openList}
        onBlur={close}
        onKeyDown={onKey}
      />
      {value !== '' && (
        <button type="button" className={s.clear} aria-label={`Clear ${label}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick('')}>
          ×
        </button>
      )}
      <ul id={`${uid}-options`} role="listbox" aria-label={`${label} options`} className={s.options} hidden={!showList}>
        {showList &&
          shown.map((o, i) => (
            <li
              key={o.value}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              data-active={i === act}
              className={s.option}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              {o.label}
              {o.detail && (
                <span className={s.detail} aria-hidden="true">
                  {o.detail}
                </span>
              )}
            </li>
          ))}
      </ul>
      {open && shown.length === 0 && typed !== '' && <p className={s.noMatch}>{noMatch} “{typed}”.</p>}
    </div>
  );
}

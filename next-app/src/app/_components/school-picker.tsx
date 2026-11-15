'use client';

/**
 * School picker for families (public tokens) — the public twin of the leaders' SchoolCombobox
 * (admin/(workspace)/_components/school-combobox.tsx; the firewall keeps them apart). It works on NAMES:
 * a family picks one of the troop's active schools, or types one that isn't listed and chooses
 * `+ Add “<typed>” as a new school`, which only puts that name in their update. Nothing is added to the
 * list until a leader approves the change request (approveChangeRequest resolves the name).
 *
 * Type to filter (the typed text bolded), × clears, ▾ toggles, ArrowUp/ArrowDown/Enter/Escape; leaving the
 * box without picking restores the current value. A current value that isn't on the list still shows.
 * The label is the caller's (`<label htmlFor={id}>`); pass `aria-describedby` through for pending notes.
 * Specimen: /admin/styleguide/public -> School picker.
 */
import { useId, useState, type KeyboardEvent } from 'react';
import s from './school-picker.module.css';

const keyOf = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();

function bold(label: string, query: string) {
  const q = query.trim();
  const at = q ? label.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <strong>{label.slice(at, at + q.length)}</strong>
      {label.slice(at + q.length)}
    </>
  );
}

export function SchoolPicker({
  id,
  names,
  value,
  onChange,
  inputClassName,
  disabled = false,
  'aria-describedby': describedBy
}: {
  id: string;
  /** The active schools' names. */
  names: readonly string[];
  /** The chosen name; '' = none. */
  value: string;
  onChange: (name: string) => void;
  /** The screen's own input class (e.g. /profile's .editInput), so the field matches its neighbours. */
  inputClassName?: string;
  disabled?: boolean;
  'aria-describedby'?: string;
}) {
  const uid = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const typed = (query ?? '').trim();
  const q = typed.toLowerCase();
  const shown = [...names].sort((a, b) => a.localeCompare(b)).filter((n) => !q || n.toLowerCase().includes(q));
  const exact = typed !== '' && names.some((n) => keyOf(n) === keyOf(typed));
  const addLabel = typed !== '' && !exact ? `+ Add “${typed.replace(/\s+/g, ' ')}” as a new school` : null;
  const count = shown.length + (addLabel ? 1 : 0);
  const act = Math.min(active, Math.max(0, count - 1));
  const showList = open && count > 0;

  const close = () => {
    setQuery(null);
    setOpen(false);
  };
  const choose = (i: number) => {
    if (i < shown.length) onChange(shown[i]);
    else if (addLabel) onChange(typed.replace(/\s+/g, ' '));
    close();
  };
  const openList = () => {
    if (open || disabled) return;
    setOpen(true);
    setActive(Math.max(0, shown.indexOf(value)));
  };

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else setActive(Math.min(act + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openList();
      else setActive(Math.max(act - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showList) choose(act);
    } else if (e.key === 'Escape' && (open || query !== null)) {
      e.preventDefault();
      close();
    }
  }

  return (
    <div className={s.wrap}>
      <input
        id={id}
        type="text"
        role="combobox"
        className={[s.input, inputClassName].filter(Boolean).join(' ')}
        value={query ?? value}
        autoComplete="off"
        disabled={disabled}
        aria-describedby={describedBy}
        aria-expanded={showList}
        aria-controls={`${uid}-options`}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${uid}-opt-${act}` : undefined}
        placeholder="Type to search schools…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={openList}
        onClick={openList}
        onBlur={close}
        onKeyDown={onKey}
      />
      {value !== '' && !disabled && (
        <button type="button" className={s.clear} aria-label="Clear school" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange('')}>
          ×
        </button>
      )}
      <button
        type="button"
        className={s.toggle}
        aria-label={open ? 'Close school list' : 'Open school list'}
        tabIndex={-1}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) close();
          else {
            openList();
            document.getElementById(id)?.focus();
          }
        }}
      >
        ▾
      </button>
      <ul id={`${uid}-options`} role="listbox" aria-label="Schools" className={s.options} hidden={!showList}>
        {showList &&
          shown.map((n, i) => (
            <li
              key={n}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={n === value}
              data-active={i === act}
              className={s.option}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span>{bold(n, typed)}</span>
            </li>
          ))}
        {showList && addLabel && (
          <li
            id={`${uid}-opt-${shown.length}`}
            role="option"
            aria-selected={false}
            data-active={act === shown.length}
            className={`${s.option} ${s.addOption}`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => setActive(shown.length)}
            onClick={() => choose(shown.length)}
          >
            {addLabel}
          </li>
        )}
      </ul>
    </div>
  );
}

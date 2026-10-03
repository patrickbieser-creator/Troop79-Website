'use client';

/**
 * The dashed search box every Menu Monster list uses: a combobox with a listbox
 * under it, fully keyboard-operable (arrows move, Enter picks, Escape clears the
 * box, or cancels when it is already empty). The caller owns WHAT can be found —
 * `options(query)` — so the same box searches ingredients (IngredientSearch) and
 * serves a day's "Add to Friday" search on the Plan tab. Look: workspace.module.css
 * .addInput / .results / .option.
 */

import { useId, useState, type KeyboardEvent, type Ref } from 'react';
import w from '../menus/_components/workspace.module.css';

export interface SearchOption {
  id: string;
  label: string;
  /** A quieter second line under the label ("adds to breakfast"). */
  sub?: string;
}

export function SearchCombobox({
  label,
  placeholder,
  listLabel,
  options,
  onPick,
  onCancel,
  noMatch,
  autoFocus,
  inputRef
}: {
  /** The accessible name of the input. */
  label: string;
  placeholder: string;
  /** The accessible name of the listbox. */
  listLabel: string;
  /** What the typed text finds. */
  options: (query: string) => readonly SearchOption[];
  onPick: (option: SearchOption) => void;
  /** Escape with nothing typed (a transient row uses it to close itself). */
  onCancel?: () => void;
  /** The line shown when text is typed and nothing matches. */
  noMatch?: (query: string) => string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const q = query.trim();
  const matches = options(query);
  const act = Math.min(active, Math.max(0, matches.length - 1));
  const showList = open && matches.length > 0;

  const reset = () => {
    setQuery('');
    setOpen(false);
    setActive(0);
  };
  const pick = (o: SearchOption) => {
    reset();
    onPick(o);
  };

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive(Math.min(act + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(act - 1, 0));
    } else if (e.key === 'Enter') {
      if (showList) {
        e.preventDefault();
        pick(matches[act]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) reset();
      else if (onCancel) onCancel();
      else reset();
    }
  }

  return (
    <div className={w.addWrap}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        className={w.addInput}
        value={query}
        autoComplete="off"
        autoFocus={autoFocus}
        aria-label={label}
        aria-expanded={showList}
        aria-controls={`${uid}-results`}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${uid}-opt-${act}` : undefined}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
      />
      <ul id={`${uid}-results`} role="listbox" aria-label={listLabel} className={w.results} hidden={!showList}>
        {showList &&
          matches.map((o, i) => (
            <li
              key={o.id}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={i === act}
              className={w.option}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(o)}
            >
              {o.sub ? (
                <span className={w.optionText}>
                  {o.label}
                  <span className={w.optionSub}>{o.sub}</span>
                </span>
              ) : (
                o.label
              )}
            </li>
          ))}
      </ul>
      {open && matches.length === 0 && q !== '' && noMatch && <p className={w.noMatch}>{noMatch(q)}</p>}
    </div>
  );
}

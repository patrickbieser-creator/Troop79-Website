'use client';

/**
 * A dashed search over catalog ingredients: a combobox with a listbox under it,
 * fully keyboard-operable (arrows move, Enter picks, Escape clears the box, or
 * cancels when it is already empty). Used twice by the menu-edit ingredient
 * list: the persistent "Add an ingredient" row at the end, and the transient
 * "Swap X for…" row that opens under a row. Same look as the meal page's
 * recipe search (workspace.module.css .addInput / .results / .option).
 */

import { useId, useState, type KeyboardEvent, type Ref } from 'react';
import w from '../menus/_components/workspace.module.css';

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
  const uid = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const q = query.trim().toLowerCase();
  const matches = choices.filter((c) => c.name.toLowerCase().includes(q));
  const act = Math.min(active, Math.max(0, matches.length - 1));
  const showList = open && matches.length > 0;

  const reset = () => {
    setQuery('');
    setOpen(false);
    setActive(0);
  };
  const pick = (c: IngredientChoice) => {
    reset();
    onPick(c);
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
      // Typed text clears first; an empty box cancels (the swap row closes itself).
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
      <ul id={`${uid}-results`} role="listbox" aria-label={`${label} — matching ingredients`} className={w.results} hidden={!showList}>
        {showList &&
          matches.map((c, i) => (
            <li
              key={c.id}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={i === act}
              className={w.option}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(c)}
            >
              {c.name}
            </li>
          ))}
      </ul>
      {open && matches.length === 0 && q !== '' && <p className={w.noMatch}>No ingredient matches “{query.trim()}”.</p>}
    </div>
  );
}

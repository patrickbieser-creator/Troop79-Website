'use client';

/**
 * Menu Monster leader tools — gear is PICKED from the master list, never typed in (Patrick, 2026-10-05: "we do
 * not need the option to add items on the fly; the list will not grow the way food items do"). A type-to-filter
 * box finds unselected master items, A to Z; picked items sit below as chips, A to Z, each with a count stepper
 * and a remove button. There is no "add" row anywhere: a missing item is added on the Gear tab ("+ New gear").
 *
 * Controlled: `gear` is the recipe's entries as stored ("Skillet × 2"), `onChange` gets the new list, sorted.
 * The save action resolves every entry against the master list again, so this is a convenience, not the gate.
 * Specimen: /admin/styleguide/admin → Gear Picker.
 */

import { useId, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { MAX_GEAR_COUNT, gearKey, gearPickOptions, gearText, parseGear, sortGear, type GearItem } from '@/lib/menu-monster/gear';
import s from './gear-picker.module.css';

export function GearPicker({
  gear,
  list,
  onChange,
  labelledBy,
  initialQuery = ''
}: {
  gear: readonly string[];
  /** The master gear list (retired items are never offered). */
  list: readonly GearItem[];
  onChange: (next: string[]) => void;
  /** The id of the visible label that names this field. */
  labelledBy?: string;
  /** Specimens only: start with text already typed. */
  initialQuery?: string;
}) {
  const uid = useId();
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const options = gearPickOptions(list, query, gear);
  const act = Math.min(active, Math.max(0, options.length - 1));
  const showList = open && options.length > 0;
  const q = query.trim();
  // Typed text that matches nothing can never become draft state, so it is said in place and stays until the text changes.
  const unmatched = q !== '' && options.length === 0;
  const chips = sortGear(gear);

  const pick = (item: GearItem) => {
    onChange(sortGear([...gear, item.name]));
    setQuery('');
    setActive(0);
  };
  const setCount = (entry: string, count: number) => {
    const { name } = parseGear(entry);
    onChange(sortGear(gear.map((g) => (gearKey(parseGear(g).name) === gearKey(name) ? gearText(name, count) : g))));
  };
  const remove = (entry: string) => onChange(gear.filter((g) => gearKey(parseGear(g).name) !== gearKey(parseGear(entry).name)));

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive(Math.min(act + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(act - 1, 0));
    } else if (e.key === 'Enter') {
      // Enter never submits the recipe form; it picks the highlighted item when the list is open.
      e.preventDefault();
      if (showList) pick(options[act]);
      // Enter on text that matches nothing says so (the note below is already showing; it is announced as an alert).
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else setOpen(false);
    }
  }

  return (
    <div className={s.picker} role="group" aria-labelledby={labelledBy}>
      <div className={s.searchWrap}>
        <input
          type="text"
          role="combobox"
          className={unmatched ? `${s.search} ${s.searchBad}` : s.search}
          aria-invalid={unmatched || undefined}
          value={query}
          autoComplete="off"
          aria-label="Search gear"
          aria-expanded={showList}
          aria-controls={`${uid}-options`}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${uid}-opt-${act}` : undefined}
          placeholder="Search the gear list…"
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
        <ul id={`${uid}-options`} role="listbox" aria-label="Gear on the list" className={s.options} hidden={!showList}>
          {showList &&
            options.map((o, i) => (
              <li
                key={o.id}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === act}
                className={s.option}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(o)}
              >
                {o.name}
              </li>
            ))}
        </ul>
        {unmatched && (
          <p className={s.noMatch} role="alert">
            “{q}” is not on the gear list — pick a match, or add it on the Gear tab.{' '}
            <Link href="/admin/library/menu-monster?tab=gear" target="_blank" rel="noopener" className={s.noMatchLink}>
              Add it to the gear list…
            </Link>
          </p>
        )}
      </div>

      {chips.length > 0 && (
        <ul className={s.chips} aria-label="Selected gear">
          {chips.map((entry) => {
            const { name, count } = parseGear(entry);
            return (
              <li key={gearKey(name)} className={s.chip}>
                <span className={s.chipName}>{gearText(name, count)}</span>
                <span className={s.stepper}>
                  <button type="button" className={s.step} aria-label={`Fewer ${name}`} disabled={count <= 1} onClick={() => setCount(entry, count - 1)}>
                    −
                  </button>
                  <button type="button" className={s.step} aria-label={`More ${name}`} disabled={count >= MAX_GEAR_COUNT} onClick={() => setCount(entry, count + 1)}>
                    +
                  </button>
                </span>
                <button type="button" className={s.remove} aria-label={`Remove ${name}`} onClick={() => remove(entry)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

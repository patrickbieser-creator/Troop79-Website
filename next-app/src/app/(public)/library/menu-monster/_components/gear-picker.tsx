'use client';

/**
 * Gear is PICKED from the troop's master list, never typed in (Patrick, 2026-10-05: "we do not need the option
 * to add items on the fly"). Two pieces, both on public tokens:
 *
 *   GearPicker   the dashed search box (SearchCombobox) over the list's live items, A to Z, minus what is already
 *                taken. Nothing matching says so; it NEVER offers to create the item — a leader adds new gear.
 *   GearChips    the picked entries, A to Z, each with a − [n] + count (shown "Name × n" when n > 1) and a remove.
 *
 * The recipe editor uses both; the menu's Gear tab uses the picker alone (its rows already list what is picked).
 */

import { Stepper } from '@/app/_components/stepper';
import { MAX_GEAR_COUNT, gearKey, gearPickOptions, gearText, parseGear, sortGear, type GearItem } from '@/lib/menu-monster/gear';
import { SearchCombobox, type SearchOption } from './search-combobox';
import s from './gear-picker.module.css';

export function GearPicker({
  list,
  taken,
  onPick,
  label = 'Search gear',
  placeholder = 'Search the gear list'
}: {
  /** The troop's master gear list (retired items are never offered). */
  list: readonly GearItem[];
  /** Entries already picked or already on the menu ("Skillet × 2"): only their names count. */
  taken: readonly string[];
  /** The item chosen, in the list's own spelling. */
  onPick: (name: string) => void;
  label?: string;
  placeholder?: string;
}) {
  return (
    <SearchCombobox
      label={label}
      placeholder={placeholder}
      listLabel="Gear on the list"
      options={(q): readonly SearchOption[] => gearPickOptions(list, q, taken).map((g) => ({ id: String(g.id), label: g.name }))}
      onPick={(o) => onPick(o.label)}
      noMatch={(q) => `Nothing on the gear list matches “${q}”. A leader can add new gear.`}
    />
  );
}

export function GearChips({ gear, onChange, onAnnounce, idPrefix = '' }: { gear: readonly string[]; onChange: (next: string[]) => void; onAnnounce?: (text: string) => void; /** Keeps the count inputs' ids unique when several lists are on one page (one per open meal). */ idPrefix?: string }) {
  if (gear.length === 0) return null;
  const same = (a: string, b: string) => gearKey(parseGear(a).name) === gearKey(parseGear(b).name);
  return (
    <ul className={s.chips} aria-label="Gear">
      {sortGear(gear).map((entry) => {
        const { name, count } = parseGear(entry);
        const id = `${idPrefix}gear-n-${gearKey(name).replace(/[^a-z0-9]+/g, '-')}`;
        return (
          <li key={gearKey(name)} className={s.chip}>
            <span className={s.chipName}>{gearText(name, count)}</span>
            <Stepper
              id={id}
              value={count}
              min={1}
              max={MAX_GEAR_COUNT}
              groupLabel={`How many ${name}`}
              lessLabel={`Fewer ${name}`}
              moreLabel={`More ${name}`}
              inputLabel={`${name} count`}
              onChange={(n) => onChange(sortGear(gear.map((g) => (same(g, entry) ? gearText(name, n) : g))))}
            />
            <button
              type="button"
              className={s.remove}
              aria-label={`Remove ${name}`}
              onClick={() => {
                onChange(gear.filter((g) => !same(g, entry)));
                onAnnounce?.(`${name} removed from gear.`);
              }}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}

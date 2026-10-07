'use client';

/**
 * Client-side specimen wrappers for /admin/styleguide/admin. The styleguide page
 * is a server component, so it can't pass handler props (onAction/onSelect)
 * to client components — these thin wrappers supply inert handlers instead.
 * Display-only: nothing here appears outside the styleguide.
 */
import { ActionsMenu } from '../../_components/actions-menu';
import { SortHeader, useSortable } from '../../_components/use-sortable';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { AdminCombobox, type ComboOption } from '../../_components/admin-combobox';
import { GearPicker } from '../../library/menu-monster/gear-picker';
import type { GearItem } from '@/lib/menu-monster/gear';
import { useState } from 'react';

const SORT_ROWS = [
  { name: 'Violet Babby', nights: 12 },
  { name: 'Jack Porter', nights: 21 },
  { name: 'Oscar Belle', nights: 7 }
];

export function SortHeaderSpecimen() {
  const { sorted, sortKey, sortDir, toggle } = useSortable<
    (typeof SORT_ROWS)[number],
    'name' | 'nights'
  >(SORT_ROWS, (row, key) => row[key], null);
  return (
    <table style={{ borderCollapse: 'collapse', minWidth: 280 }}>
      <thead>
        <tr>
          <SortHeader label="Scout" colKey="name" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
          <SortHeader label="Nights" colKey="nights" sortKey={sortKey} sortDir={sortDir} toggle={toggle} align="right" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.name}>
            <td style={{ padding: '4px 10px 4px 0' }}>{r.name}</td>
            <td style={{ padding: '4px 0', textAlign: 'right' }}>{r.nights}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ActionsMenuSpecimen() {
  return (
    <ActionsMenu
      ariaLabel="Sample actions"
      options={[
        { value: 'record', label: 'Record a transaction' },
        { value: 'export', label: 'Export CSV (backup)' }
      ]}
      onAction={() => {}}
    />
  );
}

/** The list search, live: three names, filter them. */
const SEARCH_ROWS = [{ name: 'Avery Scout' }, { name: 'Blake Bieser' }, { name: 'Casey Okafor' }];
const searchFields = (r: { name: string }) => [r.name];
export function SearchFieldSpecimen() {
  const { q, setQ, visible } = useTableSearch(SEARCH_ROWS, searchFields);
  return (
    <div>
      <SearchField value={q} onChange={setQ} label="Search scouts" />
      <ul>
        {visible.map((r) => (
          <li key={r.name}>{r.name}</li>
        ))}
      </ul>
    </div>
  );
}

const GEAR_SAMPLE: GearItem[] = ['Camp stove', 'Cutting board', 'Dutch oven (12 in)', 'Griddle', 'Ladle', 'Long tongs', 'Skillet', 'Spatula'].map((name, id) => ({
  id: id + 1,
  name,
  home: 'trailer',
  perPerson: false,
  retiredAt: null
}));

/** Gear Picker: starts with two items so the chips, the count dial and the remove are all on show. */
export function GearPickerSpecimen() {
  const [gear, setGear] = useState<string[]>(['Skillet × 2', 'Spatula']);
  return <GearPicker gear={gear} list={GEAR_SAMPLE} onChange={setGear} />;
}

const COMBO_SAMPLE: ComboOption[] = [
  { value: 'bread', label: 'Bread', detail: 'Bakery', keywords: ['slice', 'slices'] },
  { value: 'flour', label: 'All purpose flour', detail: 'Dry goods', keywords: ['cup', 'cups'] },
  { value: 'almond-flour', label: 'Almond flour', detail: 'Dry goods', keywords: ['cup', 'cups'] },
  { value: 'eggs', label: 'Eggs', detail: 'Dairy', keywords: ['egg', 'eggs'] }
];

/** Combobox: starts on a pick so the clear × shows; type "flou" to filter. */
export function ComboboxSpecimen() {
  const [value, setValue] = useState('flour');
  return <AdminCombobox id="sg-combobox" label="Ingredient" options={COMBO_SAMPLE} value={value} onChange={setValue} />;
}

/** Combobox, marked: the red outline + aria-invalid a blocked Save leaves on an empty pick. */
export function ComboboxInvalidSpecimen() {
  const [value, setValue] = useState('');
  return <AdminCombobox id="sg-combobox-bad" label="Ingredient (marked)" options={COMBO_SAMPLE} value={value} invalid onChange={setValue} />;
}

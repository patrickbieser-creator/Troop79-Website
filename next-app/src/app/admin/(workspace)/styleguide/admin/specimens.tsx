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

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchField, useTableSearch } from '../src/app/admin/(workspace)/_components/search-field';

/**
 * The one name search for in-memory lists (Patrick, 2026-08-25: "a search
 * for name on every screen on roster … in the same place … a reusable UX
 * component"). Client-side, instant, case-insensitive substring over the
 * fields the caller names; Esc clears; the count is announced.
 */
const ROWS = [
  { name: 'Avery Scout', email: 'avery@example.org' },
  { name: 'Blake Bieser', email: null },
  { name: 'Casey Okafor', email: 'okafor@example.org' }
];

function Demo() {
  const { q, setQ, visible } = useTableSearch(ROWS, (r) => [r.name, r.email]);
  return (
    <div>
      <SearchField value={q} onChange={setQ} label="Search people" resultCount={visible.length} totalCount={ROWS.length} />
      <ul>
        {visible.map((r) => (
          <li key={r.name}>{r.name}</li>
        ))}
      </ul>
    </div>
  );
}

describe('SearchField + useTableSearch', () => {
  it('IsASearchInput_NamedForWhatItSearches_WithTheNamePlaceholder', () => {
    render(<Demo />);
    const input = screen.getByRole('searchbox', { name: 'Search people' });
    expect(input.getAttribute('placeholder')).toBe('Search by name…');
    expect(screen.getByText('3')).toBeTruthy(); // total, until you type
  });

  it('FiltersCaseInsensitively_AcrossTheNamedFields_AndCountsNofM', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.type(screen.getByRole('searchbox'), 'OKA');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Casey Okafor']);
    expect(screen.getByText('1 of 3')).toBeTruthy();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'avery@');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Avery Scout']);
  });

  it('Escape_ClearsTheSearch', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.type(screen.getByRole('searchbox'), 'blake');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});

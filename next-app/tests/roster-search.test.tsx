import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RosterSearch } from '../src/app/admin/(workspace)/advancement/roster/roster-search';
import {
  buildRosterSearchRows,
  ROSTER_KIND_LABEL,
  type RosterSearchRow
} from '../src/app/admin/(workspace)/advancement/roster/roster-search-rows';
import type { DirectoryPerson } from '../src/app/admin/(workspace)/advancement/roster/people-table';
import type { GuestTabRow } from '../src/lib/guest-people';

/**
 * One global roster search above the tabs (Patrick, 2026-08-26; Jenna's
 * spec 2026-08-27): replaces the three per-tab SearchFields; results span
 * every tab, column 1 says which tab a match lives on, and a row deep-links
 * to that tab with the existing ?open= wiring.
 */
const person = (over: Partial<DirectoryPerson>): DirectoryPerson => ({
  person_id: 1,
  display_name: 'Someone',
  primary_email: null,
  primary_phone: null,
  bsa_member_id: null,
  scout_id: null,
  inactive_reason: null,
  roles: '',
  tab: 'adult',
  in_picker: true,
  active: true,
  person_inactive_reason: null,
  ...over
});

const DIRECTORY: DirectoryPerson[] = [
  person({ person_id: 10, display_name: 'Avery Scout', scout_id: 'A02', tab: 'active_scout' }),
  person({ person_id: 11, display_name: 'Blake Former', scout_id: 'A09', tab: 'inactive_scout' }),
  person({ person_id: 12, display_name: 'Casey Leader', tab: 'leader', primary_email: 'casey@example.org', roles: 'scoutmaster' }),
  person({ person_id: 13, display_name: 'Dana Adult', tab: 'adult', primary_phone: '414-555-0100' })
];

const GUESTS: GuestTabRow[] = [
  {
    personId: 40,
    name: 'Evan Guest',
    hostHouseholdId: 7,
    hostLabel: 'Adult family',
    lastClass: null,
    lastEventTitle: null,
    lastEventDate: null,
    phone: null,
    forgetNudge: false
  }
];

const HOUSEHOLD_BY_PERSON = { 10: 7, 13: 7 };
const HOUSEHOLD_LABEL = new Map([[7, 'Adult family']]);

const rows = () =>
  buildRosterSearchRows({
    directory: DIRECTORY,
    guests: GUESTS,
    householdByPerson: HOUSEHOLD_BY_PERSON,
    householdLabel: HOUSEHOLD_LABEL
  });

describe('buildRosterSearchRows', () => {
  it('NormalizesEveryTab_IntoOneRowShape_WithTheTabAsKind', () => {
    const r = rows();
    expect(r.map((x) => [x.kind, x.name])).toEqual([
      ['active_scout', 'Avery Scout'],
      ['inactive_scout', 'Blake Former'],
      ['leader', 'Casey Leader'],
      ['adult', 'Dana Adult'],
      ['guest', 'Evan Guest']
    ]);
  });

  it('DeepLinks_ToTheRowsTab_WithTheIdThatTabOpens', () => {
    const by = Object.fromEntries(rows().map((x) => [x.name, x.href]));
    // Scout tabs open by scout code; people tabs and guests by people.id.
    expect(by['Avery Scout']).toBe('/admin/advancement/roster?tab=active_scout&open=A02');
    expect(by['Blake Former']).toBe('/admin/advancement/roster?tab=inactive_scout&open=A09');
    expect(by['Casey Leader']).toBe('/admin/advancement/roster?tab=leader&open=12');
    expect(by['Evan Guest']).toBe('/admin/advancement/roster?tab=guest&open=40');
  });

  it('CarriesHousehold_AndGuestOfHost_AsTheDetailColumn', () => {
    const by = Object.fromEntries(rows().map((x) => [x.name, x.detail]));
    expect(by['Avery Scout']).toBe('Adult family');
    expect(by['Casey Leader']).toBeNull();
    expect(by['Evan Guest']).toBe('Guest of Adult family');
  });

  it('LabelsEveryKind_Singular', () => {
    expect(ROSTER_KIND_LABEL).toEqual({
      active_scout: 'Active Scout',
      inactive_scout: 'Inactive Scout',
      leader: 'Leader',
      adult: 'Adult',
      guest: 'Guest'
    });
  });
});

function Demo({ data = rows() }: { data?: RosterSearchRow[] }) {
  return (
    <RosterSearch rows={data} tabs={<nav data-testid="tabs">tabs</nav>}>
      <p data-testid="tab-table">the tab table</p>
    </RosterSearch>
  );
}

describe('RosterSearch', () => {
  it('Idle_ShowsTheTabsAndTheTabTable_AndNoResults', () => {
    render(<Demo />);
    expect(screen.getByRole('searchbox', { name: 'Search the roster' })).toBeTruthy();
    expect(screen.getByTestId('tab-table')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Search results' })).toBeNull();
    expect(screen.getByTestId('tabs').closest('[inert]')).toBeNull();
  });

  it('Typing_ReplacesTheTabTable_WithResultsAcrossEveryTab_AndInertsTheTabs', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.type(screen.getByRole('searchbox'), 'a');
    expect(screen.queryByTestId('tab-table')).toBeNull();
    const table = screen.getByRole('table', { name: 'Search results' });
    const names = within(table)
      .getAllByRole('link')
      .map((a) => a.textContent);
    // Every name containing "a" — one from each tab, guests included.
    expect(names).toEqual(['Avery Scout', 'Blake Former', 'Casey Leader', 'Dana Adult', 'Evan Guest']);
    expect(screen.getByText('5 of 5')).toBeTruthy();
    const tabs = screen.getByTestId('tabs').closest('[inert]');
    expect(tabs).not.toBeNull();
    expect(tabs!.getAttribute('title')).toBe('Clear search to browse by tab');
  });

  it('ColumnOne_IsTheMatchesTab_AndTheNameLinksToItsEditor', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.type(screen.getByRole('searchbox'), 'casey');
    const table = screen.getByRole('table', { name: 'Search results' });
    const row = within(table).getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells[0].textContent).toBe('Leader');
    const link = within(cells[1]).getByRole('link', { name: 'Casey Leader' });
    expect(link.getAttribute('href')).toBe('/admin/advancement/roster?tab=leader&open=12');
    expect(cells[2].textContent).toBe('casey@example.org');
  });

  it('MatchesEmailAndPhone_Quietly', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.type(screen.getByRole('searchbox'), '0100');
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Dana Adult']);
  });

  it('NoMatch_SaysSo_WithTheQuery_AndKeepsTheColumns', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No one matches “zzz”.')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Search results' })).toBeTruthy();
  });

  it('Escape_ClearsTheSearch_AndTheTabTableComesBack', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.type(screen.getByRole('searchbox'), 'dana');
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('tab-table')).toBeTruthy();
    expect(screen.getByTestId('tabs').closest('[inert]')).toBeNull();
  });
});

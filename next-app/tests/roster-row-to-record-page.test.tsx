import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoutsTable } from '../src/app/admin/(workspace)/advancement/roster/scouts-table';
import type { ScoutRow } from '../src/app/admin/(workspace)/advancement/roster/scout-form';
import { PeopleTable, type DirectoryPerson } from '../src/app/admin/(workspace)/advancement/roster/people-table';

/**
 * Phase 6 of Plans/Person-Editor-Rethink.md: a name on either roster grid is
 * a LINK to the person's record page (`/admin/advancement/roster/<personId>
 * ?from=<tab>`), not a dialog trigger. The `from` tab is what the record
 * page's Back link returns to.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../src/app/admin/(workspace)/advancement/roster/scout-form', () => ({ ScoutForm: () => null }));
vi.mock('../src/app/admin/(workspace)/advancement/roster/adult-form', () => ({ AdultForm: () => null }));

const scout = (over: Partial<ScoutRow>): ScoutRow => ({
  person_id: 501,
  id: 'A01',
  first_name: 'Avery',
  last_name: 'Scout',
  display_name: 'Avery Scout',
  patrol: null,
  current_rank: null,
  bsa_member_id: null,
  birthdate: null,
  gender: null,
  school: null,
  graduation_year: null,
  swim_class: null,
  junior_leader_override: null,
  active: true,
  inactive_reason: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  zip: null,
  phone: null,
  email: null,
  health_form_date: null,
  things_we_should_know: null,
  ...over
});

const adult = (over: Partial<DirectoryPerson>): DirectoryPerson => ({
  person_id: 77,
  display_name: 'Becky Vest',
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

describe('Scouts grid — row click', () => {
  it('Leader_ClicksRosterRow_LandsOnRecordPage', () => {
    render(<ScoutsTable scouts={[scout({})]} ranks={[]} rankLabel={{}} today="2026-09-07" only="active" />);
    const link = screen.getByRole('link', { name: 'Avery Scout' });
    expect(link.getAttribute('href')).toBe('/admin/advancement/roster/501?from=active_scout');
  });

  it('Leader_ClicksInactiveScoutRow_BackLinkRemembersTheInactiveTab', () => {
    render(
      <ScoutsTable
        scouts={[scout({ active: false, inactive_reason: 'moved_away' })]}
        ranks={[]}
        rankLabel={{}}
        today="2026-09-07"
        only="inactive"
      />
    );
    expect(screen.getByRole('link', { name: 'Avery Scout' }).getAttribute('href')).toBe(
      '/admin/advancement/roster/501?from=inactive_scout'
    );
  });

  it('Leader_SeesPlainName_WhenNoPersonRecordIsLinked', () => {
    // Defensive: every scout created through createScout has a person, but a
    // row without one must not link to /roster/null.
    render(<ScoutsTable scouts={[scout({ person_id: null })]} ranks={[]} rankLabel={{}} today="2026-09-07" only="active" />);
    expect(screen.queryByRole('link', { name: 'Avery Scout' })).toBeNull();
    expect(screen.getByText('Avery Scout')).toBeTruthy();
  });
});

describe('Leaders / Adults grid — row click', () => {
  it('Leader_ClicksRosterRow_LandsOnRecordPage', () => {
    render(
      <PeopleTable people={[adult({ tab: 'leader', roles: 'adult_leader' })]} households={[]} householdByPerson={{}} householdMembers={{}} />
    );
    expect(screen.getByRole('link', { name: 'Becky Vest' }).getAttribute('href')).toBe(
      '/admin/advancement/roster/77?from=leader'
    );
  });

  it('Leader_ClicksAdultRow_FromParamFollowsTheRowsOwnTab', () => {
    render(<PeopleTable people={[adult({})]} households={[]} householdByPerson={{}} householdMembers={{}} />);
    expect(screen.getByRole('link', { name: 'Becky Vest' }).getAttribute('href')).toBe(
      '/admin/advancement/roster/77?from=adult'
    );
  });

  it('Leader_SeesNoEditDialogTrigger_OnTheGrid', () => {
    // The PersonEditor dialog is retired: the only button left in the grid's
    // chrome is the toolbar's "+ Add Adult".
    render(<PeopleTable people={[adult({})]} households={[]} householdByPerson={{}} householdMembers={{}} />);
    expect(screen.queryByRole('button', { name: 'Becky Vest' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ Add Adult' })).toBeTruthy();
  });
});

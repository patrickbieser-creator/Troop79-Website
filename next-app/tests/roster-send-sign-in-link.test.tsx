import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeopleTable, type DirectoryPerson } from '../src/app/admin/(workspace)/advancement/roster/people-table';
import { getPersonDetail, type PersonDetail } from '../src/app/admin/(workspace)/advancement/roster/person-actions';

/**
 * Roster "Send sign-in link" button (Plans/Verified-Signup.md Phase A) — the
 * button in the PersonEditor dialog must be disabled, with a reason, for a
 * person with no email on file. Uses `detail.fields.primary_email` (the
 * dialog's own fresh getPersonDetail() read), not the stale table-row prop,
 * since that's what requestChallengeForPerson() will actually find.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

vi.mock('../src/app/admin/(workspace)/advancement/roster/person-actions', () => ({
  addRole: vi.fn(),
  endRole: vi.fn(),
  deleteRole: vi.fn(),
  setHousehold: vi.fn(),
  addRelationship: vi.fn(),
  removeRelationship: vi.fn(),
  searchPeople: vi.fn(async () => []),
  getPersonDetail: vi.fn(),
  updatePersonDemographics: vi.fn(),
  setPersonActive: vi.fn(),
  mergePersonInto: vi.fn(),
  deletePerson: vi.fn(),
  createHouseholdForPerson: vi.fn(),
  renameHousehold: vi.fn(),
  sendSignInLink: vi.fn()
}));

function person(over: Partial<DirectoryPerson> & { person_id: number; display_name: string }): DirectoryPerson {
  return {
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
  };
}

function detail(fields: PersonDetail['fields']): PersonDetail {
  return { active: true, inactiveReason: null, tab: 'adult', householdId: null, roles: [], relationships: [], fields };
}

function renderTable(people: DirectoryPerson[]) {
  return render(
    <PeopleTable
      people={people}
      roles={[]}
      relationships={[]}
      households={[]}
      householdByPerson={{}}
      householdMembers={{}}
      nameById={{}}
    />
  );
}

describe('Roster "Send sign-in link" button', () => {
  it('SendSignInLink_DisabledWithReason_WhenNoEmail', async () => {
    vi.mocked(getPersonDetail).mockResolvedValue(detail({ primary_email: null, first_name: 'Dana', last_name: 'NoEmail' }));
    const user = userEvent.setup();
    renderTable([person({ person_id: 1, display_name: 'Dana NoEmail' })]);

    await user.click(screen.getByRole('button', { name: 'Dana NoEmail' }));

    const btn = await screen.findByRole('button', { name: 'Send sign-in link' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    expect(btn.getAttribute('title')).toBe('Add an email address first');
  });

  it('SendSignInLink_Enabled_WhenAnEmailIsOnFile', async () => {
    vi.mocked(getPersonDetail).mockResolvedValue(
      detail({ primary_email: 'dana@example.com', first_name: 'Dana', last_name: 'HasEmail' })
    );
    const user = userEvent.setup();
    renderTable([person({ person_id: 2, display_name: 'Dana HasEmail' })]);

    await user.click(screen.getByRole('button', { name: 'Dana HasEmail' }));

    const btn = await screen.findByRole('button', { name: 'Send sign-in link' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    expect(btn.getAttribute('title')).toBeNull();
  });
});

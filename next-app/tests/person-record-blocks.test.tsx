import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonRecord } from '../src/app/admin/(workspace)/advancement/roster/[personId]/person-record';
import type { PersonRecord as PersonRecordData } from '../src/app/admin/(workspace)/advancement/roster/[personId]/record-types';
import {
  createAdultForScout,
  deletePerson,
  endRole,
  getPersonDetail,
  getPersonEmails,
  mergePersonInto,
  removePersonEmailAction,
  searchPeople,
  setPersonPrimaryEmailAction,
  type PersonDetail
} from '../src/app/admin/(workspace)/advancement/roster/person-actions';
import type { PersonEmailRow } from '../src/lib/person-emails';

/**
 * Person Editor Rethink, Phase 3 (Plans/Person-Editor-Rethink.md) — the
 * "Takes effect immediately" blocks (emails, relationships, roles), the
 * Danger zone (merge / delete / promote) and the header's Send sign-in link.
 * Guards live in the UI where the spec puts them: a disabled control keeps a
 * title saying why, an irreversible step confirms first and names its
 * consequence, and a change that moves someone between roster tabs says so.
 *
 * The mock boundary is the server action (Tests/CLAUDE.md): assert on what
 * the component sent and what it showed after the action's answer.
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/admin/advancement/roster/401',
  useSearchParams: () => new URLSearchParams('')
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/person-actions', () => ({
  addRole: vi.fn(async () => ({ ok: true })),
  endRole: vi.fn(async () => ({ ok: true })),
  deleteRole: vi.fn(async () => ({ ok: true })),
  setHousehold: vi.fn(async () => ({ ok: true })),
  addRelationship: vi.fn(async () => ({ ok: true })),
  removeRelationship: vi.fn(async () => ({ ok: true })),
  linkAdultToScout: vi.fn(async () => ({ ok: true })),
  createAdultForScout: vi.fn(async () => ({ ok: true, personId: 402 })),
  searchPeople: vi.fn(async () => []),
  getPersonDetail: vi.fn(),
  getPersonEmails: vi.fn(async () => []),
  updatePersonDemographics: vi.fn(async () => ({ ok: true })),
  setPersonActive: vi.fn(async () => ({ ok: true })),
  mergePersonInto: vi.fn(async () => ({ ok: true })),
  deletePerson: vi.fn(async () => ({ ok: true })),
  sendSignInLink: vi.fn(async () => ({ ok: true, masked: 'd***@example.com', expiresMinutes: 15 })),
  addPersonEmailAction: vi.fn(async () => ({ ok: true })),
  setPersonPrimaryEmailAction: vi.fn(async () => ({ ok: true })),
  removePersonEmailAction: vi.fn(async () => ({ ok: true }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/[personId]/scout-status-actions', () => ({
  setScoutActive: vi.fn(async () => ({ ok: true }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/lookups/actions', () => ({
  updateScoutIdentity: vi.fn(async () => ({ ok: true })),
  updateScoutFields: vi.fn(async () => ({ ok: true })),
  promoteScoutToAdult: vi.fn(async () => ({ ok: true }))
}));

function email(over: Partial<PersonEmailRow> & { id: number; email: string }): PersonEmailRow {
  return {
    personId: 401,
    label: 'home',
    isPrimary: false,
    verifiedAt: null,
    bouncedAt: null,
    unsubscribedAt: null,
    ...over
  };
}

function detail(over: Partial<PersonDetail> = {}): PersonDetail {
  return {
    active: true,
    inactiveReason: null,
    tab: 'adult',
    householdId: 1,
    roles: [],
    relationships: [],
    fields: {
      first_name: 'Dana',
      last_name: 'Whitlock',
      birthdate: '1981-03-14',
      primary_email: 'dana@example.com',
      primary_phone: '(414) 555-0142',
      address_line1: '2210 N Prospect Ave',
      address_line2: null,
      city: 'Milwaukee',
      state: 'WI',
      zip: '53202',
      bsa_member_id: '137204418',
      ypt_completed: '2025-02-11',
      health_form_date: '2026-05-30',
      things_we_should_know: null
    },
    ...over
  };
}

function adultRecord(over: Partial<PersonRecordData> = {}): PersonRecordData {
  return {
    personId: 401,
    displayName: 'Dana Whitlock',
    kind: 'adult',
    tab: 'adult',
    detail: detail(),
    emails: [email({ id: 11, email: 'dana@example.com', isPrimary: true })],
    scout: null,
    gender: null,
    leader: null,
    rankLabel: null,
    household: { id: 1, label: 'Whitlock', members: [] },
    households: [
      { id: 1, label: 'Whitlock' },
      { id: 2, label: 'Raman' }
    ],
    status: { active: true, reason: null },
    pendingUpdate: false,
    today: '2026-09-07',
    ...over
  };
}

function scoutRecord(over: Partial<PersonRecordData> = {}): PersonRecordData {
  return {
    personId: 501,
    displayName: 'Milo Whitlock',
    kind: 'scout',
    tab: 'active_scout',
    detail: detail({
      tab: 'active_scout',
      fields: {
        first_name: 'Milo',
        last_name: 'Whitlock',
        birthdate: '2012-06-02',
        primary_email: null,
        primary_phone: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        zip: null,
        bsa_member_id: '140011223',
        ypt_completed: null,
        health_form_date: '2026-05-30',
        things_we_should_know: null
      }
    }),
    emails: [],
    scout: {
      id: 'W03',
      patrol: 'Falcon',
      current_rank: 'first_class',
      school: 'Riverside',
      graduation_year: 2030,
      swim_class: 'swimmer',
      active: true,
      inactive_reason: null,
      junior_leader_override: null
    },
    gender: 'M',
    leader: null,
    rankLabel: 'First Class',
    household: { id: 1, label: 'Whitlock', members: [] },
    households: [{ id: 1, label: 'Whitlock' }],
    status: { active: true, reason: null },
    pendingUpdate: false,
    today: '2026-09-07',
    ...over
  };
}

const region = (name: string) => screen.getByRole('region', { name });
const rowOf = (text: string) => within(region('Email addresses')).getByText(text).closest('li') as HTMLElement;
const dialog = () => screen.getByRole('dialog');
const statusText = (needle: string) =>
  screen.getAllByRole('status').some((el) => (el.textContent ?? '').includes(needle));

beforeEach(() => {
  nav.push.mockClear();
  nav.refresh.mockClear();
  vi.mocked(removePersonEmailAction).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(setPersonPrimaryEmailAction).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(endRole).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(mergePersonInto).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(deletePerson).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(createAdultForScout).mockClear().mockResolvedValue({ ok: true, personId: 402 });
  vi.mocked(searchPeople).mockClear().mockResolvedValue([]);
  vi.mocked(getPersonEmails).mockClear().mockResolvedValue([]);
  vi.mocked(getPersonDetail).mockClear().mockResolvedValue(detail());
});

describe('Person record — "Takes effect immediately" blocks', () => {
  it('Leader_RemovesOnlyEmail_ButtonDisabledWithReason', async () => {
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const row = rowOf('dana@example.com');
    const remove = within(row).getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.title).toBe('The only address on file — add another before removing this one');
    expect(within(region('Email addresses')).getByText('Takes effect immediately')).toBeTruthy();
  });

  it('Leader_RemovesVerifiedEmail_SeesConfirmFirst', async () => {
    const user = userEvent.setup();
    const emails = [
      email({ id: 11, email: 'dana@example.com', isPrimary: true, verifiedAt: '2026-01-05T10:00:00Z' }),
      email({ id: 12, email: 'dana.w@work.example', label: 'work', verifiedAt: '2026-02-01T10:00:00Z' })
    ];
    vi.mocked(getPersonEmails).mockResolvedValue([emails[0]]);
    render(<PersonRecord record={adultRecord({ emails })} from="adult" />);

    await user.click(within(rowOf('dana.w@work.example')).getByRole('button', { name: 'Remove' }));
    // Nothing removed yet — the confirm names the address and that it is verified.
    expect(removePersonEmailAction).not.toHaveBeenCalled();
    const dlg = dialog();
    expect(within(dlg).getByText('Remove dana.w@work.example?')).toBeTruthy();
    expect(within(dlg).getByText(/This address is verified/)).toBeTruthy();

    await user.click(within(dlg).getByRole('button', { name: 'Remove address' }));
    await waitFor(() => expect(removePersonEmailAction).toHaveBeenCalledWith(401, 12));
    await waitFor(() => expect(within(region('Email addresses')).queryByText('dana.w@work.example')).toBeNull());
    expect(statusText('Address removed.')).toBe(true);
  });

  it('Leader_MakesEmailPrimary_ListUpdates', async () => {
    const user = userEvent.setup();
    const emails = [
      email({ id: 11, email: 'dana@example.com', isPrimary: true }),
      email({ id: 12, email: 'dana.w@work.example', label: 'work' })
    ];
    vi.mocked(getPersonEmails).mockResolvedValue([
      { ...emails[0], isPrimary: false },
      { ...emails[1], isPrimary: true }
    ]);
    render(<PersonRecord record={adultRecord({ emails })} from="adult" />);

    expect(within(rowOf('dana@example.com')).getByText('primary')).toBeTruthy();
    await user.click(within(rowOf('dana.w@work.example')).getByRole('button', { name: 'Make primary' }));
    await waitFor(() => expect(setPersonPrimaryEmailAction).toHaveBeenCalledWith(401, 12));
    await waitFor(() => expect(within(rowOf('dana.w@work.example')).getByText('primary')).toBeTruthy());
    expect(within(rowOf('dana@example.com')).queryByText('primary')).toBeNull();
    expect(statusText('dana.w@work.example is now primary')).toBe(true);
  });

  it('Leader_EndsSoleLeaderRole_SeesTabMoveConfirmThenNotice', async () => {
    const user = userEvent.setup();
    const roles = [{ id: 5, role: 'adult_leader', start_date: '2023-09-01', end_date: null }];
    const record = adultRecord({
      kind: 'leader',
      tab: 'leader',
      detail: detail({ tab: 'leader', roles }),
      leader: { code: 'DW', canLogin: true }
    });
    vi.mocked(getPersonDetail).mockResolvedValue(
      detail({ tab: 'adult', roles: [{ ...roles[0], end_date: '2026-09-07' }] })
    );
    render(<PersonRecord record={record} from="leader" />);

    const rolesSection = region('Roles');
    await user.click(within(rolesSection).getByRole('button', { name: 'End…' }));
    expect(endRole).not.toHaveBeenCalled();
    const dlg = dialog();
    expect(within(dlg).getByText('End Adult leader for Dana Whitlock?')).toBeTruthy();
    expect(within(dlg).getByText(/move from Leaders to Adults/)).toBeTruthy();

    await user.click(within(dlg).getByRole('button', { name: 'End role' }));
    await waitFor(() => expect(endRole).toHaveBeenCalledWith(5));
    await waitFor(() => expect(statusText('Dana Whitlock now appears under Adults')).toBe(true));
    expect(within(region('Roles')).getByText('Previously held')).toBeTruthy();
  });

  it('Leader_AddsRelationship_ExistingEmailLinksInsteadOfCreating', async () => {
    const user = userEvent.setup();
    vi.mocked(createAdultForScout).mockResolvedValue({ ok: true, personId: 402, linked: true });
    vi.mocked(getPersonDetail).mockResolvedValue(
      detail({
        tab: 'active_scout',
        relationships: [{ id: 31, outgoing: false, type: 'parent_of', isGuardian: true, otherName: 'Priya Raman' }]
      })
    );
    render(<PersonRecord record={scoutRecord()} from="active_scout" />);

    const family = region('Parents & guardians');
    await user.click(within(family).getByRole('button', { name: '+ Add parent / guardian' }));
    await user.click(within(family).getByRole('button', { name: '+ New adult' }));
    await user.type(within(family).getByLabelText(/^Name/), 'Priya Raman');
    await user.type(within(family).getByLabelText(/^Email/), 'priya@example.com');
    await user.click(within(family).getByRole('button', { name: 'Add and link' }));

    await waitFor(() =>
      expect(createAdultForScout).toHaveBeenCalledWith(501, 'Priya Raman', 'priya@example.com', '', 'parent_of', true)
    );
    await waitFor(() => expect(statusText('linked them instead of creating a duplicate')).toBe(true));
    expect(within(region('Parents & guardians')).getByText('Priya Raman')).toBeTruthy();
  });
});

describe('Person record — Danger zone and Send sign-in link', () => {
  it('Leader_MergesPerson_SeesConfirmNamingWhatMoves', async () => {
    const user = userEvent.setup();
    vi.mocked(searchPeople).mockResolvedValue([{ id: 402, display_name: 'Priya Raman', primary_email: 'priya@example.com' }]);
    render(<PersonRecord record={adultRecord()} from="adult" />);

    const danger = region('Danger zone');
    await user.click(within(danger).getByRole('button', { name: 'Show' }));
    await user.type(within(danger).getByLabelText('Merge into'), 'Pri');
    await user.click(await within(danger).findByRole('button', { name: /Priya Raman/ }));

    expect(mergePersonInto).not.toHaveBeenCalled();
    const dlg = dialog();
    expect(within(dlg).getByText('Merge Dana Whitlock into Priya Raman?')).toBeTruthy();
    const body = dlg.textContent ?? '';
    for (const moved of ['email address', 'relationship', 'role', 'Household', 'Ledger']) {
      expect(body, `confirm names ${moved}`).toContain(moved);
    }
    await user.click(within(dlg).getByRole('button', { name: 'Merge into Priya Raman' }));
    await waitFor(() => expect(mergePersonInto).toHaveBeenCalledWith(401, 402));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/advancement/roster/402?from=adult'));
  });

  it('Leader_DeletesPersonWithAttachments_ButtonRefusedWithReason', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={scoutRecord()} from="active_scout" />);

    const danger = region('Danger zone');
    await user.click(within(danger).getByRole('button', { name: 'Show' }));
    const del = within(danger).getByRole('button', { name: 'Delete this person…' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.title).toMatch(/scout record/);
    expect(within(danger).getByText(/Refused while anything is attached/).textContent).toMatch(/scout record/);
    await user.click(del);
    expect(deletePerson).not.toHaveBeenCalled();
  });

  it('Leader_SendsSignInLink_NoDeliverableAddress_ButtonDisabled', () => {
    render(<PersonRecord record={scoutRecord()} from="active_scout" />);
    const send = screen.getByRole('button', { name: 'Send sign-in link' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toBe('No email on file — signs in through a parent');
  });
});

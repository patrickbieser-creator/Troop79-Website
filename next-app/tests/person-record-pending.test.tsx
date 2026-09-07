import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonRecord } from '../src/app/admin/(workspace)/advancement/roster/[personId]/person-record';
import type {
  FamilyNotice,
  PendingChangeRequest,
  PersonRecord as PersonRecordData
} from '../src/app/admin/(workspace)/advancement/roster/[personId]/record-types';
import { approveChangeRequest, rejectChangeRequest } from '../src/app/admin/(workspace)/advancement/roster/change-request-actions';
import type { PersonDetail } from '../src/app/admin/(workspace)/advancement/roster/person-actions';

/**
 * Person Editor Rethink, Phase 5 (Plans/Person-Editor-Rethink.md) — the
 * family's pending update rendered INSIDE the section it touches. A request
 * that changes phone + birthdate puts a banner in Contact & sign-in AND in
 * Details, each listing only its own fields; nothing in Identity or
 * Household & family. Approve / Reject from any one section act on the
 * WHOLE request (change_requests is one row, D-098/D-103), and the copy
 * says so when the request also touches other sections. The "Added by a
 * family — not yet acknowledged" notice sits at the top of the main column
 * with a single Acknowledge.
 *
 * The mock boundary is the server action (Tests/CLAUDE.md).
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
  updateScoutFields: vi.fn(async () => ({ ok: true }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/change-request-actions', () => ({
  getPendingChangeRequest: vi.fn(async () => null),
  approveChangeRequest: vi.fn(async () => ({ ok: true })),
  rejectChangeRequest: vi.fn(async () => ({ ok: true }))
}));

beforeEach(() => {
  nav.refresh.mockClear();
  vi.mocked(approveChangeRequest).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(rejectChangeRequest).mockClear().mockResolvedValue({ ok: true });
});

function detail(over: Partial<PersonDetail>): PersonDetail {
  return {
    active: true,
    inactiveReason: null,
    tab: 'adult',
    householdId: 1,
    roles: [],
    relationships: [],
    fields: {},
    ...over
  };
}

function adultRecord(over: Partial<PersonRecordData> = {}): PersonRecordData {
  return {
    personId: 401,
    displayName: 'Dana Whitlock',
    kind: 'adult',
    tab: 'adult',
    detail: detail({
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
      }
    }),
    emails: [],
    scout: null,
    gender: null,
    leader: null,
    rankLabel: null,
    household: { id: 1, label: 'Whitlock', members: [] },
    households: [{ id: 1, label: 'Whitlock' }],
    status: { active: true, reason: null },
    pendingUpdate: false,
    pending: null,
    familyNotice: null,
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
        primary_phone: '(414) 555-0190',
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
    pendingUpdate: true,
    pending: null,
    familyNotice: null,
    today: '2026-09-07',
    ...over
  };
}

const adultRequest = (): PendingChangeRequest => ({
  id: 77,
  entityType: 'adult',
  submittedAt: '2026-09-04T19:22:00Z',
  submittedByName: 'Marcus Whitlock',
  proposed: { primary_phone: '(414) 555-0199', birthdate: '1981-03-15' }
});

const scoutRequest = (): PendingChangeRequest => ({
  id: 88,
  entityType: 'scout',
  submittedAt: '2026-09-05T21:03:00Z',
  submittedByName: 'Priya Raman',
  proposed: { phone: '(414) 555-0191', birthdate: '2012-06-03' }
});

const notice = (): FamilyNotice => ({
  id: 91,
  submittedAt: '2026-09-01T08:10:00Z',
  submittedByName: 'Jamal Okafor',
  fields: { name: 'Rosalind Achebe', relationship: 'Grandmother', primary_email: null, primary_phone: '(414) 555-0131' }
});

const section = (name: string) => screen.getByRole('region', { name });
const bannerIn = (name: string) => within(section(name)).queryByRole('heading', { name: /Pending update from the family/ });

describe('Person record — pending update banners live in the section they touch', () => {
  it('Family_SubmitsChangeRequest_BannerAppearsInTouchedSection', () => {
    render(<PersonRecord record={scoutRecord({ pending: scoutRequest() })} from="active_scout" />);

    expect(bannerIn('Contact & sign-in')).toBeTruthy();
    expect(bannerIn('Details')).toBeTruthy();
    expect(bannerIn('Identity')).toBeNull();
    expect(bannerIn('Household & family')).toBeNull();

    // Each banner lists only its own section's fields, current beside proposed.
    const contact = section('Contact & sign-in');
    const phoneRow = within(contact).getByRole('row', { name: /Phone/ });
    expect(within(phoneRow).getByText('(414) 555-0190')).toBeTruthy();
    expect(within(phoneRow).getByText('(414) 555-0191')).toBeTruthy();
    expect(within(contact).queryByRole('row', { name: /Birthdate/ })).toBeNull();
    const details = section('Details');
    expect(within(details).getByRole('row', { name: /Birthdate/ })).toBeTruthy();
    expect(within(details).queryByRole('row', { name: /Phone/ })).toBeNull();
    expect(within(contact).getByText(/Priya Raman/)).toBeTruthy();

    // Phase 1's "open from the roster list" notice is gone.
    expect(screen.queryByText(/roster list/)).toBeNull();
  });

  it('Leader_ApprovesFromOneSection_AppliesEntireRequest', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord({ pending: adultRequest() })} from="adult" />);
    const contact = section('Contact & sign-in');

    // The copy says the click acts on the whole request and names the other section.
    expect(within(contact).getByText(/This request also changes Details/)).toBeTruthy();
    await user.click(within(contact).getByRole('button', { name: 'Approve all 2 changes' }));

    await waitFor(() => expect(approveChangeRequest).toHaveBeenCalledTimes(1));
    expect(approveChangeRequest).toHaveBeenCalledWith(77);
    await waitFor(() => expect(bannerIn('Contact & sign-in')).toBeNull());
    expect(bannerIn('Details')).toBeNull();
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('Leader_RejectsWithReason_ReasonIsSent', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord({ pending: adultRequest() })} from="adult" />);
    const details = section('Details');

    expect(within(details).queryByLabelText(/Reason/)).toBeNull();
    await user.click(within(details).getByRole('button', { name: 'Reject all 2 changes…' }));
    await user.type(within(details).getByLabelText(/Reason/), 'Please use the address on the BSA application');
    await user.click(within(details).getByRole('button', { name: 'Confirm reject' }));

    await waitFor(() => expect(rejectChangeRequest).toHaveBeenCalledTimes(1));
    expect(rejectChangeRequest).toHaveBeenCalledWith(77, 'Please use the address on the BSA application');
    await waitFor(() => expect(bannerIn('Details')).toBeNull());
    expect(bannerIn('Contact & sign-in')).toBeNull();
    expect(approveChangeRequest).not.toHaveBeenCalled();
  });

  it('Leader_AcknowledgesFamilyAddedNotice', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord({ familyNotice: notice() })} from="adult" />);

    const box = screen.getByRole('region', { name: /Added by a family/ });
    expect(within(box).getByText(/Jamal Okafor/)).toBeTruthy();
    expect(within(box).getByText(/Grandmother/)).toBeTruthy();
    // A notice is acknowledged, never rejected — there is nothing to undo.
    expect(within(box).queryByRole('button', { name: /Reject/ })).toBeNull();
    await user.click(within(box).getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => expect(approveChangeRequest).toHaveBeenCalledWith(91));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Added by a family/ })).toBeNull());
    expect(nav.refresh).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonRecord } from '../src/app/admin/(workspace)/advancement/roster/[personId]/person-record';
import type { PersonRecord as PersonRecordData } from '../src/app/admin/(workspace)/advancement/roster/[personId]/record-types';
import { previewPersonRecordSave, savePersonRecord } from '../src/app/admin/(workspace)/advancement/roster/[personId]/save-record-actions';
import type { RecordDraft } from '../src/app/admin/(workspace)/advancement/roster/[personId]/record-draft';

/**
 * One form, one Save (Plans/Person-Record-One-Save.md): every field on the record page is
 * always editable and joins one draft; the sticky record bar's Save sends the whole draft to
 * savePersonRecord once; Discard returns everything to the last saved state; a blocked save
 * says why beside the button; More actions holds merge / delete; the rail lists what is
 * left to fill in. The mock boundary is the server action (Tests/CLAUDE.md).
 */
const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/advancement/roster/401',
  useSearchParams: () => new URLSearchParams('')
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/[personId]/save-record-actions', () => ({
  savePersonRecord: vi.fn(async () => ({ ok: true, links: [] })),
  previewPersonRecordSave: vi.fn(async () => ({ also: [] })),
  searchFamilyCandidates: vi.fn(async () => [])
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/person-actions', () => ({
  deletePerson: vi.fn(async () => ({ ok: true })),
  mergePersonInto: vi.fn(async () => ({ ok: true })),
  searchPeople: vi.fn(async () => []),
  setPersonIsTest: vi.fn(async () => ({ ok: true })),
  sendSignInLink: vi.fn(async () => ({ ok: true, masked: 'd***@example.com', expiresMinutes: 20 }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/lookups/actions', () => ({
  promoteScoutToAdult: vi.fn(async () => ({ ok: true }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/lookups/school-actions', () => ({
  addSchool: vi.fn(async () => ({ ok: true }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/[personId]/history-actions', () => ({
  getPersonHistoryAction: vi.fn(async () => [])
}));

beforeEach(() => {
  vi.mocked(savePersonRecord).mockClear().mockResolvedValue({ ok: true, links: [] });
  vi.mocked(previewPersonRecordSave).mockClear().mockResolvedValue({ also: [] });
  router.refresh.mockClear();
});

function adultRecord(over: Partial<PersonRecordData> = {}): PersonRecordData {
  return {
    personId: 401,
    displayName: 'Dana Whitlock',
    kind: 'adult',
    tab: 'adult',
    detail: {
      active: true,
      inactiveReason: null,
      tab: 'adult',
      householdId: 1,
      roles: [],
      relationships: [{ id: 900, outgoing: true, type: 'parent_of', isGuardian: false, otherName: 'Rowan Whitlock' }],
      fields: {
        first_name: 'Dana',
        last_name: 'Whitlock',
        birthdate: '1981-03-14',
        primary_phone: '(414) 555-0142',
        address_line1: '2210 N Prospect Ave',
        city: 'Milwaukee',
        state: 'WI',
        zip: '53202',
        bsa_member_id: '',
        ypt_completed: null,
        health_form_date: null
      }
    },
    emails: [
      { id: 11, personId: 401, email: 'dana@example.com', label: 'home', isPrimary: true, verifiedAt: '2026-08-01T12:00:00Z', bouncedAt: null, unsubscribedAt: null },
      { id: 12, personId: 401, email: 'dana@work.example.com', label: 'work', isPrimary: false, verifiedAt: null, bouncedAt: null, unsubscribedAt: null }
    ],
    scout: null,
    gender: null,
    leader: null,
    initials: null,
    initialsSuggestion: 'DW',
    rankLabel: null,
    household: { id: 1, label: 'Whitlock', members: [] },
    households: [
      { id: 1, label: 'Whitlock' },
      { id: 2, label: 'Raman' }
    ],
    family: [
      { personId: 402, name: 'Rowan Whitlock', kind: 'scout', youth: true, inHousehold: true, active: true, links: [{ id: 900, type: 'parent_of', outgoing: true }] },
      { personId: 403, name: 'Sky Whitlock', kind: 'scout', youth: true, inHousehold: true, active: true, links: [] }
    ],
    youth: false,
    status: { active: true, reason: null },
    pendingUpdate: false,
    today: '2026-11-15',
    history: { latest: [], total: 0, withDetails: 0 },
    ...over
  };
}

function scoutRecord(): PersonRecordData {
  const base = adultRecord();
  return {
    ...base,
    personId: 402,
    displayName: 'Rowan Whitlock',
    kind: 'scout',
    tab: 'active_scout',
    detail: { ...base.detail, tab: 'active_scout', relationships: [], fields: { first_name: 'Rowan', last_name: 'Whitlock', health_form_date: '2026-06-01' } },
    emails: [],
    scout: {
      id: 'F01',
      patrol: 'Hawks',
      current_rank: 'tenderfoot',
      school_id: null,
      school: null,
      graduation_year: 2031,
      swim_class: 'swimmer',
      active: true,
      inactive_reason: null,
      junior_leader_override: null
    },
    family: [],
    youth: true,
    schools: []
  } as PersonRecordData;
}

const bar = () => screen.getByRole('region', { name: 'Record actions' });
const lastDraft = (): RecordDraft => vi.mocked(savePersonRecord).mock.calls.at(-1)![1];

describe('Person record — one form, one Save', () => {
  it('Leader_SeesSaved_WhenNothingChanged', () => {
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const save = within(bar()).getByRole('button', { name: 'Saved' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('Leader_SeesSaveChangesAndCount_WhenDirty', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const phone = screen.getByLabelText('Phone');
    await user.clear(phone);
    await user.type(phone, '414-555-0000');
    expect(within(bar()).getByText(/1 unsaved change/).parentElement?.textContent).toContain('Phone');
    expect((within(bar()).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Leader_SavesEveryChangeAtOnce_WhenFieldsAcrossSectionsEdited', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    await user.clear(screen.getByLabelText('Last name'));
    await user.type(screen.getByLabelText('Last name'), 'Whitlock-Ray');
    await user.type(screen.getByLabelText('Add an email address'), 'dana@new.example.com');
    await user.click(screen.getByRole('button', { name: '+ Email' }));
    await user.selectOptions(screen.getByLabelText('Grant a role'), 'committee_member');
    await user.selectOptions(screen.getByLabelText('Household'), '2');
    await user.click(within(bar()).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(savePersonRecord).toHaveBeenCalledTimes(1));
    const d = lastDraft();
    expect([d.f.last_name, d.emails.map((e) => e.email), d.roles, d.householdId]).toEqual([
      'Whitlock-Ray',
      ['dana@example.com', 'dana@work.example.com', 'dana@new.example.com'],
      ['committee_member'],
      '2'
    ]);
  });

  it('Leader_GetsLastSavedState_WhenDiscarding', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const emails = screen.getByRole('list', { name: 'Email addresses' });
    await user.click(within(emails).getAllByRole('button', { name: 'Remove' })[1]);
    await user.selectOptions(screen.getByLabelText('How Dana Whitlock and Rowan Whitlock are related'), '');
    await user.click(within(bar()).getByRole('button', { name: 'Discard changes' }));

    expect([
      within(screen.getByRole('list', { name: 'Email addresses' })).queryByText('removed on save'),
      (screen.getByLabelText('How Dana Whitlock and Rowan Whitlock are related') as HTMLSelectElement).value,
      (within(bar()).getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled
    ]).toEqual([null, 'parent_of>', true]);
  });

  it('Leader_MustPickReason_WhenMarkingScoutInactive', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={scoutRecord()} from="active_scout" />);
    await user.click(screen.getByRole('radio', { name: 'Inactive' }));
    await user.click(within(bar()).getByRole('button', { name: 'Save changes' }));
    expect([within(bar()).getByRole('alert').textContent, vi.mocked(savePersonRecord).mock.calls.length]).toEqual([
      'Can’t save yet: Pick why the scout is inactive',
      0
    ]);
  });

  it('Leader_SeesToFinishItems_WhenYptAndHealthMissing', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const rail = screen.getByRole('region', { name: 'To finish' });
    expect(within(rail).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'YPT not on file',
      'Health form missing',
      'No BSA ID',
      'No role (optional)'
    ]);
    await user.click(within(rail).getByRole('button', { name: 'YPT not on file' }));
    expect(document.activeElement?.id).toBe('pr-ypt_completed');
  });

  it('Leader_FindsMergeAndDelete_InMoreActionsMenu', () => {
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const menu = within(bar()).getByRole('combobox', { name: 'More actions for Dana Whitlock' });
    const labels = within(menu).getAllByRole('option').map((o) => o.textContent);
    expect([labels.includes('Merge with another person…'), labels.at(-1), screen.queryByText('Danger zone')]).toEqual([
      true,
      'Delete Dana Whitlock…',
      null
    ]);
  });

  it('Leader_SeesWhatElseSaveDoes_WhenAParentLinkCascades', async () => {
    vi.mocked(previewPersonRecordSave).mockResolvedValue({
      also: [{ person_id: 401, person_name: 'Dana Whitlock', related_person_id: 403, related_name: 'Sky Whitlock', type: 'parent_of', change: 'added' }]
    });
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    await user.selectOptions(screen.getByLabelText('How Dana Whitlock and Sky Whitlock are related'), 'guardian_of>');
    expect(await within(bar()).findByText(/Saving will also link Dana Whitlock as parent of Sky Whitlock/)).toBeTruthy();
  });

  it('Leader_CantSendSignInLink_WhileEmailsHaveUnsavedChanges', async () => {
    const user = userEvent.setup();
    render(<PersonRecord record={adultRecord()} from="adult" />);
    await user.click(within(screen.getByRole('list', { name: 'Email addresses' })).getAllByRole('button', { name: 'Remove' })[1]);
    const send = within(bar()).getByRole('button', { name: 'Send sign-in link' }) as HTMLButtonElement;
    expect([send.disabled, send.title]).toEqual([true, 'Save the email changes first']);
  });

  it('Leader_SeesTheDraftReset_AfterASave', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PersonRecord record={adultRecord()} from="adult" />);
    await user.clear(screen.getByLabelText('Phone'));
    await user.type(screen.getByLabelText('Phone'), '414-555-0000');
    await user.click(within(bar()).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const next = adultRecord();
    next.detail.fields.primary_phone = '414-555-0000';
    rerender(<PersonRecord record={next} from="adult" />);
    expect((within(bar()).getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

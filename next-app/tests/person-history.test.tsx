import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonRecord } from '../src/app/admin/(workspace)/advancement/roster/[personId]/person-record';
import type {
  PersonHistoryEntry,
  PersonRecord as PersonRecordData
} from '../src/app/admin/(workspace)/advancement/roster/[personId]/record-types';
import { loadFullHistory } from '../src/app/admin/(workspace)/advancement/roster/[personId]/history-actions';
import type { PersonDetail } from '../src/app/admin/(workspace)/advancement/roster/person-actions';

/**
 * Person record History (Plans/Person-Record-One-Save.md; first built in
 * Person-Editor-Rethink Phase 4): the record bar's "Last change … · History (N)",
 * the rail's Recent changes (latest 3), fed by audit_log filtered to this person. One line per change; the
 * chip on a row carries the field-level old → new as a hover tooltip AND
 * opens it as a Field / Was / Now table; "Full log" opens every entry,
 * newest first; an entry logged before the cutover (details null) shows
 * summary only with a fallback line in the detail view.
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
  updateScoutFields: vi.fn(async () => ({ ok: true })),
  promoteScoutToAdult: vi.fn(async () => ({ ok: true }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/[personId]/history-actions', () => ({
  loadFullHistory: vi.fn(async () => [])
}));

function entry(over: Partial<PersonHistoryEntry> & { id: number; occurredAt: string }): PersonHistoryEntry {
  return {
    actorLabel: 'Priya Raman',
    actorPersonId: 7,
    action: 'update',
    summary: 'Updated something',
    details: null,
    ...over
  };
}

// Six entries, oldest → newest by id; the page shows the latest four.
const ENTRIES: PersonHistoryEntry[] = [
  entry({ id: 1, occurredAt: '2024-08-30T15:00:00Z', actorLabel: 'Import', summary: 'Created from the roster spreadsheet' }),
  entry({
    id: 2,
    occurredAt: '2025-02-12T15:00:00Z',
    summary: "Updated Dana Whitlock's demographics (fields: ypt_completed)",
    details: [{ field: 'YPT completed', from: '—', to: 'Feb 11, 2025' }]
  }),
  entry({
    id: 3,
    occurredAt: '2026-06-02T15:00:00Z',
    actorLabel: 'ZZ Old Leader',
    summary: "Updated Dana Whitlock's demographics (fields: primary_phone)"
  }),
  entry({
    id: 4,
    occurredAt: '2026-08-15T15:00:00Z',
    summary: 'Ended role — Committee member',
    details: [{ field: 'Committee member', from: 'since Sep 1, 2021', to: 'ended Aug 15, 2026' }]
  }),
  entry({
    id: 5,
    occurredAt: '2026-08-16T15:00:00Z',
    summary: 'Set person 401 inactive — Status, Reason',
    details: [
      { field: 'Status', from: 'Active', to: 'Inactive' },
      { field: 'Reason', from: '—', to: 'Moved to Madison, Aug 2026' }
    ]
  }),
  entry({
    id: 6,
    occurredAt: '2026-08-20T15:00:00Z',
    actorLabel: 'system',
    summary: 'Marked email bounced',
    details: [{ field: 'g.tomasek@oldmail.example', from: 'deliverable', to: 'bounced Aug 20, 2026' }]
  })
];
const NEWEST_FIRST = [...ENTRIES].reverse();

function detail(): PersonDetail {
  return {
    active: false,
    inactiveReason: 'Moved to Madison, Aug 2026',
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
    }
  };
}

function adultRecord(): PersonRecordData {
  return {
    personId: 401,
    displayName: 'Dana Whitlock',
    kind: 'adult',
    tab: 'adult',
    detail: detail(),
    emails: [
      {
        id: 11,
        personId: 401,
        email: 'dana@example.com',
        label: 'home',
        isPrimary: true,
        verifiedAt: null,
        bouncedAt: null,
        unsubscribedAt: null
      }
    ],
    scout: null,
    gender: null,
    leader: null,
    initials: null,
    initialsSuggestion: '',
    rankLabel: null,
    household: { id: 1, label: 'Whitlock', members: [] },
    households: [{ id: 1, label: 'Whitlock' }],
    status: { active: false, reason: 'Moved to Madison, Aug 2026' },
    pendingUpdate: false,
    today: '2026-09-07',
    history: { latest: NEWEST_FIRST.slice(0, 4), total: 6, withDetails: 4 }
  };
}

function recent() {
  return screen.getByRole('region', { name: 'Recent changes' });
}
const recordBar = () => screen.getByRole('region', { name: 'Record actions' });

describe('History — record bar, Recent changes and the full log', () => {
  it('Leader_SeesLastChangeAndCount_InRecordBar', () => {
    render(<PersonRecord record={adultRecord()} from="adult" />);
    expect(recordBar().textContent).toContain('Last change Aug 20, 2026 by system');
    expect(within(recordBar()).getByRole('button', { name: 'History (6)' })).toBeTruthy();
  });

  it('Leader_SeesLatestThree_InRecentChanges', () => {
    render(<PersonRecord record={adultRecord()} from="adult" />);
    const rows = within(recent()).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect([rows.length, rows[0]]).toEqual([3, expect.stringContaining('Marked email bounced')]);
  });

  it('Leader_OpensFullLog_SeesAllEntriesNewestFirst', async () => {
    vi.mocked(loadFullHistory).mockResolvedValueOnce(NEWEST_FIRST);
    render(<PersonRecord record={adultRecord()} from="adult" />);
    await userEvent.click(within(recent()).getByRole('button', { name: 'All 6 changes' }));

    const dialog = await screen.findByRole('dialog', { name: /History — Dana Whitlock/ });
    await waitFor(() => expect(within(dialog).getAllByRole('listitem')).toHaveLength(6));
    const rows = within(dialog).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect([rows[0], rows[5]]).toEqual([
      expect.stringContaining('Marked email bounced'),
      expect.stringContaining('Created from the roster spreadsheet')
    ]);
  });

  it('Leader_ClicksRecentEntry_SeesFieldWasNowTable', async () => {
    render(<PersonRecord record={adultRecord()} from="adult" />);
    await userEvent.click(within(recent()).getByRole('button', { name: /Set person 401 inactive/ }));
    const dialog = await screen.findByRole('dialog', { name: /Set person 401 inactive/ });
    const rows = within(within(dialog).getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').map((td) => td.textContent))).toEqual([
      ['Status', 'Active', 'Inactive'],
      ['Reason', '—', 'Moved to Madison, Aug 2026']
    ]);
  });

  it('Leader_ViewsPreCutoverEntry_SeesNoDetailFallback', async () => {
    const rec = adultRecord();
    rec.history = { latest: [ENTRIES[2]], total: 6, withDetails: 4 };
    render(<PersonRecord record={rec} from="adult" />);
    await userEvent.click(within(recent()).getByRole('button', { name: /primary_phone/ }));
    const dialog = await screen.findByRole('dialog', { name: /primary_phone/ });
    expect(within(dialog).getByText('No field-level detail recorded for this entry.')).toBeTruthy();
  });

  it('Leader_ClicksChipInsideFullLog_SeesDetail_ThenBackReturnsToLog', async () => {
    vi.mocked(loadFullHistory).mockResolvedValueOnce(NEWEST_FIRST);
    render(<PersonRecord record={adultRecord()} from="adult" />);
    await userEvent.click(within(recordBar()).getByRole('button', { name: 'History (6)' }));
    const dialog = await screen.findByRole('dialog', { name: /History — Dana Whitlock/ });
    await waitFor(() => expect(within(dialog).getAllByRole('listitem')).toHaveLength(6));

    const chips = within(dialog).getAllByRole('button', { name: /^1 field changed/ });
    await userEvent.click(chips[chips.length - 1]); // the oldest — entry 2, YPT
    expect(within(dialog).getByRole('cell', { name: 'YPT completed' })).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Back to log' }));
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(6);
  });
});

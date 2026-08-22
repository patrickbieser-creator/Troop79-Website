import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildCarManifests,
  buildContacts,
  buildCounts,
  buildMoneyLines,
  buildOtherSets,
  buildRosterSections,
  printableQuestions,
  type SnapshotInput,
  type SnapshotPerson
} from '../src/lib/event-snapshot';

/**
 * Event snapshot (Plans/Event-Logistics.md §E) — the sheet's one tab as a
 * document, shaped by pure functions. No medical content, ever; leader
 * free-text columns only when the leader says so.
 */
function person(over: Partial<SnapshotPerson> & { entryId: number; name: string }): SnapshotPerson {
  return {
    classLabel: 'Scout',
    isYouth: true,
    status: 'yes',
    participation: 'full',
    grade: '8th',
    phone: '(414) 555-0100',
    email: null,
    household: 'Porter',
    drivesOut: false,
    drivesBack: false,
    vehicleSeatsOut: null,
    vehicleSeatsBack: null,
    rideOut: 'needs_ride',
    rideBack: 'needs_ride',
    slipReceived: false,
    owed: 30,
    paid: 0,
    balance: 30,
    notes: null,
    leaderAnswers: {},
    answers: {},
    ...over
  };
}

const driver = person({
  entryId: 1,
  name: 'Jason Porter',
  classLabel: 'Adult',
  isYouth: false,
  grade: null,
  email: 'j@x.com',
  drivesOut: true,
  vehicleSeatsOut: 4,
  rideOut: null,
  rideBack: 'self',
  owed: 30,
  paid: 30,
  balance: 0
});
const input: SnapshotInput = {
  title: 'Pinewoods Campout',
  dateLabel: 'Sep 19–21, 2025',
  location: 'Pinewoods',
  people: [
    driver,
    person({ entryId: 2, name: 'Anjali' }),
    person({ entryId: 3, name: 'Owen', paid: 30, balance: 0 }),
    person({ entryId: 4, name: 'Violet', rideOut: 'meeting_there' }),
    person({ entryId: 5, name: 'Gone', status: 'cancelled' }),
    person({ entryId: 6, name: 'Mindy', classLabel: 'Adult', isYouth: false, participation: 'driver_only', drivesOut: true, vehicleSeatsOut: 2, rideOut: null, rideBack: 'not_traveling', owed: 0, balance: 0 })
  ],
  questions: [
    { id: 10, prompt: 'Shoe size', inputType: 'text', leaderOnly: false, printAllowed: false },
    { id: 11, prompt: 'Health form in hand', inputType: 'choice', leaderOnly: true, printAllowed: false },
    { id: 12, prompt: 'Meds', inputType: 'text', leaderOnly: true, printAllowed: false },
    { id: 13, prompt: 'Tent plan', inputType: 'text', leaderOnly: true, printAllowed: true }
  ],
  sets: [
    { id: 1, label: 'Patrols', kind: 'patrol', leg: null, groups: [
      { id: 100, name: 'Kraken', capacity: null, driverEntryId: null, notes: null, memberEntryIds: [2] },
      { id: 101, name: 'Fire Quackers', capacity: null, driverEntryId: null, notes: null, memberEntryIds: [4] }
    ] },
    { id: 2, label: 'Cars there', kind: 'car', leg: 'out', groups: [
      { id: 200, name: 'Jason Porter', capacity: 4, driverEntryId: 1, notes: 'pulling trailer', memberEntryIds: [1, 2] },
      { id: 201, name: 'Mindy', capacity: 2, driverEntryId: 6, notes: null, memberEntryIds: [6] }
    ] },
    { id: 3, label: 'Tents', kind: 'tent', leg: null, groups: [
      { id: 300, name: 'Tent A', capacity: 2, driverEntryId: null, notes: null, memberEntryIds: [2, 3] }
    ] }
  ],
  expenses: [{ occurredOn: '2025-09-17', amount: -534.71, memo: 'Food — Pick n Save', method: 'other' }],
  reimbursements: [{ requesterName: 'Mindy', amount: 534.71, status: 'submitted', description: 'Food' }],
  milestones: [{ label: 'Campout fee', dueOn: '2025-09-12', amount: 30, kind: 'payment' }],
  incomeByMethod: { venmo: 60 },
  totals: { owed: 120, paid: 60, due: 60, income: 60, expenses: 534.71, reimbursementsPending: 534.71, net: -1009.42 }
};

describe('printableQuestions', () => {
  it('LeaderOnlyTextColumn_IsExcludedFromSnapshotAndCsv_UnlessPrintAllowed', () => {
    expect(printableQuestions(input.questions).map((q) => q.id)).toEqual([10, 11, 13]);
  });
});

describe('roster sections', () => {
  it('RosterSections_GroupByThePatrolSet_AndListTheRestLast', () => {
    const s = buildRosterSections(input);
    expect(s.map((x) => [x.heading, x.rows.map((r) => r.name)])).toEqual([
      ['Fire Quackers', ['Violet']],
      ['Kraken', ['Anjali']],
      ['Not in a patrol', ['Jason Porter', 'Mindy', 'Owen']]
    ]);
  });

  it('RosterSections_AreFlat_WhenThereIsNoPatrolOrCrewSet', () => {
    const s = buildRosterSections({ ...input, sets: input.sets.filter((x) => x.kind !== 'patrol') });
    expect(s).toHaveLength(1);
    expect(s[0].rows.map((r) => r.name)).toEqual(['Anjali', 'Jason Porter', 'Mindy', 'Owen', 'Violet']);
  });
});

describe('car manifests', () => {
  it('CarManifests_ListDriverPhoneRidersUnplacedAndOnTheirOwn_PerLeg', () => {
    const m = buildCarManifests(input);
    expect(m).toHaveLength(1); // only an out set in the fixture
    const out = m[0];
    expect(out.cars.map((c) => [c.driverName, c.driverPhone, c.capacity, c.notes, c.riders])).toEqual([
      ['Jason Porter', '(414) 555-0100', 4, 'pulling trailer', ['Anjali']],
      ['Mindy', '(414) 555-0100', 2, null, []]
    ]);
    expect(out.unplaced).toEqual(['Owen']);
    expect(out.onTheirOwn).toEqual([{ name: 'Violet', how: 'Meeting there' }]);
  });
});

describe('other sets, contacts, money, counts', () => {
  it('OtherSets_ExcludeCarsAndThePatrolSet', () => {
    expect(buildOtherSets(input)).toEqual([{ label: 'Tents', groups: [{ name: 'Tent A', capacity: 2, members: ['Anjali', 'Owen'] }] }]);
  });

  it('Contacts_ShowAdultEmail_ButNotAYouths', () => {
    const c = buildContacts(input);
    expect(c.find((x) => x.name === 'Jason Porter')?.email).toBe('j@x.com');
    expect(c.find((x) => x.name === 'Anjali')?.email).toBeNull();
    expect(c.find((x) => x.name === 'Anjali')?.role).toBe('Scout · 8th · Porter');
    expect(c.some((x) => x.name === 'Gone')).toBe(false);
  });

  it('MoneyLines_ListWhoStillOwes_AndThePL', () => {
    const m = buildMoneyLines(input);
    expect(m.stillOwe).toEqual([
      { name: 'Anjali', balance: 30 },
      { name: 'Violet', balance: 30 }
    ]);
    expect(m.incomeLines).toEqual(['venmo: $60']);
    expect(m.pl[2]).toBe('Cost to the troop $1009.42');
  });

  it('Counts_MatchTheSheetsCountsBlock', () => {
    expect(buildCounts(input)).toEqual([
      { label: 'Youth', value: 3 },
      { label: 'Adults', value: 1 },
      { label: 'Adult', value: 1 },
      { label: 'Scout', value: 3 },
      { label: 'Driver-only', value: 1 },
      { label: 'Total', value: 4 }
    ]);
  });
});

describe('no medical content', () => {
  it('Snapshot_ContainsEverySection_AndNoMedicalContent', () => {
    // Guard, not decoration: the document leaves the building on paper.
    const json = JSON.stringify({
      sections: buildRosterSections(input),
      cars: buildCarManifests(input),
      other: buildOtherSets(input),
      contacts: buildContacts(input),
      money: buildMoneyLines(input),
      counts: buildCounts(input),
      questions: printableQuestions(input.questions)
    });
    expect(json).not.toMatch(/things_we_should_know|allerg|medical|Meds/i);
    const src = readFileSync('src/lib/event-snapshot.ts', 'utf8');
    expect(src).not.toMatch(/things_we_should_know/);
  });
});

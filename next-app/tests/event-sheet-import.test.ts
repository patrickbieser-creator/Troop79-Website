import { describe, it, expect } from 'vitest';
import {
  buildImportPlan,
  cleanSheetTitle,
  parseEventSheet,
  sheetDateToISO,
  type ResolvedPerson,
  type SheetRow
} from '../src/lib/event-sheet-import';

/**
 * Event Logistics Phase 5 — the campout sheet tab as pure functions
 * (Plans/Event-Logistics.md §F). Fixture is a SANITIZED excerpt of the
 * Pinewoods '25 layout: same columns, same summary blocks, invented people.
 */
const TAB: SheetRow[] = [
  ['Maple Campout - Sept 2025', '', '', '', '', '', '', '', '', '', 'DRIVER'],
  ['', '', '', '', '', '', '', '', '', '', 'Seats', 'Seats', '', '', '', 'Venmo', 'Wreath'],
  ['', 'Age', 'Grade', 'NAME', '', 'Car To', 'Car Back', '', 'Patrol', '', 'Out', 'Back', 'Notes', 'Ck', '$$', 'PPal', 'Cans', 'eMail', 'Phone'],
  ['A', '', '', 'Pat', 'Driver', '', '', '', '', '', 4, 4, '', '', 30, '', '', 'pat@example.com', '(555) 000-0001'],
  ['A', '', '', 'Mo', 'Vanrider', '', '', '', '', '', 3, '', 'Reimb less fees', '', '', 30, '', 'mo@example.com', ''],
  ['JL', 16, 11, 'Vera', 'Lead', '', '', '', 'Screaming Eagles', '', '', '', '', '', '', 30, '', '', ''],
  ['S', 14, 8, 'Ana', 'Scout', 'Pat', 'Pat', '', 'Fire Quackers', '', '', '', '', '', 30, '', '', 'ana@example.com', ''],
  ['S', 13, 8, 'Xan', 'Guest', '', '', '', 'Shooting Star', '', '', '', 'Pd by Pat', '', '', 30, '', '', ''],
  ['AOL', '', '', 'Lil', 'Webelo', 'Nobody', '', '', 'Fire Quackers', '', '', '', '', '', '', 30, '', '', ''],
  ['S', 12, 6, 'Unk', 'Nown', '', '', '', 'Kraken', '', '', '', '', 15, '', '', '', '', ''],
  [],
  [],
  ['Counts', '', '', '', '', '', '', '', '', '', 'Patrol Count', 'Assigned', '', '', '', 'Venmo'],
  ['Adults', 2, '', '', '', 'Need', 'Need', 'Avail', 'Avail', '', 'Kraken', 1, '', 'Checks', '$$', 'Paypal', 'Cans', 'Expenses', 'Date ', 'Note'],
  ['Scouts', 3, '', '', '', 'Out', 'Back', 'Out', 'Back', '', 'Screaming Eagles', 1, '', 0, 60, 120, 0, 534.71, 45917, 'Food - Store - Mo'],
  ['JLs', 1, '', '', '', 'Seats', 'Seats', 'Seats', 'Seats', '', 'Fire Quackers', 2, '', '', '', '', '', 187, 45694, 'Group Site C under Pat Driver'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', -60, 45919, 'Pat and Ana Campout Fee'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 314, 'Paid to Pat'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 661.71],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Income'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 180, 45795, 'Campout Fees Received'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Reimbursements'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 127, 45928, 'Due to Pat less Campout Fees'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 40, 45928, 'Owed to someone unnamed'],
  [],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 127],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Credit for Future Campouts', 'entered in the scout accounts sheet'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 15, 45930, 'Unk Nown overpaid']
];

const RESOLVED: ResolvedPerson[] = [
  { row: 3, personId: 101, displayName: 'Pat Driver', isScout: false, householdId: 1 },
  { row: 4, personId: 102, displayName: 'Mo Vanrider', isScout: false, householdId: 2 },
  { row: 5, personId: 103, displayName: 'Vera Lead', isScout: true, householdId: 3 },
  { row: 6, personId: 104, displayName: 'Ana Scout', isScout: true, householdId: 1 },
  { row: 7, personId: 105, displayName: 'Xan Guest', isScout: true, householdId: 4 },
  { row: 8, personId: 106, displayName: 'Lil Webelo', isScout: true, householdId: 5 }
  // row 9 (Unk Nown) deliberately unresolved
];

describe('parseEventSheet', () => {
  const parsed = parseEventSheet(TAB);

  it('Parser_ReadsPeopleRows_UntilTheFirstBlankRow', () => {
    expect(parsed.people.map((p) => `${p.firstName} ${p.lastName}`)).toEqual([
      'Pat Driver',
      'Mo Vanrider',
      'Vera Lead',
      'Ana Scout',
      'Xan Guest',
      'Lil Webelo',
      'Unk Nown'
    ]);
  });

  it('Parser_ReadsSeatsPerLeg_AsNumbersIncludingTheDriver', () => {
    const mo = parsed.people[1];
    expect([mo.seatsOut, mo.seatsBack]).toEqual([3, null]);
  });

  it('Parser_MapsPaymentColumnsToMethods', () => {
    expect(parsed.people[0].payments).toEqual([{ method: 'cash', amount: 30, column: '$$' }]);
    expect(parsed.people[1].payments).toEqual([{ method: 'venmo', amount: 30, column: 'PPal' }]);
    expect(parsed.people[6].payments).toEqual([{ method: 'check', amount: 15, column: 'Ck' }]);
  });

  it('Parser_ReadsGroupingColumnsBySetLabel', () => {
    expect(parsed.groupSets).toEqual([{ label: 'Patrols', kind: 'patrol' }]);
    expect(parsed.people[3].groups).toEqual({ Patrols: 'Fire Quackers' });
    expect(parsed.people[0].groups).toEqual({});
  });

  it('Parser_ReadsExpenseBlock_StoppingAtTheTotalRow', () => {
    expect(parsed.expenses).toEqual([
      { amount: 534.71, date: '2025-09-17', note: 'Food - Store - Mo' },
      { amount: 187, date: '2025-02-06', note: 'Group Site C under Pat Driver' },
      { amount: -60, date: '2025-09-19', note: 'Pat and Ana Campout Fee' }
    ]);
  });

  it('Parser_ReadsReimbursementAndCreditBlocks', () => {
    expect(parsed.reimbursements.map((r) => r.amount)).toEqual([127, 40]);
    expect(parsed.credits).toEqual([{ amount: 15, date: '2025-09-30', note: 'Unk Nown overpaid' }]);
  });

  it('Parser_CleansTheTabTitle', () => {
    expect(parsed.title).toBe('Maple Campout');
    expect(cleanSheetTitle('BWCA 2026')).toBe('BWCA 2026');
  });

  it('Parser_ThrowsWithoutANameHeader', () => {
    expect(() => parseEventSheet([['nothing', 'here']])).toThrow(/NAME/);
  });

  it('SheetDate_ConvertsExcelSerialsAndStrings', () => {
    expect(sheetDateToISO(45917)).toBe('2025-09-17');
    expect(sheetDateToISO('9/1/2026')).toBe('2026-09-01');
    expect(sheetDateToISO('')).toBeNull();
  });
});

describe('buildImportPlan', () => {
  const plan = buildImportPlan(parseEventSheet(TAB), RESOLVED, { eventDate: '2026-09-01' });

  it('Plan_WritesOneEntryPerResolvedPerson_AndWarnsForTheRest', () => {
    expect(plan.entries.map((e) => e.personId)).toEqual([101, 102, 103, 104, 105, 106]);
    expect(plan.warnings).toContain('row 10: "Unk Nown" not found in people — skipped');
  });

  it('Plan_DriverSeatsIncludeTheDriver_AndDriversHaveNoRideStatus', () => {
    const pat = plan.entries[0];
    expect(pat).toMatchObject({ drivesOut: true, drivesBack: true, vehicleSeatsOut: 4, vehicleSeatsBack: 4, rideOut: null, rideBack: null });
  });

  it('Plan_OneLegDriver_NeedsARideOnTheOtherLeg', () => {
    const mo = plan.entries[1];
    expect(mo).toMatchObject({ drivesOut: true, drivesBack: false, vehicleSeatsBack: null, rideOut: null, rideBack: 'needs_ride' });
  });

  it('Plan_NonDriversDefaultToNeedsRide', () => {
    expect(plan.entries[3]).toMatchObject({ drivesOut: false, rideOut: 'needs_ride', rideBack: 'needs_ride' });
  });

  it('Plan_ClassifiesJLAsJuniorLeader_AndLeavesOthersToTheDatabase', () => {
    expect(plan.entries[2]).toMatchObject({ personKind: 'scout', participantClass: 'junior_leader' });
    expect(plan.entries[3].participantClass).toBeNull();
    expect(plan.entries[0].personKind).toBe('adult');
  });

  it('Plan_PlacesRidersInTheNamedDriversCar_PerLeg', () => {
    const cars = plan.placements.filter((p) => p.driverRow != null);
    expect(cars).toEqual([
      { row: 6, setLabel: 'Cars there', driverRow: 3 },
      { row: 6, setLabel: 'Cars back', driverRow: 3 }
    ]);
  });

  it('Plan_RefusesACarTokenThatIsNotADriver', () => {
    expect(plan.warnings).toContain('row 9: Cars there "Nobody" is not a driver on this sheet — not placed');
  });

  it('Plan_PlacesPeopleInNamedGroupsOfTheSheetsSets', () => {
    const patrols = plan.placements.filter((p) => p.groupName);
    expect(patrols).toContainEqual({ row: 5, setLabel: 'Patrols', groupName: 'Screaming Eagles' });
    expect(patrols.filter((p) => p.groupName === 'Fire Quackers').map((p) => p.row)).toEqual([6, 8]);
  });

  it('Plan_PriceIsTheModeOfPerPersonTotals', () => {
    expect(plan.price).toBe(30);
  });

  it('Plan_PaymentsCarryMethodAndTheRowNote', () => {
    expect(plan.payments.find((p) => p.personId === 105)).toEqual({ row: 7, personId: 105, amount: 30, method: 'venmo', memo: 'Pd by Pat' });
    expect(plan.payments).toHaveLength(6);
  });

  it('Plan_ExpensesArePositiveTroopRows_NegativeOnesAreRefused', () => {
    expect(plan.expenses).toEqual([
      { amount: 534.71, memo: 'Food - Store - Mo', occurredOn: '2025-09-17' },
      { amount: 187, memo: 'Group Site C under Pat Driver', occurredOn: '2025-02-06' }
    ]);
    expect(plan.warnings.some((w) => w.startsWith('expense -60'))).toBe(true);
  });

  it('Plan_ReimbursementsResolveTheAdultNamedInTheNote', () => {
    expect(plan.reimbursements).toEqual([
      { requesterRow: 3, requesterPersonId: 101, amount: 127, description: 'Due to Pat less Campout Fees' }
    ]);
    expect(plan.warnings.some((w) => w.includes('names no adult'))).toBe(true);
  });

  it('Plan_CreditsAreReportedNotImported', () => {
    expect(plan.warnings.some((w) => w.startsWith('credit 15'))).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { rosterDates } from '../src/lib/roster-dates';

/**
 * The roster's Created and Left columns (Patrick, 2026-11-01), derived from what the database already holds:
 * Created = the earlier of the day the record was made and the scout's first ledger entry (imported records all
 * read the people-spine build day, 2026-07-20); Left = a scout's last ledger entry.
 */
describe('rosterDates', () => {
  const tenure = [{ scout_id: 'A04', first_activity_date: '2022-07-20', last_activity_date: '2026-01-25' }];

  it('Created_ForAScout_IsTheirFirstLedgerEntry_WhenThatIsEarlier', () => {
    const { created } = rosterDates({
      people: [{ id: 7, created_at: '2026-07-20T14:00:00+00:00' }],
      scouts: [{ id: 'A04', person_id: 7 }],
      tenure
    });
    expect(created[7]).toBe('2022-07-20');
  });

  it('Created_IsTheRecordDay_InCentral_WhenThereIsNoEarlierHistory', () => {
    // 02:30 UTC on Oct 5 is the evening of Oct 4 in Milwaukee.
    const { created } = rosterDates({
      people: [{ id: 9, created_at: '2026-10-05T02:30:00+00:00' }],
      scouts: [],
      tenure: []
    });
    expect(created[9]).toBe('2026-10-04');
  });

  it('Created_KeepsTheRecordDay_WhenTheFirstEntryIsLater', () => {
    const { created } = rosterDates({
      people: [{ id: 7, created_at: '2021-01-01T18:00:00+00:00' }],
      scouts: [{ id: 'A04', person_id: 7 }],
      tenure
    });
    expect(created[7]).toBe('2021-01-01');
  });

  it('Left_ForAScout_IsTheirLastLedgerEntry', () => {
    const { left } = rosterDates({ people: [], scouts: [{ id: 'A04', person_id: 7 }], tenure });
    expect(left.A04).toBe('2026-01-25');
  });

  it('Left_IsMissing_ForAScoutWithNoLedgerHistory', () => {
    const { left } = rosterDates({ people: [], scouts: [{ id: 'T01', person_id: 3 }], tenure });
    expect(left.T01).toBeUndefined();
  });
});

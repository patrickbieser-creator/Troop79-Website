import { describe, it, expect } from 'vitest';
import { run } from '@/app/admin/(workspace)/advancement/audits/checks/service-hours';
import type { AuditInput, AuditLedgerRow } from '@/app/admin/(workspace)/advancement/audits/audit-input';

/**
 * Service-hours audit (Patrick, 2026-11-15): "find scouts who need requirements filled in automatically, like hours of
 * service". Cumulative hours for Tenderfoot 7b (1), Second Class 8e (2 more = 3), First Class 9d (3 more = 6); six
 * hours logged since the prior rank's award for Star 4 (since First Class) and Life 4 (since Star). Pure: the check
 * reads an in-memory snapshot, so these build one.
 */

const S = 'zz-svc';
let nextId = 1;
const row = (kind: AuditLedgerRow['kind'], code: string, date: string, qty = 1): AuditLedgerRow => ({
  id: nextId++,
  scout_id: S,
  kind,
  code,
  label: null,
  date,
  by: null,
  qty,
  unit: kind === 'service_hours' ? 'hours' : 'complete',
  notes: null,
  entered_by: 'vitest',
  entered_at: `${date}T12:00:00Z`,
  calendar_entry_id: null
});
const hours = (qty: number, date: string, code = `SVC-${date}`) => row('service_hours', code, date, qty);
const award = (rankId: string, date: string) => row('rank_award', rankId, date);
const signed = (code: string) => row('rank_requirement', code, '2026-01-01');

function input(ledger: AuditLedgerRow[]): AuditInput {
  return {
    supabase: null as unknown as AuditInput['supabase'],
    scouts: [{ id: S, display_name: 'ZZ Service', active: true, person_id: null }],
    rankRequirements: [
      { rank_id: 'tenderfoot', code: '7b', label: '1 hour Service Project' },
      { rank_id: 'second-class', code: '8e', label: '2 more hours service project(s)' },
      { rank_id: 'first-class', code: '9d', label: '3 more hours of service project(s)' },
      { rank_id: 'star', code: '4', label: 'Six Hours of Service' },
      { rank_id: 'life', code: '4', label: 'Six More Hours of Service' }
    ] as unknown as AuditInput['rankRequirements'],
    ledger
  };
}
const codes = async (ledger: AuditLedgerRow[]) => (await run(input(ledger))).flatMap((f) => f.missing.map((m) => m.code)).sort();

describe('service-hours audit — lower ranks (cumulative)', () => {
  it('ServiceHours_FlagsTenderfootOnly_AtOneHour', async () => {
    expect(await codes([hours(1, '2026-01-10')])).toEqual(['tenderfoot-7b']);
  });

  it('ServiceHours_FlagsThroughFirstClass_AtSixHours', async () => {
    expect(await codes([hours(4, '2026-01-10'), hours(2, '2026-02-10')])).toEqual(['first-class-9d', 'second-class-8e', 'tenderfoot-7b']);
  });

  it('ServiceHours_SkipsARequirementAlreadySignedOff', async () => {
    expect(await codes([hours(3, '2026-01-10'), signed('tenderfoot-7b')])).toEqual(['second-class-8e']);
  });
});

describe('service-hours audit — Star and Life (since the prior rank)', () => {
  const lower = ['tenderfoot-7b', 'second-class-8e', 'first-class-9d'].map(signed);

  it('ServiceHours_FlagsStar4_WithSixHoursSinceFirstClass', async () => {
    expect(await codes([...lower, award('first-class', '2026-01-01'), hours(6, '2026-03-01')])).toEqual(['star-4']);
  });

  it('ServiceHours_IgnoresHoursBeforeTheFirstClassAward', async () => {
    expect(await codes([...lower, hours(10, '2025-12-01'), award('first-class', '2026-01-01'), hours(5, '2026-03-01')])).toEqual([]);
  });

  it('ServiceHours_DoesNotFlagStar4_WithoutFirstClass', async () => {
    expect(await codes([...lower, hours(8, '2026-03-01')])).toEqual([]);
  });

  it('ServiceHours_FlagsLife4_WithSixHoursSinceStar', async () => {
    expect(await codes([...lower, signed('star-4'), award('star', '2026-04-01'), hours(6, '2026-05-01')])).toEqual(['life-4']);
  });

  it('ServiceHours_DefaultsTheSignOffDateToTheDayTheThresholdWasReached', async () => {
    const [f] = await run(input([...lower, award('first-class', '2026-01-01'), hours(4, '2026-02-01'), hours(3, '2026-03-01')]));
    expect(f.qualifyingDate).toBe('2026-03-01');
  });
});

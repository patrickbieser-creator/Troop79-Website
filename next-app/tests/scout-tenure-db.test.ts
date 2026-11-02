import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * scout_tenure (Patrick, 2026-11-01): a scout's first and last live ledger date, for the roster's Created and
 * Left columns. Deleted/archived rows and pre-2000 typos (production has entries dated year 0025) don't count;
 * meeting attendance does. Real local database; test-owned scout and ledger rows only.
 */
const sb = adminClient();
let personId = 0;
let scoutId = '';

async function entry(date: string, over: Record<string, unknown> = {}) {
  const { error } = await sb.from('ledger_entries').insert({
    scout_id: scoutId,
    date,
    kind: 'rank_requirement',
    code: 'scout-1a',
    qty: 1,
    unit: 'complete',
    entered_by: 'vitest',
    ...over
  });
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  const { data, error } = await sb
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} Tenure Scout`, first_name: `${TEST_PREFIX} Tenure`, last_name: 'Scout' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  personId = data!.id as number;
  scoutId = `vitest-tenure-${personId}`;
  const s = await sb.from('scouts').insert({
    id: scoutId,
    first_name: `${TEST_PREFIX} Tenure`,
    last_name: 'Scout',
    display_name: `${TEST_PREFIX} Tenure Scout`,
    person_id: personId,
    active: false,
    inactive_reason: 'dropped_out'
  });
  if (s.error) throw new Error(s.error.message);
  await entry('0025-11-08'); // a typo year
  await entry('2019-03-01', { deleted_at: new Date().toISOString(), deleted_by: 'vitest', deleted_reason: 'test' });
  await entry('2022-09-15');
  await entry('2023-10-22', { kind: 'meeting_attendance', code: 'meeting' });
  await entry('2024-05-01', { archived_at: new Date().toISOString(), archived_by: 'vitest', archived_reason: 'test' });
});

afterAll(async () => {
  await sb.from('ledger_entries').delete().eq('scout_id', scoutId);
  await sb.from('scouts').delete().eq('id', scoutId);
  await sb.from('people').delete().eq('id', personId);
});

const tenure = async () =>
  (await sb.from('scout_tenure').select('first_activity_date, last_activity_date').eq('scout_id', scoutId).single()).data;

describe('scout_tenure', () => {
  it('FirstActivity_SkipsTyposAndDeletedRows', async () => {
    expect((await tenure())?.first_activity_date).toBe('2022-09-15');
  });

  it('LastActivity_CountsMeetingAttendance_AndSkipsArchivedRows', async () => {
    expect((await tenure())?.last_activity_date).toBe('2023-10-22');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { run } from '@/app/admin/(workspace)/advancement/audits/checks/activity-thresholds';

/**
 * The "activity" umbrella (Patrick, 2026-08-14).
 *
 * An activity covers campouts, fundraisers, day outings and service projects —
 * everything except meetings — and an event counts toward its umbrella AND its
 * quantity at once. The rule this replaces counted only `camping_nights` and
 * `hiking_miles`, so every fundraiser and service day a scout attended was
 * invisible to Second Class 1a and First Class 1a. Measured against production
 * the day it was fixed: 4 active scouts had met a 1a threshold and were not
 * being credited.
 *
 * Two things are worth pinning:
 *   1. the umbrella is wide (the bug), and
 *   2. one event CODE is one activity, so duplicate data entry cannot inflate a
 *      scout's tally — the duplicate-records audit found ~436 duplicate groups
 *      on production, so this guard does real work.
 */

const admin = adminClient();
const SCOUT_ID = `zzvitest-act-${process.pid}`;

/** Only this fixture scout's findings, so real roster data can't sway the test. */
function findingsFor(all: Awaited<ReturnType<typeof run>>, rankLabel: string) {
  return all.filter((f) => f.scoutId === SCOUT_ID && f.groupLabel === rankLabel);
}

async function logActivity(kind: string, code: string, date: string) {
  const { error } = await admin.from('ledger_entries').insert({
    scout_id: SCOUT_ID,
    date,
    kind,
    code,
    qty: 1,
    unit: kind === 'camping_nights' ? 'nights' : kind === 'service_hours' ? 'hours' : 'each',
    entered_by: 'vitest'
  });
  if (error) throw new Error(`${kind}/${code}: ${error.message}`);
}

beforeAll(async () => {
  await admin.from('scouts').insert({
    id: SCOUT_ID,
    first_name: 'ZZVitest',
    last_name: 'Activity',
    display_name: 'ZZVitest Activity',
    active: true
  });
});

afterAll(async () => {
  await admin.from('ledger_entries').delete().eq('scout_id', SCOUT_ID);
  await admin.from('scouts').delete().eq('id', SCOUT_ID);
});

describe('activity thresholds — the umbrella', () => {
  it('SecondClass1a_IsNotSurfaced_WhenTheScoutHasTooFewActivities', async () => {
    // 3 campouts, nothing else. Second Class needs 5 activities.
    await logActivity('camping_nights', 'ZZVIT-CAMP-1', '2026-01-10');
    await logActivity('camping_nights', 'ZZVIT-CAMP-2', '2026-02-10');
    await logActivity('camping_nights', 'ZZVIT-CAMP-3', '2026-03-10');

    const findings = await run(admin);
    expect(findingsFor(findings, 'Second Class')).toHaveLength(0);
  });

  it('SecondClass1a_IsSurfaced_WhenAFundraiserAndServiceDayCompleteTheCount', async () => {
    // These two are exactly what the OLD rule threw away. With them the scout
    // reaches 5 activities against 3 campouts and qualifies.
    await logActivity('fundraiser', 'ZZVIT-FUND-1', '2026-04-10');
    await logActivity('service_hours', 'ZZVIT-SERV-1', '2026-05-10');

    const findings = await run(admin);
    const mine = findingsFor(findings, 'Second Class');
    expect(mine).toHaveLength(1);
    expect(mine[0].contextLine).toContain('5 activities');
    expect(mine[0].contextLine).toContain('3 campouts');
  });

  it('DayOutings_CountTowardTheUmbrella_ThoughTheyLogNoQuantity', async () => {
    await logActivity('day_outing', 'ZZVIT-DAY-1', '2026-06-10');
    const findings = await run(admin);
    expect(findingsFor(findings, 'Second Class')[0].contextLine).toContain('6 activities');
  });

  it('DuplicateRows_CountOnce_WhenTheyShareAnEventCode', async () => {
    // The real guard: accidental double entry. Two rows, one code, one campout
    // — the tally must move by exactly one, not two.
    await logActivity('camping_nights', 'ZZVIT-CAMP-4', '2026-07-10');
    await logActivity('camping_nights', 'ZZVIT-CAMP-4', '2026-07-11');

    const findings = await run(admin);
    const mine = findingsFor(findings, 'Second Class')[0];
    expect(mine.contextLine).toContain('7 activities');
    expect(mine.contextLine).toContain('4 campouts');
  });

  it('Meetings_NeverCount_HoweverManyTheScoutAttends', async () => {
    const before = findingsFor(await run(admin), 'Second Class')[0].contextLine;
    for (let i = 1; i <= 4; i += 1) {
      await logActivity('meeting_attendance', `MTG:2026-08-0${i}`, `2026-08-0${i}`);
    }
    const after = findingsFor(await run(admin), 'Second Class')[0].contextLine;
    expect(after).toBe(before);
  });
});

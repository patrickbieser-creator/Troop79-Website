import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { planCalendarEntryMerge, executeCalendarEntryMerge } from '@/lib/calendar-admin';

/**
 * Merge, not delete — the alternative to deleteCalendarEntry for genuine
 * duplicate entries (2026-08-20 recommendation, after a raw delete orphaned
 * ledger credit that then got mistaken for a stray duplicate and wiped for
 * real). Every dependent table is reassigned from the loser to the keeper
 * before the loser is removed, so nothing is ever silently orphaned.
 */

const admin = adminClient();
const FIXTURE = `ZZVITEST Merge ${process.pid}`;
const SCOUT_BOTH = `zzvit-mg-both-${process.pid}`; // has attendance/credit on both sides
const SCOUT_LOSE_ONLY = `zzvit-mg-lose-${process.pid}`; // only on the loser

let categoryLabel = '';
let keepId = 0;
let loseId = 0;
let scoutBothPersonId = 0;
let scoutLoseOnlyPersonId = 0;

beforeAll(async () => {
  categoryLabel = FIXTURE;
  await admin.from('calendar_categories').insert({
    label: categoryLabel,
    color: '#334455',
    sort_order: 9993,
    template: 'activity',
    credit_kind: 'camping_nights',
    credit_unit: 'nights',
    counts_as_activity: true
  });

  const { data: sb } = await admin
    .from('people')
    .insert({ display_name: `${FIXTURE} Both` })
    .select('id')
    .single();
  scoutBothPersonId = sb!.id as number;
  await admin.from('scouts').insert({
    id: SCOUT_BOTH,
    first_name: 'ZZVitest',
    last_name: 'Both',
    display_name: `${FIXTURE} Both`,
    active: true,
    person_id: scoutBothPersonId
  });

  const { data: sl } = await admin
    .from('people')
    .insert({ display_name: `${FIXTURE} LoseOnly` })
    .select('id')
    .single();
  scoutLoseOnlyPersonId = sl!.id as number;
  await admin.from('scouts').insert({
    id: SCOUT_LOSE_ONLY,
    first_name: 'ZZVitest',
    last_name: 'LoseOnly',
    display_name: `${FIXTURE} LoseOnly`,
    active: true,
    person_id: scoutLoseOnlyPersonId
  });
});

afterAll(async () => {
  await admin.from('ledger_entries').delete().in('scout_id', [SCOUT_BOTH, SCOUT_LOSE_ONLY]);
  await admin.from('scouts').delete().in('id', [SCOUT_BOTH, SCOUT_LOSE_ONLY]);
  await admin.from('people').delete().in('id', [scoutBothPersonId, scoutLoseOnlyPersonId]);
  await admin.from('calendar_categories').delete().eq('label', categoryLabel);
});

async function makeEntries(keepDate: string, loseDate: string) {
  const { data: k } = await admin
    .from('calendar_entries')
    .insert({ entry_date: keepDate, category: categoryLabel, title: `${FIXTURE} Keep` })
    .select('id')
    .single();
  const { data: l } = await admin
    .from('calendar_entries')
    .insert({ entry_date: loseDate, category: categoryLabel, title: `${FIXTURE} Lose` })
    .select('id')
    .single();
  return { keepId: k!.id as number, loseId: l!.id as number };
}

async function cleanupEntries(k: number, l: number) {
  await admin.from('event_attendance').delete().in('calendar_entry_id', [k, l]);
  await admin.from('ledger_entries').delete().in('calendar_entry_id', [k, l]);
  await admin.from('calendar_entries').delete().in('id', [k, l]);
}

describe('planCalendarEntryMerge', () => {
  afterEach(async () => {
    if (keepId && loseId) await cleanupEntries(keepId, loseId);
    keepId = 0;
    loseId = 0;
  });

  it('PlanMerge_MovesEverything_WhenTheKeeperHasNothingOverlapping', async () => {
    ({ keepId, loseId } = await makeEntries('2027-11-01', '2027-11-01'));
    await admin.from('event_attendance').insert({ calendar_entry_id: loseId, person_id: scoutLoseOnlyPersonId, qty: 1 });
    await admin.from('ledger_entries').insert({
      scout_id: SCOUT_LOSE_ONLY,
      date: '2027-11-01',
      kind: 'camping_nights',
      code: `EVT:${loseId}`,
      qty: 1,
      unit: 'nights',
      calendar_entry_id: loseId
    });

    const plan = await planCalendarEntryMerge(admin, keepId, loseId);
    expect(plan.attendanceMoved).toBe(1);
    expect(plan.attendanceSuperseded).toBe(0);
    expect(plan.creditMoved).toBe(1);
    expect(plan.creditSuperseded).toBe(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('PlanMerge_SupersedesOverlap_WhenBothSidesHaveTheSamePerson', async () => {
    ({ keepId, loseId } = await makeEntries('2027-11-08', '2027-11-08'));
    await admin.from('event_attendance').insert([
      { calendar_entry_id: keepId, person_id: scoutBothPersonId, qty: 1 },
      { calendar_entry_id: loseId, person_id: scoutBothPersonId, qty: 1 }
    ]);
    await admin.from('ledger_entries').insert([
      {
        scout_id: SCOUT_BOTH,
        date: '2027-11-08',
        kind: 'camping_nights',
        code: `EVT:${keepId}`,
        qty: 1,
        unit: 'nights',
        calendar_entry_id: keepId
      },
      {
        scout_id: SCOUT_BOTH,
        date: '2027-11-08',
        kind: 'camping_nights',
        code: `EVT:${loseId}`,
        qty: 1,
        unit: 'nights',
        calendar_entry_id: loseId
      }
    ]);

    const plan = await planCalendarEntryMerge(admin, keepId, loseId);
    expect(plan.attendanceMoved).toBe(0);
    expect(plan.attendanceSuperseded).toBe(1);
    expect(plan.creditMoved).toBe(0);
    expect(plan.creditSuperseded).toBe(1);
  });

  it('PlanMerge_FlagsAConflict_WhenBothEntriesHaveTheirOwnSignup', async () => {
    ({ keepId, loseId } = await makeEntries('2027-11-15', '2027-11-15'));
    await admin.from('event_signups').insert([
      { calendar_entry_id: keepId, status: 'open', audience: 'both', deadline: '2027-11-01T00:00:00Z' },
      { calendar_entry_id: loseId, status: 'open', audience: 'both', deadline: '2027-11-01T00:00:00Z' }
    ]);

    const plan = await planCalendarEntryMerge(admin, keepId, loseId);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].table).toBe('event_signups');

    await admin.from('event_signups').delete().in('calendar_entry_id', [keepId, loseId]);
  });
});

describe('executeCalendarEntryMerge', () => {
  afterEach(async () => {
    if (keepId && loseId) await cleanupEntries(keepId, loseId).catch(() => {});
    keepId = 0;
    loseId = 0;
  });

  it('ExecuteMerge_MovesAttendanceAndCredit_AndRemovesTheLoser', async () => {
    ({ keepId, loseId } = await makeEntries('2027-11-22', '2027-11-20')); // loser has the wrong date
    await admin.from('event_attendance').insert({ calendar_entry_id: loseId, person_id: scoutLoseOnlyPersonId, qty: 2 });
    await admin.from('ledger_entries').insert({
      scout_id: SCOUT_LOSE_ONLY,
      date: '2027-11-20',
      kind: 'camping_nights',
      code: `EVT:${loseId}`,
      label: `${FIXTURE} Lose`,
      qty: 2,
      unit: 'nights',
      calendar_entry_id: loseId
    });

    const res = await executeCalendarEntryMerge(admin, keepId, loseId, 'vitest');
    expect(res.ok).toBe(true);

    const { data: att } = await admin
      .from('event_attendance')
      .select('calendar_entry_id')
      .eq('person_id', scoutLoseOnlyPersonId);
    expect(att).toHaveLength(1);
    expect(att![0].calendar_entry_id).toBe(keepId);

    const { data: credit } = await admin
      .from('ledger_entries')
      .select('calendar_entry_id, date, label, code')
      .eq('scout_id', SCOUT_LOSE_ONLY)
      .is('deleted_at', null)
      .single();
    // Repointed AND refreshed to the keeper's own date/title/code — not a
    // stale copy of the entry that no longer exists.
    expect(credit!.calendar_entry_id).toBe(keepId);
    expect(credit!.date).toBe('2027-11-22');
    expect(credit!.label).toBe(`${FIXTURE} Keep`);
    expect(credit!.code).toBe(`EVT:${keepId}`);

    const { data: loser } = await admin.from('calendar_entries').select('id').eq('id', loseId);
    expect(loser).toHaveLength(0);

    loseId = 0; // already gone — afterEach must not try to delete it again
  });

  it('ExecuteMerge_SoftDeletesTheDuplicateCredit_KeepingTheKeepersRow', async () => {
    ({ keepId, loseId } = await makeEntries('2027-11-29', '2027-11-29'));
    await admin.from('ledger_entries').insert([
      {
        scout_id: SCOUT_BOTH,
        date: '2027-11-29',
        kind: 'camping_nights',
        code: `EVT:${keepId}`,
        qty: 3,
        unit: 'nights',
        calendar_entry_id: keepId
      },
      {
        scout_id: SCOUT_BOTH,
        date: '2027-11-29',
        kind: 'camping_nights',
        code: `EVT:${loseId}`,
        qty: 3,
        unit: 'nights',
        calendar_entry_id: loseId
      }
    ]);

    const res = await executeCalendarEntryMerge(admin, keepId, loseId, 'vitest');
    expect(res.ok).toBe(true);

    const { data: rows } = await admin
      .from('ledger_entries')
      .select('calendar_entry_id, deleted_at, deleted_reason')
      .eq('scout_id', SCOUT_BOTH)
      .order('deleted_at', { nullsFirst: true });
    expect(rows).toHaveLength(2);
    expect(rows![0].deleted_at).toBeNull();
    expect(rows![0].calendar_entry_id).toBe(keepId);
    expect(rows![1].deleted_at).not.toBeNull();
    expect(rows![1].deleted_reason).toContain('Duplicate');

    loseId = 0;
  });

  it('ExecuteMerge_Refuses_WhenBothEntriesHaveTheirOwnSignup', async () => {
    ({ keepId, loseId } = await makeEntries('2027-12-06', '2027-12-06'));
    await admin.from('event_signups').insert([
      { calendar_entry_id: keepId, status: 'open', audience: 'both', deadline: '2027-11-01T00:00:00Z' },
      { calendar_entry_id: loseId, status: 'open', audience: 'both', deadline: '2027-11-01T00:00:00Z' }
    ]);

    const res = await executeCalendarEntryMerge(admin, keepId, loseId, 'vitest');
    expect(res.ok).toBe(false);

    // Nothing touched — both entries and both signups still stand.
    const { data: entries } = await admin.from('calendar_entries').select('id').in('id', [keepId, loseId]);
    expect(entries).toHaveLength(2);

    await admin.from('event_signups').delete().in('calendar_entry_id', [keepId, loseId]);
  });
});

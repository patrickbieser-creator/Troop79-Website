import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  defaultQtyFor,
  creditRuleFor,
  ledgerCodeFor,
  reconcileWithSignup,
  type AttendeeCandidate
} from '@/lib/attendance-shared';
import { syncCredit, retireCredit, adoptLegacyCredit } from '@/lib/attendance-admin';

/**
 * Roll Call — attendance as a layer on calendar_entries, writing through to the
 * ledger rather than replacing it.
 *
 * The invariants worth pinning are the ones automatic cascading credit can get
 * wrong silently:
 *   * credit follows attendance, and is soft-deleted (never destroyed) on
 *     uncheck;
 *   * re-saving does not double-credit;
 *   * adults get attendance and no ledger row at all;
 *   * a category that grants nothing writes no credit;
 *   * the signup is a SEED — unchecking never touches it.
 */

const admin = adminClient();
const FIXTURE = `ZZVITEST RollCall ${process.pid}`;
const SCOUT_ID = `zzvit-rc-${process.pid}`;

let categoryLabel = '';
let entryId = 0;
let scoutPersonId = 0;
let adultPersonId = 0;

beforeAll(async () => {
  await admin.from('calendar_categories').insert({
    label: FIXTURE,
    color: '#556677',
    sort_order: 9995,
    template: 'activity',
    credit_kind: 'camping_nights',
    credit_unit: 'nights',
    counts_as_activity: true
  });

  const { data: entry } = await admin
    .from('calendar_entries')
    .insert({
      entry_date: '2027-09-10',
      end_date: '2027-09-12', // two nights
      category: categoryLabel || FIXTURE,
      title: `${FIXTURE} campout`
    })
    .select('id')
    .single();
  categoryLabel = FIXTURE;
  entryId = entry!.id as number;

  const { data: sp } = await admin
    .from('people')
    .insert({ display_name: `${FIXTURE} Scout` })
    .select('id')
    .single();
  scoutPersonId = sp!.id as number;
  await admin.from('scouts').insert({
    id: SCOUT_ID,
    first_name: 'ZZVitest',
    last_name: 'RollCall',
    display_name: `${FIXTURE} Scout`,
    active: true,
    person_id: scoutPersonId
  });

  const { data: ap } = await admin
    .from('people')
    .insert({ display_name: `${FIXTURE} Adult` })
    .select('id')
    .single();
  adultPersonId = ap!.id as number;
});

afterAll(async () => {
  await admin.from('ledger_entries').delete().eq('scout_id', SCOUT_ID);
  await admin.from('event_attendance').delete().eq('calendar_entry_id', entryId);
  await admin.from('calendar_entries').delete().eq('id', entryId);
  await admin.from('scouts').delete().eq('id', SCOUT_ID);
  await admin.from('people').delete().in('id', [scoutPersonId, adultPersonId]);
  await admin.from('calendar_categories').delete().eq('label', categoryLabel);
});

describe('attendance as a layer', () => {
  it('Attendance_IsUniquePerPersonPerEntry', async () => {
    await admin.from('event_attendance').insert({
      calendar_entry_id: entryId,
      person_id: scoutPersonId,
      qty: 2
    });
    const { error } = await admin
      .from('event_attendance')
      .insert({ calendar_entry_id: entryId, person_id: scoutPersonId, qty: 2 });
    // This uniqueness is what makes "five SEPARATE activities" structural
    // rather than a dedup heuristic.
    expect(error?.code).toBe('23505');
  });

  it('DeletingTheEntry_CascadesAttendance_ButLeavesTheLedgerRow', async () => {
    const { data: e } = await admin
      .from('calendar_entries')
      .insert({ entry_date: '2027-09-20', category: categoryLabel, title: `${FIXTURE} doomed` })
      .select('id')
      .single();
    const doomed = e!.id as number;

    await admin
      .from('event_attendance')
      .insert({ calendar_entry_id: doomed, person_id: scoutPersonId, qty: 1 });
    const { data: led } = await admin
      .from('ledger_entries')
      .insert({
        scout_id: SCOUT_ID,
        date: '2027-09-20',
        kind: 'camping_nights',
        code: `EVT:${doomed}`,
        qty: 1,
        unit: 'nights',
        calendar_entry_id: doomed
      })
      .select('id')
      .single();

    await admin.from('calendar_entries').delete().eq('id', doomed);

    const { data: att } = await admin
      .from('event_attendance')
      .select('id')
      .eq('calendar_entry_id', doomed);
    expect(att ?? []).toHaveLength(0);

    // Advancement history survives; only the link is nulled.
    const { data: after } = await admin
      .from('ledger_entries')
      .select('id, calendar_entry_id')
      .eq('id', led!.id)
      .single();
    expect(after!.calendar_entry_id).toBeNull();

    await admin.from('ledger_entries').delete().eq('id', led!.id);
  });
});

describe('credit rules', () => {
  it('DefaultQty_IsTheDateSpan_ForACampout', () => {
    // Friday to Sunday is two nights (Patrick, 2026-08-14).
    expect(defaultQtyFor('camping_nights', '2027-09-10', '2027-09-12')).toBe(2);
    expect(defaultQtyFor('camping_nights', '2027-09-10', null)).toBe(1);
  });

  it('DefaultQty_IsZeroForServiceHours_BecauseNobodyCanGuessTheLength', () => {
    expect(defaultQtyFor('service_hours', '2027-09-10', null)).toBe(0);
  });

  it('DefaultQty_IsZero_WhenTheCategoryGrantsNothing', () => {
    expect(defaultQtyFor(null, '2027-09-10', '2027-09-12')).toBe(0);
  });

  it('CreditRule_ComesFromTheCategory_AndFallsBackWhenUnknown', async () => {
    const { data } = await admin
      .from('calendar_categories')
      .select('label, color, sort_order, behavior, template, credit_kind, credit_unit, counts_as_activity');
    const rows = data as Parameters<typeof creditRuleFor>[0];

    expect(creditRuleFor(rows, categoryLabel).creditKind).toBe('camping_nights');
    expect(creditRuleFor(rows, 'Troop Meeting').countsAsActivity).toBe(false);
    expect(creditRuleFor(rows, 'Service Project').creditUnit).toBe('hours');
    // An unknown category degrades to "no credit, but still an activity"
    // rather than throwing — same posture as colorFor().
    expect(creditRuleFor(rows, 'Invented Yesterday')).toEqual({
      creditKind: null,
      creditUnit: null,
      countsAsActivity: true
    });
  });

  it('MeetingsKeepTheirHistoricLedgerCode_SoBackfilledRowsAgree', () => {
    expect(ledgerCodeFor('meeting_attendance', 42, '2026-07-19')).toBe('MTG:2026-07-19');
    // Everything else keys by entry id, which survives a rename or date move.
    expect(ledgerCodeFor('camping_nights', 42, '2026-07-19')).toBe('EVT:42');
  });
});

describe('activity categories', () => {
  it('MeetingCategories_DoNotCountAsActivities', async () => {
    const { data } = await admin
      .from('calendar_categories')
      .select('label, counts_as_activity')
      .in('label', [
        'Troop Meeting',
        'No Meeting',
        'Ceremony / Recognition',
        'Advancement Event',
        'Leadership / Planning'
      ]);
    for (const row of data ?? []) expect(row.counts_as_activity).toBe(false);
  });

  it('EventCategories_DoCountAsActivities', async () => {
    const { data } = await admin
      .from('calendar_categories')
      .select('label, counts_as_activity')
      .in('label', [
        'Campout / Overnight',
        'Service Project',
        'Fundraiser',
        'Day Activity / Outing',
        'Training',
        'Recruiting / Outreach',
        'Social Event'
      ]);
    expect(data ?? []).toHaveLength(7);
    for (const row of data ?? []) expect(row.counts_as_activity).toBe(true);
  });
});

describe('signup reconciliation', () => {
  const candidates: AttendeeCandidate[] = [
    { personId: 1, displayName: 'Signed up, came', scoutId: null, tab: 'adult', signedUp: true },
    { personId: 2, displayName: 'Signed up, no-show', scoutId: null, tab: 'adult', signedUp: true },
    { personId: 3, displayName: 'Walked up', scoutId: null, tab: 'adult', signedUp: false }
  ];

  it('Reconcile_FlagsANoShow_WhoSignedUpAndOwesMoney', () => {
    const { missedSignup } = reconcileWithSignup(candidates, new Set([1, 3]));
    expect(missedSignup.map((c) => c.personId)).toEqual([2]);
  });

  it('Reconcile_FlagsAWalkUp_WhoMayNeverHaveBeenInvoiced', () => {
    const { unexpected } = reconcileWithSignup(candidates, new Set([1, 3]));
    expect(unexpected.map((c) => c.personId)).toEqual([3]);
  });

  it('Reconcile_IsQuiet_WhenAttendanceMatchesTheSignup', () => {
    const { missedSignup, unexpected } = reconcileWithSignup(candidates, new Set([1, 2]));
    expect(missedSignup).toHaveLength(0);
    expect(unexpected).toHaveLength(0);
  });
});

/**
 * The cascade itself — the tests that were missing when qa-lead found a
 * credit-duplication bug in it.
 *
 * These call `lib/attendance-admin.ts` directly, which is why that module was
 * extracted out of the server action: logic that nothing can invoke is logic
 * nothing can test, and a green 171-test suite sailed straight past a real
 * duplication bug because of it.
 */
describe('the write cascade', () => {
  const ctx = {
    id: 0,
    entryDate: '2027-09-10',
    title: 'ZZVITEST campout',
    creditKind: 'camping_nights' as const,
    defaultQty: 2
  };

  beforeAll(() => {
    ctx.id = entryId;
  });

  afterEach(async () => {
    await admin.from('ledger_entries').delete().eq('scout_id', SCOUT_ID);
  });

  it('SyncCredit_WritesOneRow_WhenTheScoutIsMarkedPresent', async () => {
    const res = await syncCredit(admin, ctx, scoutPersonId, 2, 'vitest');
    expect(res.ok).toBe(true);

    const { data } = await admin
      .from('ledger_entries')
      .select('qty, unit, kind, code, calendar_entry_id')
      .eq('scout_id', SCOUT_ID);
    expect(data).toHaveLength(1);
    expect(data![0].qty).toBe(2);
    expect(data![0].unit).toBe('nights');
    expect(data![0].calendar_entry_id).toBe(entryId);
  });

  it('SyncCredit_GrantsNoSecondRow_WhenRunTwice', async () => {
    // The bug qa-lead found: the old read-then-branch inserted again whenever
    // its `.maybeSingle()` lookup errored. Now an upsert against a unique
    // index, so duplication is impossible rather than unlikely.
    await syncCredit(admin, ctx, scoutPersonId, 2, 'vitest');
    await syncCredit(admin, ctx, scoutPersonId, 2, 'vitest');
    await syncCredit(admin, ctx, scoutPersonId, 2, 'vitest');

    const { data } = await admin.from('ledger_entries').select('id').eq('scout_id', SCOUT_ID);
    expect(data).toHaveLength(1);
  });

  it('Database_RefusesASecondCredit_ForTheSameEntryAndScout', async () => {
    await syncCredit(admin, ctx, scoutPersonId, 2, 'vitest');
    const { error } = await admin.from('ledger_entries').insert({
      scout_id: SCOUT_ID,
      date: ctx.entryDate,
      kind: 'camping_nights',
      code: `EVT:${entryId}`,
      qty: 2,
      unit: 'nights',
      calendar_entry_id: entryId
    });
    // The guard is in the DB, not just in the application.
    expect(error?.code).toBe('23505');
  });

  it('RetireCredit_SoftDeletes_AndNeverDestroysHistory', async () => {
    await syncCredit(admin, ctx, scoutPersonId, 2, 'vitest');
    const res = await retireCredit(admin, ctx, scoutPersonId, 'vitest');
    expect(res.ok).toBe(true);

    const { data } = await admin
      .from('ledger_entries')
      .select('id, deleted_at, deleted_reason')
      .eq('scout_id', SCOUT_ID);
    expect(data).toHaveLength(1); // still there
    expect(data![0].deleted_at).not.toBeNull();
    expect(data![0].deleted_reason).toContain('Roll Call');
  });

  it('SyncCredit_RevivesTheSameRow_WhenRecheckedAfterAnUncheck', async () => {
    await syncCredit(admin, ctx, scoutPersonId, 2, 'vitest');
    const { data: before } = await admin.from('ledger_entries').select('id').eq('scout_id', SCOUT_ID);
    await retireCredit(admin, ctx, scoutPersonId, 'vitest');
    await syncCredit(admin, ctx, scoutPersonId, 2, 'vitest');

    const { data: after } = await admin
      .from('ledger_entries')
      .select('id, deleted_at')
      .eq('scout_id', SCOUT_ID);
    expect(after).toHaveLength(1);
    expect(after![0].id).toBe(before![0].id); // revived, not replaced
    expect(after![0].deleted_at).toBeNull();
  });

  it('SyncCredit_WritesNothing_ForAnAdult', async () => {
    const res = await syncCredit(admin, ctx, adultPersonId, 2, 'vitest');
    expect(res.ok).toBe(true);
    const { count } = await admin
      .from('ledger_entries')
      .select('id', { count: 'exact', head: true })
      .eq('calendar_entry_id', entryId);
    expect(count).toBe(0);
  });

  it('SyncCredit_WritesNothing_WhenTheCategoryGrantsNoCredit', async () => {
    const res = await syncCredit(
      admin,
      { ...ctx, creditKind: null },
      scoutPersonId,
      2,
      'vitest'
    );
    expect(res.ok).toBe(true);
    const { count } = await admin
      .from('ledger_entries')
      .select('id', { count: 'exact', head: true })
      .eq('scout_id', SCOUT_ID);
    expect(count).toBe(0);
  });

  it('AdoptLegacyCredit_ClaimsAPreRollCallRow_SoItIsNotDuplicated', async () => {
    // What the retired meetings screen used to write: right code, right date,
    // no entry link. Roll Call keys on the link, so without adoption it would
    // insert a second row for the same scout and meeting.
    const meetingCtx = {
      ...ctx,
      creditKind: 'meeting_attendance' as const,
      defaultQty: 1
    };
    await admin.from('ledger_entries').insert({
      scout_id: SCOUT_ID,
      date: meetingCtx.entryDate,
      kind: 'meeting_attendance',
      code: `MTG:${meetingCtx.entryDate}`,
      qty: 1,
      unit: 'each',
      calendar_entry_id: null
    });

    await adoptLegacyCredit(admin, meetingCtx, SCOUT_ID);
    await syncCredit(admin, meetingCtx, scoutPersonId, 1, 'vitest');

    const { data } = await admin
      .from('ledger_entries')
      .select('id, calendar_entry_id')
      .eq('scout_id', SCOUT_ID);
    expect(data).toHaveLength(1);
    expect(data![0].calendar_entry_id).toBe(entryId);
  });
});

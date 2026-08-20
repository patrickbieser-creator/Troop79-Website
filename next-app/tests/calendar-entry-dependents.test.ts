import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { calendarEntryDependents } from '@/lib/calendar-admin';

/**
 * The dry-run info shown before deleteCalendarEntry actually deletes.
 *
 * Pinned here because the FK behavior on the two dependent tables is
 * asymmetric (see roll-call.test.ts's
 * DeletingTheEntry_CascadesAttendance_ButLeavesTheLedgerRow) — a guard that
 * only checked one of them would miss exactly the case that caused the
 * 2026-08-20 incident: a deleted duplicate entry orphaning ledger credit that
 * then read as a stray duplicate and got wiped for real.
 */

const admin = adminClient();
const FIXTURE = `ZZVITEST DepGuard ${process.pid}`;
const SCOUT_ID = `zzvit-dg-${process.pid}`;

let categoryLabel = '';
let scoutPersonId = 0;
let adultPersonId = 0;

beforeAll(async () => {
  categoryLabel = FIXTURE;
  await admin.from('calendar_categories').insert({
    label: categoryLabel,
    color: '#665544',
    sort_order: 9994,
    template: 'activity',
    credit_kind: 'camping_nights',
    credit_unit: 'nights',
    counts_as_activity: true
  });

  const { data: sp } = await admin
    .from('people')
    .insert({ display_name: `${FIXTURE} Scout` })
    .select('id')
    .single();
  scoutPersonId = sp!.id as number;
  await admin.from('scouts').insert({
    id: SCOUT_ID,
    first_name: 'ZZVitest',
    last_name: 'DepGuard',
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
  await admin.from('scouts').delete().eq('id', SCOUT_ID);
  await admin.from('people').delete().in('id', [scoutPersonId, adultPersonId]);
  await admin.from('calendar_categories').delete().eq('label', categoryLabel);
});

describe('calendarEntryDependents', () => {
  it('CalendarEntryDependents_ReturnsZero_WhenNothingReferencesTheEntry', async () => {
    const { data: entry } = await admin
      .from('calendar_entries')
      .insert({ entry_date: '2027-10-01', category: categoryLabel, title: `${FIXTURE} empty` })
      .select('id')
      .single();
    const id = entry!.id as number;

    const dependents = await calendarEntryDependents(admin, id);
    expect(dependents).toEqual({ attendanceCount: 0, creditCount: 0, names: [] });

    await admin.from('calendar_entries').delete().eq('id', id);
  });

  it('CalendarEntryDependents_CountsAttendanceAndCredit_AndNamesEveryoneAffected', async () => {
    const { data: entry } = await admin
      .from('calendar_entries')
      .insert({ entry_date: '2027-10-08', category: categoryLabel, title: `${FIXTURE} full` })
      .select('id')
      .single();
    const id = entry!.id as number;

    // Scout: both attendance and credit. Adult: attendance only (adults have
    // no ledger by design), so the guard must still count and name them.
    await admin.from('event_attendance').insert([
      { calendar_entry_id: id, person_id: scoutPersonId, qty: 2 },
      { calendar_entry_id: id, person_id: adultPersonId, qty: 2 }
    ]);
    await admin.from('ledger_entries').insert({
      scout_id: SCOUT_ID,
      date: '2027-10-08',
      kind: 'camping_nights',
      code: `EVT:${id}`,
      qty: 2,
      unit: 'nights',
      calendar_entry_id: id
    });

    const dependents = await calendarEntryDependents(admin, id);
    expect(dependents.attendanceCount).toBe(2);
    expect(dependents.creditCount).toBe(1);
    expect(dependents.names).toContain(`${FIXTURE} Scout`);
    expect(dependents.names).toContain(`${FIXTURE} Adult`);

    await admin.from('event_attendance').delete().eq('calendar_entry_id', id);
    await admin.from('ledger_entries').delete().eq('scout_id', SCOUT_ID);
    await admin.from('calendar_entries').delete().eq('id', id);
  });

  it('CalendarEntryDependents_IgnoresSoftDeletedCredit_SoAnAlreadyRemovedRowDoesNotWarnTwice', async () => {
    const { data: entry } = await admin
      .from('calendar_entries')
      .insert({ entry_date: '2027-10-15', category: categoryLabel, title: `${FIXTURE} archived credit` })
      .select('id')
      .single();
    const id = entry!.id as number;

    await admin.from('ledger_entries').insert({
      scout_id: SCOUT_ID,
      date: '2027-10-15',
      kind: 'camping_nights',
      code: `EVT:${id}`,
      qty: 2,
      unit: 'nights',
      calendar_entry_id: id,
      deleted_at: new Date().toISOString(),
      deleted_by: 'vitest',
      deleted_reason: 'pre-deleted for this test'
    });

    const dependents = await calendarEntryDependents(admin, id);
    expect(dependents).toEqual({ attendanceCount: 0, creditCount: 0, names: [] });

    await admin.from('ledger_entries').delete().eq('scout_id', SCOUT_ID);
    await admin.from('calendar_entries').delete().eq('id', id);
  });
});

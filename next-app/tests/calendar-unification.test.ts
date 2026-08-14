import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Calendar unification — meetings become a layer on calendar_entries.
 *
 * The invariants worth a DB test are the ones the old model could not express
 * or could silently violate:
 *
 *  1. A meeting cannot exist without a calendar entry. That is the bug this
 *     merge closes — a meeting entered on the Meetings screen never reached the
 *     calendar page, the homepage sidebar, or /calendar.ics, so Outlook and Band
 *     never saw it. After the FK it is structurally impossible.
 *  2. Two meetings may share a date. The old `meeting_date UNIQUE` made a
 *     committee meeting and a troop meeting on one night unrepresentable, and it
 *     is what forced /events/[id] to become the single permalink.
 *  3. One agenda per ENTRY. Two meetings on a night are two entries with one
 *     agenda each — not one entry with two.
 *  4. Deleting the entry takes its agenda layer with it. The entry is the spine.
 */

const admin = adminClient();
const FIXTURE = `ZZVITEST Unification ${process.pid}`;
const SHARED_DATE = '2027-03-07';

let categoryLabel = '';
let entryA: number | null = null;
let entryB: number | null = null;
const meetingIds: number[] = [];

beforeAll(async () => {
  categoryLabel = FIXTURE;
  const { error: catErr } = await admin
    .from('calendar_categories')
    .insert({ label: categoryLabel, color: '#334455', sort_order: 9998, template: 'meeting' });
  if (catErr) throw new Error(`fixture: calendar_categories insert failed: ${catErr.message}`);

  const { data: entries, error: entryErr } = await admin
    .from('calendar_entries')
    .insert([
      { entry_date: SHARED_DATE, category: categoryLabel, title: `${FIXTURE} troop meeting` },
      { entry_date: SHARED_DATE, category: categoryLabel, title: `${FIXTURE} committee meeting` }
    ])
    .select('id');
  if (entryErr || !entries || entries.length !== 2) {
    throw new Error(`fixture: calendar_entries insert failed: ${entryErr?.message}`);
  }
  entryA = entries[0].id;
  entryB = entries[1].id;
});

afterAll(async () => {
  for (const id of meetingIds) await admin.from('meetings').delete().eq('id', id);
  if (entryA) await admin.from('calendar_entries').delete().eq('id', entryA);
  if (entryB) await admin.from('calendar_entries').delete().eq('id', entryB);
  await admin.from('calendar_categories').delete().eq('label', categoryLabel);
});

describe('meetings as a layer on calendar_entries', () => {
  it('Meeting_IsRejected_WhenCalendarEntryIdIsNull', async () => {
    const { error } = await admin
      .from('meetings')
      .insert({ meeting_date: SHARED_DATE, title: `${FIXTURE} orphan` });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/calendar_entry_id/i);
  });

  it('TwoMeetings_CanShareOneDate_WhenBothLinkToDistinctEntries', async () => {
    const { data, error } = await admin
      .from('meetings')
      .insert([
        { calendar_entry_id: entryA, meeting_date: SHARED_DATE, title: `${FIXTURE} A` },
        { calendar_entry_id: entryB, meeting_date: SHARED_DATE, title: `${FIXTURE} B` }
      ])
      .select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    for (const row of data ?? []) meetingIds.push(row.id);
  });

  it('SecondAgenda_IsRejected_WhenTheEntryAlreadyHasOne', async () => {
    const { error } = await admin
      .from('meetings')
      .insert({ calendar_entry_id: entryA, meeting_date: SHARED_DATE, title: `${FIXTURE} dupe` });
    expect(error).not.toBeNull();
    // 23505 — the meetings_calendar_entry_key unique index.
    expect(error?.code).toBe('23505');
  });

  it('DeletingACalendarEntry_CascadesToItsMeetingLayer', async () => {
    const { data: entry } = await admin
      .from('calendar_entries')
      .insert({ entry_date: '2027-03-14', category: categoryLabel, title: `${FIXTURE} doomed` })
      .select('id')
      .single();
    const entryId = entry!.id as number;

    const { data: meeting } = await admin
      .from('meetings')
      .insert({ calendar_entry_id: entryId, meeting_date: '2027-03-14', title: `${FIXTURE} doomed` })
      .select('id')
      .single();
    const meetingId = meeting!.id as number;

    await admin.from('calendar_entries').delete().eq('id', entryId);

    const { data: after } = await admin.from('meetings').select('id').eq('id', meetingId);
    expect(after ?? []).toHaveLength(0);
  });

  /**
   * The invariant worth the most: 1,249 historical check-ins must not be
   * reachable by the new cascade. `meeting_attendance_leaders` and the scout
   * side of attendance are DATE-keyed with no FK to meetings.id, so they are
   * structurally safe — but "safe because a foreign key happens not to exist"
   * is exactly the kind of fact that quietly stops being true. This locks it.
   */
  it('AttendanceRecords_Survive_WhenTheCalendarEntryAndItsAgendaAreDeleted', async () => {
    const attendanceDate = '2027-03-21';
    const { data: entry } = await admin
      .from('calendar_entries')
      .insert({ entry_date: attendanceDate, category: categoryLabel, title: `${FIXTURE} attended` })
      .select('id')
      .single();
    const entryId = entry!.id as number;

    await admin
      .from('meetings')
      .insert({ calendar_entry_id: entryId, meeting_date: attendanceDate, title: `${FIXTURE} attended` });

    // leader_code is an FK to leaders — borrow a real one rather than inventing
    // a code, so this exercises the actual table shape.
    const { data: someLeader } = await admin.from('leaders').select('code').limit(1).single();
    const leaderCode = someLeader!.code as string;

    const { error: attErr } = await admin
      .from('meeting_attendance_leaders')
      .insert({ meeting_date: attendanceDate, leader_code: leaderCode });
    // If the shape of this table ever changes, fail loudly rather than passing
    // a test that silently asserted nothing.
    expect(attErr).toBeNull();

    await admin.from('calendar_entries').delete().eq('id', entryId);

    const { data: survivors } = await admin
      .from('meeting_attendance_leaders')
      .select('meeting_date')
      .eq('meeting_date', attendanceDate);
    expect(survivors ?? []).toHaveLength(1);

    await admin.from('meeting_attendance_leaders').delete().eq('meeting_date', attendanceDate);
  });

  it('EveryMeeting_PointsAtAnEntryOnItsOwnDate', async () => {
    // The guard 20260814120000 enforces at deploy time, held as a standing
    // regression: the backfill's lowest-id tie-break must never mislink.
    const { data } = await admin
      .from('meetings')
      .select('id, meeting_date, calendar_entries!inner(entry_date)');
    const mismatched = (data ?? []).filter((m) => {
      const joined = Array.isArray(m.calendar_entries) ? m.calendar_entries[0] : m.calendar_entries;
      return joined?.entry_date !== m.meeting_date;
    });
    expect(mismatched).toHaveLength(0);
  });

  it('EveryExistingMeeting_HasACalendarEntry_AfterTheBackfill', async () => {
    // The migration's own guard raises if any row is left unlinked, so this is
    // the standing regression: nothing may reintroduce an orphan.
    const { count, error } = await admin
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .is('calendar_entry_id', null);
    expect(error).toBeNull();
    expect(count).toBe(0);
  });
});

describe('category templates', () => {
  it('Category_IsRejected_WhenTemplateIsNotInTheClosedSet', async () => {
    const { error } = await admin
      .from('calendar_categories')
      .insert({
        label: `${FIXTURE} bad template`,
        color: '#000000',
        sort_order: 9997,
        template: 'workshop'
      });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/template/i);
  });

  it('SeededCategories_AllCarryATemplate', async () => {
    const { data, error } = await admin
      .from('calendar_categories')
      .select('label, template')
      .is('template', null)
      // Other test files' fixtures are live in the table while this runs
      // (vitest parallelizes by file) and are deliberately created without a
      // template — the seeded vocabulary is what this asserts about.
      .not('label', 'like', 'ZZVITEST%');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('TheMeetingBehaviorCategory_UsesTheMeetingTemplate', async () => {
    const { data } = await admin
      .from('calendar_categories')
      .select('label, template')
      .eq('behavior', 'meeting')
      .maybeSingle();
    expect(data?.template).toBe('meeting');
  });
});

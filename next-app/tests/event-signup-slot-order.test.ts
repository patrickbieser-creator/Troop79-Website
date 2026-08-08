import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, TEST_PREFIX, type TestEvent } from './helpers/signup-fixtures';
import { loadEventDetail } from '../src/lib/event-signup';

/**
 * Family-facing job order (D-078 follow-up, 2026-08-08).
 *
 * The public slot query used to order by `slot_date, sort` only. Nothing ever
 * writes `sort` — addSlot doesn't set it — so every row holds the schema
 * default 0, which left the whole list tied on both keys. Two consequences
 * this file pins down:
 *
 *   1. Ties had no deterministic resolution at all, so an UPDATE to any job
 *      could silently move it on the page families read.
 *   2. Nothing sorted on `starts_at`, so a day's jobs came back in insertion
 *      order — a 3pm teardown entered before an 8am setup displayed first.
 *
 * Both matter at the scale that prompted the fix: a rummage sale is 30-40
 * jobs entered in whatever order they come to mind, and the family-facing
 * list has to read as a schedule regardless.
 *
 * Exercised through loadEventDetail() rather than a hand-rolled query — the
 * ordering IS the production query, so asserting against a copy of it would
 * pass even if the real one regressed.
 */
describe('Event Signup family-facing job order', () => {
  const admin = adminClient();
  let event: TestEvent;

  beforeAll(async () => {
    event = await createTestEvent(admin);

    // Inserted deliberately worst-case: latest shift first, and the untimed
    // task in the middle, so insertion order contradicts the expected order
    // on every axis. All share sort=0 (the default addSlot leaves behind).
    const rows = [
      {
        label: `${TEST_PREFIX} Teardown`,
        kind: 'shift',
        slot_date: '2027-01-01',
        starts_at: '15:00',
        ends_at: '17:00',
        attendance_required: true
      },
      {
        label: `${TEST_PREFIX} Bake donation`,
        kind: 'task',
        slot_date: null,
        starts_at: null,
        ends_at: null,
        attendance_required: false
      },
      {
        label: `${TEST_PREFIX} Setup crew`,
        kind: 'shift',
        slot_date: '2027-01-01',
        starts_at: '08:00',
        ends_at: '10:00',
        attendance_required: true
      }
    ];

    for (const r of rows) {
      const { error } = await admin
        .from('signup_slots')
        .insert({ event_signup_id: event.eventSignupId, eligibility: 'both', needed: 4, ...r });
      if (error) throw new Error(`fixture: signup_slots insert failed: ${error.message}`);
    }
  });

  afterAll(async () => {
    await deleteTestEvent(admin, event);
  });

  it('Jobs_ReadAsASchedule_WhenEnteredOutOfChronologicalOrder', async () => {
    const detail = await loadEventDetail(event.calendarEntryId);
    const sameDay = (detail?.slots ?? [])
      .filter((s) => s.slot_date === '2027-01-01')
      .map((s) => s.label);

    expect(sameDay).toEqual([`${TEST_PREFIX} Setup crew`, `${TEST_PREFIX} Teardown`]);
  });

  it('UntimedTask_SortsAfterDatedJobs_WhenItHasNoDate', async () => {
    const detail = await loadEventDetail(event.calendarEntryId);
    const labels = (detail?.slots ?? []).map((s) => s.label);

    expect(labels[labels.length - 1]).toBe(`${TEST_PREFIX} Bake donation`);
  });

  it('JobOrder_IsStable_AcrossRepeatedLoads', async () => {
    // The `id` tiebreaker is the point: without it these two reads are only
    // incidentally equal, and an edit between them could reorder the list.
    const first = await loadEventDetail(event.calendarEntryId);
    const second = await loadEventDetail(event.calendarEntryId);

    expect((first?.slots ?? []).map((s) => s.id)).toEqual((second?.slots ?? []).map((s) => s.id));
  });
});

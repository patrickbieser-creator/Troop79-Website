import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, type TestEvent } from './helpers/signup-fixtures';

/**
 * signup_slots.code (migration 20260823130000) — the roster column code for
 * job-heavy events. Optional; 1–5 letters/digits; unique per event, case-
 * insensitively. The app derives a code when it is NULL, so the schema only
 * has to keep leader-entered codes honest.
 */
const admin = adminClient();
let event: TestEvent;
let other: TestEvent;

async function slot(eventSignupId: number, label: string, code: string | null) {
  return admin
    .from('signup_slots')
    .insert({ event_signup_id: eventSignupId, kind: 'task', label, code, attendance_required: false })
    .select('id, code')
    .single();
}

beforeAll(async () => {
  event = await createTestEvent(admin);
  other = await createTestEvent(admin);
});

afterAll(async () => {
  await deleteTestEvent(admin, event);
  await deleteTestEvent(admin, other);
});

describe('signup_slots.code', () => {
  it('Code_IsOptional_AndStoredAsGiven', async () => {
    const { data: bare, error: e1 } = await slot(event.eventSignupId, 'Bring a table', null);
    expect(e1).toBeNull();
    expect(bare?.code).toBeNull();
    const { data: coded, error: e2 } = await slot(event.eventSignupId, 'Cashier', 'CASH');
    expect(e2).toBeNull();
    expect(coded?.code).toBe('CASH');
  });

  it('Code_RejectsMoreThanFiveChars_OrNonAlphanumerics', async () => {
    const { error: tooLong } = await slot(event.eventSignupId, 'Trucks', 'TRUCKS');
    expect(tooLong).not.toBeNull();
    const { error: spaced } = await slot(event.eventSignupId, 'Set up', 'SET U');
    expect(spaced).not.toBeNull();
  });

  it('Code_IsUniquePerEvent_CaseInsensitively_ButFreeAcrossEvents', async () => {
    const { error: dup } = await slot(event.eventSignupId, 'Cash box', 'cash');
    expect(dup).not.toBeNull();
    expect(dup?.code).toBe('23505');
    const { error: elsewhere } = await slot(other.eventSignupId, 'Cashier', 'CASH');
    expect(elsewhere).toBeNull();
  });
});

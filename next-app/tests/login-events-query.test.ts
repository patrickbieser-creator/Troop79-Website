import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { recordLoginEvent, loadRecentLogins, loadAllLogins, loadRecentFailedLogins } from '../src/lib/login-events';

/**
 * Recent Logins dashboard — the real query against real people,
 * person_capabilities, and login_events (Plans/Recent-Logins-Dashboard.md).
 * Integration-style against local Postgres, no mocking.
 */
describe('login-events — query', () => {
  let personIds: number[] = [];
  let eventIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (eventIds.length > 0) await admin.from('login_events').delete().in('id', eventIds);
    if (personIds.length > 0) {
      await admin.from('person_capabilities').delete().in('person_id', personIds);
      await admin.from('people').delete().in('id', personIds);
    }
    eventIds = [];
    personIds = [];
  });

  async function makePerson(admin: ReturnType<typeof adminClient>, label: string): Promise<number> {
    const { data, error } = await admin
      .from('people')
      .insert({ first_name: '[TEST]', last_name: 'Vitest', display_name: `[TEST] Vitest ${label}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: person insert failed: ${error?.message}`);
    const id = data.id as number;
    personIds.push(id);
    return id;
  }

  async function trackEventsFor(admin: ReturnType<typeof adminClient>, personId: number): Promise<void> {
    const { data } = await admin.from('login_events').select('id').eq('person_id', personId);
    for (const row of (data ?? []) as { id: number }[]) eventIds.push(row.id);
  }

  it('RecordsARoleSnapshotOfLeader_ForAPersonHoldingAnyCapability', async () => {
    const admin = adminClient();
    const person = await makePerson(admin, `leader-${Date.now()}`);
    await admin.from('person_capabilities').insert({ person_id: person, capability: 'advancement.write' });

    await recordLoginEvent(admin, { personId: person, method: 'passkey', success: true });
    await trackEventsFor(admin, person);

    const { events } = await loadAllLogins(admin, { limit: 50 });
    const mine = events.find((e) => e.personId === person)!;
    expect(mine.roleSnapshot).toBe('leader');
  });

  it('RecordsARoleSnapshotOfFamily_ForAPersonWithNoCapabilities', async () => {
    const admin = adminClient();
    const person = await makePerson(admin, `family-${Date.now()}`);

    await recordLoginEvent(admin, { personId: person, method: 'code', success: true });
    await trackEventsFor(admin, person);

    const { events } = await loadAllLogins(admin, { limit: 50 });
    const mine = events.find((e) => e.personId === person)!;
    expect(mine.roleSnapshot).toBe('family');
  });

  it('FlagsTheFirstSuccessfulLogin_ButNotTheSecond', async () => {
    const admin = adminClient();
    const person = await makePerson(admin, `firstlogin-${Date.now()}`);

    await recordLoginEvent(admin, { personId: person, method: 'link', success: true });
    await new Promise((r) => setTimeout(r, 10)); // ensure distinct created_at ordering
    await recordLoginEvent(admin, { personId: person, method: 'link', success: true });
    await trackEventsFor(admin, person);

    const { events } = await loadAllLogins(admin, { limit: 50 });
    const mine = events.filter((e) => e.personId === person).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    expect(mine).toHaveLength(2);
    expect(mine[0].isFirstLogin).toBe(true);
    expect(mine[1].isFirstLogin).toBe(false);
  });

  it('ParsesAndStoresTheDeviceLabel_FromTheUserAgent', async () => {
    const admin = adminClient();
    const person = await makePerson(admin, `device-${Date.now()}`);
    await recordLoginEvent(admin, {
      personId: person,
      method: 'code',
      success: true,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
    });
    await trackEventsFor(admin, person);

    const { events } = await loadAllLogins(admin, { limit: 50 });
    const mine = events.find((e) => e.personId === person)!;
    expect(mine.deviceLabel).toBe('Mac - Safari');
  });

  it('loadRecentLogins_ReturnsOnlySuccessfulLogins_NewestFirst', async () => {
    const admin = adminClient();
    const person = await makePerson(admin, `recent-${Date.now()}`);
    await recordLoginEvent(admin, { personId: person, method: 'code', success: false, failureReason: 'invalid' });
    await recordLoginEvent(admin, { personId: person, method: 'code', success: true });
    await trackEventsFor(admin, person);

    const events = await loadRecentLogins(admin, 15);
    const mine = events.filter((e) => e.personId === person);
    expect(mine).toHaveLength(1);
    expect(mine[0].success).toBe(true);
  });

  it('loadRecentFailedLogins_ReturnsOnlyFailures_KeptSeparateFromSuccesses', async () => {
    const admin = adminClient();
    const person = await makePerson(admin, `failed-${Date.now()}`);
    await recordLoginEvent(admin, { personId: person, method: 'code', success: false, failureReason: 'invalid' });
    await recordLoginEvent(admin, { personId: person, method: 'code', success: true });
    await trackEventsFor(admin, person);

    const events = await loadRecentFailedLogins(admin, 15);
    const mine = events.filter((e) => e.personId === person);
    expect(mine).toHaveLength(1);
    expect(mine[0].success).toBe(false);
    expect(mine[0].failureReason).toBe('invalid');
  });

  it('RecordsAFailedLoginWithNoPersonId_WithoutThrowing', async () => {
    // The enumeration-safe case — a wrong email/code combo that never
    // resolved to a real person.
    const admin = adminClient();
    await expect(
      recordLoginEvent(admin, { personId: null, method: 'code', success: false, failureReason: 'invalid' })
    ).resolves.not.toThrow();

    const events = await loadRecentFailedLogins(admin, 50);
    const mine = events.find((e) => e.personId === null && e.failureReason === 'invalid');
    // Cleanup: this row has no personId, so afterEach's person-scoped
    // cleanup can't reach it — delete it directly here.
    if (mine) await admin.from('login_events').delete().eq('id', mine.id);
    expect(mine).toBeDefined();
  });
});

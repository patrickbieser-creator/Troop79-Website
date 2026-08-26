import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  recordLoginEvent,
  loadRecentLogins,
  loadAllLogins,
  loadRecentFailedLogins,
  loadHouseholdsSignedInStats
} from '../src/lib/login-events';

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

  it('LoginEvent_ShowsSentByLeader_WhenTokenWasLeaderSent', async () => {
    // Plans/Verified-Signup.md Phase A: a leader's "Send sign-in link" sets
    // login_tokens.created_by_leader; on redemption the login_events row it
    // produced should carry that leader's label for the dashboard's "…
    // via link sent by {leader}" line. login_events has no token_id, so the
    // join in loadRecentLogins() matches on person_id + a close consumed_at
    // — reproduced here exactly as production writes it: the token's
    // consumed_at set at redemption time, the login_events row inserted
    // moments later by the same request.
    const admin = adminClient();
    const person = await makePerson(admin, `leaderlink-${Date.now()}`);

    const { data: tokenRow, error: tokenErr } = await admin
      .from('login_tokens')
      .insert({
        person_id: person,
        channel: 'email',
        sent_to: 'leader-sent@example.com',
        token_hash: `vitest-attribution-token-${Date.now()}`,
        code_hash: `vitest-attribution-code-${Date.now()}`,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        consumed_at: new Date().toISOString(),
        created_by_leader: '[TEST] Leader Sender'
      })
      .select('id')
      .single();
    if (tokenErr || !tokenRow) throw new Error(`fixture: login_tokens insert failed: ${tokenErr?.message}`);

    try {
      await recordLoginEvent(admin, { personId: person, method: 'code', success: true });
      await trackEventsFor(admin, person);

      const events = await loadRecentLogins(admin, 50);
      const mine = events.find((e) => e.personId === person)!;
      expect(mine.sentByLeader).toBe('[TEST] Leader Sender');
    } finally {
      await admin.from('login_tokens').delete().eq('id', tokenRow.id);
    }
  });

  it('LoginEvent_HasNoSentByLeader_ForASelfServiceSignIn', async () => {
    // Same shape, but no login_tokens row at all (a passkey sign-in, or any
    // redemption where the token carries no created_by_leader) — must not
    // false-match onto an unrelated leader-sent token for a different person.
    const admin = adminClient();
    const person = await makePerson(admin, `selfservice-${Date.now()}`);

    await recordLoginEvent(admin, { personId: person, method: 'passkey', success: true });
    await trackEventsFor(admin, person);

    const events = await loadRecentLogins(admin, 50);
    const mine = events.find((e) => e.personId === person)!;
    expect(mine.sentByLeader).toBeNull();
  });
});

describe('loadHouseholdsSignedInStats', () => {
  let householdIds: number[] = [];
  let personIds: number[] = [];
  let scoutIds: string[] = [];
  let eventIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (eventIds.length > 0) await admin.from('login_events').delete().in('id', eventIds);
    if (scoutIds.length > 0) await admin.from('scouts').delete().in('id', scoutIds);
    if (personIds.length > 0) await admin.from('household_members').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('people').delete().in('id', personIds);
    if (householdIds.length > 0) await admin.from('households').delete().in('id', householdIds);
    householdIds = [];
    personIds = [];
    scoutIds = [];
    eventIds = [];
  });

  async function makeHousehold(admin: ReturnType<typeof adminClient>, label: string): Promise<number> {
    const { data, error } = await admin.from('households').insert({ label: `[TEST] ${label}` }).select('id').single();
    if (error || !data) throw new Error(`fixture: household insert failed: ${error?.message}`);
    householdIds.push(data.id as number);
    return data.id as number;
  }

  async function makeScoutInHousehold(
    admin: ReturnType<typeof adminClient>,
    householdId: number,
    suffix: string
  ): Promise<number> {
    const { data: person, error: personErr } = await admin
      .from('people')
      .insert({ display_name: `[TEST] Scout ${suffix}`, active: true })
      .select('id')
      .single();
    if (personErr || !person) throw new Error(`fixture: scout person insert failed: ${personErr?.message}`);
    personIds.push(person.id as number);

    const scoutId = `vitest-hhsignedin-${suffix}`;
    const { error: scoutErr } = await admin.from('scouts').insert({
      id: scoutId,
      first_name: '[TEST]',
      last_name: 'Vitest',
      display_name: `[TEST] Scout ${suffix}`,
      active: true,
      person_id: person.id
    });
    if (scoutErr) throw new Error(`fixture: scout insert failed: ${scoutErr.message}`);
    scoutIds.push(scoutId);

    const { error: memErr } = await admin
      .from('household_members')
      .insert({ household_id: householdId, person_id: person.id });
    if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);

    return person.id as number;
  }

  async function makeAdultInHousehold(
    admin: ReturnType<typeof adminClient>,
    householdId: number,
    label: string
  ): Promise<number> {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: `[TEST] ${label}`, active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: adult person insert failed: ${error?.message}`);
    const id = data.id as number;
    personIds.push(id);
    const { error: memErr } = await admin.from('household_members').insert({ household_id: householdId, person_id: id });
    if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);
    return id;
  }

  async function trackEventsFor(admin: ReturnType<typeof adminClient>, personId: number): Promise<void> {
    const { data } = await admin.from('login_events').select('id').eq('person_id', personId);
    for (const row of (data ?? []) as { id: number }[]) eventIds.push(row.id);
  }

  it('HouseholdsSignedIn_CountsHouseholdsWithAnySuccessfulLogin', async () => {
    // Shared local DB carries real seed data (Tests/CLAUDE.md), so this
    // asserts the DELTA our own fixtures produce, not an absolute count.
    const admin = adminClient();
    const before = await loadHouseholdsSignedInStats(admin);

    const householdSignedIn = await makeHousehold(admin, 'SignedIn');
    const householdNotSignedIn = await makeHousehold(admin, 'NotSignedIn');
    await makeScoutInHousehold(admin, householdSignedIn, `signedin-${Date.now()}`);
    await makeScoutInHousehold(admin, householdNotSignedIn, `notsignedin-${Date.now()}`);
    // A PARENT signs in, not the scout — still counts toward the household.
    const parent = await makeAdultInHousehold(admin, householdSignedIn, `Parent ${Date.now()}`);

    await recordLoginEvent(admin, { personId: parent, method: 'code', success: true });
    await trackEventsFor(admin, parent);

    const after = await loadHouseholdsSignedInStats(admin);
    expect(after.total).toBe(before.total + 2);
    expect(after.signedIn).toBe(before.signedIn + 1);
  });

  it('HouseholdsSignedIn_IgnoresAFailedLogin', async () => {
    const admin = adminClient();
    const before = await loadHouseholdsSignedInStats(admin);

    const household = await makeHousehold(admin, 'FailedOnly');
    const scoutPersonId = await makeScoutInHousehold(admin, household, `failedonly-${Date.now()}`);

    await recordLoginEvent(admin, { personId: scoutPersonId, method: 'code', success: false, failureReason: 'invalid' });
    await trackEventsFor(admin, scoutPersonId);

    const after = await loadHouseholdsSignedInStats(admin);
    expect(after.total).toBe(before.total + 1);
    expect(after.signedIn).toBe(before.signedIn); // failed login doesn't count
  });
});

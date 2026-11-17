import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Shortcut tracking (Plans/Completed/Admin-Portal-Nav.md decision 12), against real local Postgres. Fixture people are the
 * is_test people (Todd 170 as "me", Alex 85 as someone else); every row this file writes is removed by person id.
 */
const ME = 170;
const OTHER = 85;
const admin = adminClient();

let actorPersonId: number | null = ME;
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () =>
    actorPersonId == null
      ? { kind: 'legacy', label: 'Legacy', personId: null, capabilities: new Set(['advancement.write']), legacyRole: 'leader', subjectKind: null }
      : { kind: 'identity', label: 'Test', personId: actorPersonId, capabilities: new Set(['advancement.write']), legacyRole: null, subjectKind: 'adult' },
  actorCanEnterAdmin: (a: unknown) => a != null
}));

const { logNavOpenForActor: logNavOpenAction } = await import('../src/app/admin/(workspace)/_components/nav-open-log');
const { POST } = await import('../src/app/admin/nav-open/route');
const { logNavOpen, mostOpened } = await import('../src/app/admin/(workspace)/_components/nav-events');

async function clear() {
  await admin.from('admin_nav_events').delete().in('person_id', [ME, OTHER]);
}
async function keysOf(personId: number) {
  const { data } = await admin.from('admin_nav_events').select('feature_key').eq('person_id', personId).order('id');
  return (data ?? []).map((r) => r.feature_key as string);
}

beforeEach(async () => {
  actorPersonId = ME;
  await clear();
});
afterAll(clear);

describe('admin nav events', () => {
  it('NavEvents_LogsOneRowPerOpen', async () => {
    await logNavOpenAction('money.ledger');
    await logNavOpenAction('people.roster');
    expect(await keysOf(ME)).toEqual(['money.ledger', 'people.roster']);
  });

  it('NavEvents_SameOpenWithinSeconds_CountsOnce', async () => {
    await logNavOpenAction('money.ledger');
    await logNavOpenAction('money.ledger');
    expect(await keysOf(ME)).toEqual(['money.ledger']);
  });

  it('NavOpenRoute_LogsTheBodyKey_AndAnswers204', async () => {
    const res = await POST(new Request('http://localhost:3000/admin/nav-open', { method: 'POST', body: 'content.calendar', headers: { origin: 'http://localhost:3000', host: 'localhost:3000' } }));
    expect([res.status, await keysOf(ME)]).toEqual([204, ['content.calendar']]);
  });

  it('NavOpenRoute_RefusesACrossSitePost', async () => {
    const res = await POST(new Request('http://localhost:3000/admin/nav-open', { method: 'POST', body: 'content.calendar', headers: { origin: 'https://evil.example', host: 'localhost:3000' } }));
    expect([res.status, await keysOf(ME)]).toEqual([403, []]);
  });

  it('NavEvents_ScopedToActor_IgnoresClientPersonId', async () => {
    // The action takes only a key: whoever is signed in is the person logged.
    actorPersonId = OTHER;
    await logNavOpenAction('people.roster');
    expect([await keysOf(ME), await keysOf(OTHER)]).toEqual([[], ['people.roster']]);
  });

  it('NavEvents_UnknownKey_LogsNothing', async () => {
    await logNavOpenAction('no.such-thing');
    expect(await keysOf(ME)).toEqual([]);
  });

  it('NavEvents_NoPersonalSignIn_LogsNothing', async () => {
    actorPersonId = null;
    await logNavOpenAction('money.ledger');
    expect(await keysOf(ME)).toEqual([]);
  });

  it('NavEvents_LogPrunesRowsOlderThan90Days', async () => {
    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000).toISOString();
    await admin.from('admin_nav_events').insert([
      { person_id: ME, feature_key: 'content.calendar', at: old },
      { person_id: ME, feature_key: 'people.roster', at: recent },
      { person_id: OTHER, feature_key: 'content.calendar', at: old }
    ]);
    await logNavOpen(admin, ME, 'money.ledger');
    expect([await keysOf(ME), await keysOf(OTHER)]).toEqual([['people.roster', 'money.ledger'], ['content.calendar']]);
  });

  it('MostOpened_CountsThePast30DaysOnly', async () => {
    const day = 24 * 60 * 60 * 1000;
    await admin.from('admin_nav_events').insert([
      { person_id: ME, feature_key: 'content.calendar', at: new Date(Date.now() - 40 * day).toISOString() },
      { person_id: ME, feature_key: 'content.calendar', at: new Date(Date.now() - 35 * day).toISOString() },
      { person_id: ME, feature_key: 'money.ledger', at: new Date(Date.now() - 2 * day).toISOString() }
    ]);
    expect(await mostOpened(admin, ME)).toEqual([{ key: 'money.ledger', count: 1 }]);
  });
});

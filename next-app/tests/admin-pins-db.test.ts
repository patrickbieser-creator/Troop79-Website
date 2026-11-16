import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Pins (Plans/Admin-Portal-Nav.md phase 3), against real local Postgres. The fixture people are the is_test people
 * (Todd 170 as "me", Alex 85 as someone else), and every row this file writes is removed by person id: nobody else
 * pins as a test person.
 */
const ME = 170;
const OTHER = 85;
const admin = adminClient();

const EVERY = ['advancement.write', 'roster.manage', 'calendar.write', 'news.write', 'meeting_plan.use', 'library.moderate', 'library.proxy_view', 'finance.manage', 'finance.view', 'meeting_planner.view', 'meeting_planner.edit', 'meeting_planner.seed'];
let actorPersonId: number | null = ME;
let actorCaps: string[] = EVERY;
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () =>
    actorPersonId === -1
      ? null
      : { kind: 'identity', label: 'Test', personId: actorPersonId, capabilities: new Set(actorCaps), legacyRole: null, subjectKind: 'adult' },
  actorCanEnterAdmin: (a: unknown) => a != null
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { pinFeatureAction, unpinFeatureAction, savePinsAction } = await import('../src/app/admin/(workspace)/_components/pin-actions');
const { loadPinKeys, MAX_PINS } = await import('../src/app/admin/(workspace)/_components/pins-store');

async function clear() {
  await admin.from('admin_pins').delete().in('person_id', [ME, OTHER]);
}

beforeEach(async () => {
  actorPersonId = ME;
  actorCaps = EVERY;
  await clear();
});
afterAll(clear);

describe('admin pins', () => {
  it('Pin_AddsInOrder_FollowsPerson', async () => {
    await pinFeatureAction('money.ledger');
    await pinFeatureAction('advancement.fast-entry');
    expect(await loadPinKeys(admin, ME)).toEqual(['money.ledger', 'advancement.fast-entry']);
  });

  it('Pin_SameItemTwice_KeepsOne', async () => {
    await pinFeatureAction('money.ledger');
    await pinFeatureAction('money.ledger');
    expect(await loadPinKeys(admin, ME)).toEqual(['money.ledger']);
  });

  it('Pin_UnknownKey_Refused', async () => {
    const res = await pinFeatureAction('no.such-thing');
    expect([res.ok, await loadPinKeys(admin, ME)]).toEqual([false, []]);
  });

  it('Pins_ScopedToActor_NeverAnotherPerson', async () => {
    await admin.from('admin_pins').insert({ person_id: OTHER, feature_key: 'money.ledger', position: 0 });
    await unpinFeatureAction('money.ledger');
    await pinFeatureAction('people.roster');
    expect([await loadPinKeys(admin, OTHER), await loadPinKeys(admin, ME)]).toEqual([['money.ledger'], ['people.roster']]);
  });

  it('Pin_ItemThePersonCannotOpen_Refused', async () => {
    actorCaps = ['advancement.write'];
    const res = await pinFeatureAction('money.ledger');
    expect([res.ok, await loadPinKeys(admin, ME)]).toEqual([false, []]);
  });

  it('SavePins_ItemThePersonCannotOpen_Refused', async () => {
    actorCaps = ['advancement.write'];
    const res = await savePinsAction(['advancement.ledger', 'money.ledger']);
    expect([res.ok, await loadPinKeys(admin, ME)]).toEqual([false, []]);
  });

  it('Pin_Home_Refused', async () => {
    expect((await pinFeatureAction('home')).ok).toBe(false);
  });

  it('Unpin_WorksEvenAfterAccessIsGone', async () => {
    await pinFeatureAction('money.ledger');
    actorCaps = ['advancement.write'];
    await unpinFeatureAction('money.ledger');
    expect(await loadPinKeys(admin, ME)).toEqual([]);
  });

  it('Pins_NeedAPersonalSignIn', async () => {
    actorPersonId = null;
    const res = await pinFeatureAction('money.ledger');
    expect(res.ok).toBe(false);
  });

  it('Pins_RefusedWithNoSession', async () => {
    actorPersonId = -1;
    expect((await savePinsAction(['money.ledger'])).ok).toBe(false);
  });

  it('Unpin_RemovesOnlyThatItem', async () => {
    await savePinsAction(['money.ledger', 'people.roster']);
    await unpinFeatureAction('money.ledger');
    expect(await loadPinKeys(admin, ME)).toEqual(['people.roster']);
  });

  it('SavePins_ReplacesTheListInOrder', async () => {
    await savePinsAction(['money.ledger', 'people.roster', 'content.calendar']);
    await savePinsAction(['content.calendar', 'money.ledger']);
    expect(await loadPinKeys(admin, ME)).toEqual(['content.calendar', 'money.ledger']);
  });

  it('SavePins_RefusesRepeatsAndUnknownKeys_ChangingNothing', async () => {
    await savePinsAction(['money.ledger']);
    const a = await savePinsAction(['people.roster', 'people.roster']);
    const b = await savePinsAction(['people.roster', 'no.such']);
    expect([a.ok, b.ok, await loadPinKeys(admin, ME)]).toEqual([false, false, ['money.ledger']]);
  });

  it('Pins_CappedAtMax', async () => {
    const { FEATURES } = await import('../src/app/admin/(workspace)/_components/feature-registry');
    // Admin-area features only: planner links need planner view, which the mocked actor's capabilities decide.
    const pool = FEATURES.filter((f) => f.key !== 'home' && f.href.startsWith('/admin') && !f.healthViewersOnly && f.capability);
    await savePinsAction(pool.slice(0, MAX_PINS).map((f) => f.key));
    const res = await pinFeatureAction(pool[MAX_PINS].key);
    expect([res.ok, (await loadPinKeys(admin, ME)).length]).toEqual([false, MAX_PINS]);
  });

});

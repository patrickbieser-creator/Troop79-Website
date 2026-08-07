import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadHouseholdByKey } from '../src/lib/households';

/**
 * /profile Tier 2 (Plans/Family-Identity-Auth.md Phase 2) — the household-
 * membership boundary submitChangeRequestAction relies on
 * (profile/actions.ts: `party.scouts.some((s) => s.id === scoutId)`), which
 * D-055 shipped with NO test coverage at all (explicit Phase 2 acceptance
 * criterion: "add it here"). submitChangeRequestAction itself isn't
 * unit-testable without a cookie-mocking harness this suite doesn't have
 * (Tests/CLAUDE.md's integration-at-the-DB-layer boundary) — this exercises
 * the exact data check the action's rejection depends on: a verified
 * session's OWN household never contains another household's scout.
 */
describe('profile Tier 2 — household boundary', () => {
  let householdIds: number[] = [];
  let personIds: number[] = [];
  let scoutIds: string[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (scoutIds.length > 0) await admin.from('scouts').delete().in('id', scoutIds);
    if (personIds.length > 0) await admin.from('household_members').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('people').delete().in('id', personIds);
    if (householdIds.length > 0) await admin.from('households').delete().in('id', householdIds);
    householdIds = [];
    personIds = [];
    scoutIds = [];
  });

  async function makeHouseholdWithScout(
    admin: ReturnType<typeof adminClient>,
    label: string,
    suffix: string
  ): Promise<{ householdId: number; scoutId: string }> {
    const { data: household, error: hhErr } = await admin
      .from('households')
      .insert({ label: `[TEST] ${label}` })
      .select('id')
      .single();
    if (hhErr || !household) throw new Error(`fixture: household insert failed: ${hhErr?.message}`);
    householdIds.push(household.id);

    const { data: person, error: personErr } = await admin
      .from('people')
      .insert({ display_name: `[TEST] Scout ${suffix}`, active: true })
      .select('id')
      .single();
    if (personErr || !person) throw new Error(`fixture: person insert failed: ${personErr?.message}`);
    personIds.push(person.id);

    const scoutId = `vitest-tier2-${suffix}`;
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
      .insert({ household_id: household.id, person_id: person.id });
    if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);

    return { householdId: household.id, scoutId };
  }

  it('VerifiedParent_IsRefused_WhenSubmittingForScoutOutsideOwnHousehold', async () => {
    const admin = adminClient();
    const householdA = await makeHouseholdWithScout(admin, 'Household A', `a-${Date.now()}`);
    const householdB = await makeHouseholdWithScout(admin, 'Household B', `b-${Date.now()}`);

    const partyA = await loadHouseholdByKey(String(householdA.householdId));
    // The exact boundary condition submitChangeRequestAction rejects on.
    expect(partyA?.scouts.some((s) => s.id === householdB.scoutId)).toBe(false);
    // And the positive case — A's own scout IS found, so the check isn't
    // trivially always-false.
    expect(partyA?.scouts.some((s) => s.id === householdA.scoutId)).toBe(true);
  });
});

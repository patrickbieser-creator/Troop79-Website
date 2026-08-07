import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadHouseholdByKey } from '../src/lib/households';

/**
 * /library/submit-proof Tier 2-S (Plans/Family-Identity-Auth.md Phase 2) —
 * the exact resolution rule submitProofAction uses for a verified scout
 * session: `party.scouts.find((s) => s.personId === session.personId)`. No
 * form field is consulted at all under Tier 2-S (decision 6: "a scout may
 * only ever claim their own work") — this proves that rule finds ONLY the
 * matching scout even with a sibling scout in the SAME household, not just
 * "some scout in the household". submitProofAction itself isn't
 * unit-testable without a cookie-mocking harness this suite doesn't have
 * (same D-049 boundary as tests/profile-tier2.test.ts).
 */
describe('submit-proof Tier 2-S — scout self-claim boundary', () => {
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

  it('ScoutSession_CanSubmitProof_WhenClaimingOnlyThemselves', async () => {
    const admin = adminClient();
    const { data: household, error: hhErr } = await admin
      .from('households')
      .insert({ label: '[TEST] Siblings' })
      .select('id')
      .single();
    if (hhErr || !household) throw new Error(`fixture: household insert failed: ${hhErr?.message}`);
    const householdId: number = household.id;
    householdIds.push(householdId);

    const suffix = Date.now();
    async function makeSibling(label: string, idx: number): Promise<{ personId: number; scoutId: string }> {
      const { data: person, error: personErr } = await admin
        .from('people')
        .insert({ display_name: `[TEST] ${label}`, active: true })
        .select('id')
        .single();
      if (personErr || !person) throw new Error(`fixture: person insert failed: ${personErr?.message}`);
      personIds.push(person.id);

      const scoutId = `vitest-sib-${suffix}-${idx}`;
      const { error: scoutErr } = await admin.from('scouts').insert({
        id: scoutId,
        first_name: '[TEST]',
        last_name: 'Vitest',
        display_name: `[TEST] ${label}`,
        active: true,
        person_id: person.id
      });
      if (scoutErr) throw new Error(`fixture: scout insert failed: ${scoutErr.message}`);
      scoutIds.push(scoutId);

      const { error: memErr } = await admin
        .from('household_members')
        .insert({ household_id: householdId, person_id: person.id });
      if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);

      return { personId: person.id, scoutId };
    }

    const scoutA = await makeSibling('Scout A', 1);
    const scoutB = await makeSibling('Scout B', 2);

    const party = await loadHouseholdByKey(String(householdId));
    expect(party?.scouts).toHaveLength(2);

    // The Tier 2-S resolution rule, verbatim from submit-proof/actions.ts.
    const resolvedForA = party?.scouts.find((s) => s.personId === scoutA.personId);
    expect(resolvedForA?.id).toBe(scoutA.scoutId);
    expect(resolvedForA?.id).not.toBe(scoutB.scoutId);

    const resolvedForB = party?.scouts.find((s) => s.personId === scoutB.personId);
    expect(resolvedForB?.id).toBe(scoutB.scoutId);
  });
});

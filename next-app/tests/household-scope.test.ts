import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { resolveFamilyScope } from '../src/lib/household-scope';

/**
 * Household scoping (Plans/Troop-Finances.md Phase 3) — the first
 * "your own family only" data-access pattern in this codebase. The negative
 * test (ExcludesUnrelatedPerson) is the one that actually matters: everything
 * else here is a sanity check that the happy path works at all.
 */
describe('resolveFamilyScope', () => {
  let personIds: number[] = [];
  let relationshipIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (relationshipIds.length > 0) {
      await admin.from('relationships').delete().in('id', relationshipIds);
    }
    if (personIds.length > 0) {
      await admin.from('people').delete().in('id', personIds);
    }
    personIds = [];
    relationshipIds = [];
  });

  async function makePerson(name: string): Promise<number> {
    const admin = adminClient();
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: `[TEST] ${name}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
    const id = data.id as number;
    personIds.push(id);
    return id;
  }

  async function makeRelationship(parentId: number, childId: number, type: 'parent_of' | 'guardian_of') {
    const admin = adminClient();
    const { data, error } = await admin
      .from('relationships')
      .insert({ person_id: parentId, related_person_id: childId, type })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: relationships insert failed: ${error?.message}`);
    relationshipIds.push(data.id as number);
  }

  it('ResolveFamilyScope_ReturnsOnlySelf_ForAScoutSession', async () => {
    const admin = adminClient();
    const scoutId = await makePerson('Scout Probe');
    const scope = await resolveFamilyScope(admin, scoutId, 'scout');
    expect(scope).toEqual([scoutId]);
  });

  it('ResolveFamilyScope_IncludesChildren_ForAnAdultWithParentOfRelationships', async () => {
    const admin = adminClient();
    const parentId = await makePerson('Parent Probe');
    const childId = await makePerson('Child Probe');
    await makeRelationship(parentId, childId, 'parent_of');

    const scope = await resolveFamilyScope(admin, parentId, 'adult');
    expect(scope).toEqual(expect.arrayContaining([parentId, childId]));
    expect(scope).toHaveLength(2);
  });

  it('ResolveFamilyScope_IncludesGuardianOfChildren_SameAsParentOf', async () => {
    const admin = adminClient();
    const guardianId = await makePerson('Guardian Probe');
    const wardId = await makePerson('Ward Probe');
    await makeRelationship(guardianId, wardId, 'guardian_of');

    const scope = await resolveFamilyScope(admin, guardianId, 'adult');
    expect(scope).toEqual(expect.arrayContaining([guardianId, wardId]));
  });

  it('ResolveFamilyScope_ExcludesUnrelatedPerson_EvenWhenBothAreAdults', async () => {
    // The actual security-relevant test: no relationship row means no scope,
    // regardless of any other kind of shared context.
    const admin = adminClient();
    const parentId = await makePerson('Scoped Parent Probe');
    const strangerId = await makePerson('Unrelated Adult Probe');

    const scope = await resolveFamilyScope(admin, parentId, 'adult');
    expect(scope).not.toContain(strangerId);
  });

  it('ResolveFamilyScope_ReturnsOnlySelf_ForAnAdultWithNoChildren', async () => {
    const admin = adminClient();
    const adultId = await makePerson('Childless Adult Probe');
    const scope = await resolveFamilyScope(admin, adultId, 'adult');
    expect(scope).toEqual([adultId]);
  });
});

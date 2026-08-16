import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  CAPABILITIES,
  wouldOrphanCapability,
  loadPersonAuthz,
  hasAnyCapability,
  type Capability
} from '../src/lib/capabilities';
import { satisfiesLegacyRole } from '../src/lib/require-role';
import type { AdminActor } from '../src/lib/admin-actor';

/**
 * Unified Identity & Capabilities — Phase B
 * (Plans/Unified-Identity-And-Capabilities.md).
 *
 * The cookie-reading half (resolveAdminActor, requireCapability) is not
 * exercised here: this suite has no cookie-mocking infrastructure, which is
 * D-049's stated boundary and the same reason
 * Family-Identity-Auth.md tested proofSubmissionAllowedFor() directly rather
 * than the Server Action. What IS tested is every decision those functions
 * delegate to — the orphan rule, the epoch comparison, and the
 * any-capability question that gates the workspace.
 */

describe('capabilities — Phase B', () => {
  let personIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (personIds.length > 0) {
      await admin.from('person_capabilities').delete().in('person_id', personIds);
      await admin.from('people').delete().in('id', personIds);
    }
    personIds = [];
  });

  async function makePerson(admin: ReturnType<typeof adminClient>): Promise<number> {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: '[TEST] Phase B', active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
    personIds.push(data.id as number);
    return data.id as number;
  }

  // ── the orphan rule (pure) ───────────────────────────────────────────────

  it('Revoke_IsRefused_WhenPersonIsTheLastHolder', () => {
    expect(wouldOrphanCapability([42], 42)).toBe(true);
  });

  it('Revoke_IsAllowed_WhenAnotherHolderRemains', () => {
    expect(wouldOrphanCapability([42, 43], 42)).toBe(false);
  });

  it('Revoke_IsAllowed_WhenPersonDoesNotHoldItAtAll', () => {
    // Revoking a grant that isn't there is a no-op, not an orphaning — the
    // guard must not turn a harmless double-click into an error.
    expect(wouldOrphanCapability([43], 42)).toBe(false);
    expect(wouldOrphanCapability([], 42)).toBe(false);
  });

  it('Revoke_IsRefused_WhenDuplicateRowsNameOnlyThatPerson', () => {
    // Defensive: the primary key prevents duplicates today, but the rule
    // should not depend on that to reach the right answer.
    expect(wouldOrphanCapability([42, 42], 42)).toBe(true);
  });

  // ── the workspace gate ───────────────────────────────────────────────────

  it('AdminAccess_IsRefused_WhenPersonHoldsNoCapability', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    const authz = await loadPersonAuthz(admin, personId);
    expect(await hasAnyCapability(admin, personId, authz!.sessionEpoch)).toBe(false);
  });

  it('AdminAccess_IsGranted_WhenPersonHoldsAnySingleCapability', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    await admin.from('person_capabilities').insert({ person_id: personId, capability: 'news.write' });
    const authz = await loadPersonAuthz(admin, personId);
    expect(await hasAnyCapability(admin, personId, authz!.sessionEpoch)).toBe(true);
  });

  it('AdminAccess_IsRefused_WhenEpochWasBumpedAfterSignIn', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    await admin.from('person_capabilities').insert({ person_id: personId, capability: 'roster.manage' });
    const issued = await loadPersonAuthz(admin, personId);

    // A leader hitting "Revoke sessions", or a roster deactivation trigger.
    await admin.from('people').update({ session_epoch: issued!.sessionEpoch + 1 }).eq('id', personId);

    // The grant is untouched — revocation is about the SESSION, not the role.
    const after = await loadPersonAuthz(admin, personId);
    expect(after!.capabilities.has('roster.manage')).toBe(true);
    expect(await hasAnyCapability(admin, personId, issued!.sessionEpoch)).toBe(false);
  });

  // ── the legacy-role shim: must never WIDEN privilege ─────────────────────

  function identityActor(caps: Capability[]): AdminActor {
    return {
      kind: 'identity',
      label: '[TEST] Actor',
      personId: 999,
      capabilities: new Set(caps),
      legacyRole: null
    };
  }

  it('LegacyLeaderRole_IsRefused_WhenIdentityActorHoldsOnlySomeCapabilities', () => {
    // The widening this guard exists to prevent: an ASM with calendar.write
    // reaching the advancement ledger, because requireRole(['leader']) guards
    // 129 call sites that mean many different things.
    expect(satisfiesLegacyRole(identityActor(['calendar.write']), 'leader')).toBe(false);
    expect(
      satisfiesLegacyRole(identityActor(['calendar.write', 'news.write', 'meeting_plan.use']), 'leader')
    ).toBe(false);
  });

  it('LegacyLeaderRole_IsSatisfied_WhenIdentityActorHoldsEveryCapability', () => {
    expect(satisfiesLegacyRole(identityActor([...CAPABILITIES]), 'leader')).toBe(true);
  });

  it('LegacyLeaderRole_IsRefused_WhenExactlyOneCapabilityIsMissing', () => {
    const allButOne = CAPABILITIES.filter((c) => c !== 'library.proxy_view');
    expect(satisfiesLegacyRole(identityActor([...allButOne]), 'leader')).toBe(false);
  });

  it('LegacyScoutRole_IsSatisfied_WhenIdentityActorHoldsNewsWrite', () => {
    expect(satisfiesLegacyRole(identityActor(['news.write']), 'scout')).toBe(true);
    expect(satisfiesLegacyRole(identityActor(['calendar.write']), 'scout')).toBe(false);
  });

  it('LegacyActor_MatchesOnItsOwnRole_AndNotTheOther', () => {
    const leader: AdminActor = {
      kind: 'legacy',
      label: 'Patrick B',
      personId: 82,
      capabilities: new Set(CAPABILITIES),
      legacyRole: 'leader'
    };
    expect(satisfiesLegacyRole(leader, 'leader')).toBe(true);
    expect(satisfiesLegacyRole(leader, 'scout')).toBe(false);

    const scout: AdminActor = {
      kind: 'legacy',
      label: 'Some Scout',
      personId: null,
      capabilities: new Set<Capability>(['news.write']),
      legacyRole: 'scout'
    };
    // A legacy scout must NOT be admitted to leader surfaces just because the
    // shim gives them news.write — the role is the authority on that path.
    expect(satisfiesLegacyRole(scout, 'leader')).toBe(false);
    expect(satisfiesLegacyRole(scout, 'scout')).toBe(true);
  });

  // ── seed-wide invariant: nothing is orphaned right now ───────────────────

  it('EveryCapability_HasAtLeastOneHolder_OrIsDeliberatelyUnassigned', async () => {
    const admin = adminClient();
    const { data } = await admin.from('person_capabilities').select('capability');
    const held = new Set(((data ?? []) as { capability: string }[]).map((r) => r.capability));

    // roster.manage and library.moderate are the two the seed leaves to be
    // assigned by name (Open Question 7). Everything else must have a holder,
    // or a converted page in Phase B2 would be unreachable by anyone.
    const mustHaveHolder = CAPABILITIES.filter(
      (c) => c !== 'library.moderate' && c !== 'library.proxy_view'
    );
    for (const cap of mustHaveHolder) {
      expect(held.has(cap), `${cap} is held by nobody`).toBe(true);
    }
  });
});

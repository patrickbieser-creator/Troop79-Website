import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadScoutRankProgress, loadScoutMbAwardMap, loadActiveScoutsList } from '../src/lib/library-data';
import { loadPersonAuthz, type Capability } from '../src/lib/capabilities';
import { actorCanProxyLibrary, actorIsLibraryLeader } from '../src/lib/library-viewer';
import type { AdminActor } from '../src/lib/admin-actor';
import { rankReqKey } from '../src/lib/library';

/**
 * Resource Library scout-progress personalization (Patrick, 2026-08-07) —
 * the DB-touching pieces of lib/library-viewer.ts's resolution chain that
 * don't require a cookie-mocking harness this suite doesn't have (same
 * D-049 boundary as tests/submit-proof-tier2.test.ts: cookies()-reading
 * functions aren't unit-testable here, so this proves the underlying rules
 * they compose instead).
 *
 * The superuser-proxy tests below moved onto `person_capabilities` /
 * `library.proxy_view` on 2026-08-17 (Plans/Unified-Identity-And-Capabilities.md)
 * — they used to exercise the leader-LABEL-to-CODE resolution against the now
 * -dead `library_superusers` table, which nothing in lib/library-viewer.ts
 * reads anymore. The real risk in the new model isn't label resolution
 * (resolveAdminActor() carries personId directly) — it's that
 * `library.proxy_view` is grantable to ANY person_id, including a scout's
 * (the 'librarian' bundle pairs it with library.moderate, and "Librarian" is
 * a real youth position of responsibility), so actorCanProxyLibrary() must
 * refuse a scout actor even when the grant is present (qa-lead review,
 * 2026-08-17, the bug this file's tests originally missed).
 */
describe('Resource Library scout progress', () => {
  let scoutIds: string[] = [];
  let ledgerEntryIds: number[] = [];
  let personIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (ledgerEntryIds.length > 0) {
      await admin.from('ledger_entries').delete().in('id', ledgerEntryIds);
    }
    if (personIds.length > 0) {
      await admin.from('person_capabilities').delete().in('person_id', personIds);
      await admin.from('people').delete().in('id', personIds);
    }
    if (scoutIds.length > 0) {
      await admin.from('scouts').delete().in('id', scoutIds);
    }
    scoutIds = [];
    ledgerEntryIds = [];
    personIds = [];
  });

  async function makePerson(admin: ReturnType<typeof adminClient>): Promise<number> {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: '[TEST] Library Vitest', active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
    personIds.push(data.id as number);
    return data.id as number;
  }

  async function makeScout(
    admin: ReturnType<typeof adminClient>,
    suffix: string,
    active = true
  ): Promise<string> {
    const id = `vitest-lib-${suffix}`;
    const { error } = await admin.from('scouts').insert({
      id,
      first_name: '[TEST]',
      last_name: 'Vitest',
      display_name: `[TEST] Vitest ${suffix}`,
      active,
      // scouts_inactive_reason_only_when_inactive requires this whenever
      // active=false.
      inactive_reason: active ? null : 'other'
    });
    if (error) throw new Error(`fixture: scout insert failed: ${error.message}`);
    scoutIds.push(id);
    return id;
  }

  async function makeLedgerEntry(
    admin: ReturnType<typeof adminClient>,
    scoutId: string,
    kind: 'rank_requirement' | 'merit_badge_award',
    code: string,
    date: string
  ): Promise<void> {
    const { data, error } = await admin
      .from('ledger_entries')
      .insert({ scout_id: scoutId, kind, code, date })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: ledger entry insert failed: ${error?.message}`);
    ledgerEntryIds.push(data.id as number);
  }

  it('RankProgress_MapsCompositeKeyToDate_ForOnlyThatScout', async () => {
    const admin = adminClient();
    const scoutA = await makeScout(admin, `ranka-${Date.now()}`);
    const scoutB = await makeScout(admin, `rankb-${Date.now()}`);
    const key = rankReqKey('tenderfoot', '1a');
    await makeLedgerEntry(admin, scoutA, 'rank_requirement', key, '2026-01-15');
    await makeLedgerEntry(admin, scoutB, 'rank_requirement', key, '2026-02-01');

    const progressA = await loadScoutRankProgress(admin, scoutA);
    expect(progressA.get(key)).toBe('2026-01-15');

    const progressB = await loadScoutRankProgress(admin, scoutB);
    expect(progressB.get(key)).toBe('2026-02-01');
    // Each scout's map is scoped to that scout only — not a shared troop-wide read.
    expect(progressA.size).toBe(1);
  });

  it('MbAwardMap_StripsMbPrefix_AndIgnoresRequirementRows', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `mb-${Date.now()}`);
    await makeLedgerEntry(admin, scout, 'merit_badge_award', 'MB:first-aid', '2026-03-10');
    // A requirement-leaf row for the SAME badge uses the '{mbId}-{code}'
    // composite, not 'MB:{mbId}' — must not be mistaken for the award itself.
    await makeLedgerEntry(admin, scout, 'rank_requirement', 'scout-1a', '2026-03-11');

    const awards = await loadScoutMbAwardMap(admin, scout);
    expect(awards.get('first-aid')).toBe('2026-03-10');
    expect(awards.has('MB:first-aid')).toBe(false); // key is the bare mbId, prefix stripped
    expect(awards.size).toBe(1);
  });

  it('ActiveScoutsList_ExcludesInactiveScouts', async () => {
    const admin = adminClient();
    const suffix = Date.now();
    const active = await makeScout(admin, `active-${suffix}`, true);
    const inactive = await makeScout(admin, `inactive-${suffix}`, false);

    const list = await loadActiveScoutsList(admin);
    const ids = list.map((s) => s.id);
    expect(ids).toContain(active);
    expect(ids).not.toContain(inactive);
  });

  it('PersonAuthz_HoldsLibraryProxyView_WhenGranted', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    const { error } = await admin
      .from('person_capabilities')
      .insert({ person_id: personId, capability: 'library.proxy_view' });
    if (error) throw new Error(`fixture: person_capabilities insert failed: ${error.message}`);

    const authz = await loadPersonAuthz(admin, personId);
    expect(authz?.capabilities.has('library.proxy_view')).toBe(true);
  });

  it('PersonAuthz_LacksLibraryProxyView_WhenNotGranted', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    // Deliberately no person_capabilities row for this person.

    const authz = await loadPersonAuthz(admin, personId);
    expect(authz?.capabilities.has('library.proxy_view')).toBe(false);
  });

  // ── actorCanProxyLibrary / actorIsLibraryLeader (pure — no DB) ───────────
  //
  // These are the exact decision resolveLibraryViewer()/viewerIsLeader() run
  // behind their cookie-reading boundary (same D-049 split as
  // satisfiesLegacyRole() in tests/capabilities-phase-b.test.ts). The scout
  // cases are the actual regression this file exists to guard now: a scout
  // CAN legitimately hold `library.proxy_view` (the 'librarian' bundle pairs
  // it with library.moderate, and Librarian is a real youth position of
  // responsibility) — the guard must refuse them anyway.

  function actor(overrides: Partial<AdminActor> & { capabilities?: Set<Capability> }): AdminActor {
    return {
      kind: 'identity',
      label: '[TEST] Actor',
      personId: 999,
      capabilities: new Set<Capability>(),
      legacyRole: null,
      subjectKind: 'adult',
      ...overrides
    };
  }

  it('ActorCanProxyLibrary_IsFalse_WhenActorIsNull', () => {
    expect(actorCanProxyLibrary(null)).toBe(false);
  });

  it('ActorCanProxyLibrary_IsFalse_WhenGrantIsMissing', () => {
    expect(actorCanProxyLibrary(actor({ capabilities: new Set<Capability>() }))).toBe(false);
  });

  it('ActorCanProxyLibrary_IsTrue_ForAnAdultHoldingTheGrant', () => {
    expect(
      actorCanProxyLibrary(actor({ capabilities: new Set<Capability>(['library.proxy_view']) }))
    ).toBe(true);
  });

  it('ActorCanProxyLibrary_IsFalse_ForAScoutHoldingTheGrant', () => {
    // The bug: a scout granted the 'librarian' bundle (library.moderate +
    // library.proxy_view) must never be able to proxy every active scout's
    // advancement progress just because the grant is present.
    expect(
      actorCanProxyLibrary(
        actor({ subjectKind: 'scout', capabilities: new Set<Capability>(['library.proxy_view']) })
      )
    ).toBe(false);
  });

  it('ActorIsLibraryLeader_IsFalse_ForAScoutHoldingAnyCapability', () => {
    // A youth leader (SPL/PL) can legitimately hold meeting_plan.use via the
    // youth_leader bundle without becoming an adult leader for the purposes
    // of leaders-only Library material.
    expect(
      actorIsLibraryLeader(
        actor({ subjectKind: 'scout', capabilities: new Set<Capability>(['meeting_plan.use']) })
      )
    ).toBe(false);
  });

  it('ActorIsLibraryLeader_IsTrue_ForAnAdultHoldingAnyCapability', () => {
    expect(
      actorIsLibraryLeader(actor({ capabilities: new Set<Capability>(['meeting_plan.use']) }))
    ).toBe(true);
  });

  it('ActorIsLibraryLeader_IsFalse_WhenActorHoldsNoCapability', () => {
    expect(actorIsLibraryLeader(actor({ capabilities: new Set<Capability>() }))).toBe(false);
  });
});

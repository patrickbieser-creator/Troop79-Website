import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  loadScoutRankProgress,
  loadScoutMbAwardMap,
  loadActiveScoutsList,
  loadLibrarySuperuserCodes
} from '../src/lib/library-data';
import { loadAuthorizedAdults, matchAuthorizedAdult } from '../src/lib/authorized-adults';
import { rankReqKey } from '../src/lib/library';

/**
 * Resource Library scout-progress personalization (Patrick, 2026-08-07) —
 * the DB-touching pieces of lib/library-viewer.ts's resolution chain that
 * don't require a cookie-mocking harness this suite doesn't have (same
 * D-049 boundary as tests/submit-proof-tier2.test.ts: cookies()-reading
 * functions aren't unit-testable here, so this proves the underlying rules
 * they compose instead).
 *
 * The one thing worth a dedicated test even without cookie mocking: the
 * leader-LABEL-to-CODE resolution tech-lead flagged as the real risk in this
 * feature's design review — `library_superusers.leader_code` is keyed on
 * `leaders.code`, but a leader session only ever carries a display LABEL
 * ("Mike Ba."), never the code. Getting that resolution wrong would silently
 * disable every superuser grant.
 */
describe('Resource Library scout progress', () => {
  let scoutIds: string[] = [];
  let ledgerEntryIds: number[] = [];
  let leaderCodes: string[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (ledgerEntryIds.length > 0) {
      await admin.from('ledger_entries').delete().in('id', ledgerEntryIds);
    }
    if (leaderCodes.length > 0) {
      await admin.from('library_superusers').delete().in('leader_code', leaderCodes);
      await admin.from('leaders').delete().in('code', leaderCodes);
    }
    if (scoutIds.length > 0) {
      await admin.from('scouts').delete().in('id', scoutIds);
    }
    scoutIds = [];
    ledgerEntryIds = [];
    leaderCodes = [];
  });

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

  it('SuperuserLabel_ResolvesToCode_ThenMatchesTheGrant', async () => {
    // The exact chain lib/library-viewer.ts runs: a leader session carries
    // ONLY session.leader (a display label like "Mike Ba."), never
    // leaders.code — resolveLibraryViewer must resolve label -> code via
    // matchAuthorizedAdult() BEFORE checking library_superusers, or every
    // grant silently fails to gate anyone in.
    const admin = adminClient();
    const code = `VT${Date.now() % 100000}`;
    leaderCodes.push(code);
    const { error: leaderErr } = await admin.from('leaders').insert({
      code,
      name: '[TEST] Superuser Vitest',
      is_person: true,
      can_login: true
    });
    if (leaderErr) throw new Error(`fixture: leader insert failed: ${leaderErr.message}`);
    const { error: suErr } = await admin.from('library_superusers').insert({ leader_code: code });
    if (suErr) throw new Error(`fixture: library_superusers insert failed: ${suErr.message}`);

    const adults = await loadAuthorizedAdults(admin);
    const fixture = adults.find((a) => a.code === code);
    expect(fixture).toBeTruthy();

    // Simulates the session carrying the auto-derived LABEL, same as what
    // admin/login/actions.ts stores at login time (matched.label).
    const matched = matchAuthorizedAdult(adults, fixture!.label);
    expect(matched?.code).toBe(code);

    const superuserCodes = await loadLibrarySuperuserCodes(admin);
    expect(superuserCodes.has(matched!.code)).toBe(true);
  });

  it('NonSuperuserLeader_IsNotInTheGrantSet', async () => {
    const admin = adminClient();
    const code = `VT${(Date.now() + 1) % 100000}`;
    leaderCodes.push(code);
    const { error } = await admin.from('leaders').insert({
      code,
      name: '[TEST] Plain Leader Vitest',
      is_person: true,
      can_login: true
    });
    if (error) throw new Error(`fixture: leader insert failed: ${error.message}`);
    // Deliberately no library_superusers row for this leader.

    const superuserCodes = await loadLibrarySuperuserCodes(admin);
    expect(superuserCodes.has(code)).toBe(false);
  });
});

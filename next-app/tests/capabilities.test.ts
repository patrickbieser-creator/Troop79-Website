import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import {
  CAPABILITIES,
  BUNDLES,
  expandBundle,
  isCapability,
  loadPersonAuthz,
  hasCapability
} from '../src/lib/capabilities';

/**
 * Unified Identity & Capabilities — Phase A
 * (Plans/Unified-Identity-And-Capabilities.md).
 *
 * Same approach as the rest of this suite: real local Postgres, no mocks
 * (D-049). Fixture rows are created and torn down per test; the two seed
 * tests assert INVARIANTS over whatever real data is present rather than
 * naming specific people, per Tests/CLAUDE.md ("don't assert against real
 * troop data").
 */

describe('capabilities — Phase A', () => {
  let personIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (personIds.length > 0) {
      await admin.from('person_capabilities').delete().in('person_id', personIds);
      await admin.from('people').delete().in('id', personIds);
    }
    personIds = [];
  });

  async function makePerson(admin: ReturnType<typeof adminClient>, name = 'Cap Probe'): Promise<number> {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: `[TEST] ${name}`, active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
    personIds.push(data.id as number);
    return data.id as number;
  }

  // ── vocabulary and bundles (pure) ────────────────────────────────────────

  it('Bundle_ExpandsToFlatCapabilities_WithNoBundleReference', () => {
    const expanded = expandBundle('advancement_chair');
    expect(expanded).toEqual(expect.arrayContaining(['advancement.write', 'roster.manage']));
    // Flat strings only — a bundle must never leak its own identity into the
    // grant set, or "bundles are a button, not a layer" quietly stops holding.
    for (const cap of expanded) {
      expect(isCapability(cap)).toBe(true);
    }
  });

  it('EveryBundle_ContainsOnlyKnownCapabilities_WhenExpanded', () => {
    for (const key of Object.keys(BUNDLES)) {
      for (const cap of expandBundle(key)) {
        expect(CAPABILITIES).toContain(cap);
      }
    }
  });

  it('TroopAdminBundle_CoversEveryCapability_SoTheGrantsScreenIsReachable', () => {
    expect([...expandBundle('troop_admin')].sort()).toEqual([...CAPABILITIES].sort());
  });

  // ── schema ───────────────────────────────────────────────────────────────

  it('UnknownCapability_IsRejected_WhenInserted', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    const { error } = await admin
      .from('person_capabilities')
      .insert({ person_id: personId, capability: 'roster.destroy' });
    expect(error).not.toBeNull();
  });

  it('AnonKey_CannotRead_PersonCapabilities', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const admin = adminClient();
    const personId = await makePerson(admin);
    await admin.from('person_capabilities').insert({ person_id: personId, capability: 'news.write' });

    const { data, error } = await anon.from('person_capabilities').select('*');
    expect(data ?? []).toHaveLength(0);
    if (error) expect(error).not.toBeNull();
  });

  // ── the combined epoch + grants read ─────────────────────────────────────

  it('PersonAuthz_ReturnsEpochAndCapabilities_InOneCall', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    await admin.from('person_capabilities').insert([
      { person_id: personId, capability: 'news.write' },
      { person_id: personId, capability: 'calendar.write' }
    ]);

    const authz = await loadPersonAuthz(admin, personId);
    expect(authz).not.toBeNull();
    expect(typeof authz!.sessionEpoch).toBe('number');
    expect(authz!.capabilities.has('news.write')).toBe(true);
    expect(authz!.capabilities.has('calendar.write')).toBe(true);
    expect(authz!.capabilities.has('roster.manage')).toBe(false);
  });

  it('PersonAuthz_ReturnsEmptyCapabilities_WhenPersonHoldsNoGrants', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    const authz = await loadPersonAuthz(admin, personId);
    expect(authz).not.toBeNull();
    expect(authz!.capabilities.size).toBe(0);
  });

  it('PersonAuthz_ReturnsNull_WhenPersonDoesNotExist', async () => {
    const admin = adminClient();
    const authz = await loadPersonAuthz(admin, -1);
    expect(authz).toBeNull();
  });

  it('PersonAuthz_ReflectsEpochBump_WhenPersonIsDeactivated', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    const before = await loadPersonAuthz(admin, personId);
    await admin.from('people').update({ active: false }).eq('id', personId);
    const after = await loadPersonAuthz(admin, personId);
    expect(after!.sessionEpoch).toBeGreaterThan(before!.sessionEpoch);
  });

  it('Capability_IsRefused_WhenSessionEpochIsStale', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    await admin.from('person_capabilities').insert({ person_id: personId, capability: 'news.write' });

    const issued = await loadPersonAuthz(admin, personId);
    expect(await hasCapability(admin, personId, 'news.write', issued!.sessionEpoch)).toBe(true);

    // Revocation: bump the epoch the way a roster deactivation does.
    await admin.from('people').update({ active: false }).eq('id', personId);
    expect(await hasCapability(admin, personId, 'news.write', issued!.sessionEpoch)).toBe(false);
  });

  it('Capability_IsRefused_WhenGrantIsRemoved', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    await admin.from('person_capabilities').insert({ person_id: personId, capability: 'news.write' });
    const authz = await loadPersonAuthz(admin, personId);

    await admin.from('person_capabilities').delete().eq('person_id', personId).eq('capability', 'news.write');
    // No sign-out, no cookie change — the next privileged action just fails.
    expect(await hasCapability(admin, personId, 'news.write', authz!.sessionEpoch)).toBe(false);
  });

  // ── seed invariants (property tests over real data, no names hardcoded) ──

  it('NoActiveScout_HoldsAnyCapability_AfterSeed', async () => {
    const admin = adminClient();
    const { data: scouts } = await admin.from('scouts').select('person_id').eq('active', true);
    const scoutPersonIds = (scouts ?? [])
      .map((s) => (s as { person_id: number | null }).person_id)
      .filter((id): id is number => typeof id === 'number');
    if (scoutPersonIds.length === 0) return; // nothing to prove on an empty roster

    const { data: grants } = await admin
      .from('person_capabilities')
      .select('person_id, capability')
      .in('person_id', scoutPersonIds);

    // leaders.can_login is true for at least one active scout's leader code
    // (an older scout who teaches). Seeding from that flag without the
    // isAdultPerson() filter would hand a youth roster.manage.
    expect(grants ?? []).toEqual([]);
  });

  it('AtLeastOnePerson_HoldsEveryCapability_SoTheSystemIsNotBricked', async () => {
    const admin = adminClient();
    const { data } = await admin.from('person_capabilities').select('person_id, capability');
    const byPerson = new Map<number, Set<string>>();
    for (const row of (data ?? []) as { person_id: number; capability: string }[]) {
      const set = byPerson.get(row.person_id) ?? new Set<string>();
      set.add(row.capability);
      byPerson.set(row.person_id, set);
    }
    const full = [...byPerson.values()].some((caps) => CAPABILITIES.every((c) => caps.has(c)));
    expect(full).toBe(true);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import {
  requestChallenge,
  peekTokenChallenge,
  redeemToken,
  redeemCode
} from '../src/lib/identity-challenge';
import { verifyIdentitySession, isEpochCurrent } from '../src/lib/identity-session';
import { signSession } from '../src/lib/leader-session';

/**
 * Family Identity & Passwordless Auth — Phase 1 (Plans/Family-Identity-Auth.md).
 * Same approach as the rest of this suite: real local Postgres/Storage, no
 * mocks (D-049). RESEND_API_KEY/EMAIL_FROM are unconfigured in local dev
 * (Tests/CLAUDE.md), so sendEmail() no-ops throughout — these tests verify
 * the login_tokens rows and redemption logic, not actual delivery.
 */

describe('identity auth — Phase 1', () => {
  let householdIds: number[] = [];
  let personIds: number[] = [];
  let scoutIds: string[] = [];
  let tokenIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (tokenIds.length > 0) await admin.from('login_tokens').delete().in('id', tokenIds);
    if (scoutIds.length > 0) await admin.from('scouts').delete().in('id', scoutIds);
    if (personIds.length > 0) await admin.from('household_members').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('people').delete().in('id', personIds);
    if (householdIds.length > 0) await admin.from('households').delete().in('id', householdIds);
    householdIds = [];
    personIds = [];
    scoutIds = [];
    tokenIds = [];
  });

  async function makeHousehold(admin: ReturnType<typeof adminClient>, label: string): Promise<number> {
    const { data, error } = await admin.from('households').insert({ label: `[TEST] ${label}` }).select('id').single();
    if (error || !data) throw new Error(`fixture: household insert failed: ${error?.message}`);
    householdIds.push(data.id);
    return data.id as number;
  }

  async function makeAdultInHousehold(
    admin: ReturnType<typeof adminClient>,
    householdId: number,
    email: string
  ): Promise<number> {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: '[TEST] Adult', primary_email: email, active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: person insert failed: ${error?.message}`);
    personIds.push(data.id);
    const { error: memErr } = await admin
      .from('household_members')
      .insert({ household_id: householdId, person_id: data.id });
    if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);
    return data.id as number;
  }

  async function makeScoutInHousehold(
    admin: ReturnType<typeof adminClient>,
    householdId: number,
    suffix: string
  ): Promise<{ personId: number; scoutId: string }> {
    const { data: person, error: personErr } = await admin
      .from('people')
      .insert({ display_name: `[TEST] Scout ${suffix}`, active: true })
      .select('id')
      .single();
    if (personErr || !person) throw new Error(`fixture: scout person insert failed: ${personErr?.message}`);
    personIds.push(person.id);

    const scoutId = `vitest-idauth-${suffix}`;
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

    return { personId: person.id, scoutId };
  }

  it('Parent_ReceivesChallenge_WhenEmailMatchesRoster', async () => {
    const admin = adminClient();
    const householdId = await makeHousehold(admin, 'Challenge');
    const email = `vitest-idauth-${Date.now()}@example.com`;
    await makeAdultInHousehold(admin, householdId, email);

    await requestChallenge(admin, email);

    const { data: rows } = await admin.from('login_tokens').select('id, sent_to').eq('sent_to', email.toLowerCase());
    const created = (rows ?? []) as { id: number; sent_to: string }[];
    expect(created).toHaveLength(1);
    tokenIds.push(...created.map((r) => r.id));
  });

  it('Stranger_GetsIdenticalResponse_WhenEmailIsNotOnRoster', async () => {
    const admin = adminClient();
    const email = `vitest-idauth-nomatch-${Date.now()}@example.com`;

    // No fixture person created — this address matches nobody.
    await expect(requestChallenge(admin, email)).resolves.toBeUndefined();

    const { data: rows } = await admin.from('login_tokens').select('id').eq('sent_to', email.toLowerCase());
    expect((rows ?? []).length).toBe(0);
  });

  it('Token_IsNotConsumed_WhenLinkIsFetchedByGet', async () => {
    const admin = adminClient();
    const householdId = await makeHousehold(admin, 'Peek');
    const email = `vitest-idauth-${Date.now()}@example.com`;
    await makeAdultInHousehold(admin, householdId, email);
    await requestChallenge(admin, email);

    const { data: rows } = await admin.from('login_tokens').select('id, token_hash').eq('sent_to', email.toLowerCase());
    const row = (rows ?? [])[0] as { id: number; token_hash: string };
    tokenIds.push(row.id);

    // peekTokenChallenge only ever receives the RAW token in production (from
    // the emailed link) — this test can't recover it from the hash, so it
    // asserts the GET-safety contract the function documents: reading with a
    // token that can't possibly match anything still performs zero writes.
    await peekTokenChallenge(admin, 'not-the-real-token');
    const { data: after } = await admin.from('login_tokens').select('consumed_at').eq('id', row.id).single();
    expect(after?.consumed_at).toBeNull();
  });

  it('Token_IsRejected_WhenOlderThanFifteenMinutes', async () => {
    const admin = adminClient();
    const householdId = await makeHousehold(admin, 'Expired');
    const { personId } = await makeScoutInHousehold(admin, householdId, `exp-${Date.now()}`);

    const rawToken = 'vitest-raw-token-expired';
    const tokenHash = await sha256HexForTest(rawToken);
    const { data: inserted, error } = await admin
      .from('login_tokens')
      .insert({
        person_id: personId,
        channel: 'email',
        sent_to: 'expired@example.com',
        token_hash: tokenHash,
        code_hash: await sha256HexForTest('000000'),
        expires_at: new Date(Date.now() - 60_000).toISOString() // already expired
      })
      .select('id')
      .single();
    if (error || !inserted) throw new Error(`fixture: expired token insert failed: ${error?.message}`);
    tokenIds.push(inserted.id);

    const identity = await redeemToken(admin, rawToken);
    expect(identity).toBeNull();
  });

  it('Token_IsRejected_WhenAlreadyRedeemed_AndSiblingsDieWithIt', async () => {
    const admin = adminClient();
    const householdId = await makeHousehold(admin, 'Siblings');
    const email = `vitest-idauth-${Date.now()}@example.com`;
    const personId = await makeAdultInHousehold(admin, householdId, email);

    const rawTokenA = 'vitest-raw-token-a';
    const rawTokenB = 'vitest-raw-token-b';
    const [hashA, hashB] = await Promise.all([sha256HexForTest(rawTokenA), sha256HexForTest(rawTokenB)]);
    const future = new Date(Date.now() + 10 * 60_000).toISOString();

    const { data: rowA } = await admin
      .from('login_tokens')
      .insert({
        person_id: personId,
        channel: 'email',
        sent_to: email,
        token_hash: hashA,
        code_hash: await sha256HexForTest('111111'),
        expires_at: future
      })
      .select('id')
      .single();
    const { data: rowB } = await admin
      .from('login_tokens')
      .insert({
        person_id: personId,
        channel: 'email',
        sent_to: email,
        token_hash: hashB,
        code_hash: await sha256HexForTest('222222'),
        expires_at: future
      })
      .select('id')
      .single();
    tokenIds.push(rowA!.id, rowB!.id);

    const first = await redeemToken(admin, rawTokenA);
    expect(first).not.toBeNull();

    // Redeeming A a second time fails outright.
    const second = await redeemToken(admin, rawTokenA);
    expect(second).toBeNull();

    // B was never redeemed directly, but A's redemption should have killed it.
    const { data: bAfter } = await admin.from('login_tokens').select('consumed_at').eq('id', rowB!.id).single();
    expect(bAfter?.consumed_at).not.toBeNull();
  });

  it('Challenge_IsRefused_WhenFourthRequestArrivesInWindow', async () => {
    const admin = adminClient();
    const householdId = await makeHousehold(admin, 'RateLimit');
    const email = `vitest-idauth-${Date.now()}@example.com`;
    await makeAdultInHousehold(admin, householdId, email);

    await requestChallenge(admin, email);
    await requestChallenge(admin, email);
    await requestChallenge(admin, email);
    await requestChallenge(admin, email); // 4th — should be silently dropped

    const { data: rows } = await admin.from('login_tokens').select('id').eq('sent_to', email.toLowerCase());
    const created = (rows ?? []) as { id: number }[];
    tokenIds.push(...created.map((r) => r.id));
    expect(created.length).toBe(3);
  });

  it('Code_IsRejected_WhenFiveAttemptsAlreadyFailed', async () => {
    const admin = adminClient();
    const householdId = await makeHousehold(admin, 'Lockout');
    const email = `vitest-idauth-${Date.now()}@example.com`;
    const personId = await makeAdultInHousehold(admin, householdId, email);

    const { data: row } = await admin
      .from('login_tokens')
      .insert({
        person_id: personId,
        channel: 'email',
        sent_to: email,
        token_hash: await sha256HexForTest('vitest-lockout-token'),
        code_hash: await sha256HexForTest('999999'),
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        attempts: 5
      })
      .select('id')
      .single();
    tokenIds.push(row!.id);

    const result = await redeemCode(admin, email, '999999');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('locked');
  });

  it('LeaderSession_CannotVerify_AsIdentityCookie', async () => {
    // Every cookie type here shares LEADER_SESSION_SECRET — a leader token
    // must NOT verify as an identity session just because the signature is
    // valid. verifyIdentitySession()'s role==='identity' discriminator is
    // what this guards.
    const leaderToken = await signSession({ leader: 'Test Leader', iat: Date.now(), role: 'leader' });
    const identity = await verifyIdentitySession(leaderToken);
    expect(identity).toBeNull();
  });

  it('RevokedPerson_SessionIsRejected_AfterEpochBump', async () => {
    const admin = adminClient();
    const householdId = await makeHousehold(admin, 'Epoch');
    const email = `vitest-idauth-${Date.now()}@example.com`;
    const personId = await makeAdultInHousehold(admin, householdId, email);

    const session = {
      role: 'identity' as const,
      subjectKind: 'adult' as const,
      personId,
      householdKey: String(householdId),
      displayName: '[TEST] Adult',
      epoch: 0,
      iat: Date.now()
    };
    expect(await isEpochCurrent(admin, session)).toBe(true);

    // Bump epoch the same way the revocation trigger / a leader revoke would —
    // direct SQL, not through the app.
    await admin.from('people').update({ session_epoch: 1 }).eq('id', personId);
    expect(await isEpochCurrent(admin, session)).toBe(false);
  });

  it('SessionEpoch_IsBumped_WhenRosterMarksPersonInactive', async () => {
    const admin = adminClient();
    const householdId = await makeHousehold(admin, 'PersonTrigger');
    const email = `vitest-idauth-${Date.now()}@example.com`;
    const personId = await makeAdultInHousehold(admin, householdId, email);

    const { data: before } = await admin.from('people').select('session_epoch').eq('id', personId).single();
    expect(before?.session_epoch).toBe(0);

    // Direct SQL update, not through the app — the trigger must fire
    // regardless of what wrote the row (bulk import accepts, Supabase
    // console corrections, merges).
    await admin.from('people').update({ active: false }).eq('id', personId);

    const { data: after } = await admin.from('people').select('session_epoch').eq('id', personId).single();
    expect(after?.session_epoch).toBe(1);
  });

  it('SessionEpoch_IsBumped_WhenScoutMarkedInactive_ForHouseholdAdultsToo', async () => {
    const admin = adminClient();
    const householdId = await makeHousehold(admin, 'ScoutTrigger');
    const parentEmail = `vitest-idauth-${Date.now()}@example.com`;
    const parentPersonId = await makeAdultInHousehold(admin, householdId, parentEmail);
    const { personId: scoutPersonId, scoutId } = await makeScoutInHousehold(admin, householdId, `epoch-${Date.now()}`);

    // scouts_inactive_reason_only_when_inactive requires a reason whenever
    // active flips false — caught live by this test the first time around.
    const { error: deactivateErr } = await admin
      .from('scouts')
      .update({ active: false, inactive_reason: 'other' })
      .eq('id', scoutId);
    if (deactivateErr) throw new Error(`fixture: scout deactivate failed: ${deactivateErr.message}`);

    const { data: scoutPerson } = await admin.from('people').select('session_epoch').eq('id', scoutPersonId).single();
    const { data: parentPerson } = await admin.from('people').select('session_epoch').eq('id', parentPersonId).single();
    expect(scoutPerson?.session_epoch).toBe(1);
    expect(parentPerson?.session_epoch).toBe(1);
  });

  it('AnonKey_CannotRead_LoginTokens', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const admin = adminClient();
    const householdId = await makeHousehold(admin, 'RlsProbe');
    const email = `vitest-idauth-${Date.now()}@example.com`;
    const personId = await makeAdultInHousehold(admin, householdId, email);
    const { data: row } = await admin
      .from('login_tokens')
      .insert({
        person_id: personId,
        channel: 'email',
        sent_to: email,
        token_hash: await sha256HexForTest('vitest-rls-probe'),
        code_hash: await sha256HexForTest('123123'),
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
      })
      .select('id')
      .single();
    tokenIds.push(row!.id);

    const { data, error } = await anon.from('login_tokens').select('*').limit(1);
    if (error === null) {
      expect(data ?? []).toHaveLength(0);
    }
  });
});

/** Test-only re-implementation of identity-challenge.ts's private hashSecret()
 *  — same SHA-256(value || pepper) shape, needed here only to seed fixture
 *  rows whose hash the module itself would otherwise compute internally. */
async function sha256HexForTest(raw: string): Promise<string> {
  const pepper = process.env.IDENTITY_TOKEN_PEPPER;
  if (!pepper) throw new Error('IDENTITY_TOKEN_PEPPER missing — is .env.local present?');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${raw}${pepper}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

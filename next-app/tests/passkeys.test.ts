import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import {
  passkeyConfig,
  passkeysConfigured,
  beginRegistration,
  beginAuthentication,
  listPasskeys,
  deletePasskey
} from '../src/lib/passkeys';

/**
 * Passkeys — server half (Plans/Family-Identity-Auth.md Phase 4).
 *
 * WHAT IS NOT TESTED HERE, and why. Completing a WebAuthn ceremony needs a
 * real (or virtual) authenticator to sign the challenge; this suite has no
 * browser, so verifyRegistrationResponse / verifyAuthenticationResponse are
 * exercised only by SimpleWebAuthn's own tests. What IS covered is everything
 * we wrote: option generation, challenge storage and single-use consumption,
 * the revocation trigger, and the four non-negotiables from the plan — which
 * are the parts a future change could quietly break.
 */

describe('passkeys', () => {
  let personIds: number[] = [];
  let householdIds: number[] = [];

  beforeAll(() => {
    if (!passkeysConfigured()) {
      throw new Error('PASSKEY_RP_ID must be set in .env.local (use "localhost") to run these.');
    }
  });

  afterEach(async () => {
    const admin = adminClient();
    if (personIds.length > 0) {
      await admin.from('passkey_challenges').delete().in('person_id', personIds);
      await admin.from('passkey_credentials').delete().in('person_id', personIds);
      await admin.from('household_members').delete().in('person_id', personIds);
      await admin.from('people').delete().in('id', personIds);
    }
    if (householdIds.length > 0) await admin.from('households').delete().in('id', householdIds);
    personIds = [];
    householdIds = [];
  });

  async function makeAdult(): Promise<number> {
    const admin = adminClient();
    const { data: hh } = await admin
      .from('households')
      .insert({ label: '[TEST] Passkey HH' })
      .select('id')
      .single();
    householdIds.push((hh as { id: number }).id);
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: '[TEST] Passkey Adult', active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: ${error?.message}`);
    const id = (data as { id: number }).id;
    personIds.push(id);
    await admin.from('household_members').insert({ household_id: (hh as { id: number }).id, person_id: id });
    return id;
  }

  // ── configuration ────────────────────────────────────────────────────────

  it('Config_PinsTheRpId_RatherThanDerivingItFromTheRequest', () => {
    // Credentials are bound to the registrable domain and do not survive a
    // move. Deriving the RP ID from req.headers.host means a preview
    // deployment registers credentials that are useless in production — and
    // the failure is silent until someone tries to sign in.
    const src = readFileSync('src/lib/passkeys.ts', 'utf8');
    expect(src).toContain('process.env.PASSKEY_RP_ID');
    // Match code, not prose — the header comment legitimately says "request
    // host" while explaining why it must not be read.
    expect(src).not.toMatch(/from 'next\/headers'/);
    expect(src).not.toMatch(/\.host/);
    expect(passkeyConfig()?.rpId).toBeTruthy();
  });

  // ── registration ─────────────────────────────────────────────────────────

  it('Registration_StoresItsChallenge_BoundToThatPerson', async () => {
    const admin = adminClient();
    const personId = await makeAdult();
    const options = await beginRegistration(admin, { personId, displayName: 'Probe' });
    expect(options).not.toBeNull();

    const { data } = await admin
      .from('passkey_challenges')
      .select('person_id, kind, consumed_at')
      .eq('challenge', options!.challenge)
      .maybeSingle();
    const row = data as { person_id: number; kind: string; consumed_at: string | null } | null;
    expect(row).not.toBeNull();
    // Bound to the requester: a response cannot be replayed against another
    // account, because finishRegistration compares these.
    expect(row!.person_id).toBe(personId);
    expect(row!.kind).toBe('register');
    expect(row!.consumed_at).toBeNull();
  });

  it('Registration_AsksForADiscoverableCredential_SoSignInNeedsNoEmail', async () => {
    const personId = await makeAdult();
    const options = await beginRegistration(adminClient(), { personId, displayName: 'Probe' });
    // Resident keys are the whole point: returning sign-in is "tap Sign in"
    // with nothing typed at all.
    expect(options!.authenticatorSelection?.residentKey).toBe('required');
  });

  it('Registration_ExcludesExistingCredentials_SoADeviceCannotDoubleRegister', async () => {
    const admin = adminClient();
    const personId = await makeAdult();
    await admin.from('passkey_credentials').insert({
      person_id: personId,
      credential_id: `test-cred-${Date.now()}`,
      public_key: '\\xdeadbeef'
    });
    const options = await beginRegistration(admin, { personId, displayName: 'Probe' });
    expect(options!.excludeCredentials?.length).toBe(1);
  });

  // ── authentication ───────────────────────────────────────────────────────

  it('Authentication_IssuesAChallengeWithNoPerson_BecauseTheDeviceSaysWhoYouAre', async () => {
    const admin = adminClient();
    const options = await beginAuthentication(admin);
    expect(options).not.toBeNull();
    const { data } = await admin
      .from('passkey_challenges')
      .select('person_id, kind')
      .eq('challenge', options!.challenge)
      .maybeSingle();
    const row = data as { person_id: number | null; kind: string } | null;
    // Null person is correct and load-bearing: discoverable credentials mean
    // the user has not told us who they are yet.
    expect(row!.person_id).toBeNull();
    expect(row!.kind).toBe('authenticate');
    expect(options!.allowCredentials ?? []).toEqual([]);
  });

  // ── revocation reaches the strongest credential ──────────────────────────

  it('Revoking_DeletesPasskeys_NotJustSessions', async () => {
    const admin = adminClient();
    const personId = await makeAdult();
    await admin.from('passkey_credentials').insert({
      person_id: personId,
      credential_id: `test-revoke-${Date.now()}`,
      public_key: '\\xdeadbeef'
    });
    expect(await listPasskeys(admin, personId)).toHaveLength(1);

    // A leader hitting "Revoke sessions", or a roster deactivation trigger.
    const { data: before } = await admin
      .from('people')
      .select('session_epoch')
      .eq('id', personId)
      .single();
    await admin
      .from('people')
      .update({ session_epoch: (before as { session_epoch: number }).session_epoch + 1 })
      .eq('id', personId);

    // Otherwise "revoke" would mean "revoke everything except the one
    // credential that can sign back in immediately".
    expect(await listPasskeys(admin, personId)).toHaveLength(0);
  });

  it('DeletePasskey_IsScopedToTheOwner_SoAForgedIdCannotRemoveSomeoneElses', async () => {
    const admin = adminClient();
    const mine = await makeAdult();
    const theirs = await makeAdult();
    const { data } = await admin
      .from('passkey_credentials')
      .insert({
        person_id: theirs,
        credential_id: `test-theirs-${Date.now()}`,
        public_key: '\\xdeadbeef'
      })
      .select('id')
      .single();

    await deletePasskey(admin, mine, (data as { id: number }).id);
    expect(await listPasskeys(admin, theirs)).toHaveLength(1);
  });

  // ── the plan's non-negotiables, as code ──────────────────────────────────

  it('SignCount_IsNotHardFailed_SoIPhonesAreNotLockedOut', () => {
    // Many platform authenticators always return 0; treating a
    // non-incrementing counter as cloning evidence would lock them all out.
    const src = readFileSync('src/lib/passkeys.ts', 'utf8');
    expect(src).toContain('requireUserVerification: false');
    expect(src).not.toMatch(/throw[^\n]*counter/i);
  });

  it('Passkeys_AreAdultsOnly_AndTheEmailedCodePathIsNeverRemoved', () => {
    const actions = readFileSync('src/app/(public)/signin/actions.ts', 'utf8');
    // Scouts stay on codes: a passkey on a shared school Chromebook is a mess.
    expect(actions).toContain("subjectKind !== 'adult'");
    // The code path is the permanent recovery route — a passkey-only account
    // is a family locked out with no self-service way back in.
    expect(actions).toContain('requestChallengeForPerson');
    expect(actions).toContain('redeemCodeForPerson');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  normaliseHintAddress,
  resolveHintCandidates,
  buildSignInHint,
  signSignInHint,
  verifySignInHint,
  hintAllowsPerson,
  hintRateLimitExceeded,
  HINT_COOKIE,
  HINT_PEEK_MAX_PER_IP_HOUR
} from '../src/lib/signin-hint';
import { signToken } from '../src/lib/signed-cookie';
import { recordLoginEvent } from '../src/lib/login-events';

/**
 * Bugle "Register Now" links — identity-hinted sign-in
 * (Plans/Bugle-Register-Now-Links.md, approach B). The newsletter merges the
 * recipient's own address into the link; the site resolves it to the people
 * it belongs to, adults first, and offers "Continue as {name}? Email me a
 * code" without the troop password or the name search. Integration-style
 * against local Postgres like the rest of the suite.
 */

describe('signin-hint — address normalisation (B8)', () => {
  it('HintAddress_RestoresPlusFromSpace_InLocalPartOnly', () => {
    // EmailOctopus merges the raw address; a `+` in a query string decodes to
    // a space by the time it reaches the server.
    expect(normaliseHintAddress('pat troop@gmail.com')).toBe('pat+troop@gmail.com');
    // The domain never carries a plus; a stray space there is just a space.
    expect(normaliseHintAddress('pat@gmail .com')).toBe('');
  });

  it('HintAddress_NormalisesCaseAndWhitespace', () => {
    expect(normaliseHintAddress('  Dana.R@Example.COM ')).toBe('dana.r@example.com');
  });

  it('HintAddress_RejectsNonAddresses', () => {
    expect(normaliseHintAddress('')).toBe('');
    expect(normaliseHintAddress('not-an-address')).toBe('');
    expect(normaliseHintAddress('{{EmailAddress}}')).toBe('');
  });
});

describe('signin-hint — the hint cookie', () => {
  const hint = {
    candidates: [{ personId: 82, displayName: 'Dana R.', subjectKind: 'adult' as const, maskedEmail: 'd•••@x.com' }],
    parents: [],
    iat: Date.now()
  };

  it('HintCookie_RoundTripsThroughSignAndVerify', async () => {
    const token = await signSignInHint(hint);
    const parsed = await verifySignInHint(token);
    expect(parsed?.candidates[0]?.personId).toBe(82);
    expect(parsed?.role).toBe('hint');
  });

  it('HintCookie_RejectsWrongRole', async () => {
    // Every cookie shares LEADER_SESSION_SECRET — the role literal is what
    // keeps an identity/family/leader token from verifying as a hint.
    const forged = await signToken({ role: 'identity', ...hint });
    expect(await verifySignInHint(forged)).toBeNull();
  });

  it('HintCookie_RejectsOnceOlderThanMaxAge', async () => {
    const stale = await signSignInHint({ ...hint, iat: Date.now() - (HINT_COOKIE.maxAgeSeconds + 60) * 1000 });
    expect(await verifySignInHint(stale)).toBeNull();
  });

  it('HintAllowsPerson_OnlyForCandidatesAndParents', () => {
    const h = {
      role: 'hint' as const,
      candidates: [{ personId: 1, displayName: 'S', subjectKind: 'scout' as const, maskedEmail: 's•••@x.com' }],
      parents: [{ personId: 2, displayName: 'P', subjectKind: 'adult' as const, maskedEmail: 'p•••@x.com' }],
      iat: Date.now()
    };
    expect(hintAllowsPerson(h, 1)).toBe(true);
    expect(hintAllowsPerson(h, 2)).toBe(true);
    expect(hintAllowsPerson(h, 3)).toBe(false);
  });
});

describe('signin-hint — resolution (B4)', () => {
  let householdIds: number[] = [];
  let personIds: number[] = [];
  let scoutIds: string[] = [];
  let emailIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (emailIds.length > 0) await admin.from('person_emails').delete().in('id', emailIds);
    if (scoutIds.length > 0) await admin.from('scouts').delete().in('id', scoutIds);
    if (personIds.length > 0) await admin.from('household_members').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('person_emails').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('people').delete().in('id', personIds);
    if (householdIds.length > 0) await admin.from('households').delete().in('id', householdIds);
    householdIds = [];
    personIds = [];
    scoutIds = [];
    emailIds = [];
  });

  async function makeHousehold(admin: ReturnType<typeof adminClient>, label: string): Promise<number> {
    const { data, error } = await admin.from('households').insert({ label: `[TEST] ${label}` }).select('id').single();
    if (error || !data) throw new Error(`fixture: household insert failed: ${error?.message}`);
    householdIds.push(data.id);
    return data.id as number;
  }

  async function makeAdult(
    admin: ReturnType<typeof adminClient>,
    householdId: number,
    name: string,
    email: string | null,
    active = true
  ): Promise<number> {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: `[TEST] ${name}`, primary_email: email, active })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: person insert failed: ${error?.message}`);
    personIds.push(data.id);
    const { error: memErr } = await admin.from('household_members').insert({ household_id: householdId, person_id: data.id });
    if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);
    return data.id as number;
  }

  async function makeScout(
    admin: ReturnType<typeof adminClient>,
    householdId: number,
    suffix: string,
    email: string | null
  ): Promise<number> {
    const { data: person, error: personErr } = await admin
      .from('people')
      .insert({ display_name: `[TEST] Scout ${suffix}`, primary_email: email, active: true })
      .select('id')
      .single();
    if (personErr || !person) throw new Error(`fixture: scout person insert failed: ${personErr?.message}`);
    personIds.push(person.id);
    const scoutId = `vitest-hint-${suffix}`;
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
    const { error: memErr } = await admin.from('household_members').insert({ household_id: householdId, person_id: person.id });
    if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);
    return person.id as number;
  }

  it('HintCandidates_OrdersAdultsBeforeScouts_WhenOneAddressIsShared', async () => {
    const admin = adminClient();
    const hh = await makeHousehold(admin, 'Shared');
    const email = `vitest-hint-shared-${Date.now()}@example.com`;
    const scoutPid = await makeScout(admin, hh, `s${Date.now()}`, email);
    const adultPid = await makeAdult(admin, hh, 'Shared Adult', email);

    const candidates = await resolveHintCandidates(admin, email);

    expect(candidates.map((c) => c.personId)).toEqual([adultPid, scoutPid]);
    expect(candidates[0].subjectKind).toBe('adult');
    expect(candidates[1].subjectKind).toBe('scout');
  });

  it('HintCandidates_ExcludesInactivePeople', async () => {
    const admin = adminClient();
    const hh = await makeHousehold(admin, 'Inactive');
    const email = `vitest-hint-inactive-${Date.now()}@example.com`;
    await makeAdult(admin, hh, 'Gone Adult', email, false);

    expect(await resolveHintCandidates(admin, email)).toEqual([]);
  });

  it('HintCandidates_FindsASecondaryAddress_ButNotABouncedOne', async () => {
    const admin = adminClient();
    const hh = await makeHousehold(admin, 'Secondary');
    const stamp = Date.now();
    const adultPid = await makeAdult(admin, hh, 'Two Addresses', `vitest-hint-primary-${stamp}@example.com`);
    const secondary = `vitest-hint-secondary-${stamp}@example.com`;
    const bounced = `vitest-hint-bounced-${stamp}@example.com`;
    const { data: rows, error } = await admin
      .from('person_emails')
      .insert([
        { person_id: adultPid, email: secondary, label: 'work' },
        { person_id: adultPid, email: bounced, label: 'other', bounced_at: new Date().toISOString() }
      ])
      .select('id');
    if (error) throw new Error(`fixture: person_emails insert failed: ${error.message}`);
    emailIds.push(...((rows ?? []) as { id: number }[]).map((r) => r.id));

    expect((await resolveHintCandidates(admin, secondary)).map((c) => c.personId)).toEqual([adultPid]);
    expect(await resolveHintCandidates(admin, bounced)).toEqual([]);
  });

  it('HintCandidates_ReturnsNothing_ForAnUnknownAddress', async () => {
    const admin = adminClient();
    expect(await resolveHintCandidates(admin, `vitest-hint-nobody-${Date.now()}@example.com`)).toEqual([]);
  });

  it('SignInHint_ListsHouseholdAdults_WhenTheAddressBelongsOnlyToAScout', async () => {
    // D-246: a code goes only to the picked person's own address, so a
    // scout-only hint offers the household's adults by name instead of
    // dead-ending the parent in "ask a parent".
    const admin = adminClient();
    const hh = await makeHousehold(admin, 'ScoutOnly');
    const stamp = Date.now();
    const scoutEmail = `vitest-hint-scout-${stamp}@example.com`;
    const scoutPid = await makeScout(admin, hh, `so${stamp}`, scoutEmail);
    const parentPid = await makeAdult(admin, hh, 'Parent With Email', `vitest-hint-parent-${stamp}@example.com`);
    await makeAdult(admin, hh, 'Parent Without Email', null);

    const hint = await buildSignInHint(admin, scoutEmail);

    expect(hint?.candidates.map((c) => c.personId)).toEqual([scoutPid]);
    expect(hint?.parents.map((p) => p.personId)).toEqual([parentPid]);
    expect(hint?.parents[0].maskedEmail).toMatch(/^v•+@example\.com$/);
  });

  it('SignInHint_IsNull_ForAnUnknownAddress', async () => {
    expect(await buildSignInHint(adminClient(), `vitest-hint-nobody-${Date.now()}@example.com`)).toBeNull();
  });
});

describe('signin-hint — per-IP peek limiter (B7)', () => {
  let eventIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (eventIds.length > 0) await admin.from('login_events').delete().in('id', eventIds);
    eventIds = [];
  });

  async function logUnknownHints(ip: string, n: number): Promise<void> {
    const admin = adminClient();
    for (let i = 0; i < n; i++) {
      await recordLoginEvent(admin, { personId: null, method: 'hint', success: false, failureReason: 'hint-unknown', ip });
    }
    const { data } = await admin.from('login_events').select('id').eq('ip', ip);
    eventIds.push(...((data ?? []) as { id: number }[]).map((r) => r.id));
  }

  it('LoginEvents_AcceptsMethodHint', async () => {
    const admin = adminClient();
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const { data, error } = await admin
      .from('login_events')
      .insert({ person_id: null, method: 'hint', success: false, failure_reason: 'hint-unknown', ip })
      .select('id')
      .single();
    expect(error).toBeNull();
    if (data) eventIds.push((data as { id: number }).id);
  });

  it('HintRateLimit_IsNotExceeded_BelowTheCap', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    await logUnknownHints(ip, HINT_PEEK_MAX_PER_IP_HOUR - 1);
    expect(await hintRateLimitExceeded(adminClient(), ip)).toBe(false);
  });

  it('HintRateLimit_IsExceeded_AtTheCap_ForThatIpOnly', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 50) + 201}`;
    await logUnknownHints(ip, HINT_PEEK_MAX_PER_IP_HOUR);
    expect(await hintRateLimitExceeded(adminClient(), ip)).toBe(true);
    expect(await hintRateLimitExceeded(adminClient(), '192.0.2.1')).toBe(false);
  });

  it('HintRateLimit_IsNeverExceeded_WithoutAnIp', async () => {
    expect(await hintRateLimitExceeded(adminClient(), null)).toBe(false);
  });
});

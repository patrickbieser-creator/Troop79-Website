import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { maskEmail, requestChallengeForPerson, redeemCodeForPerson } from '../src/lib/identity-challenge';
import { searchSignInCandidates, MIN_QUERY_LENGTH, MAX_RESULTS } from '../src/lib/signin-roster';

/**
 * Name-picker sign-in (Plans/Unified-Identity-And-Capabilities.md Phase D).
 *
 * THE BUG THIS FILE EXISTS FOR: a scout can share a parent's email address —
 * resolveChallengeTarget says so in its own comment, and takes the FIRST
 * match. Routing the picker through a contact string would therefore mint and
 * redeem against the parent when a scout picked their own name, silently
 * signing the scout in AS their parent, with the parent's household and (once
 * capabilities exist) the parent's grants.
 *
 * requestChallengeForPerson / redeemCodeForPerson exist to keep the identity
 * the picker already established, rather than re-deriving it from an
 * ambiguous key. These tests prove the two people stay separate.
 */

describe('sign-in name picker', () => {
  let householdIds: number[] = [];
  let personIds: number[] = [];
  let scoutIds: string[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (personIds.length > 0) await admin.from('login_tokens').delete().in('person_id', personIds);
    if (scoutIds.length > 0) await admin.from('scouts').delete().in('id', scoutIds);
    if (personIds.length > 0) await admin.from('household_members').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('people').delete().in('id', personIds);
    if (householdIds.length > 0) await admin.from('households').delete().in('id', householdIds);
    householdIds = [];
    personIds = [];
    scoutIds = [];
  });

  async function makeHousehold(label: string): Promise<number> {
    const admin = adminClient();
    const { data, error } = await admin.from('households').insert({ label: `[TEST] ${label}` }).select('id').single();
    if (error || !data) throw new Error(`fixture: household: ${error?.message}`);
    householdIds.push(data.id as number);
    return data.id as number;
  }

  async function makePerson(householdId: number, name: string, email: string | null): Promise<number> {
    const admin = adminClient();
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: name, primary_email: email, active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: person: ${error?.message}`);
    personIds.push(data.id as number);
    await admin.from('household_members').insert({ household_id: householdId, person_id: data.id });
    return data.id as number;
  }

  // ── masking (pure) ───────────────────────────────────────────────────────

  it('MaskedEmail_KeepsFirstCharAndDomain_AndHidesTheRest', () => {
    const masked = maskEmail('dana.reilly@gmail.com');
    expect(masked.startsWith('d')).toBe(true);
    expect(masked.endsWith('@gmail.com')).toBe(true);
    expect(masked).not.toContain('ana.reilly');
  });

  it('MaskedEmail_DoesNotLeakLocalPartLength_ForLongAddresses', () => {
    // Padding is clamped, so "a@x.com" and a 30-character local part do not
    // advertise how long the real address is.
    const short = maskEmail('ab@x.com');
    const long = maskEmail('averyveryverylongaddress@x.com');
    expect(long.length).toBeLessThanOrEqual(short.length + 4);
  });

  it('MaskedEmail_DoesNotThrow_OnMalformedInput', () => {
    expect(maskEmail('not-an-email')).toBe('•••');
    expect(maskEmail('')).toBe('•••');
  });

  // ── the shared-address hazard ────────────────────────────────────────────

  it('ScoutSharingAParentsEmail_GetsTheirOwnToken_NotTheParents', async () => {
    const admin = adminClient();
    const hh = await makeHousehold('Shared Address');
    const shared = `vitest-shared-${Date.now()}@example.com`;
    const parentId = await makePerson(hh, '[TEST] Shared Parent', shared);
    const scoutPersonId = await makePerson(hh, '[TEST] Shared Scout', shared);

    const scoutId = `vitest-picker-${Date.now()}`;
    scoutIds.push(scoutId);
    await admin.from('scouts').insert({
      id: scoutId,
      first_name: '[TEST]',
      last_name: 'Shared Scout',
      display_name: '[TEST] Shared Scout',
      active: true,
      person_id: scoutPersonId
    });

    const res = await requestChallengeForPerson(admin, scoutPersonId);
    expect(res.sent).toBe(true);

    const { data: tokens } = await admin
      .from('login_tokens')
      .select('person_id')
      .in('person_id', [parentId, scoutPersonId]);
    const owners = ((tokens ?? []) as { person_id: number }[]).map((t) => t.person_id);

    // The whole point: the token belongs to the person who was PICKED, even
    // though the address resolves to the parent first.
    expect(owners).toContain(scoutPersonId);
    expect(owners).not.toContain(parentId);
  });

  it('ChallengeForPerson_ReportsUnreachable_WhenNoAddressIsOnFile', async () => {
    const hh = await makeHousehold('No Address');
    const personId = await makePerson(hh, '[TEST] No Address', null);
    const res = await requestChallengeForPerson(adminClient(), personId);
    expect(res.sent).toBe(false);
  });

  it('ChallengeForPerson_ReportsUnreachable_WhenThePersonIsInactive', async () => {
    const admin = adminClient();
    const hh = await makeHousehold('Departed');
    const personId = await makePerson(hh, '[TEST] Departed', `vitest-gone-${Date.now()}@example.com`);
    await admin.from('people').update({ active: false }).eq('id', personId);
    const res = await requestChallengeForPerson(admin, personId);
    expect(res.sent).toBe(false);
  });

  it('RedeemForPerson_IsRefused_WhenTheCodeIsWrong', async () => {
    const admin = adminClient();
    const hh = await makeHousehold('Wrong Code');
    const personId = await makePerson(hh, '[TEST] Wrong Code', `vitest-wrong-${Date.now()}@example.com`);
    await requestChallengeForPerson(admin, personId);
    const result = await redeemCodeForPerson(admin, personId, '000000');
    expect(result.ok).toBe(false);
  });

  // ── the search contract ─────────────────────────────────────────────────

  it('Search_ReturnsNothing_BelowTheTwoCharacterFloor', async () => {
    // The roster must not be browsable. An empty or one-character query is
    // how someone would try to dump it.
    for (const q of ['', ' ', 'a', ' b ']) {
      const { candidates } = await searchSignInCandidates(q);
      expect(candidates, `query ${JSON.stringify(q)} returned rows`).toEqual([]);
    }
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  it('Search_MatchesTheFullSurname_ButNeverReturnsIt', async () => {
    const hh = await makeHousehold('Surname Match');
    const personId = await makePerson(hh, 'Zephaniah Quibblesworth', `vitest-sur-${Date.now()}@example.com`);

    // Typing the surname finds them...
    const { candidates } = await searchSignInCandidates('quibblesworth');
    const mine = candidates.find((c) => c.personId === personId);
    expect(mine, 'surname search did not match').toBeDefined();

    // ...but the surname is a server-side key, not a returned value.
    expect(mine!.displayName).toContain('Zephaniah');
    expect(mine!.displayName).not.toContain('Quibblesworth');
    expect(JSON.stringify(candidates)).not.toContain('Quibblesworth');
  });

  it('Search_MatchesOnFirstNameToo_AndIsCaseInsensitive', async () => {
    const hh = await makeHousehold('First Name Match');
    const personId = await makePerson(hh, 'Zephaniah Quibblesworth', `vitest-first-${Date.now()}@example.com`);
    const lower = await searchSignInCandidates('zeph');
    const upper = await searchSignInCandidates('ZEPH');
    expect(lower.candidates.map((c) => c.personId)).toContain(personId);
    expect(upper.candidates.map((c) => c.personId)).toContain(personId);
  });

  it('Search_ReturnsMaskedEmailsOnly_NeverRawAddresses', async () => {
    const hh = await makeHousehold('Masking Probe');
    const raw = `vitest-visible-${Date.now()}@example.com`;
    const personId = await makePerson(hh, 'Xanthe Vandersnoot', raw);

    const { candidates } = await searchSignInCandidates('vandersnoot');
    const mine = candidates.find((c) => c.personId === personId);
    expect(mine).toBeDefined();
    expect(JSON.stringify(candidates)).not.toContain(raw);
    expect(mine!.maskedEmail).toContain('@example.com');
  });

  it('Search_CapsResults_AndSaysSoWhenItDid', async () => {
    // "e" is too short; a common two-letter run should still be bounded so a
    // broad query cannot page through the troop.
    const { candidates, truncated } = await searchSignInCandidates('an');
    expect(candidates.length).toBeLessThanOrEqual(MAX_RESULTS);
    if (truncated) expect(candidates.length).toBe(MAX_RESULTS);
  });

  it('Search_StillListsSomeoneWithNoEmail_RatherThanHidingThem', async () => {
    const hh = await makeHousehold('Listed Anyway');
    const personId = await makePerson(hh, 'Wilhelmina Nocontact', null);
    const { candidates } = await searchSignInCandidates('nocontact');
    const mine = candidates.find((c) => c.personId === personId);
    // Hiding them recreates the dead end the picker exists to remove.
    expect(mine).toBeDefined();
    expect(mine!.maskedEmail).toBeNull();
  });

  it('Search_KeepsLabelsUnique_WhenTwoPeopleShareAFirstNameAndInitial', async () => {
    const hh = await makeHousehold('Same Name');
    const a = await makePerson(hh, 'Thaddeus Farnsworth', `vitest-a-${Date.now()}@example.com`);
    const b = await makePerson(hh, 'Thaddeus Fenwick', `vitest-b-${Date.now()}@example.com`);
    const { candidates } = await searchSignInCandidates('thaddeus');
    const labels = candidates.filter((c) => [a, b].includes(c.personId)).map((c) => c.displayName);
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size, `ambiguous labels: ${labels.join(', ')}`).toBe(2);
  });

  it('Search_LabelsDoNotChange_WhenOnlyOneOfThePairMatches', async () => {
    // Disambiguation is computed across the whole roster BEFORE filtering.
    // Doing it post-filter would make a person's name depend on what you
    // typed, which is worse than the ambiguity it fixes.
    const hh = await makeHousehold('Stable Label');
    const a = await makePerson(hh, 'Thaddeus Farnsworth', `vitest-c-${Date.now()}@example.com`);
    await makePerson(hh, 'Thaddeus Fenwick', `vitest-d-${Date.now()}@example.com`);

    const both = await searchSignInCandidates('thaddeus');
    const one = await searchSignInCandidates('farnsworth');
    const inBoth = both.candidates.find((c) => c.personId === a)!.displayName;
    const alone = one.candidates.find((c) => c.personId === a)!.displayName;
    expect(alone).toBe(inBoth);
  });
});

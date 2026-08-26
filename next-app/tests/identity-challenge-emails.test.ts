import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  deliverableEmailsFor,
  requestChallengeForPerson,
  redeemCode,
  redeemCodeForPerson,
  redeemToken
} from '../src/lib/identity-challenge';
import { addPersonEmail } from '../src/lib/person-emails';

/**
 * Multiple emails per person, sign-in side (Plans/Retire-Roster-Contact-
 * Columns.md Phase 2) — deliverableEmailsFor(), requestChallengeForPerson's
 * emailId targeting, and the verified_at stamp a successful redemption
 * leaves on the address it actually went through.
 */
describe('identity-challenge — multiple emails', () => {
  let householdIds: number[] = [];
  let personIds: number[] = [];
  let tokenIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (tokenIds.length > 0) await admin.from('login_tokens').delete().in('id', tokenIds);
    if (personIds.length > 0) await admin.from('household_members').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('person_emails').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('people').delete().in('id', personIds);
    if (householdIds.length > 0) await admin.from('households').delete().in('id', householdIds);
    householdIds = [];
    personIds = [];
    tokenIds = [];
  });

  async function makeAdultInHousehold(admin: ReturnType<typeof adminClient>, label: string): Promise<number> {
    const { data: hh, error: hhErr } = await admin
      .from('households')
      .insert({ label: `[TEST] ${label}` })
      .select('id')
      .single();
    if (hhErr || !hh) throw new Error(`fixture: household insert failed: ${hhErr?.message}`);
    householdIds.push(hh.id as number);

    const { data: p, error: pErr } = await admin
      .from('people')
      .insert({ display_name: `[TEST] ${label}`, active: true })
      .select('id')
      .single();
    if (pErr || !p) throw new Error(`fixture: person insert failed: ${pErr?.message}`);
    personIds.push(p.id as number);

    const { error: memErr } = await admin.from('household_members').insert({ household_id: hh.id, person_id: p.id });
    if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);

    return p.id as number;
  }

  async function tokensFor(admin: ReturnType<typeof adminClient>, personId: number) {
    const { data } = await admin
      .from('login_tokens')
      .select('id, sent_to')
      .eq('person_id', personId)
      .order('created_at', { ascending: false });
    const rows = (data ?? []) as { id: number; sent_to: string }[];
    tokenIds.push(...rows.map((r) => r.id));
    return rows;
  }

  /** Directly seed a redeemable token for a known address, bypassing
   *  mintAndSend() — needed to drive an actual SUCCESSFUL redemption, since
   *  the raw code/token identity-challenge.ts mints is never handed back to
   *  a caller (same boundary tests/identity-auth.test.ts documents). */
  async function seedRedeemableToken(
    admin: ReturnType<typeof adminClient>,
    personId: number,
    sentTo: string,
    rawToken: string,
    rawCode: string
  ): Promise<number> {
    const { data, error } = await admin
      .from('login_tokens')
      .insert({
        person_id: personId,
        channel: 'email',
        sent_to: sentTo,
        token_hash: await sha256HexForTest(rawToken),
        code_hash: await sha256HexForTest(rawCode),
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: login_tokens insert failed: ${error?.message}`);
    tokenIds.push(data.id as number);
    return data.id as number;
  }

  it('DeliverableEmailsFor_ReturnsPrimaryFirst', async () => {
    const admin = adminClient();
    const personId = await makeAdultInHousehold(admin, 'Ordering');
    await addPersonEmail(admin, personId, `primary-${Date.now()}@example.com`);
    await addPersonEmail(admin, personId, `secondary-${Date.now()}@example.com`, 'work');

    const rows = await deliverableEmailsFor(admin, personId);
    expect(rows).toHaveLength(2);
    expect(rows[0].email).toContain('primary-');
  });

  it('DeliverableEmailsFor_ExcludesBouncedAndUnsubscribed', async () => {
    const admin = adminClient();
    const personId = await makeAdultInHousehold(admin, 'Bounced');
    const primary = await addPersonEmail(admin, personId, `livep-${Date.now()}@example.com`);
    const bounced = await addPersonEmail(admin, personId, `bounced-${Date.now()}@example.com`, 'work');
    await admin.from('person_emails').update({ bounced_at: new Date().toISOString() }).eq('id', bounced.id);

    const rows = await deliverableEmailsFor(admin, personId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(primary.id);
  });

  it('RequestChallengeForPerson_WithEmailId_SendsToThatAddress', async () => {
    const admin = adminClient();
    const personId = await makeAdultInHousehold(admin, 'PickAddress');
    await addPersonEmail(admin, personId, `primary-${Date.now()}@example.com`);
    const other = await addPersonEmail(admin, personId, `other-${Date.now()}@example.com`, 'other');

    const result = await requestChallengeForPerson(admin, personId, { emailId: other.id });
    expect(result.sent).toBe(true);

    const rows = await tokensFor(admin, personId);
    expect(rows).toHaveLength(1);
    expect(rows[0].sent_to).toBe(other.email);
  });

  it('RequestChallengeForPerson_WithEmailId_RefusesAnAddressBelongingToSomeoneElse', async () => {
    const admin = adminClient();
    const personA = await makeAdultInHousehold(admin, 'OwnerA');
    const personB = await makeAdultInHousehold(admin, 'OwnerB');
    await addPersonEmail(admin, personA, `a-${Date.now()}@example.com`);
    const addrOfB = await addPersonEmail(admin, personB, `b-${Date.now()}@example.com`);

    const result = await requestChallengeForPerson(admin, personA, { emailId: addrOfB.id });
    expect(result).toEqual({ sent: false, reason: 'unreachable' });

    expect(await tokensFor(admin, personA)).toHaveLength(0);
  });

  it('RedeemCode_MarksTheAddressVerified_AndLeavesOtherAddressesAlone', async () => {
    const admin = adminClient();
    const personId = await makeAdultInHousehold(admin, 'VerifyOnCodeRedeem');
    const used = await addPersonEmail(admin, personId, `codeused-${Date.now()}@example.com`);
    const unused = await addPersonEmail(admin, personId, `codeunused-${Date.now()}@example.com`, 'work');
    await seedRedeemableToken(admin, personId, used.email, 'vitest-code-flow-token', '654321');

    const result = await redeemCodeForPerson(admin, personId, '654321');
    expect(result.ok).toBe(true);

    const { data: rows } = await admin
      .from('person_emails')
      .select('id, verified_at')
      .in('id', [used.id, unused.id]);
    const byId = new Map(((rows ?? []) as { id: number; verified_at: string | null }[]).map((r) => [r.id, r.verified_at]));
    expect(byId.get(used.id)).not.toBeNull();
    expect(byId.get(unused.id)).toBeNull();
  });

  it('RedeemCode_LeavesVerifiedAtNull_WhenTheAttemptFails', async () => {
    const admin = adminClient();
    const personId = await makeAdultInHousehold(admin, 'FailedCodeNoVerify');
    const email = await addPersonEmail(admin, personId, `failcode-${Date.now()}@example.com`);
    await seedRedeemableToken(admin, personId, email.email, 'vitest-failcode-token', '111222');

    const failed = await redeemCode(admin, email.email, '000000'); // wrong code
    expect(failed.ok).toBe(false);

    const { data: after } = await admin.from('person_emails').select('verified_at').eq('id', email.id).single();
    expect((after as { verified_at: string | null }).verified_at).toBeNull();
  });

  it('RedeemToken_MarksTheAddressVerified', async () => {
    const admin = adminClient();
    const personId = await makeAdultInHousehold(admin, 'VerifyOnLinkRedeem');
    const used = await addPersonEmail(admin, personId, `linkused-${Date.now()}@example.com`);
    await seedRedeemableToken(admin, personId, used.email, 'vitest-link-flow-token', '333444');

    const identity = await redeemToken(admin, 'vitest-link-flow-token');
    expect(identity).not.toBeNull();

    const { data: after } = await admin.from('person_emails').select('verified_at').eq('id', used.id).single();
    expect((after as { verified_at: string | null }).verified_at).not.toBeNull();
  });

  it('RedeemToken_LeavesVerifiedAtNull_WhenTheTokenDoesNotMatch', async () => {
    const admin = adminClient();
    const personId = await makeAdultInHousehold(admin, 'FailedLinkNoVerify');
    const email = await addPersonEmail(admin, personId, `faillink-${Date.now()}@example.com`);
    await seedRedeemableToken(admin, personId, email.email, 'vitest-faillink-token', '555666');

    const identity = await redeemToken(admin, 'not-the-real-token');
    expect(identity).toBeNull();

    const { data: after } = await admin.from('person_emails').select('verified_at').eq('id', email.id).single();
    expect((after as { verified_at: string | null }).verified_at).toBeNull();
  });
});

/** Test-only re-implementation of identity-challenge.ts's private
 *  hashSecret() — same SHA-256(value || pepper) shape, needed here only to
 *  seed fixture rows whose hash the module itself would otherwise compute
 *  internally (mirrors tests/identity-auth.test.ts's own copy). */
async function sha256HexForTest(raw: string): Promise<string> {
  const pepper = process.env.IDENTITY_TOKEN_PEPPER;
  if (!pepper) throw new Error('IDENTITY_TOKEN_PEPPER missing — is .env.local present?');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${raw}${pepper}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

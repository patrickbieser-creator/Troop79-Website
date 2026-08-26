import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { requestChallengeForPerson } from '../src/lib/identity-challenge';

/**
 * Roster "Send sign-in link" (Plans/Verified-Signup.md Phase A).
 *
 * sendSignInLink() itself is a Server Action gated by
 * requireCapability('roster.manage'), which needs a cookie this suite has no
 * way to mock — same D-049 boundary tests/news-submission.test.ts documents.
 * What IS DB-testable is the layer it actually wires into:
 * requestChallengeForPerson()'s createdByLeader threading onto login_tokens,
 * proven directly below (SendSignInLink_LogsTheSender). That the Server
 * Action calls it with the ACTING LEADER's label, takes only a person id, and
 * sits behind the same capability as every other Roster write is proven by
 * source inspection, which is where those properties actually live (same
 * reasoning news-submission.test.ts gives for its own source-property test).
 */
describe('requestChallengeForPerson — createdByLeader (Send sign-in link)', () => {
  let householdIds: number[] = [];
  let personIds: number[] = [];
  let tokenIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (tokenIds.length > 0) await admin.from('login_tokens').delete().in('id', tokenIds);
    if (personIds.length > 0) await admin.from('household_members').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('people').delete().in('id', personIds);
    if (householdIds.length > 0) await admin.from('households').delete().in('id', householdIds);
    householdIds = [];
    personIds = [];
    tokenIds = [];
  });

  async function makeAdultInHousehold(admin: ReturnType<typeof adminClient>, email: string): Promise<number> {
    const { data: hh, error: hhErr } = await admin
      .from('households')
      .insert({ label: '[TEST] SendLink' })
      .select('id')
      .single();
    if (hhErr || !hh) throw new Error(`fixture: household insert failed: ${hhErr?.message}`);
    householdIds.push(hh.id as number);

    const { data: p, error: pErr } = await admin
      .from('people')
      .insert({ display_name: '[TEST] Adult', primary_email: email, active: true })
      .select('id')
      .single();
    if (pErr || !p) throw new Error(`fixture: person insert failed: ${pErr?.message}`);
    personIds.push(p.id as number);

    const { error: memErr } = await admin.from('household_members').insert({ household_id: hh.id, person_id: p.id });
    if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);

    return p.id as number;
  }

  it('SendSignInLink_LogsTheSender', async () => {
    const admin = adminClient();
    const personId = await makeAdultInHousehold(admin, `vitest-sendlink-${Date.now()}@example.com`);

    const result = await requestChallengeForPerson(admin, personId, { createdByLeader: '[TEST] Leader Sender' });
    expect(result.sent).toBe(true);

    const { data: rows } = await admin
      .from('login_tokens')
      .select('id, created_by_leader')
      .eq('person_id', personId);
    const created = (rows ?? []) as { id: number; created_by_leader: string | null }[];
    tokenIds.push(...created.map((r) => r.id));
    expect(created).toHaveLength(1);
    expect(created[0].created_by_leader).toBe('[TEST] Leader Sender');
  });

  it('SendSignInLink_LeavesCreatedByLeaderNull_ForASelfServiceRequest', async () => {
    // The /signin self-service path never passes createdByLeader — the
    // column stays null so a redeemed self-service token is never
    // mis-attributed to a leader on the dashboard.
    const admin = adminClient();
    const personId = await makeAdultInHousehold(admin, `vitest-selfservice-${Date.now()}@example.com`);

    const result = await requestChallengeForPerson(admin, personId);
    expect(result.sent).toBe(true);

    const { data: rows } = await admin
      .from('login_tokens')
      .select('id, created_by_leader')
      .eq('person_id', personId);
    const created = (rows ?? []) as { id: number; created_by_leader: string | null }[];
    tokenIds.push(...created.map((r) => r.id));
    expect(created[0].created_by_leader).toBeNull();
  });
});

describe('sendSignInLink — source property', () => {
  const src = readFileSync(
    new URL('../src/app/admin/(workspace)/advancement/roster/person-actions.ts', import.meta.url),
    'utf8'
  );
  const start = src.indexOf('export async function sendSignInLink');
  const nextFnIdx = src.indexOf('\nexport async function', start + 1);
  const body = src.slice(start, nextFnIdx === -1 ? undefined : nextFnIdx);

  it('SendSignInLink_OnlyEverUsesTheRosterAddress', () => {
    expect(start).toBeGreaterThan(-1);

    // Signature: a person id, nothing shaped like an address.
    const signature = body.slice(0, body.indexOf(')') + 1);
    expect(signature).toContain('personId: number');
    expect(signature).not.toMatch(/email|address/i);

    // The body never reads an email/address out of its own input — the
    // destination is resolved entirely inside requestChallengeForPerson()
    // (deliverableEmailFor(), keyed on the roster's primary_email), so there
    // is no path from a caller-supplied string to where the mail goes.
    expect(body).not.toMatch(/formData/i);
    expect(body).not.toMatch(/['"]email['"]/i);
  });

  it('SendSignInLink_PassesTheActingLeadersLabel_AsCreatedByLeader', () => {
    expect(body).toContain('requestChallengeForPerson(');
    expect(body).toContain('createdByLeader: actor.label');
  });

  it('SendSignInLink_IsGuardedByRosterManage_SameAsEveryOtherRosterWrite', () => {
    expect(body).toContain("requireCapability('roster.manage')");
  });
});

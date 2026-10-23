import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { approveSubmission } from '../src/lib/library-data';

/**
 * Proof approvals sign the ledger the way Fast Entry does (production bug, 2026-10-22): `by` is the approving
 * leader's code ("PB"), falling back to the reviewer's initials when they have no leader code, and `date` is today in
 * Central (an approval after 7 PM Central used to land on tomorrow's UTC date). `entered_by` stays the label. Real
 * local database; test-owned rows only.
 */
const sb = adminClient();
const people: number[] = [];
const scoutIds: string[] = [];
const submissionIds: number[] = [];
const ledgerIds: number[] = [];
const leaderCodes: string[] = [];
let leader = 0;
let noCode = 0;
let other = 0;
/** L0 qa (3): another leader already holds the code these initials would make. */
const TAKEN_LABEL = 'Qa Xb Jc';
const TAKEN = 'QXJ';
const CODE = `Z${Date.now() % 100000}`;

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} ASS ${label}`, first_name: `${TEST_PREFIX} ASS`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function submission(suffix: string): Promise<number> {
  const id = `vitest-ass-${suffix}-${Date.now()}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: TEST_PREFIX, last_name: 'ASS', display_name: `${TEST_PREFIX} ASS ${suffix}`, active: true });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  const { data, error: e2 } = await sb
    .from('requirement_submissions')
    .insert({ scout_id: id, target_kind: 'rank_req', target_key: 'first-class-9zz-proof', proof_type: 'report', body_md: '[TEST] signer', submitted_via: 'family', status: 'pending' })
    .select('id')
    .single();
  if (e2) throw new Error(e2.message);
  submissionIds.push(data!.id);
  return data!.id as number;
}
async function approve(subId: number, label: string, personId: number | null) {
  const res = await approveSubmission(sb, subId, label, personId);
  if (res.error || !res.ledgerEntryId) throw new Error(res.error ?? 'no ledger row');
  ledgerIds.push(res.ledgerEntryId);
  const { data } = await sb.from('ledger_entries').select('by, date, entered_by').eq('id', res.ledgerEntryId).single();
  return data as { by: string; date: string; entered_by: string };
}

beforeAll(async () => {
  leader = await person('Leader');
  noCode = await person('Nocode');
  const { error } = await sb.from('leaders').insert({ code: CODE, name: `${TEST_PREFIX} ASS Leader`, person_id: leader });
  if (error) throw new Error(error.message);
  leaderCodes.push(CODE);
  other = await person('Other');
  const taken = await sb.from('leaders').insert({ code: TAKEN, name: `${TEST_PREFIX} ASS Other`, person_id: other });
  if (!taken.error) leaderCodes.push(TAKEN);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  if (submissionIds.length) await sb.from('requirement_submissions').delete().in('id', submissionIds);
  if (ledgerIds.length) await sb.from('ledger_entries').delete().in('id', ledgerIds);
  if (scoutIds.length) await sb.from('scouts').delete().in('id', scoutIds);
  if (leaderCodes.length) await sb.from('leaders').delete().in('code', leaderCodes);
  await sb.from('people').delete().in('id', people);
});

describe('approveSubmission signs like Fast Entry', () => {
  it('ApproveSubmission_SignsWithLeaderCode', async () => {
    const row = await approve(await submission('code'), 'Patrick Bieser', leader);
    expect(row.by).toBe(CODE);
  });

  it('ApproveSubmission_FallsBackToInitials_WhenNoLeaderCode', async () => {
    const row = await approve(await submission('initials'), 'Maria Lopez', noCode);
    expect(row.by).toBe('ML');
  });

  it('ApproveSubmission_KeepsTheLabelAsEnteredBy', async () => {
    const row = await approve(await submission('label'), 'Patrick Bieser', leader);
    expect(row.entered_by).toBe('Patrick Bieser');
  });

  it('ApproveSubmission_DatesInCentral_AfterSevenPm', async () => {
    const id = await submission('late');
    // 8:30 PM Central on Oct 21 is already Oct 22 in UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T01:30:00Z'));
    const row = await approve(id, 'Patrick Bieser', leader);
    expect(row.date).toBe('2026-10-21');
  });
});

describe('approveSubmission never signs as someone else (L0 qa)', () => {
  it('ApproveSubmission_InitialsAreAnotherLeadersCode_SignsWithTheLabel', async () => {
    const row = await approve(await submission('taken'), TAKEN_LABEL, noCode);
    expect(row.by).toBe(TAKEN_LABEL);
  });

  it('ApproveSubmission_NoPerson_SignsWithTheLabel', async () => {
    const row = await approve(await submission('noperson'), 'Maria Lopez', null);
    expect(row.by).toBe('Maria Lopez');
  });
});

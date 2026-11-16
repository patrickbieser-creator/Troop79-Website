import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { approvalsCutoff, loadRecentApprovals, loadApprovalDetail } from '../src/lib/proof-approvals';

/**
 * Advancement › Approvals (Patrick, 2026-11-15): a read-only list of proof submissions approved in the past two
 * months, each opening to everything the record holds. Prompted by an approval that "disappeared" from the Proof
 * Queue — it had been approved, and nothing on screen said so.
 *
 * Real local database; test-owned rows only (scout ids minted here, submission/ledger ids collected on insert).
 */

describe('approvalsCutoff (pure)', () => {
  it('ApprovalsCutoff_IsTwoMonthsBeforeNow', () => {
    expect(approvalsCutoff(new Date('2026-11-15T18:00:00Z'))).toBe('2026-09-15T18:00:00.000Z');
  });

  it('ApprovalsCutoff_ClampsToTheMonthEnd', () => {
    // Dec 31 minus two months is Oct 31; Apr 30 minus two is Feb 28 — never rolls into the next month.
    expect(approvalsCutoff(new Date('2026-04-30T12:00:00Z'))).toBe('2026-02-28T12:00:00.000Z');
  });
});

const sb = adminClient();
const SCOUT = `vitest-appr-${Date.now()}`;
const submissionIds: number[] = [];
const ledgerIds: number[] = [];
let submitterId = 0;
const ids = { recent: 0, older: 0, old: 0, returned: 0, pending: 0 };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function insertSubmission(over: Record<string, unknown>): Promise<number> {
  const { data, error } = await sb
    .from('requirement_submissions')
    .insert({
      scout_id: SCOUT,
      target_kind: 'rank_req',
      target_key: 'life-4',
      proof_type: 'report',
      body_md: '[TEST] six hours at the food pantry',
      media: [],
      submitted_via: 'family',
      status: 'pending',
      ...over
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  submissionIds.push(data!.id);
  return data!.id as number;
}

beforeAll(async () => {
  const { data: p, error: pe } = await sb
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} APPR Parent`, first_name: `${TEST_PREFIX} APPR`, last_name: 'Parent' })
    .select('id')
    .single();
  if (pe) throw new Error(pe.message);
  submitterId = p!.id;

  const { error: se } = await sb
    .from('scouts')
    .insert({ id: SCOUT, first_name: TEST_PREFIX, last_name: 'APPR', display_name: `${TEST_PREFIX} APPR Scout`, active: true });
  if (se) throw new Error(se.message);

  const { data: led, error: le } = await sb
    .from('ledger_entries')
    .insert({
      scout_id: SCOUT,
      date: '2026-11-15',
      kind: 'rank_requirement',
      code: 'life-4',
      label: 'Six More Hours of Service',
      by: 'MS',
      qty: 1,
      unit: 'complete',
      entered_by: 'Mindy Stollenwerk',
      entered_at: daysAgo(1)
    })
    .select('id')
    .single();
  if (le) throw new Error(le.message);
  ledgerIds.push(led!.id);

  ids.recent = await insertSubmission({
    status: 'approved',
    reviewed_by: 'Mindy Stollenwerk',
    reviewed_at: daysAgo(1),
    ledger_entry_id: led!.id,
    submitted_by_person_id: submitterId
  });
  ids.older = await insertSubmission({ target_key: 'life-5', status: 'approved', reviewed_by: 'Patrick Bieser', reviewed_at: daysAgo(20) });
  ids.old = await insertSubmission({ target_key: 'life-6', status: 'approved', reviewed_by: 'Patrick Bieser', reviewed_at: daysAgo(70) });
  ids.returned = await insertSubmission({ target_key: 'life-7', status: 'returned', reviewed_by: 'Patrick Bieser', reviewed_at: daysAgo(2), feedback_md: 'Not yet' });
  ids.pending = await insertSubmission({ target_key: 'life-8' });
});

afterAll(async () => {
  if (submissionIds.length) await sb.from('requirement_submissions').delete().in('id', submissionIds);
  if (ledgerIds.length) await sb.from('ledger_entries').delete().in('id', ledgerIds);
  await sb.from('scouts').delete().eq('id', SCOUT);
  if (submitterId) await sb.from('people').delete().eq('id', submitterId);
});

describe('loadRecentApprovals', () => {
  const mine = async () => (await loadRecentApprovals(sb)).filter((a) => a.scoutId === SCOUT);

  it('LoadRecentApprovals_IncludesApprovalsInTheWindow', async () => {
    expect((await mine()).map((a) => a.id).sort()).toEqual([ids.recent, ids.older].sort());
  });

  it('LoadRecentApprovals_ListsNewestFirst', async () => {
    expect((await mine()).map((a) => a.id)).toEqual([ids.recent, ids.older]);
  });

  it('LoadRecentApprovals_NamesTheScoutTheRequirementAndTheApprover', async () => {
    const row = (await mine()).find((a) => a.id === ids.recent)!;
    expect([row.scoutName, row.requirement, row.reviewedBy]).toEqual([
      `${TEST_PREFIX} APPR Scout`,
      'Life — Requirement 4: Six More Hours of Service',
      'Mindy Stollenwerk'
    ]);
  });
});

describe('loadApprovalDetail', () => {
  it('LoadApprovalDetail_CarriesTheSubmitterAndTheLedgerEntry', async () => {
    const d = await loadApprovalDetail(sb, ids.recent);
    expect([d?.submitterName, d?.ledger?.id, d?.ledger?.by, d?.ledger?.deletedAt]).toEqual([
      `${TEST_PREFIX} APPR Parent`,
      ledgerIds[0],
      'MS',
      null
    ]);
  });

  it('LoadApprovalDetail_IsNullForASubmissionThatWasNotApproved', async () => {
    expect(await loadApprovalDetail(sb, ids.returned)).toBeNull();
  });
});

describe('Advancement nav', () => {
  it('AdvancementNav_ListsApprovalsRightAfterSubmitAndPresent', async () => {
    const { SECTIONS } = await import('../src/app/admin/(workspace)/_components/nav-data');
    const labels = SECTIONS.find((s) => s.title === 'Advancement')!.items.map((i) => i.label);
    expect(labels.slice(labels.indexOf('Submit & Present'), labels.indexOf('Submit & Present') + 2)).toEqual(['Submit & Present', 'Approvals']);
  });
});

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { bucketIdsNow, deleteNewEmptyBuckets } from './helpers/bucket-cleanup';
import { fetchAllRows } from '../src/lib/supabase/paginate';
import {
  computeBalance,
  computeScoutAccountBalances,
  reconciliationDrift,
  type FinancialTransactionRow
} from '../src/lib/finance';

/**
 * The finance page used to pull the WHOLE financial_transactions table through fetchAllRows once per
 * widget (balances, scout balances, reconciliation). Those actions now read the Postgres aggregate
 * finance_balances (the activity-label list went with the label column, Buckets Release 2). Each test recomputes the answer the OLD way
 * (full read + lib/finance) and requires the action to agree, with test-owned fixture rows (memo
 * 'finance-aggregates-db') thickening the data: voided rows, fractional cents, a scout_account row.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/require-capability', () => ({
  requireCapability: async () => ({ personId: null }),
  requireAnyOf: async () => ({ personId: null })
}));
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import {
  getAccountBalancesAction,
  getScoutAccountBalancesAction,
  getReconciliationSummaryAction
} from '../src/app/admin/(workspace)/finance/actions';

const admin = adminClient();
const MEMO = 'finance-aggregates-db';
const created: number[] = [];
const reconCreated: number[] = [];

afterEach(async () => {
  if (created.length) await admin.from('financial_transactions').delete().in('id', created.splice(0));
  if (reconCreated.length) await admin.from('account_reconciliations').delete().in('id', reconCreated.splice(0));
});

async function insertTx(row: {
  account: string;
  amount: number;
  person_id?: number | null;
  voided?: boolean;
  occurred_on?: string;
}) {
  const { data, error } = await admin
    .from('financial_transactions')
    .insert({
      occurred_on: row.occurred_on ?? '2020-01-01',
      account: row.account,
      amount: row.amount,
      kind: 'transfer',
      person_id: row.person_id ?? null,
      memo: MEMO,
      voided_at: row.voided ? new Date().toISOString() : null
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message);
  created.push(data.id as number);
}

async function fixtures() {
  const { data: p } = await admin.from('people').select('id').limit(1).single();
  const personId = p!.id as number;
  await insertTx({ account: 'checking', amount: 0.1 });
  await insertTx({ account: 'checking', amount: 0.2 });
  await insertTx({ account: 'checking', amount: -7.35 });
  await insertTx({ account: 'checking', amount: 999, voided: true });
  await insertTx({ account: 'savings', amount: 12.34, occurred_on: '2020-02-01' });
  await insertTx({ account: 'sofi', amount: 5.55 });
  await insertTx({ account: 'scholarship', amount: 3.3 });
  await insertTx({ account: 'scout_account', amount: 20.15, person_id: personId });
  await insertTx({ account: 'scout_account', amount: -0.05, person_id: personId });
  await insertTx({ account: 'scout_account', amount: 500, person_id: personId, voided: true });
  await insertTx({ account: 'checking', amount: 1, voided: true });
  return personId;
}

async function allRows() {
  return fetchAllRows<FinancialTransactionRow & { occurred_on: string }>((from, to) =>
    admin
      .from('financial_transactions')
      .select('id, occurred_on, account, amount, person_id, voided_at')
      .order('id')
      .range(from, to)
  );
}

describe('finance aggregates equal the full-read algorithm', () => {
  it('AccountBalances_EqualComputeBalance_OverTheFullTable', async () => {
    await fixtures();
    const rows = await allRows();
    const got = await getAccountBalancesAction();
    expect(got).toEqual({
      checking: computeBalance(rows, { account: 'checking' }),
      savings: computeBalance(rows, { account: 'savings' }),
      scholarship: computeBalance(rows, { account: 'scholarship' }),
      sofi: computeBalance(rows, { account: 'sofi' })
    });
  });

  it('ScoutBalances_EqualComputeScoutAccountBalances', async () => {
    const personId = await fixtures();
    const rows = await allRows();
    const expected = computeScoutAccountBalances(rows);
    const got = await getScoutAccountBalancesAction();
    expect(new Map(got.map((r) => [r.personId, r.balance]))).toEqual(expected);
    expect(got.find((r) => r.personId === personId)?.balance).toBe(expected.get(personId));
    const names = got.map((r) => r.personName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('ReconciliationSummary_EqualsTheLoopedFullReadAlgorithm', async () => {
    await fixtures();
    const { data: rec } = await admin
      .from('account_reconciliations')
      .insert({ account: 'checking', as_of: '2020-01-15', statement_balance: 1.23, computed_balance: 0, note: MEMO })
      .select('id')
      .single();
    reconCreated.push(rec!.id as number);
    const rows = await allRows();
    const expected = [];
    for (const account of ['checking', 'savings'] as const) {
      const { data: last } = await admin
        .from('account_reconciliations')
        .select('as_of, statement_balance')
        .eq('account', account)
        .order('as_of', { ascending: false })
        .limit(1)
        .maybeSingle();
      const stmt = last ? Number(last.statement_balance) : null;
      expected.push({
        account,
        computedBalance: computeBalance(rows, { account }),
        lastReconciledAt: last?.as_of ?? null,
        lastStatementBalance: stmt,
        drift: last && stmt != null ? reconciliationDrift(rows, account, last.as_of, stmt) : null
      });
    }
    expect(await getReconciliationSummaryAction()).toEqual(expected);
  });

});

describe('finance aggregate functions are service-role only', () => {
  it.each(['finance_balances'])('%s_IsExecutableByTheServiceRole', async (fn) => {
    const { error } = await admin.rpc(fn);
    expect(error).toBeNull();
  });

  // Buckets Release 2: the bucket resolvers write (they can create a bucket), so anon must not reach them either.
  it.each([
    ['finance_balances', {}],
    ['bucket_id_for_name', { p_name: 'anon bucket' }],
    ['event_bucket', { p_calendar_entry_id: 1 }]
  ] as const)('%s_CannotBeExecutedWithTheAnonKey', async (fn, args) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anon.rpc(fn, args);
    expect(error).not.toBeNull();
  });
});

// Labels written here create buckets (the buckets sync trigger); remove the ones this file made.
let bucketsBefore = new Set<number>();
beforeAll(async () => {
  bucketsBefore = await bucketIdsNow(adminClient());
});
afterAll(async () => {
  await deleteNewEmptyBuckets(adminClient(), bucketsBefore);
});

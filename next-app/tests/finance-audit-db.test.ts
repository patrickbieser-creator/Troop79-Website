import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';

/**
 * finance_audit_totals() — Postgres's independent totals for the Ledger
 * Audit (Plans/Ledger-Audit.md). Real local Postgres (D-049). A fixture row
 * on the closed SOFI account keeps the arithmetic isolated from whatever the
 * mirrored ledger holds: the test compares before/after deltas.
 */
const admin = adminClient();
const created: number[] = [];

afterEach(async () => {
  if (created.length) await admin.from('financial_transactions').delete().in('id', created.splice(0));
});

async function sofiTotals() {
  const { data, error } = await admin.rpc('finance_audit_totals');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { account: string; live_total: number; live_rows: number; voided_rows: number }[];
  const sofi = rows.filter((r) => r.account === 'sofi');
  return {
    cents: sofi.reduce((n, r) => n + Math.round(Number(r.live_total) * 100), 0),
    live: sofi.reduce((n, r) => n + Number(r.live_rows), 0),
    voided: sofi.reduce((n, r) => n + Number(r.voided_rows), 0)
  };
}

async function insertSofi(amount: number, voided = false) {
  const { data, error } = await admin
    .from('financial_transactions')
    .insert({
      occurred_on: '2020-01-01',
      account: 'sofi',
      amount,
      kind: 'transfer',
      memo: 'finance-audit-db test fixture',
      voided_at: voided ? new Date().toISOString() : null
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message);
  created.push(data.id as number);
}

describe('finance_audit_totals()', () => {
  it('FinanceAuditTotals_SumsLiveRowsExactly_AndCountsVoidedSeparately', async () => {
    const before = await sofiTotals();
    await insertSofi(0.1);
    await insertSofi(0.2);
    await insertSofi(999, true);
    const after = await sofiTotals();
    expect({ cents: after.cents - before.cents, live: after.live - before.live, voided: after.voided - before.voided }).toEqual({
      cents: 30,
      live: 2,
      voided: 1
    });
  });

  it('FinanceAuditTotals_CannotBeExecutedWithTheAnonKey', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anon.rpc('finance_audit_totals');
    expect(error).not.toBeNull();
  });
});

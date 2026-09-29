'use server';

/**
 * Ledger Audit + Bank Match — read-only Server Actions (Plans/Ledger-Audit.md).
 * finance.manage OR finance.view, same gate as the ledger itself: nothing
 * here writes. The uploaded bank export is parsed in memory and discarded —
 * bank data is never stored.
 */
import { requireAnyOf } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { centralToday } from '@/lib/dates';
import {
  runLedgerAudit,
  type AuditFinding,
  type AuditTxn,
  type AuditReconciliation,
  type AuditReimbursement,
  type SqlTotalRow
} from '@/lib/finance-audit';
import { BankCsvError, buildBankMatchReport, parseLandmarkCsv, type BankMatchReport, type LedgerCashRow } from '@/lib/bank-statement';

const TXN_COLUMNS =
  'id, occurred_on, account, amount, kind, method, person_id, memo, transfer_group, reimbursement_id, source, voided_at, created_at, updated_at';

/** What the report shows for a row a finding names. */
export interface AuditRowSummary {
  id: number;
  occurred_on: string;
  account: string;
  amount: number;
  kind: string;
  memo: string | null;
  voided: boolean;
}

export interface LedgerAuditResult {
  findings: AuditFinding[];
  rows: Record<number, AuditRowSummary>;
  rowCount: number;
  ranAt: string;
}

async function loadAllTransactions(): Promise<AuditTxn[]> {
  const supabase = createAdminClient();
  // Ordered by id: unordered range pages can skip or repeat rows (tech-lead),
  // which would show up here as a false re-sum mismatch.
  const rows = await fetchAllRows<AuditTxn>((from, to) =>
    supabase.from('financial_transactions').select(TXN_COLUMNS).order('id').range(from, to)
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export async function runLedgerAuditAction(): Promise<LedgerAuditResult> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const supabase = createAdminClient();

  const [rows, totalsRes, reconRes, reimbRes] = await Promise.all([
    loadAllTransactions(),
    supabase.rpc('finance_audit_totals'),
    supabase.from('account_reconciliations').select('id, account, as_of, statement_balance, computed_balance, created_at'),
    supabase.from('reimbursement_requests').select('id, amount, status')
  ]);
  if (totalsRes.error) throw new Error(`finance_audit_totals: ${totalsRes.error.message}`);
  if (reconRes.error) throw new Error(reconRes.error.message);
  if (reimbRes.error) throw new Error(reimbRes.error.message);

  const sqlTotals = ((totalsRes.data ?? []) as SqlTotalRow[]).map((r) => ({
    ...r,
    live_total: Number(r.live_total),
    live_rows: Number(r.live_rows),
    voided_rows: Number(r.voided_rows)
  }));
  const reconciliations = ((reconRes.data ?? []) as AuditReconciliation[]).map((r) => ({
    ...r,
    statement_balance: Number(r.statement_balance),
    computed_balance: Number(r.computed_balance)
  }));
  const reimbursements = ((reimbRes.data ?? []) as AuditReimbursement[]).map((r) => ({ ...r, amount: Number(r.amount) }));

  const findings = runLedgerAudit({ rows, sqlTotals, reconciliations, reimbursements, today: centralToday() });

  const wanted = new Set(findings.flatMap((f) => f.txnIds));
  const summaries: Record<number, AuditRowSummary> = {};
  for (const t of rows) {
    if (!wanted.has(t.id)) continue;
    summaries[t.id] = {
      id: t.id,
      occurred_on: t.occurred_on,
      account: t.account,
      amount: t.amount,
      kind: t.kind,
      memo: t.memo,
      voided: t.voided_at !== null
    };
  }
  return { findings, rows: summaries, rowCount: rows.length, ranAt: new Date().toISOString() };
}

export type BankMatchActionResult = { ok: true; account: 'checking' | 'savings'; report: BankMatchReport } | { ok: false; error: string };

/** Largest export accepted — two years of Landmark checking is ~40 KB. */
const MAX_BYTES = 2 * 1024 * 1024;

export async function matchBankStatementAction(formData: FormData): Promise<BankMatchActionResult> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const account = formData.get('account');
  const file = formData.get('file');
  if (account !== 'checking' && account !== 'savings') return { ok: false, error: 'Pick checking or savings.' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose the CSV file exported from Landmark.' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'That file is larger than a Landmark export should be.' };

  try {
    const statement = parseLandmarkCsv(await file.text());
    const ledger: LedgerCashRow[] = (await loadAllTransactions())
      .filter((t) => t.account === account && t.voided_at === null)
      .map((t) => ({ id: t.id, occurred_on: t.occurred_on, amount: t.amount, memo: t.memo, kind: t.kind, method: t.method }));
    return { ok: true, account, report: buildBankMatchReport(statement, ledger) };
  } catch (e) {
    if (e instanceof BankCsvError) return { ok: false, error: e.message };
    throw e;
  }
}

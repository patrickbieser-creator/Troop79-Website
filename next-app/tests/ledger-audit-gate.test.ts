import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Ledger Audit (Plans/Ledger-Audit.md) — qa-lead 2026-09-29: both actions
 * are gated on finance.manage OR finance.view BEFORE touching the database,
 * and a bad upload comes back as a message, not a thrown error. Same mock
 * shape as guest-actions-gate.test.ts: resolveAdminActor has no request
 * scope in Vitest.
 */
const createAdminClient = vi.fn(() => {
  throw new Error('Supabase must not be reached in these tests');
});
let actor: { capabilities: Set<string> } | null = null;
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => createAdminClient() }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));

beforeEach(() => {
  actor = null;
  createAdminClient.mockClear();
});

function upload(text: string, account = 'checking') {
  const fd = new FormData();
  fd.set('account', account);
  fd.set('file', new File([text], 'ExportedTransactions.csv', { type: 'text/csv' }));
  return fd;
}

describe('Ledger Audit actions — capability gate', () => {
  it('LedgerAudit_RefusesAnonymous_BeforeReadingTheLedger', async () => {
    const { runLedgerAuditAction } = await import('@/app/admin/(workspace)/utilities/ledger-audit/actions');
    await expect(runLedgerAuditAction()).rejects.toThrow('Not authenticated');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('BankMatch_RefusesALeaderWithoutAFinanceCapability', async () => {
    actor = { capabilities: new Set(['news.write']) };
    const { matchBankStatementAction } = await import('@/app/admin/(workspace)/utilities/ledger-audit/actions');
    await expect(matchBankStatementAction(upload('x'))).rejects.toThrow(/requires/);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('BankMatch_ReturnsAMessage_WhenTheFileIsNotALandmarkExport', async () => {
    actor = { capabilities: new Set(['finance.view']) };
    const { matchBankStatementAction } = await import('@/app/admin/(workspace)/utilities/ledger-audit/actions');
    const r = await matchBankStatementAction(upload('"Date","Amount"\n"9/1/2025","1.00"'));
    expect(r.ok ? 'ok' : r.error).toMatch(/Landmark transaction export/);
  });

  it('BankMatch_ReturnsAMessage_WhenNoAccountIsChosen', async () => {
    actor = { capabilities: new Set(['finance.manage']) };
    const { matchBankStatementAction } = await import('@/app/admin/(workspace)/utilities/ledger-audit/actions');
    const r = await matchBankStatementAction(upload('x', 'scout_account'));
    expect(r.ok ? 'ok' : r.error).toBe('Pick checking or savings.');
  });
});

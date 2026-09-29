/**
 * /admin/utilities/ledger-audit — Ledger Audit + Bank Match
 * (Plans/Ledger-Audit.md, Patrick 2026-09-29: "recurring incidents where the
 * ledger does not balance with the bank accounts online").
 *
 * Read-only, finance.manage OR finance.view — the same gate as the ledger.
 * The ledger checks run on every load; the bank match runs when a Landmark
 * CSV export is uploaded, and the file is never stored.
 */
import { requireAnyOf } from '@/lib/require-capability';
import { PageTitle } from '../../_components/page-title';
import { matchBankStatementAction, runLedgerAuditAction } from './actions';
import { LedgerAuditReport } from './ledger-audit-report';

export const metadata = {
  title: 'Ledger Audit — Troop 79'
};

export default async function LedgerAuditPage() {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const audit = await runLedgerAuditAction();

  return (
    <>
      <PageTitle
        back={{ label: 'Utilities', href: '/admin/utilities' }}
        title="Ledger Audit"
        sub="Finds where the ledger and the bank disagree. Compare a Landmark export row by row, and check the ledger for balancing adjustments, one-sided transfers, duplicates and misbooked rows. Reports only — fixes happen in the Financial Ledger."
      />
      <LedgerAuditReport audit={audit} matchAction={matchBankStatementAction} />
    </>
  );
}

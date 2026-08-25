/**
 * /admin/finance/reimbursements — the treasurer's approve/deny/pay queue
 * (Plans/Troop-Finances.md Phase 4). finance.manage only — this is the
 * write side; family submission lives at /member/reimbursements.
 */
import { requireCapability } from '@/lib/require-capability';
import { listReimbursementsAction } from '../actions';
import { ReimbursementQueue } from './reimbursement-queue';
import { PageTitle } from '../../_components/page-title';

export const metadata = {
  title: 'Reimbursements — Troop 79'
};

export default async function ReimbursementsPage() {
  await requireCapability('finance.manage');
  const requests = await listReimbursementsAction();

  return (
    <>
      <PageTitle back={null}
        title="Reimbursements"
        sub="Approve, deny, or pay out requests families submit at /member/reimbursements."
      />
      <ReimbursementQueue requests={requests} />
    </>
  );
}

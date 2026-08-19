/**
 * /admin/finance/reimbursements — the treasurer's approve/deny/pay queue
 * (Plans/Troop-Finances.md Phase 4). finance.manage only — this is the
 * write side; family submission lives at /member/reimbursements.
 */
import { requireCapability } from '@/lib/require-capability';
import { listReimbursementsAction } from '../actions';
import { ReimbursementQueue } from './reimbursement-queue';
import styles from '../finance.module.css';

export const metadata = {
  title: 'Reimbursements — Troop 79'
};

export default async function ReimbursementsPage() {
  await requireCapability('finance.manage');
  const requests = await listReimbursementsAction();

  return (
    <>
      <div className={styles.pageTitle}>
        <div>
          <h1>Reimbursements</h1>
          <p>Approve, deny, or pay out requests families submit at /member/reimbursements.</p>
        </div>
      </div>
      <ReimbursementQueue requests={requests} />
    </>
  );
}

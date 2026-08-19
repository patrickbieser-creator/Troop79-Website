/**
 * /admin/finance/report — per-event/activity income-vs-expense report
 * (Plans/Troop-Finances.md Phase 6, Patrick 2026-08-18: "tie out between
 * income and expenses from an event like the can drive or a campout... a
 * report on demand based on each event").
 *
 * Groups every transaction by activity_label (populated on all imported
 * history; app-entered rows carry it too now via the Record a transaction
 * form's Activity field). Read-only, same finance.manage-OR-finance.view
 * gate as the ledger — this is a report, not a write surface.
 */
import { requireAnyOf } from '@/lib/require-capability';
import {
  getActivityReportAction,
  getActivityTransactionsAction,
  listDistinctActivityLabelsAction,
  previewRenameActivityAction,
  renameActivityAction
} from '../actions';
import { summarizeByActivity } from '@/lib/finance';
import { ActivityReport } from './activity-report';
import { RenameActivityPanel } from './rename-activity-panel';
import styles from '../finance.module.css';

export const metadata = {
  title: 'Activity Report — Troop 79'
};

export default async function FinanceReportPage() {
  const actor = await requireAnyOf(['finance.manage', 'finance.view']);
  const canManage = actor.capabilities.has('finance.manage');
  const [rows, activityLabels] = await Promise.all([
    getActivityReportAction(),
    canManage ? listDistinctActivityLabelsAction() : Promise.resolve([])
  ]);
  const summary = summarizeByActivity(rows);

  return (
    <>
      <div className={styles.pageTitle}>
        <div>
          <h1>Activity Report</h1>
          <p>
            Every transaction grouped by event or fundraiser — income, expenses, and whether it nets
            out to what you expected. Totals blend every account (checking, savings, scout accounts,
            scholarship); the breakdown under each activity shows the split.
          </p>
        </div>
      </div>
      {canManage && (
        <RenameActivityPanel
          activityLabels={activityLabels}
          previewRenameActivity={previewRenameActivityAction}
          renameActivity={renameActivityAction}
        />
      )}
      <ActivityReport summary={summary} getActivityTransactions={getActivityTransactionsAction} />
    </>
  );
}

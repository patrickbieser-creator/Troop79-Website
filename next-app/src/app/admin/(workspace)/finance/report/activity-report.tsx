/**
 * Pure presentation — no interactivity beyond native <details> expand/
 * collapse, so this stays a Server Component, no client JS shipped for it.
 *
 * Built from divs on one shared CSS grid class (reportGrid), not a
 * <table> — a native table's header and a CSS-grid <details> body can't be
 * guaranteed to align (that's exactly what broke here originally), and
 * <details> can't legally be a <tr> anyway. One grid definition used by
 * both the header and every row keeps them aligned by construction.
 */
import type { ActivitySummary } from '@/lib/finance';
import type { ActivityDrilldownRow } from '../actions';
import { ActivityDrilldownButton } from './activity-drilldown';
import parentStyles from '../finance.module.css';
import styles from './report.module.css';

const ACCOUNT_LABEL: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  scout_account: 'Scout accounts',
  scholarship: 'Scholarship fund',
  sofi: 'SoFi (closed)'
};

function money(n: number): string {
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
}

function dateRange(first: string, last: string): string {
  return first === last ? first : `${first} – ${last}`;
}

export function ActivityReport({
  summary,
  getActivityTransactions
}: {
  summary: ActivitySummary[];
  getActivityTransactions: (activityLabel: string) => Promise<ActivityDrilldownRow[]>;
}) {
  if (summary.length === 0) {
    return <p className={parentStyles.empty}>No transactions carry an activity label yet.</p>;
  }

  return (
    <div className={styles.wrap}>
      <div className={`${styles.reportGrid} ${styles.headerRow}`}>
        <span>Activity</span>
        <span>Date</span>
        <span className={styles.numCell}>Income</span>
        <span className={styles.numCell}>Expense</span>
        <span className={styles.numCell}>Net</span>
        <span className={styles.numCell}>Transactions</span>
      </div>
      {summary.map((s) => (
        <div key={s.activityLabel} className={styles.row}>
          <details>
            <summary className={`${styles.reportGrid} ${styles.summaryRow}`}>
              <span className={styles.activityName}>{s.activityLabel}</span>
              <span className={styles.dateRange}>{dateRange(s.firstDate, s.lastDate)}</span>
              <span className={styles.numCell}>{money(s.income)}</span>
              <span className={styles.numCell}>{money(s.expense)}</span>
              <span className={`${styles.numCell} ${s.net < 0 ? styles.negative : ''}`}>{money(s.net)}</span>
              <span className={styles.numCell}>{s.count}</span>
            </summary>
            <ul className={styles.breakdown}>
              {Object.entries(s.byAccount).map(([account, amount]) => (
                <li key={account}>
                  {ACCOUNT_LABEL[account] ?? account}: {money(amount as number)}
                </li>
              ))}
            </ul>
            <div className={styles.breakdownActions}>
              <ActivityDrilldownButton
                activityLabel={s.activityLabel}
                getActivityTransactions={getActivityTransactions}
              />
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

'use client';

/**
 * The Money tab's summary band (Plans/Event-Money-Ledger-Redesign.md §3) — replaces the five tiles. Left: income of
 * expected with a progress bar, who has paid, income by method. Right: Still due · Expenses · To reimburse · Net
 * (Cost to the troop when negative). Every figure the tiles showed is still here.
 */
import { byMethodLine, money, type EventMoneyTotals } from '@/lib/event-money';
import styles from './money.module.css';

export function MoneySummaryBand({
  totals,
  people
}: {
  totals: EventMoneyTotals;
  people: { owed: number; balance: number }[];
}) {
  const owing = people.filter((p) => p.owed > 0);
  const paidUp = owing.filter((p) => p.balance <= 0).length;
  const stillOwe = owing.length - paidUp;
  const pct = totals.owed > 0 ? Math.min(100, Math.max(0, (totals.income / totals.owed) * 100)) : 0;
  const methods = byMethodLine(totals.incomeByMethod);
  const negative = totals.net < 0;

  return (
    <section className={styles.band} aria-label="Money summary">
      <div className={styles.headline}>
        <p className={styles.big}>
          <strong>{money(totals.income)}</strong> income, of <strong>{money(totals.owed)}</strong> expected
        </p>
        <div
          className={styles.bar}
          role="progressbar"
          aria-label="Income of expected"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div className={styles.barFill} style={{ width: `${pct}%` /* dynamic */ }} />
        </div>
        <p className={styles.line}>
          {owing.length} {owing.length === 1 ? 'person owes' : 'people owe'} something: <strong>{paidUp} paid</strong>,{' '}
          <strong>{stillOwe} still owe</strong>
        </p>
        <p className={styles.line}>
          By method:{' '}
          {methods.map((m, i) => (
            <span key={m.method}>
              {i > 0 && ' · '}
              {m.amount !== 0 ? (
                <strong>
                  {m.label} {money(m.amount)}
                </strong>
              ) : (
                `${m.label} ${money(m.amount)}`
              )}
            </span>
          ))}
        </p>
      </div>

      <div className={styles.figures}>
        <div className={styles.figure}>
          <div className={styles.figLabel}>Still due</div>
          <div className={`${styles.figValue} ${totals.due > 0 ? styles.gold : ''}`}>{money(totals.due)}</div>
          <div className={styles.figSub}>
            from {stillOwe} {stillOwe === 1 ? 'person' : 'people'}
            {totals.overpaid > 0 ? ` · ${money(totals.overpaid)} overpaid` : ''}
          </div>
        </div>
        <div className={styles.figure}>
          <div className={styles.figLabel}>Expenses</div>
          <div className={styles.figValue}>{money(totals.expenses)}</div>
          <div className={styles.figSub}>incl. reimbursements paid</div>
        </div>
        <div className={styles.figure}>
          <div className={styles.figLabel}>To reimburse</div>
          <div className={styles.figValue}>{money(totals.reimbursementsPending)}</div>
          <div className={styles.figSub}>pending</div>
        </div>
        <div className={styles.figure}>
          <div className={styles.figLabel}>{negative ? 'Cost to the troop' : 'Net'}</div>
          <div className={`${styles.figValue} ${negative ? styles.danger : styles.forest}`}>{money(Math.abs(totals.net))}</div>
          <div className={styles.figSub}>income − expenses − pending</div>
        </div>
      </div>
    </section>
  );
}

/**
 * Wreath sale › Reconciliation (Patrick, 2026-10-19): every credited scout's account, line by line, and an Unassigned
 * section for orders with no credit — for the committee to check the books and for any scout or parent who asks.
 * Read-only and server-rendered from lib/wreaths/reconciliation, whose totals are checked against the Dashboard's.
 * Picking one scout renders only that scout, ready to print (WreathStatementSection's print view).
 */
import { fmtMoney2 } from '@/lib/wreaths/rules';
import { reconciliationCsv, type Reconciliation } from '@/lib/wreaths/reconciliation';
import { StatementSettings, WreathStatementSection } from '@/app/_components/wreath-statement';
import { CsvDownloadButton, PrintStatementButton, ScoutFilter } from './reconciliation-controls';
import styles from './wreaths.module.css';

/** The filter's value for a section: its person id, or 'none' for Unassigned. */
const keyOf = (personId: number | null) => (personId == null ? 'none' : String(personId));

export function ReconciliationPanel({ r, scout, asOf }: { r: Reconciliation; scout: string; asOf: string }) {
  const chosen = r.sections.find((s) => keyOf(s.personId) === scout) ?? null;
  const visible = chosen ? [chosen] : r.sections;
  const t = r.totals;
  return (
    <>
      <div className={styles.toolbar}>
        <ScoutFilter options={r.sections.map((s) => ({ value: keyOf(s.personId), label: s.name }))} value={chosen ? scout : ''} />
        <span className={styles.spacer} />
        {chosen && <PrintStatementButton />}
        {visible.length > 0 && <CsvDownloadButton csv={reconciliationCsv(visible)} fileName={`wreaths-${r.year}-reconciliation${chosen ? `-${chosen.firstName.toLowerCase()}` : ''}.csv`} />}
      </div>

      {r.check.ok ? (
        <p className={styles.balanced}>Balances with the sales dashboard ✓</p>
      ) : (
        <p className={styles.mismatch} role="alert">
          Doesn’t balance with the sales dashboard:{' '}
          {r.check.mismatches.map((m) => `${m.label} ${fmtMoney2(m.reconciliation)} here, ${fmtMoney2(m.dashboard)} on the dashboard`).join('; ')}.
        </p>
      )}

      {!chosen && r.sections.length > 0 && (
        <div className={`${styles.dashCard} ${styles.sectionGapSm}`}>
          <h3 className={styles.dashCardTitle}>All scouts</h3>
          <dl className={styles.moneyList}>
            <dt>Wreath sales ({t.items} items)</dt>
            <dd>{fmtMoney2(t.sales)}</dd>
            <dt>Cost</dt>
            <dd>{fmtMoney2(t.cost)}</dd>
            <dt>Gross profit</dt>
            <dd>{fmtMoney2(t.grossProfit)}</dd>
            {t.shortOnWreaths > 0 && (
              <>
                <dt>Paid short (troop absorbs)</dt>
                <dd>−{fmtMoney2(t.shortOnWreaths)}</dd>
              </>
            )}
            <dt>Donations, after fees and short payments</dt>
            <dd>
              {fmtMoney2(t.donationsNet)} of {fmtMoney2(t.gifts)}
            </dd>
            <dt>Card fees off the troop’s share</dt>
            <dd>{t.troopCardCost < 0 ? `+${fmtMoney2(-t.troopCardCost)}` : `−${fmtMoney2(t.troopCardCost)}`}</dd>
            <dt>Scouts’ total</dt>
            <dd>{fmtMoney2(t.scout)}</dd>
            <dt>Troop total</dt>
            <dd>{fmtMoney2(t.troop)}</dd>
            <dt>Delivery fees (troop)</dt>
            <dd>{fmtMoney2(t.deliveryFees)}</dd>
            <dt>Card fees · customers covered</dt>
            <dd>
              {fmtMoney2(t.cardFees)} · {fmtMoney2(t.feesCovered)}
            </dd>
            <dt>Paid ({t.paidOrders})</dt>
            <dd>{fmtMoney2(t.collected)}</dd>
            <dt>Pledged, unpaid ({t.unpaidOrders})</dt>
            <dd>{fmtMoney2(t.owed)}</dd>
          </dl>
          <StatementSettings settings={r.settings} />
        </div>
      )}

      <div className={styles.dashGap}>
        {visible.length === 0 && <p className={styles.muted}>No orders yet. Each scout’s account appears here as orders come in.</p>}
        {visible.map((s) => (
          <WreathStatementSection key={keyOf(s.personId)} section={s} year={r.year} settings={r.settings} asOf={asOf} printRoot={!!chosen} />
        ))}
      </div>
    </>
  );
}

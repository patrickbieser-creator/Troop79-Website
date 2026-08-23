/**
 * The Record-payment guard for notional accounts (Patrick, 2026-08-22): when
 * the method is the scout account or the scholarship fund, show what that
 * account holds; if the amount would take it negative, require an explicit
 * acknowledgement before Record is allowed, and offer the scholarship fund as
 * the alternative — all inside the same dialog. Pure: the two dialogs
 * (roster row, Money tab) render this with their own state.
 */
import type { PayMethod } from '@/lib/event-money';
import styles from './events-admin.module.css';

export interface AccountFacts {
  entryId: number;
  /** null = no person on the entry (a guest has no scout account). */
  balance: number | null;
  scholarshipBalance: number;
}

/** What the guard knows for the chosen method: the available figure, or null
 *  when the method is a cash method (no guard). */
export function availableFor(method: PayMethod, facts: AccountFacts | null): { label: string; available: number | null } | null {
  if (method === 'scout_account') return { label: 'Scout account', available: facts ? facts.balance : null };
  if (method === 'scholarship') return { label: 'Scholarship fund', available: facts ? facts.scholarshipBalance : null };
  return null;
}

/** True when the amount exceeds what the chosen notional account holds. */
export function wouldGoNegative(method: PayMethod, facts: AccountFacts | null, amount: number): boolean {
  const a = availableFor(method, facts);
  if (!a || a.available == null || !Number.isFinite(amount)) return false;
  return amount > a.available + 0.005;
}

const neg = (n: number) => (n < 0 ? <span className={styles.negMoney}>(−${Math.abs(n)})</span> : <>${n}</>);

export function PayGuard({
  method,
  facts,
  loading,
  amount,
  acknowledged,
  onAcknowledge,
  onUseScholarship
}: {
  method: PayMethod;
  facts: AccountFacts | null;
  loading: boolean;
  amount: number;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  onUseScholarship: () => void;
}) {
  const a = availableFor(method, facts);
  if (!a) return null;
  if (loading || !facts) return <p className={styles.panelHint} aria-live="polite">Checking the {a.label.toLowerCase()}…</p>;
  if (a.available == null) return <p className={styles.panelHint}>No scout account for this row (a guest).</p>;
  const short = wouldGoNegative(method, facts, amount);
  return (
    <div className={styles.panelHint} aria-live="polite">
      <p>
        {a.label} balance: {neg(a.available)} {a.available < 0 ? '— already overdrawn.' : 'available.'}
      </p>
      {short && (
        <div className={styles.payWarn} role="alert">
          <p>
            <strong>Not enough.</strong> Recording ${amount} would take the {a.label.toLowerCase()} to{' '}
            <span className={styles.negMoney}>(−${Math.round((amount - a.available) * 100) / 100})</span>.
          </p>
          <label>
            <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} /> I understand — let the{' '}
            {a.label.toLowerCase()} go negative
          </label>
          {method === 'scout_account' && (
            <p>
              <button type="button" className={styles.rowEdit} onClick={onUseScholarship}>
                Use the scholarship fund instead
              </button>{' '}
              <span>(${facts.scholarshipBalance} in the fund)</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * /admin/finance — Troop Finances workspace (Plans/Troop-Finances.md Phase 2).
 *
 * Gated on finance.manage OR finance.view (requireAnyOf). Write affordances
 * (record transaction, transfer, void, reconciliation, CSV export) render
 * only for finance.manage — finance.view is read-only by design, enforced
 * again server-side in actions.ts (the UI hiding a button is not the
 * security boundary, requireCapability() in each action is).
 */
import Link from 'next/link';
import { requireAnyOf } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { ACCOUNTS, FINANCE_PAGE_SIZE, type Account } from '@/lib/finance';
import {
  listFinancialTransactionsAction,
  getAccountBalancesAction,
  getScoutAccountBalancesAction,
  getReconciliationSummaryAction,
  listDistinctActivityLabelsAction,
  listTransactionKindsAction,
  type LedgerSortKey
} from './actions';
import { FinanceWorkspace } from './finance-workspace';
import { PageTitle } from '../_components/page-title';
import styles from './finance.module.css';

export const metadata = {
  title: 'Finance Ledger — Troop 79'
};

interface SearchParams {
  account?: string;
  kind?: string;
  person?: string;
  activity?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: string;
  amountMax?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

const SORT_KEYS: LedgerSortKey[] = ['date', 'account', 'kind', 'amount'];

function isKnownAccount(value: string): value is Account {
  return (ACCOUNTS as readonly string[]).includes(value);
}

function isSortKey(value: string): value is LedgerSortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

function urlWith(base: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, String(v));
  }
  const qs = params.toString();
  return `/admin/finance${qs ? `?${qs}` : ''}`;
}

export default async function FinancePage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireAnyOf(['finance.manage', 'finance.view']);
  const canManage = actor.capabilities.has('finance.manage');
  const raw = await searchParams;
  const account = raw.account && isKnownAccount(raw.account) ? raw.account : undefined;
  const kind = raw.kind?.trim() || undefined;
  const personId = raw.person ? Number(raw.person) : undefined;
  const activity = raw.activity?.trim() || undefined;
  // YYYY-MM-DD only — an occurred_on comparison, so anything else is
  // silently dropped rather than sent to Postgres and rejected mid-query.
  const dateFrom = raw.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(raw.dateFrom) ? raw.dateFrom : undefined;
  const dateTo = raw.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(raw.dateTo) ? raw.dateTo : undefined;
  const amountMin = raw.amountMin && Number.isFinite(Number(raw.amountMin)) ? Number(raw.amountMin) : undefined;
  const amountMax = raw.amountMax && Number.isFinite(Number(raw.amountMax)) ? Number(raw.amountMax) : undefined;
  const sort = raw.sort && isSortKey(raw.sort) ? raw.sort : 'date';
  const dir: 'asc' | 'desc' = raw.dir === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, parseInt(raw.page ?? '1', 10) || 1);

  const supabase = createAdminClient();
  const [{ rows, total }, accountBalances, scoutBalances, reconciliation, peopleRes, activityLabels, kinds] =
    await Promise.all([
      listFinancialTransactionsAction({
        account,
        kind,
        personId,
        activityLabel: activity,
        dateFrom,
        dateTo,
        amountMin,
        amountMax,
        sort,
        dir,
        page
      }),
      getAccountBalancesAction(),
      getScoutAccountBalancesAction(),
      getReconciliationSummaryAction(),
      supabase.from('people_active').select('id, display_name').order('display_name'),
      listDistinctActivityLabelsAction(),
      listTransactionKindsAction()
    ]);

  const totalPages = Math.max(1, Math.ceil(total / FINANCE_PAGE_SIZE));
  const pageStart = total === 0 ? 0 : (page - 1) * FINANCE_PAGE_SIZE + 1;
  const pageEnd = Math.min(page * FINANCE_PAGE_SIZE, total);
  const scoutAccountTotal = scoutBalances.reduce((sum, s) => sum + s.balance, 0);
  const people = (peopleRes.data ?? []) as { id: number; display_name: string }[];

  // Scholarship Fund is earmarked money (financial assistance for
  // families), not troop-discretionary cash — same as an individual scout's
  // balance, just not tied to one person. Combined here for both display
  // and the Available Funds math (Patrick, 2026-08-18): "Scholarship are a
  // subset of scout accounts."
  const totalFunds = accountBalances.checking + accountBalances.savings;
  const earmarkedTotal = scoutAccountTotal + accountBalances.scholarship;
  const availableFunds = totalFunds - earmarkedTotal;

  return (
    <>
      <PageTitle
        title="Troop Finances"
        sub={
          canManage
            ? 'The books of record — checking, savings, and every scout account, derived from full transaction history (never a stored total).'
            : 'Read-only view of troop finances — every historical transaction and current balances.'
        }
      />

      <div className={styles.balanceGrid}>
        <div className={`${styles.balanceCard} ${styles.balanceCardEmphasis}`}>
          <p className={styles.balanceLabel}>Total funds</p>
          <p className={styles.balanceValue}>${totalFunds.toFixed(2)}</p>
          <p className={styles.balanceSubtext}>Checking + savings</p>
        </div>
        <div className={styles.balanceCard}>
          <p className={styles.balanceLabel}>Checking</p>
          <p className={styles.balanceValue}>${accountBalances.checking.toFixed(2)}</p>
        </div>
        <div className={styles.balanceCard}>
          <p className={styles.balanceLabel}>Savings</p>
          <p className={styles.balanceValue}>${accountBalances.savings.toFixed(2)}</p>
        </div>
        <div className={styles.balanceCard}>
          <p className={styles.balanceLabel}>Scout &amp; scholarship accounts</p>
          <p className={styles.balanceValue}>${earmarkedTotal.toFixed(2)}</p>
          <p className={styles.balanceSubtext}>
            {scoutBalances.length} scouts, ${scoutAccountTotal.toFixed(2)} · scholarship $
            {accountBalances.scholarship.toFixed(2)}
          </p>
        </div>
        <div className={`${styles.balanceCard} ${styles.balanceCardEmphasis}`}>
          <p className={styles.balanceLabel}>Available funds</p>
          <p className={styles.balanceValue}>${availableFunds.toFixed(2)}</p>
          <p className={styles.balanceSubtext}>Total funds minus scout &amp; scholarship accounts</p>
        </div>
      </div>

      <form className={styles.toolbar} method="get">
        <select name="account" defaultValue={account ?? ''} className={styles.select} aria-label="Filter by account">
          <option value="">All accounts</option>
          {ACCOUNTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select name="kind" defaultValue={kind ?? ''} className={styles.select} aria-label="Filter by kind">
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k.code} value={k.code}>
              {k.label}
            </option>
          ))}
        </select>
        <select name="person" defaultValue={personId ? String(personId) : ''} className={styles.select} aria-label="Filter by person">
          <option value="">All people</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <label className={styles.toolbarField}>
          Activity
          <input
            type="text"
            name="activity"
            list="activity-labels-filter"
            placeholder="contains…"
            defaultValue={activity ?? ''}
            aria-label="Filter: activity contains"
          />
          <datalist id="activity-labels-filter">
            {activityLabels.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </label>
        <label className={styles.toolbarField}>
          From
          <input type="date" name="dateFrom" defaultValue={dateFrom ?? ''} aria-label="Filter: date from" />
        </label>
        <label className={styles.toolbarField}>
          To
          <input type="date" name="dateTo" defaultValue={dateTo ?? ''} aria-label="Filter: date to" />
        </label>
        <label className={styles.toolbarField}>
          Min $
          <input
            type="number"
            name="amountMin"
            step="0.01"
            min="0"
            placeholder="0.00"
            defaultValue={amountMin ?? ''}
            aria-label="Filter: minimum amount"
            className={styles.amountInput}
          />
        </label>
        <label className={styles.toolbarField}>
          Max $
          <input
            type="number"
            name="amountMax"
            step="0.01"
            min="0"
            placeholder="any"
            defaultValue={amountMax ?? ''}
            aria-label="Filter: maximum amount"
            className={styles.amountInput}
          />
        </label>
        {/* Sort survives a filter change — carried as hidden fields rather
            than reset, so adjusting a filter doesn't silently undo a sort
            the treasurer just picked. */}
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <button type="submit" className={styles.pagerBtn}>
          Filter
        </button>
        {(account || kind || personId || activity || dateFrom || dateTo || amountMin != null || amountMax != null) && (
          <Link href="/admin/finance" className={styles.pagerBtn}>
            Clear
          </Link>
        )}
      </form>

      <FinanceWorkspace
        canManage={canManage}
        rows={rows}
        people={people}
        reconciliation={reconciliation}
        sort={sort}
        dir={dir}
        filters={{
          account,
          kind,
          person: personId ? String(personId) : undefined,
          activity,
          dateFrom,
          dateTo,
          amountMin: amountMin != null ? String(amountMin) : undefined,
          amountMax: amountMax != null ? String(amountMax) : undefined
        }}
        activityLabels={activityLabels}
        kinds={kinds}
      />

      <div className={styles.pager}>
        <Link
          href={urlWith(raw, { page: String(page - 1) })}
          className={`${styles.pagerBtn} ${page <= 1 ? styles.pagerBtnDisabled : ''}`}
          aria-disabled={page <= 1}
        >
          ← Previous
        </Link>
        <Link
          href={urlWith(raw, { page: String(page + 1) })}
          className={`${styles.pagerBtn} ${page >= totalPages ? styles.pagerBtnDisabled : ''}`}
          aria-disabled={page >= totalPages}
        >
          Next →
        </Link>
        <span>
          Showing {pageStart}–{pageEnd} of {total} · page {page} / {totalPages}
        </span>
      </div>
    </>
  );
}

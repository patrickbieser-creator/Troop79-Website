/**
 * Ledger Audit — ledger-only integrity checks (Plans/Ledger-Audit.md).
 *
 * Patrick, 2026-09-29: recurring incidents where the ledger does not balance
 * with the bank. The 2026-09-22 backup showed the arithmetic is sound and
 * the errors are in what was entered — phantom rows, plugs, unpaired
 * transfers — so each check here looks for one way an entry goes wrong.
 * They report; nothing here writes. Bank-side comparison lives in
 * lib/bank-statement.ts.
 *
 * Pure functions over rows the Server Action loads in full (fetchAllRows,
 * ordered by id). Cents arithmetic, same reason as lib/finance.ts.
 */
import type { Account } from '@/lib/finance';

export type Severity = 'error' | 'warning' | 'info';

export type AuditCheck =
  | 'independent_total'
  | 'row_count'
  | 'plug'
  | 'opening_balance'
  | 'reconciliation'
  | 'reconciliation_changed'
  | 'transfer_unbalanced'
  | 'transfer_half_voided'
  | 'transfer_unpaired'
  | 'transfer_mislabeled'
  | 'duplicate'
  | 'reimbursement_missing_payout'
  | 'reimbursement_multiple_payouts'
  | 'reimbursement_amount'
  | 'reimbursement_unpaid_request'
  | 'notional_on_cash'
  | 'sign'
  | 'future_dated'
  | 'sofi_nonzero';

export interface AuditFinding {
  check: AuditCheck;
  severity: Severity;
  title: string;
  detail: string;
  /** Ledger rows this finding is about, for the report to list. */
  txnIds: number[];
  /** The dollar figure the finding is about (a drift, a plug total), when there is one. */
  amount?: number;
}

export interface AuditTxn {
  id: number;
  occurred_on: string;
  account: Account;
  amount: number;
  kind: string;
  method: string | null;
  person_id: number | null;
  memo: string | null;
  transfer_group: string | null;
  reimbursement_id: number | null;
  source: 'import' | 'app';
  voided_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface AuditReconciliation {
  id: number;
  account: 'checking' | 'savings';
  as_of: string;
  statement_balance: number;
  computed_balance: number;
  created_at: string;
}

export interface AuditReimbursement {
  id: number;
  amount: number;
  status: string;
}

/** One row of finance_audit_totals() — Postgres's own numeric sums. */
export interface SqlTotalRow {
  account: string;
  person_id: number | null;
  live_total: number;
  live_rows: number;
  voided_rows: number;
}

/** The real bank accounts. Scout accounts and the scholarship fund are
 *  notional sub-ledgers inside them; SOFI is closed. */
const CASH: readonly string[] = ['checking', 'savings'];

const cents = (n: number) => Math.round(n * 100);
const dollars = (c: number) => c / 100;
const live = (t: AuditTxn) => t.voided_at === null;
export const money = (n: number) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function days(iso: string): number {
  return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
}

/** Ledger balance of one account through a date (inclusive), live rows only. */
export function balanceThrough(rows: readonly AuditTxn[], account: Account, asOf: string): number {
  return dollars(
    rows.filter((t) => live(t) && t.account === account && t.occurred_on <= asOf).reduce((n, t) => n + cents(t.amount), 0)
  );
}

/* ── Plugs ──────────────────────────────────────────────────────────────── */

const PLUG_MEMO = /discrepanc|can'?t find|cannot find|missing \$?\d|accounting (mistake|adjustment)|acounting adjustment|\bplug\b/i;
const OPENING_MEMO = /starting balance|opening balance/i;

/**
 * Entries made to force the books to agree rather than to record money that
 * moved — every one hides a real error somewhere else. The opening balance
 * is an adjustment too, but a legitimate one; it's listed as info so the
 * total is visible without crying wolf.
 */
export function findPlugs(rows: readonly AuditTxn[]): AuditFinding[] {
  const out: AuditFinding[] = [];
  const cash = rows.filter((t) => live(t) && CASH.includes(t.account));
  const opening = cash.filter((t) => OPENING_MEMO.test(t.memo ?? ''));
  const plugs = cash.filter((t) => !opening.includes(t) && (t.kind === 'adjustment' || PLUG_MEMO.test(t.memo ?? '')));
  if (plugs.length) {
    const total = dollars(plugs.reduce((n, t) => n + cents(t.amount), 0));
    out.push({
      check: 'plug',
      severity: 'warning',
      title: `${plugs.length} balancing adjustment${plugs.length === 1 ? '' : 's'} (net ${money(total)})`,
      detail:
        'Adjustments made so the ledger would agree with the bank. Each one stands in for a real entry that is wrong or missing — find that entry (the Bank Match below usually shows it), fix it, then void the adjustment.',
      txnIds: plugs.map((t) => t.id),
      amount: total
    });
  }
  if (opening.length) {
    out.push({
      check: 'opening_balance',
      severity: 'info',
      title: 'Opening balance entry',
      detail: 'The starting balance the ledger was seeded with. Expected — listed so it is not mistaken for a plug.',
      txnIds: opening.map((t) => t.id),
      amount: dollars(opening.reduce((n, t) => n + cents(t.amount), 0))
    });
  }
  return out;
}

/* ── Reconciliations ────────────────────────────────────────────────────── */

const after = (ts: string | null, than: string) => ts !== null && Date.parse(ts) > Date.parse(than);

/**
 * Each saved reconciliation, re-checked against the ledger AS OF ITS OWN
 * DATE — not the all-time balance, which counts every row dated after the
 * statement and reads as false drift. Also lists app-entered rows created,
 * edited or voided after the reconciliation was recorded but dated inside
 * the period it covered: the edits that silently un-balance a month that
 * was already balanced. (`created_at` is when the reconciliation was first
 * saved — a later re-save on the same date keeps it — so this is a lower
 * bound, and says so.)
 */
export function checkReconciliations(rows: readonly AuditTxn[], recons: readonly AuditReconciliation[]): AuditFinding[] {
  const out: AuditFinding[] = [];
  const sorted = recons.slice().sort((a, b) => (a.as_of < b.as_of ? -1 : a.as_of > b.as_of ? 1 : a.account < b.account ? -1 : 1));
  for (const r of sorted) {
    const ledger = balanceThrough(rows, r.account, r.as_of);
    const drift = dollars(cents(ledger) - cents(r.statement_balance));
    out.push(
      drift === 0
        ? {
            check: 'reconciliation',
            severity: 'info',
            title: `${r.account} ${r.as_of}: ledger matches the statement (${money(r.statement_balance)})`,
            detail: 'Ledger balance through the statement date equals the statement balance.',
            txnIds: [],
            amount: 0
          }
        : {
            check: 'reconciliation',
            severity: 'error',
            title: `${r.account} ${r.as_of}: ledger is ${money(Math.abs(drift))} ${drift < 0 ? 'below' : 'above'} the statement`,
            detail: `Statement ${money(r.statement_balance)}; ledger through ${r.as_of} is ${money(ledger)}. When the reconciliation was saved the ledger read ${money(r.computed_balance)} — if that matched, something dated on or before ${r.as_of} has changed since.`,
            txnIds: [],
            amount: drift
          }
    );

    const inPeriod = rows.filter((t) => t.account === r.account && t.occurred_on <= r.as_of);
    const changed = inPeriod.filter(
      (t) => after(t.created_at, r.created_at) || after(t.updated_at, r.created_at) || after(t.voided_at, r.created_at)
    );
    const appChanged = changed.filter((t) => t.source === 'app');
    if (appChanged.length) {
      const imported = changed.length - appChanged.length;
      out.push({
        check: 'reconciliation_changed',
        severity: 'warning',
        title: `${r.account} ${r.as_of}: ${appChanged.length} row${appChanged.length === 1 ? '' : 's'} changed after reconciling`,
        detail: `Entered, edited or voided after this reconciliation was first saved, but dated inside the period it covered.${
          imported ? ` ${imported} spreadsheet-import row${imported === 1 ? ' was' : 's were'} also re-created after it.` : ''
        }`,
        txnIds: appChanged.map((t) => t.id)
      });
    }
  }
  return out;
}

/* ── Transfers ──────────────────────────────────────────────────────────── */

const TRANSFER_MEMO = /\bxfer\b|transfer (to|from|funds)|to savings|from savings|to checking|from checking/i;
/** A memo naming one of the troop's own accounts — the savings account ends
 *  7120 at Landmark; SOFI is the closed one. Venmo / PayPal cash-outs are
 *  tagged 'transfer' by the old spreadsheet but come from outside, so a
 *  missing partner only matters for these. */
const INTERNAL_MEMO = /7120|savings|\bsofi\b|to checking|from checking|transfer funds/i;
/** Accounts a real bank transfer moves between. */
const TRANSFER_ACCOUNTS: readonly string[] = ['checking', 'savings', 'sofi'];

/**
 * A transfer is two rows — money leaves one account and lands in another. A
 * lone leg moves the balance of one account with nothing to offset it,
 * which is exactly a ledger-vs-bank gap. App-entered transfers are linked by
 * transfer_group; the spreadsheet import's are not, so those are paired here
 * by amount and date.
 */
export function checkTransfers(rows: readonly AuditTxn[]): AuditFinding[] {
  const out: AuditFinding[] = [];

  const groups = new Map<string, AuditTxn[]>();
  for (const t of rows) if (t.transfer_group) groups.set(t.transfer_group, [...(groups.get(t.transfer_group) ?? []), t]);
  for (const legs of groups.values()) {
    const voided = legs.filter((t) => !live(t));
    if (voided.length && voided.length < legs.length) {
      out.push({
        check: 'transfer_half_voided',
        severity: 'error',
        title: 'Transfer with only one side voided',
        detail: 'One leg was voided and the other still counts, so one account moved and the other did not.',
        txnIds: legs.map((t) => t.id)
      });
      continue;
    }
    if (voided.length) continue;
    if (legs.every((t) => TRANSFER_ACCOUNTS.includes(t.account))) {
      const net = legs.reduce((n, t) => n + cents(t.amount), 0);
      if (net !== 0) {
        out.push({
          check: 'transfer_unbalanced',
          severity: 'error',
          title: `Transfer legs don't cancel (off by ${money(dollars(net))})`,
          detail: 'The money out of one account and into the other should be the same amount.',
          txnIds: legs.map((t) => t.id),
          amount: dollars(net)
        });
      }
    }
  }

  const pool = rows.filter(
    (t) =>
      live(t) &&
      !t.transfer_group &&
      TRANSFER_ACCOUNTS.includes(t.account) &&
      (t.kind === 'transfer' || TRANSFER_MEMO.test(t.memo ?? ''))
  );
  const pairs: { a: AuditTxn; b: AuditTxn; dist: number }[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      const dist = Math.abs(days(a.occurred_on) - days(b.occurred_on));
      if (a.account !== b.account && cents(a.amount) === -cents(b.amount) && dist <= 5) pairs.push({ a, b, dist });
    }
  }
  pairs.sort((p, q) => p.dist - q.dist || p.a.id - q.a.id);
  const paired = new Set<AuditTxn>();
  const mislabeled: number[] = [];
  for (const p of pairs) {
    if (paired.has(p.a) || paired.has(p.b)) continue;
    paired.add(p.a);
    paired.add(p.b);
    for (const t of [p.a, p.b]) if (t.kind !== 'transfer') mislabeled.push(t.id);
  }
  const unpaired = pool.filter(
    (t) => !paired.has(t) && t.kind === 'transfer' && (t.account !== 'checking' || INTERNAL_MEMO.test(t.memo ?? ''))
  );
  if (unpaired.length) {
    out.push({
      check: 'transfer_unpaired',
      severity: 'warning',
      title: `${unpaired.length} transfer row${unpaired.length === 1 ? '' : 's'} with no matching other side`,
      detail:
        'Each should have an equal and opposite row on the other account within a few days. A missing side leaves one account over and the other under by the same amount.',
      txnIds: unpaired.map((t) => t.id),
      amount: dollars(unpaired.reduce((n, t) => n + cents(t.amount), 0))
    });
  }
  if (mislabeled.length) {
    out.push({
      check: 'transfer_mislabeled',
      severity: 'info',
      title: `${mislabeled.length} transfer${mislabeled.length === 1 ? '' : 's'} tagged as another Kind`,
      detail: 'Paired as a transfer by amount and memo, but carries a different Kind — it will count as income or expense in the Activity Report.',
      txnIds: mislabeled.sort((a, b) => a - b)
    });
  }
  return out;
}

/* ── Duplicates ─────────────────────────────────────────────────────────── */

function tokens(memo: string | null): Set<string> {
  return new Set((memo ?? '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}
function similar(a: string | null, b: string | null): boolean {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared) >= 0.3;
}

/**
 * Same account, same amount, within three days, memos that share most of
 * their words — the shape of one real payment typed in twice. Blank memos
 * are never flagged (a run of $30 Venmo payments is normal); the Bank Match
 * settles any of these definitively.
 */
export function findLikelyDuplicates(rows: readonly AuditTxn[]): AuditFinding[] {
  const candidates = rows.filter((t) => live(t) && t.kind !== 'interest');
  const parent = new Map<number, number>();
  const linked = new Set<number>();
  const find = (id: number): number => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.account !== b.account || cents(a.amount) !== cents(b.amount)) continue;
      if (Math.abs(days(a.occurred_on) - days(b.occurred_on)) > 3) continue;
      if (a.transfer_group && a.transfer_group === b.transfer_group) continue;
      if (a.person_id !== null && b.person_id !== null && a.person_id !== b.person_id) continue;
      if (!similar(a.memo, b.memo)) continue;
      parent.set(find(b.id), find(a.id));
      linked.add(a.id).add(b.id);
    }
  }
  const clusters = new Map<number, number[]>();
  for (const t of candidates) {
    if (!linked.has(t.id)) continue;
    const root = find(t.id);
    clusters.set(root, [...(clusters.get(root) ?? []), t.id]);
  }
  return [...clusters.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => {
      const first = candidates.find((t) => t.id === ids[0])!;
      return {
        check: 'duplicate' as const,
        severity: 'warning' as const,
        title: `Possible duplicate: ${ids.length} × ${money(first.amount)} on ${first.account} around ${first.occurred_on}`,
        detail: 'Same account and amount, dated within three days, with nearly the same memo. Confirm against the bank before voiding.',
        txnIds: ids.sort((a, b) => a - b),
        amount: first.amount
      };
    });
}

/* ── Reimbursements ─────────────────────────────────────────────────────── */

/** Every paid request should have exactly one live payout of −amount —
 *  the one-writer rule markReimbursementPaidAction enforces going forward. */
export function checkReimbursements(rows: readonly AuditTxn[], requests: readonly AuditReimbursement[]): AuditFinding[] {
  const out: AuditFinding[] = [];
  const byReq = new Map<number, AuditTxn[]>();
  for (const t of rows) if (t.reimbursement_id !== null) byReq.set(t.reimbursement_id, [...(byReq.get(t.reimbursement_id) ?? []), t]);
  const reqById = new Map(requests.map((r) => [r.id, r]));

  for (const r of requests) {
    if (r.status !== 'paid') continue;
    const payouts = (byReq.get(r.id) ?? []).filter(live);
    if (payouts.length === 0) {
      out.push({
        check: 'reimbursement_missing_payout',
        severity: 'error',
        title: `Reimbursement #${r.id} is marked paid but has no payout in the ledger`,
        detail: `${money(r.amount)} left the bank (or was promised) with no ledger row.`,
        txnIds: (byReq.get(r.id) ?? []).map((t) => t.id),
        amount: -r.amount
      });
    } else if (payouts.length > 1) {
      out.push({
        check: 'reimbursement_multiple_payouts',
        severity: 'error',
        title: `Reimbursement #${r.id} was paid out ${payouts.length} times`,
        detail: `Request was for ${money(r.amount)}.`,
        txnIds: payouts.map((t) => t.id)
      });
    } else if (cents(payouts[0].amount) !== -cents(r.amount)) {
      out.push({
        check: 'reimbursement_amount',
        severity: 'error',
        title: `Reimbursement #${r.id} payout doesn't match the request`,
        detail: `Request ${money(r.amount)}; ledger payout ${money(payouts[0].amount)}.`,
        txnIds: [payouts[0].id],
        amount: dollars(cents(payouts[0].amount) + cents(r.amount))
      });
    }
  }
  for (const [reqId, txns] of byReq) {
    const req = reqById.get(reqId);
    const livePayouts = txns.filter(live);
    if (livePayouts.length && req && req.status !== 'paid') {
      out.push({
        check: 'reimbursement_unpaid_request',
        severity: 'warning',
        title: `Payout recorded for reimbursement #${reqId}, but the request is "${req.status}"`,
        detail: 'Money moved in the ledger while the request never reached paid — the status update likely failed.',
        txnIds: livePayouts.map((t) => t.id)
      });
    }
  }
  return out;
}

/* ── Misbooked rows ─────────────────────────────────────────────────────── */

/**
 * Rows the bank can never agree with: money "paid from a scout account"
 * booked to checking (a notional balance moved, no cash did); an expense or
 * reimbursement recorded as money IN (the Kind-flips-sign bug fixed
 * 2026-08-20 could leave these behind); interest recorded as money out;
 * rows dated in the future; any balance left on the closed SOFI account.
 */
export function findMisbookedRows(rows: readonly AuditTxn[], today: string): AuditFinding[] {
  const out: AuditFinding[] = [];
  const cash = rows.filter((t) => live(t) && CASH.includes(t.account));

  const notional = cash.filter((t) => t.method === 'scout_account');
  if (notional.length) {
    out.push({
      check: 'notional_on_cash',
      severity: 'warning',
      title: `${notional.length} bank-account row${notional.length === 1 ? '' : 's'} paid "from a scout account"`,
      detail: 'A scout-account payment moves notional money only — no cash reaches the bank, so this row belongs on scout_account, not on the bank account.',
      txnIds: notional.map((t) => t.id)
    });
  }

  const flipped = cash.filter(
    (t) => ((t.kind === 'expense' || t.kind === 'reimbursement') && t.amount > 0) || (t.kind === 'interest' && t.amount < 0)
  );
  if (flipped.length) {
    out.push({
      check: 'sign',
      severity: 'warning',
      title: `${flipped.length} row${flipped.length === 1 ? '' : 's'} with the direction backwards for their Kind`,
      detail: 'An expense or reimbursement recorded as money in, or interest as money out. If the Kind is right, the sign is wrong — and the balance is off by twice the amount.',
      txnIds: flipped.map((t) => t.id)
    });
  }

  const future = rows.filter((t) => live(t) && t.occurred_on > today);
  if (future.length) {
    out.push({
      check: 'future_dated',
      severity: 'warning',
      title: `${future.length} row${future.length === 1 ? '' : 's'} dated in the future`,
      detail: 'Counted in today’s balance although the bank has not seen them yet — usually a typo in the year or month.',
      txnIds: future.map((t) => t.id)
    });
  }

  const sofi = rows.filter((t) => live(t) && t.account === 'sofi');
  const sofiTotal = sofi.reduce((n, t) => n + cents(t.amount), 0);
  if (sofiTotal !== 0) {
    out.push({
      check: 'sofi_nonzero',
      severity: 'warning',
      title: `Closed SOFI account shows ${money(dollars(sofiTotal))}`,
      detail: 'SOFI is closed and should derive to $0.00 — one of its transfers is missing the other side.',
      txnIds: sofi.map((t) => t.id),
      amount: dollars(sofiTotal)
    });
  }
  return out;
}

/* ── Independent re-sum ─────────────────────────────────────────────────── */

/**
 * The app's balances (JavaScript, integer cents over the rows it read)
 * against Postgres's own numeric sums over the table. Two engines, two read
 * paths: a mismatch means the app is reading or adding something wrong —
 * the row count catches a truncated read (PostgREST's silent 1000-row cap).
 * Scout accounts compare per scout; every other account in total.
 */
export function compareIndependentTotals(rows: readonly AuditTxn[], sql: readonly SqlTotalRow[]): AuditFinding[] {
  const out: AuditFinding[] = [];
  const sqlCount = sql.reduce((n, r) => n + r.live_rows + r.voided_rows, 0);
  if (sqlCount !== rows.length) {
    out.push({
      check: 'row_count',
      severity: 'error',
      title: `The app read ${rows.length} rows; the database holds ${sqlCount}`,
      detail: 'Balances on the Finance page may be built from an incomplete read.',
      txnIds: []
    });
  }

  const key = (account: string, personId: number | null) => (account === 'scout_account' ? `${account}:${personId}` : account);
  const app = new Map<string, number>();
  for (const t of rows) if (live(t)) app.set(key(t.account, t.person_id), (app.get(key(t.account, t.person_id)) ?? 0) + cents(t.amount));
  const db = new Map<string, number>();
  for (const r of sql) db.set(key(r.account, r.person_id), (db.get(key(r.account, r.person_id)) ?? 0) + cents(r.live_total));

  const mismatched: string[] = [];
  for (const k of new Set([...app.keys(), ...db.keys()])) {
    if ((app.get(k) ?? 0) !== (db.get(k) ?? 0)) {
      mismatched.push(`${k}: app ${money(dollars(app.get(k) ?? 0))}, database ${money(dollars(db.get(k) ?? 0))}`);
    }
  }
  if (mismatched.length) {
    out.push({
      check: 'independent_total',
      severity: 'error',
      title: `${mismatched.length} balance${mismatched.length === 1 ? '' : 's'} differ between the app and the database`,
      detail: mismatched.join('; '),
      txnIds: []
    });
  }
  if (out.length === 0) {
    out.push({
      check: 'independent_total',
      severity: 'info',
      title: `Independent re-sum matches to the cent (${rows.length} rows)`,
      detail: 'Postgres’s own totals equal the balances the app computes, account by account and scout by scout.',
      txnIds: []
    });
  }
  return out;
}

/* ── All together ───────────────────────────────────────────────────────── */

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function runLedgerAudit(input: {
  rows: readonly AuditTxn[];
  sqlTotals: readonly SqlTotalRow[];
  reconciliations: readonly AuditReconciliation[];
  reimbursements: readonly AuditReimbursement[];
  today: string;
}): AuditFinding[] {
  return [
    ...compareIndependentTotals(input.rows, input.sqlTotals),
    ...checkReconciliations(input.rows, input.reconciliations),
    ...findPlugs(input.rows),
    ...checkTransfers(input.rows),
    ...findLikelyDuplicates(input.rows),
    ...checkReimbursements(input.rows, input.reimbursements),
    ...findMisbookedRows(input.rows, input.today)
  ].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

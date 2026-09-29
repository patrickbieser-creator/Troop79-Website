'use client';

/**
 * Ledger Audit + Bank Match report (Plans/Ledger-Audit.md). Bank Match comes
 * first — the bank is the truth (Patrick, 2026-09-29), so the rows that
 * disagree with it are the answer; the ledger-only checks below it explain
 * the kinds of entry that caused them.
 */
import { useState, useTransition } from 'react';
import { FormPanel } from '../../../_components/form-panel';
import { Button } from '../../../_components/button';
import { Notice } from '../../_components/notice';
import { Badge, type BadgeVariant } from '../../_components/badge';
import { fmtDate } from '@/lib/format-date';
import { money, type AuditFinding, type Severity } from '@/lib/finance-audit';
import type { BankMatchReport, BankRow, LedgerCashRow } from '@/lib/bank-statement';
import type { AuditRowSummary, BankMatchActionResult, LedgerAuditResult } from './actions';
import styles from './ledger-audit.module.css';

const SEVERITY_BADGE: Record<Severity, { variant: BadgeVariant; label: string }> = {
  error: { variant: 'danger', label: 'Error' },
  warning: { variant: 'warning', label: 'Check' },
  info: { variant: 'info', label: 'OK / info' }
};

export function LedgerAuditReport({
  audit,
  matchAction
}: {
  audit: LedgerAuditResult;
  matchAction: (formData: FormData) => Promise<BankMatchActionResult>;
}) {
  return (
    <>
      <div className={styles.section}>
        <BankMatchPanel matchAction={matchAction} />
      </div>
      <div className={styles.section}>
        <LedgerChecksPanel audit={audit} />
      </div>
    </>
  );
}

/* ── Bank Match ─────────────────────────────────────────────────────────── */

function BankMatchPanel({ matchAction }: { matchAction: (formData: FormData) => Promise<BankMatchActionResult> }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BankMatchActionResult | null>(null);
  const [hasFile, setHasFile] = useState(false);

  function submit(formData: FormData) {
    startTransition(async () => setResult(await matchAction(formData)));
  }

  return (
    <FormPanel title="Bank Match">
      <p className={styles.lede}>
        In Landmark online banking, export the account&rsquo;s transactions as CSV (it goes back two years) and
        choose the file here. Every bank row is matched to a ledger row; what&rsquo;s left over on either side
        is where the ledger and the bank disagree. The file is read once and not saved.
      </p>
      <form action={submit} className={styles.uploadRow}>
        <fieldset className={styles.radioGroup}>
          <legend>Account</legend>
          <label>
            <input type="radio" name="account" value="checking" defaultChecked /> Checking
          </label>
          <label>
            <input type="radio" name="account" value="savings" /> Savings
          </label>
        </fieldset>
        <input
          className={styles.fileInput}
          type="file"
          name="file"
          accept=".csv,text/csv"
          aria-label="Landmark CSV export"
          onChange={(e) => setHasFile((e.target.files?.length ?? 0) > 0)}
        />
        <Button type="submit" variant="primary" disabled={isPending || !hasFile} title={hasFile ? undefined : 'Choose a CSV file first'}>
          {isPending ? 'Comparing…' : 'Compare with bank'}
        </Button>
      </form>
      {result && !result.ok && (
        <div className={styles.block}>
          <Notice variant="error">{result.error}</Notice>
        </div>
      )}
      {result && result.ok && <BankMatchResult account={result.account} report={result.report} />}
    </FormPanel>
  );
}

function BankMatchResult({ account, report }: { account: string; report: BankMatchReport }) {
  const [showGroups, setShowGroups] = useState(false);
  const { statement, match } = report;
  const unexplained = match.bankOnly.length + match.ledgerOnly.length;
  const verdict =
    report.closingDiff === 0 && unexplained === 0
      ? { variant: 'success' as const, text: `The ${account} ledger agrees with the bank row for row.` }
      : report.closingDiff === 0
        ? {
            variant: 'warning' as const,
            text: `The ${account} balance agrees with the bank on ${fmtDate(statement.lastDate)}, but ${unexplained} row${unexplained === 1 ? '' : 's'} still don't match — errors that happen to cancel out (often a balancing adjustment standing in for a real entry).`
          }
        : {
            variant: 'error' as const,
            text: `On ${fmtDate(statement.lastDate)} the ${account} ledger is ${money(Math.abs(report.closingDiff))} ${report.closingDiff < 0 ? 'below' : 'above'} the bank.`
          };

  return (
    <>
      <div className={styles.summary}>
        <Stat label="Bank rows" value={`${statement.rowCount}${statement.pendingCount ? ` (+${statement.pendingCount} pending)` : ''}`} />
        <Stat label="Dates" value={`${fmtDate(statement.firstDate, { year: 'short' })} – ${fmtDate(statement.lastDate, { year: 'short' })}`} />
        <Stat label="Matched" value={`${match.matched.length} + ${match.grouped.length} batched`} />
        <Stat label="Ledger − bank at start" value={money(report.openingDiff)} />
        <Stat label="Ledger − bank at end" value={money(report.closingDiff)} />
      </div>
      <Notice variant={verdict.variant}>{verdict.text}</Notice>
      {!statement.chainConsistent && (
        <div className={styles.block}>
          <Notice variant="warning">
            The export&rsquo;s own running balance doesn&rsquo;t add up from its rows — it may be missing
            transactions. Re-export the full date range before trusting this comparison.
          </Notice>
        </div>
      )}
      {report.openingDiff !== 0 && (
        <div className={styles.block}>
          <Notice variant="info">
            The ledger was already {money(Math.abs(report.openingDiff))} {report.openingDiff < 0 ? 'below' : 'above'} the bank
            before {fmtDate(statement.firstDate)}. That difference is older than this export, so no row below can explain it.
          </Notice>
        </div>
      )}

      {report.shifts.length > 0 && (
        <div className={styles.block}>
          <h3>Where the gaps opened</h3>
          <p className={styles.blockSub}>
            Day-to-day differences that close within two weeks are timing (the ledger records a payment before the bank
            posts it) and are left out. These are the ones that lasted, with the unmatched rows dated where each began.
          </p>
          <ul className={styles.findings}>
            {report.shifts.map((s) => (
              <li key={`${s.firstSeenAtTo}-${s.to}`} className={styles.finding}>
                <div className={styles.findingHead}>
                  <Badge variant={s.to === 0 ? 'success' : 'danger'}>{s.to === 0 ? 'Closed' : 'Opened'}</Badge>
                  Ledger − bank went from {money(s.from)} to {money(s.to)} between {fmtDate(s.lastSeenAtFrom)} and{' '}
                  {fmtDate(s.firstSeenAtTo)}
                </div>
                {s.candidates.ledger.length + s.candidates.bank.length === 0 ? (
                  <p className={styles.findingDetail}>No unmatched rows in that window — look at the batched deposits for it.</p>
                ) : (
                  <UnmatchedTable bank={s.candidates.bank} ledger={s.candidates.ledger} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.block}>
        <h3>In the ledger, not at the bank ({match.ledgerOnly.length}, net {money(report.ledgerOnlyTotal)})</h3>
        <p className={styles.blockSub}>
          Recorded, but the bank never saw the money move: a phantom or duplicate entry, a wrong amount, or money
          that went through another account (a leader&rsquo;s card, a scout account).
        </p>
        <LedgerTable rows={match.ledgerOnly} />
      </div>

      <div className={styles.block}>
        <h3>At the bank, not in the ledger ({match.bankOnly.length}, net {money(report.bankOnlyTotal)})</h3>
        <p className={styles.blockSub}>Money that really moved and was never recorded — or was recorded with a different amount.</p>
        <BankTable rows={match.bankOnly} />
      </div>

      {match.nearMisses.length > 0 && (
        <div className={styles.block}>
          <h3>Probably the same transaction, entered wrong ({match.nearMisses.length})</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Bank date</th>
                <th className={styles.num}>Bank</th>
                <th>Ledger</th>
                <th className={styles.num}>Ledger amount</th>
                <th>Looks like</th>
              </tr>
            </thead>
            <tbody>
              {match.nearMisses.map((n) => (
                <tr key={`${n.ledger.id}-${n.bank.date}`}>
                  <td>{fmtDate(n.bank.date)}</td>
                  <td className={styles.num}>{money(n.bank.amount)}</td>
                  <td>
                    #{n.ledger.id} · {fmtDate(n.ledger.occurred_on)}
                  </td>
                  <td className={styles.num}>{money(n.ledger.amount)}</td>
                  <td>{n.reason === 'sign' ? 'Sign flipped' : n.reason === 'transposed' ? 'Digits transposed' : 'Off by cents'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {match.grouped.length > 0 && (
        <div className={styles.block}>
          <button type="button" className={styles.toggle} aria-expanded={showGroups} onClick={() => setShowGroups((v) => !v)}>
            {showGroups ? 'Hide' : 'Show'} {match.grouped.length} batched deposit{match.grouped.length === 1 ? '' : 's'} (matched as groups)
          </button>
          {showGroups && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Bank</th>
                  <th className={styles.num}>Bank total</th>
                  <th>Ledger rows</th>
                </tr>
              </thead>
              <tbody>
                {match.grouped.map((g) => (
                  <tr key={`${g.bank[0].date}-${g.ledger[0].id}`}>
                    <td>{g.bank.map((b) => `${fmtDate(b.date)} ${b.description}`).join(' + ')}</td>
                    <td className={styles.num}>{money(g.bank.reduce((n, b) => n + Math.round(b.amount * 100), 0) / 100)}</td>
                    <td>{g.ledger.map((l) => `#${l.id} ${money(l.amount)}`).join(' + ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}

function UnmatchedTable({ bank, ledger }: { bank: BankRow[]; ledger: LedgerCashRow[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Side</th>
          <th>Date</th>
          <th className={styles.num}>Amount</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {ledger.map((l) => (
          <tr key={`l${l.id}`}>
            <td>Ledger #{l.id}</td>
            <td>{fmtDate(l.occurred_on)}</td>
            <td className={styles.num}>{money(l.amount)}</td>
            <td className={styles.memo} title={l.memo ?? undefined}>
              {l.kind}
              {l.memo ? ` — ${l.memo}` : ''}
            </td>
          </tr>
        ))}
        {bank.map((b, i) => (
          <tr key={`b${b.date}-${i}`}>
            <td>Bank</td>
            <td>{fmtDate(b.date)}</td>
            <td className={styles.num}>{money(b.amount)}</td>
            <td className={styles.memo} title={b.description}>
              {b.description}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LedgerTable({ rows }: { rows: LedgerCashRow[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>#</th>
          <th>Date</th>
          <th className={styles.num}>Amount</th>
          <th>Kind</th>
          <th>Memo</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5} className={styles.empty}>
              None — every ledger row in these dates is at the bank.
            </td>
          </tr>
        ) : (
          rows.map((l) => (
            <tr key={l.id}>
              <td>#{l.id}</td>
              <td>{fmtDate(l.occurred_on)}</td>
              <td className={styles.num}>{money(l.amount)}</td>
              <td>{l.kind}</td>
              <td className={styles.memo} title={l.memo ?? undefined}>
                {l.memo ?? '—'}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function BankTable({ rows }: { rows: BankRow[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Date</th>
          <th className={styles.num}>Amount</th>
          <th>Description</th>
          <th>Check #</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={4} className={styles.empty}>
              None — every bank row is in the ledger.
            </td>
          </tr>
        ) : (
          rows.map((b, i) => (
            <tr key={`${b.date}-${i}`}>
              <td>{fmtDate(b.date)}</td>
              <td className={styles.num}>{money(b.amount)}</td>
              <td className={styles.memo} title={b.description}>
                {b.description}
                {b.memo ? ` — ${b.memo}` : ''}
              </td>
              <td>{b.checkNumber ?? ''}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

/* ── Ledger checks ──────────────────────────────────────────────────────── */

function LedgerChecksPanel({ audit }: { audit: LedgerAuditResult }) {
  const problems = audit.findings.filter((f) => f.severity !== 'info');
  return (
    <FormPanel title="Ledger Checks">
      <p className={styles.lede}>
        Checks the ledger against itself — no bank file needed. Ran over all {audit.rowCount} rows just now.{' '}
        {problems.length === 0 ? 'Nothing to look at.' : `${problems.length} thing${problems.length === 1 ? '' : 's'} to look at.`}
      </p>
      <ul className={styles.findings}>
        {audit.findings.map((f, i) => (
          <FindingItem key={`${f.check}-${i}`} finding={f} rows={audit.rows} />
        ))}
      </ul>
    </FormPanel>
  );
}

function FindingItem({ finding, rows }: { finding: AuditFinding; rows: Record<number, AuditRowSummary> }) {
  const badge = SEVERITY_BADGE[finding.severity];
  const listed = finding.txnIds.map((id) => rows[id]).filter(Boolean);
  return (
    <li className={styles.finding}>
      <div className={styles.findingHead}>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {finding.title}
      </div>
      <p className={styles.findingDetail}>{finding.detail}</p>
      {listed.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Account</th>
              <th className={styles.num}>Amount</th>
              <th>Kind</th>
              <th>Memo</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((r) => (
              <tr key={r.id} className={r.voided ? styles.voided : undefined}>
                <td>#{r.id}</td>
                <td>{fmtDate(r.occurred_on)}</td>
                <td>{r.account}</td>
                <td className={styles.num}>{money(r.amount)}</td>
                <td>{r.kind}{r.voided ? ' (voided)' : ''}</td>
                <td className={styles.memo} title={r.memo ?? undefined}>
                  {r.memo ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

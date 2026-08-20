'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  resolveMissingCredit,
  addAttendanceForOrphanedCredit,
  retireOrphanedCredit,
  resolveQtyMismatch,
  resolveDateDrift
} from './actions';
import type { ReconciliationFinding } from './checks/attendance-reconciliation';
import styles from './audits.module.css';

type Status = { kind: 'ok' | 'err'; msg: string } | null;

/**
 * One reconciliation finding, with the fix(es) it actually supports.
 *
 * credit_missing and date_drift each have exactly one right answer — write
 * what Roll Call should have written; follow the event's own date — so they
 * resolve in one click. credit_orphaned and qty_mismatch genuinely don't:
 * a leader has to say which side is true, so both choices are offered
 * side by side rather than one being silently picked.
 */
export function ReconciliationFindingRow({ finding }: { finding: ReconciliationFinding }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [resolved, setResolved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setStatus(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setStatus({ kind: 'err', msg: res.error ?? 'Could not resolve.' });
        return;
      }
      setStatus({ kind: 'ok', msg: okMsg });
      setResolved(true);
      router.refresh();
    });
  }

  function fd(fields: Record<string, string | number>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, String(v));
    return f;
  }

  const disabled = isPending || resolved;

  return (
    <li className={styles.missingRow} style={{ display: 'block', cursor: 'default' }}>
      <div>
        <Link href={`/admin/calendar/${finding.entryId}/roll-call`} className={styles.scoutLink}>
          {finding.personName}
        </Link>{' '}
        &mdash; {finding.entryTitle} ({finding.entryDate})
      </div>
      <div className={styles.detailLines}>{finding.detail}</div>

      {!resolved && (
        <div className={styles.fillRow} style={{ paddingTop: 0, borderTop: 'none' }}>
          {finding.kind === 'credit_missing' && finding.personId != null && (
            <button
              type="button"
              className={styles.saveBtn}
              disabled={disabled}
              title={
                finding.rollCallQty == null
                  ? "Roll Call never recorded a quantity for this person (a pre-Roll-Call imported row) — the entry's own default will be used instead."
                  : undefined
              }
              onClick={() =>
                run(
                  () =>
                    resolveMissingCredit(
                      fd({
                        calendar_entry_id: finding.entryId,
                        person_id: finding.personId!,
                        // Omit entirely when unknown rather than sending a
                        // guessed 0 — resolveMissingCredit falls back to the
                        // entry's own default (qtyForMissingCreditResolution).
                        ...(finding.rollCallQty != null ? { qty: finding.rollCallQty } : {})
                      })
                    ),
                  finding.rollCallQty != null
                    ? `Credit written (${finding.rollCallQty}).`
                    : 'Credit written.'
                )
              }
            >
              {isPending
                ? '…'
                : finding.rollCallQty != null
                  ? `Write the missing credit (${finding.rollCallQty})`
                  : 'Write the missing credit'}
            </button>
          )}

          {finding.kind === 'credit_orphaned' && finding.ledgerEntryId != null && (
            <>
              {finding.personId != null && (
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={disabled}
                  onClick={() =>
                    run(
                      () =>
                        addAttendanceForOrphanedCredit(
                          fd({
                            calendar_entry_id: finding.entryId,
                            person_id: finding.personId!,
                            qty: finding.ledgerQty ?? 1
                          })
                        ),
                      'Attendance added — credit now matches.'
                    )
                  }
                >
                  {isPending ? '…' : 'They were there — add attendance'}
                </button>
              )}
              <button
                type="button"
                className={styles.saveBtnAlt}
                disabled={disabled}
                onClick={() =>
                  run(
                    () =>
                      retireOrphanedCredit(
                        fd({
                          ledger_entry_id: finding.ledgerEntryId!,
                          scout_id: ''
                        })
                      ),
                    'Credit removed.'
                  )
                }
              >
                {isPending ? '…' : "They weren't there — remove the credit"}
              </button>
            </>
          )}

          {finding.kind === 'qty_mismatch' &&
            finding.ledgerEntryId != null &&
            finding.personId != null &&
            finding.rollCallQty != null &&
            finding.ledgerQty != null && (
              <>
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={disabled}
                  onClick={() =>
                    run(
                      () =>
                        resolveQtyMismatch(
                          fd({
                            use: 'roll_call',
                            ledger_entry_id: finding.ledgerEntryId!,
                            calendar_entry_id: finding.entryId,
                            person_id: finding.personId!,
                            roll_call_qty: finding.rollCallQty!,
                            ledger_qty: finding.ledgerQty!
                          })
                        ),
                      `Ledger set to ${finding.rollCallQty}.`
                    )
                  }
                >
                  {isPending ? '…' : `Use Roll Call's ${finding.rollCallQty}`}
                </button>
                <button
                  type="button"
                  className={styles.saveBtnAlt}
                  disabled={disabled}
                  onClick={() =>
                    run(
                      () =>
                        resolveQtyMismatch(
                          fd({
                            use: 'ledger',
                            ledger_entry_id: finding.ledgerEntryId!,
                            calendar_entry_id: finding.entryId,
                            person_id: finding.personId!,
                            roll_call_qty: finding.rollCallQty!,
                            ledger_qty: finding.ledgerQty!
                          })
                        ),
                      `Roll Call set to ${finding.ledgerQty}.`
                    )
                  }
                >
                  {isPending ? '…' : `Use the ledger's ${finding.ledgerQty}`}
                </button>
              </>
            )}

          {finding.kind === 'date_drift' && finding.ledgerEntryId != null && (
            <button
              type="button"
              className={styles.saveBtn}
              disabled={disabled}
              onClick={() =>
                run(
                  () =>
                    resolveDateDrift(
                      fd({ ledger_entry_id: finding.ledgerEntryId!, calendar_entry_id: finding.entryId })
                    ),
                  `Credit re-dated to ${finding.entryDate}.`
                )
              }
            >
              {isPending ? '…' : `Align credit to ${finding.entryDate}`}
            </button>
          )}

          {status && <span className={status.kind === 'ok' ? styles.statusOk : styles.statusErr}>{status.msg}</span>}
        </div>
      )}
      {resolved && status && <span className={styles.statusOk}>{status.msg}</span>}
    </li>
  );
}

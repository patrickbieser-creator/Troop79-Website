'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  recordEventFeePaymentAction,
  refundEventFeeAction,
  creditOverpaymentAction,
  setAmountOverrideAction,
  voidEventFeePaymentAction,
  addEventExpenseAction,
  getScoutAccountBalanceForEntryAction,
  type EventMoneyData,
  type EventMoneyPerson
} from '../../../finance/actions';
import { addMilestone, deleteMilestone, emailPaymentReminders } from '../../../events/actions';
import { TRANSACTION_METHODS, type TransactionMethod } from '@/lib/finance';
import { PayGuard, wouldGoNegative, type AccountFacts } from '../../../events/pay-guard';
import { PAY_METHOD_LABEL, type PayMethod } from '@/lib/event-money';
import { milestoneStanding, money, summarizeEventMoney, uncreditedOverpayment, type Milestone } from '@/lib/event-money';
import { Badge } from '../../../_components/badge';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../../_components/dialog';
import styles from '../../../events/events-admin.module.css';

/*
 * The Money tab (Plans/Event-Logistics.md §C). Everything here is derived
 * from financial_transactions + signup_entry_balances; this panel only ever
 * writes one transaction (or one reimbursement request, or one milestone) per
 * click, each through its own Server Action with an idempotency key.
 */

const METHOD_LABEL: Record<string, string> = {
  venmo: 'Venmo',
  check: 'Check',
  cash: 'Cash',
  scout_account: 'Scout account',
  scholarship: 'Scholarship fund',
  bank: 'Bank / card',
  other: 'Other'
};

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined);

type Mode = 'pay' | 'refund' | 'credit';

export function MoneyPanel({
  signupId,
  calendarEntryId,
  data,
  adults,
  today
}: {
  signupId: number;
  calendarEntryId: number;
  data: EventMoneyData;
  adults: { personId: number; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      try {
        const res = await fn();
        if (!res.ok) setError(res.error ?? 'Could not save.');
        else after?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save.');
      }
      router.refresh();
    });

  const milestones: Milestone[] = data.milestones;
  const totals = useMemo(
    () =>
      summarizeEventMoney(
        data.people.map((p) => ({ entryId: p.entryId, owed: p.owed, paid: p.paid, balance: p.balance })),
        [
          ...data.people.flatMap((p) =>
            p.transactions.map((t) => ({
              id: t.id,
              occurredOn: t.occurredOn,
              amount: t.amount,
              kind: t.kind,
              method: t.method,
              memo: t.memo,
              voidedAt: t.voidedAt,
              signupEntryId: p.entryId,
              personId: p.personId
            }))
          ),
          ...data.expenses.map((e) => ({
            id: e.id,
            occurredOn: e.occurredOn,
            amount: e.amount,
            kind: e.kind,
            method: e.method,
            memo: e.memo,
            voidedAt: e.voidedAt,
            signupEntryId: null,
            personId: null
          }))
        ],
        data.reimbursements.filter((r) => r.status === 'submitted' || r.status === 'approved')
      ),
    [data]
  );

  const standings = useMemo(
    () =>
      new Map(
        data.people.map((p) => [
          p.entryId,
          milestoneStanding({ owed: p.owed, paid: p.paid, isScout: p.isScout }, milestones, today)
        ])
      ),
    [data.people, milestones, today]
  );
  const behind = data.people
    .map((p) => ({ p, s: standings.get(p.entryId)! }))
    .filter(({ p, s }) => s.standing === 'behind' && p.status === 'yes');

  // ── Pay / refund / credit dialog ─────────────────────────────────────────
  const [dlg, setDlg] = useState<{ mode: Mode; person: EventMoneyPerson } | null>(null);
  // "Scout account balance" as the method: show what that account holds
  // (Patrick, 2026-08-22). Fetched on demand, per entry, from the full history.
  const [acctBalance, setAcctBalance] = useState<AccountFacts | null>(null);
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<PayMethod>('venmo');
  const [ackNegative, setAckNegative] = useState(false);
  useEffect(() => {
    if (!dlg || dlg.mode !== 'pay' || (method !== 'scout_account' && method !== 'scholarship')) return;
    let live = true;
    const entryId = dlg.person.entryId;
    getScoutAccountBalanceForEntryAction(entryId).then((r) => {
      if (live) setAcctBalance({ entryId, balance: r.balance, scholarshipBalance: r.scholarshipBalance });
    });
    return () => {
      live = false;
    };
  }, [dlg, method]);
  const payFacts = dlg && acctBalance?.entryId === dlg.person.entryId ? acctBalance : null;
  // The guard (pay-guard.tsx): Record stays disabled until a would-go-negative
  // amount is acknowledged (Patrick, 2026-08-22).
  const payNeedsAck = !!dlg && dlg.mode === 'pay' && wouldGoNegative(method, payFacts, Number(amountText)) && !ackNegative;
  const [memo, setMemo] = useState('');
  const dlgRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlgRef.current;
    if (!d) return;
    if (dlg && !d.open) d.showModal();
    if (!dlg && d.open) d.close();
  }, [dlg]);
  const openDlg = (mode: Mode, person: EventMoneyPerson) => {
    setMethod('venmo');
    setMemo('');
    setAckNegative(false);
    setAmountText(
      mode === 'pay'
        ? String(person.balance > 0 ? person.balance : person.owed)
        : mode === 'credit'
          ? String(uncreditedOverpayment(person.balance))
          : String(person.balance < 0 ? -person.balance : person.paid)
    );
    setDlg({ mode, person });
  };
  const submitDlg = () => {
    if (!dlg) return;
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const { mode, person } = dlg;
    const idempotencyKey = newKey();
    run(
      () =>
        mode === 'pay'
          ? recordEventFeePaymentAction({ signupEntryId: person.entryId, amount, method, memo, signupId, idempotencyKey })
          : mode === 'refund'
            ? refundEventFeeAction({ signupEntryId: person.entryId, amount, method, memo, signupId, idempotencyKey })
            : creditOverpaymentAction({ signupEntryId: person.entryId, amount, signupId, idempotencyKey }),
      () => setDlg(null)
    );
  };

  // ── Override editing ─────────────────────────────────────────────────────
  const [overrideFor, setOverrideFor] = useState<number | null>(null);
  const [overrideText, setOverrideText] = useState('');
  const [openHistory, setOpenHistory] = useState<Set<number>>(new Set());

  // ── Expense form ─────────────────────────────────────────────────────────
  const [xDate, setXDate] = useState(today);
  const [xAmount, setXAmount] = useState('');
  const [xMemo, setXMemo] = useState('');
  // Who paid (always an adult leader) + with what money: troop funds → an
  // expense row naming them; their own → a reimbursement request (Patrick, 2026-08-22).
  const [xPayer, setXPayer] = useState<string>('');
  const [xPaidBy, setXPaidBy] = useState<'troop' | 'own'>('own');
  const [xMethod, setXMethod] = useState<TransactionMethod>('bank');

  // ── Milestone form ───────────────────────────────────────────────────────
  const [mKind, setMKind] = useState<'payment' | 'registration' | 'form' | 'other'>('payment');
  const [mLabel, setMLabel] = useState('');
  const [mDue, setMDue] = useState('');
  const [mAmount, setMAmount] = useState('');
  const [mWho, setMWho] = useState<'scouts' | 'adults' | 'both'>('both');
  const [mailPreview, setMailPreview] = useState<string[] | null>(null);

  const standingBadge = (entryId: number, p: EventMoneyPerson) => {
    const s = standings.get(entryId)!;
    if (p.owed === 0) return <span className={styles.cellMuted}>—</span>;
    if (s.standing === 'settled') return <Badge variant="success">Paid</Badge>;
    if (s.standing === 'behind') return <Badge variant="danger">Behind · {money(s.shortBy)}</Badge>;
    if (milestones.some((m) => m.kind === 'payment')) return <Badge variant="info">On schedule</Badge>;
    return <Badge variant={p.paid > 0 ? 'warning' : 'muted'}>{money(p.balance)} due</Badge>;
  };

  return (
    <>
      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Owed</div>
          <div className={styles.tileValue}>{money(totals.owed)}</div>
          <div className={styles.tileSub}>{data.people.filter((p) => p.owed > 0).length} people owe something</div>
        </div>
        <div className={styles.tile + ' ' + (totals.due > 0 ? styles.tileWarn : styles.tileOk)}>
          <div className={styles.tileLabel}>Still due</div>
          <div className={styles.tileValue}>{money(totals.due)}</div>
          <div className={styles.tileSub}>
            {money(totals.paid)} paid{totals.overpaid > 0 ? ` · ${money(totals.overpaid)} overpaid` : ''}
          </div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Income</div>
          <div className={styles.tileValue}>{money(totals.income)}</div>
          <div className={styles.tileSub}>
            {Object.entries(totals.incomeByMethod)
              .map(([m, v]) => `${METHOD_LABEL[m] ?? m} ${money(v)}`)
              .join(' · ') || 'nothing recorded yet'}
          </div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Expenses</div>
          <div className={styles.tileValue}>{money(totals.expenses)}</div>
          <div className={styles.tileSub}>
            {totals.reimbursementsPending > 0 ? `+ ${money(totals.reimbursementsPending)} reimbursements pending` : 'incl. reimbursements paid'}
          </div>
        </div>
        <div className={styles.tile + ' ' + (totals.net < 0 ? styles.tileWarn : styles.tileOk)}>
          <div className={styles.tileLabel}>{totals.net < 0 ? 'Cost to the troop' : 'Net'}</div>
          <div className={styles.tileValue}>{money(Math.abs(totals.net))}</div>
          <div className={styles.tileSub}>income − expenses − pending reimbursements</div>
        </div>
      </div>

      {error && <p className={styles.err}>{error}</p>}
      {note && <p className={styles.okNote}>{note}</p>}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Who owes what</h2>
          <span className={styles.panelHint}>
            Owed = tier (or a per-person override). Paid = every payment recorded, refunds netted. Record installments
            here; void a mistaken one from its history.
          </span>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Owed</th>
              <th scope="col">Paid</th>
              <th scope="col">Balance</th>
              <th scope="col">Status</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => (
              <Fragment key={p.entryId}>
                <tr>
                  <td>
                    <strong>{p.name}</strong>
                    {p.status !== 'yes' && <span className={styles.evCat}>{p.status}</span>}
                    {p.participation !== 'full' && <span className={styles.evCat}>{p.participation.replace('_', ' ')}</span>}
                  </td>
                  <td className={styles.nowrap}>
                    {overrideFor === p.entryId ? (
                      <span className={styles.addRow}>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          aria-label={`Owed override — ${p.name}`}
                          value={overrideText}
                          onChange={(e) => setOverrideText(e.target.value)}
                        />
                        <button
                          type="button"
                          className={styles.enableBtn}
                          disabled={pending}
                          onClick={() =>
                            run(
                              () =>
                                setAmountOverrideAction(p.entryId, overrideText === '' ? null : Number(overrideText), signupId),
                              () => setOverrideFor(null)
                            )
                          }
                        >
                          Save
                        </button>
                        <button type="button" className={styles.rowEdit} onClick={() => setOverrideFor(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <>
                        {money(p.owed)}
                        {p.amountOverride != null && (
                          <span className={styles.evCat} title={`Tier ${p.tierLabel ?? '—'} ${money(p.tierAmount)}`}>
                            override
                          </span>
                        )}{' '}
                        <button
                          type="button"
                          className={styles.rowEdit}
                          aria-label={`Override owed — ${p.name}`}
                          disabled={pending}
                          onClick={() => {
                            setOverrideFor(p.entryId);
                            setOverrideText(p.amountOverride != null ? String(p.amountOverride) : '');
                          }}
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </td>
                  <td className={styles.nowrap}>
                    {money(p.paid)}
                    {p.credited > 0 && <span className={styles.evCat}>{money(p.credited)} credited to account</span>}
                  </td>
                  {/* Blank when nothing is owed either way (Patrick, 2026-08-22) — a $0 reads as a figure to check. */}
                  {/* Negative = overpaid: red, parentheses, minus — all three (Patrick). */}
                  <td className={styles.nowrap}>
                    {p.balance === 0 ? '' : p.balance < 0 ? <span className={styles.negMoney}>({money(p.balance)})</span> : money(p.balance)}
                    {/* Balance already nets the credit; the Paid cell carries the "$X credited" note. */}
                  </td>
                  <td>{standingBadge(p.entryId, p)}</td>
                  <td className={styles.nowrap}>
                    <button type="button" className={styles.rowEdit} disabled={pending} onClick={() => openDlg('pay', p)}>
                      Record payment
                    </button>{' '}
                    {p.paid > 0 && (
                      <button type="button" className={styles.rowEdit} disabled={pending} onClick={() => openDlg('refund', p)}>
                        Refund
                      </button>
                    )}{' '}
                    {uncreditedOverpayment(p.balance) > 0 && p.personId != null && (
                      <button type="button" className={styles.rowEdit} disabled={pending} onClick={() => openDlg('credit', p)}>
                        Credit to account
                      </button>
                    )}{' '}
                    {p.transactions.length > 0 && (
                      <button
                        type="button"
                        className={styles.rowEdit}
                        aria-expanded={openHistory.has(p.entryId)}
                        onClick={() =>
                          setOpenHistory((s) => {
                            const n = new Set(s);
                            if (n.has(p.entryId)) n.delete(p.entryId);
                            else n.add(p.entryId);
                            return n;
                          })
                        }
                      >
                        History ({p.transactions.length})
                      </button>
                    )}
                  </td>
                </tr>
                {openHistory.has(p.entryId) && (
                  <tr className={styles.editRow}>
                    <td colSpan={6}>
                      <table className={styles.miniTable}>
                        <tbody>
                          {p.transactions.map((t) => (
                            <tr key={t.id} className={t.voidedAt ? styles.cellMuted : undefined}>
                              <td>{t.occurredOn}</td>
                              <td>{money(t.amount)}</td>
                              <td>{t.kind === 'event_fee' ? (t.amount < 0 ? 'refund' : 'payment') : t.kind}</td>
                              <td>{t.method ? (METHOD_LABEL[t.method] ?? t.method) : '—'}</td>
                              <td>{t.memo ?? ''}</td>
                              <td>
                                {t.voidedAt ? (
                                  'voided'
                                ) : t.kind === 'event_fee' ? (
                                  <button
                                    type="button"
                                    className={styles.rowDel}
                                    disabled={pending}
                                    onClick={() => run(() => voidEventFeePaymentAction(t.id, signupId))}
                                  >
                                    Void
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Expenses &amp; reimbursements</h2>
          <span className={styles.panelHint}>
            Every expense names the leader who paid. Troop funds → an expense row now. Their own money → a
            reimbursement request; the expense lands when the treasurer pays it out.
          </span>
        </div>
        {data.expenses.length === 0 && data.reimbursements.length === 0 ? (
          <p className={styles.empty}>No expenses recorded for this event yet.</p>
        ) : (
          <table className={styles.miniTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Who paid</th>
                <th>Kind</th>
                <th>Method / status</th>
                <th>What</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.map((e) => (
                <tr key={`x${e.id}`} className={e.voidedAt ? styles.cellMuted : undefined}>
                  <td>{e.occurredOn}</td>
                  <td>{money(Math.abs(e.amount))}</td>
                  <td>{e.voidedAt ? 'voided' : e.personName ?? ''}</td>
                  <td>{e.kind}</td>
                  <td>{e.method ? (METHOD_LABEL[e.method] ?? e.method) : '—'}</td>
                  <td>{e.memo ?? ''}</td>
                </tr>
              ))}
              {data.reimbursements.map((r) => (
                <tr key={`r${r.id}`}>
                  <td>{r.createdAt.slice(0, 10)}</td>
                  <td>{money(r.amount)}</td>
                  <td>{r.requesterName}</td>
                  <td>reimbursement</td>
                  <td>
                    <Badge variant={r.status === 'paid' ? 'success' : r.status === 'denied' ? 'danger' : 'warning'}>{r.status}</Badge>
                  </td>
                  <td>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className={styles.addRow}>
          <input type="date" aria-label="Expense date" value={xDate} onChange={(e) => setXDate(e.target.value)} />
          <input
            type="number"
            min={0.01}
            step="0.01"
            placeholder="Amount"
            aria-label="Expense amount"
            value={xAmount}
            onChange={(e) => setXAmount(e.target.value)}
          />
          <select aria-label="Who paid" value={xPayer} onChange={(e) => setXPayer(e.target.value)}>
            <option value="">Who paid…</option>
            {adults.map((a) => (
              <option key={a.personId} value={String(a.personId)}>
                {a.name}
              </option>
            ))}
          </select>
          <select aria-label="Paid with" value={xPaidBy} onChange={(e) => setXPaidBy(e.target.value as 'troop' | 'own')}>
            <option value="own">their own money (reimburse)</option>
            <option value="troop">troop funds (check / card / bank)</option>
          </select>
          {xPaidBy === 'troop' && (
            <select aria-label="Expense method" value={xMethod} onChange={(e) => setXMethod(e.target.value as TransactionMethod)}>
              {TRANSACTION_METHODS.filter((m) => m !== 'scout_account').map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          )}
          {/* Inputs follow the column order above: Date · Amount · Who paid · Paid with · What (Patrick, 2026-08-22). */}
          <input placeholder="What for (e.g. Food — Pick n Save)" aria-label="Expense memo" value={xMemo} onChange={(e) => setXMemo(e.target.value)} />
          <button
            type="button"
            className={styles.enableBtn}
            disabled={pending || !xAmount || !xMemo.trim() || !xPayer}
            onClick={() =>
              run(
                () =>
                  addEventExpenseAction({
                    signupId,
                    calendarEntryId,
                    occurredOn: xDate,
                    amount: Number(xAmount),
                    memo: xMemo,
                    paidBy: xPaidBy === 'troop' ? 'troop' : Number(xPayer),
                    payerPersonId: Number(xPayer),
                    method: xPaidBy === 'troop' ? xMethod : 'other',
                    idempotencyKey: newKey()
                  }),
                () => {
                  setXAmount('');
                  setXMemo('');
                }
              )
            }
          >
            Add expense
          </button>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Deposit schedule &amp; deadlines</h2>
          <span className={styles.panelHint}>
            Shown on the public event page. Payment milestones drive the Behind badge: paid &lt; what the schedule asked
            for by today.
          </span>
        </div>
        {milestones.length > 0 && (
          <table className={styles.miniTable}>
            <tbody>
              {milestones.map((m) => (
                <tr key={m.id}>
                  <td>{m.dueOn}</td>
                  <td>
                    <strong>{m.label}</strong>
                  </td>
                  <td>{m.kind}</td>
                  <td>{m.amount != null ? money(m.amount) : '—'}</td>
                  <td>{m.appliesTo}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.rowDel}
                      disabled={pending}
                      onClick={() => run(() => deleteMilestone(m.id, signupId, calendarEntryId))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className={styles.addRow}>
          <select aria-label="Milestone kind" value={mKind} onChange={(e) => setMKind(e.target.value as typeof mKind)}>
            <option value="payment">Payment due</option>
            <option value="registration">Registration deadline</option>
            <option value="form">Form due</option>
            <option value="other">Other</option>
          </select>
          <input placeholder="Label (e.g. Deposit)" aria-label="Milestone label" value={mLabel} onChange={(e) => setMLabel(e.target.value)} />
          <input type="date" aria-label="Milestone due date" value={mDue} onChange={(e) => setMDue(e.target.value)} />
          {mKind === 'payment' && (
            <input
              type="number"
              min={0.01}
              step="0.01"
              placeholder="Amount"
              aria-label="Milestone amount"
              value={mAmount}
              onChange={(e) => setMAmount(e.target.value)}
            />
          )}
          <select aria-label="Milestone applies to" value={mWho} onChange={(e) => setMWho(e.target.value as typeof mWho)}>
            <option value="both">Everyone</option>
            <option value="scouts">Scouts</option>
            <option value="adults">Adults</option>
          </select>
          <button
            type="button"
            className={styles.enableBtn}
            disabled={pending || !mLabel.trim() || !mDue || (mKind === 'payment' && !mAmount)}
            onClick={() =>
              run(
                () =>
                  addMilestone(signupId, calendarEntryId, {
                    kind: mKind,
                    label: mLabel,
                    dueOn: mDue,
                    amount: mKind === 'payment' ? Number(mAmount) : null,
                    appliesTo: mWho
                  }),
                () => {
                  setMLabel('');
                  setMAmount('');
                }
              )
            }
          >
            Add milestone
          </button>
        </div>
        {milestones.some((m) => m.kind === 'payment') && (
          <div className={styles.addRow}>
            <span className={styles.panelHint}>
              {behind.length === 0
                ? 'Nobody is behind on the schedule.'
                : `${behind.length} behind: ${behind.map(({ p, s }) => `${p.name} (${money(s.shortBy)})`).join(', ')}`}
            </span>
            {behind.length > 0 && !mailPreview && (
              <button
                type="button"
                className={styles.rowEdit}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const res = await emailPaymentReminders(
                      signupId,
                      behind.map(({ p, s }) => ({ entryId: p.entryId, short: s.shortBy, due: s.dueByToday })),
                      false
                    );
                    if (!res.ok) setError(res.error ?? 'Could not preview.');
                    else setMailPreview(res.to ?? []);
                  })
                }
              >
                Preview reminder recipients
              </button>
            )}
            {mailPreview && (
              <>
                <span className={styles.panelHint}>To: {mailPreview.join(', ') || '(nobody)'}</span>
                <button
                  type="button"
                  className={styles.enableBtn}
                  disabled={pending || mailPreview.length === 0}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const res = await emailPaymentReminders(
                        signupId,
                        behind.map(({ p, s }) => ({ entryId: p.entryId, short: s.shortBy, due: s.dueByToday })),
                        true
                      );
                      if (!res.ok) setError(res.error ?? 'Could not send.');
                      else setNote(`Payment reminder ${res.status} to ${res.to?.length ?? 0} address(es).`);
                      setMailPreview(null);
                    })
                  }
                >
                  Send reminder
                </button>
                <button type="button" className={styles.rowEdit} onClick={() => setMailPreview(null)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        )}
      </section>

      <Dialog ref={dlgRef} onClose={() => setDlg(null)}>
        {dlg && (
          <>
            <DialogHeader
              title={
                dlg.mode === 'pay'
                  ? `Record payment — ${dlg.person.name}`
                  : dlg.mode === 'refund'
                    ? `Refund — ${dlg.person.name}`
                    : `Credit overpayment to scout account — ${dlg.person.name}`
              }
            />
            <DialogBody>
              <label className={`adminLabel ${styles.payField}`}>
                Amount
                <input type="number" min={0.01} step="0.01" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
              </label>
              {dlg.mode !== 'credit' && (
                <label className={`adminLabel ${styles.payField}`}>
                  Method
                  <select
                    value={method}
                    onChange={(e) => {
                      setMethod(e.target.value as PayMethod);
                      setAckNegative(false);
                    }}
                  >
                    {TRANSACTION_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABEL[m]}
                      </option>
                    ))}
                    {dlg.mode === 'pay' && <option value="scholarship">{PAY_METHOD_LABEL.scholarship}</option>}
                  </select>
                </label>
              )}
              {dlg.mode === 'pay' && (
                <PayGuard
                  method={method}
                  facts={payFacts}
                  loading={payFacts == null}
                  amount={Number(amountText)}
                  acknowledged={ackNegative}
                  onAcknowledge={setAckNegative}
                  onUseScholarship={() => {
                    setMethod('scholarship');
                    setAckNegative(false);
                  }}
                />
              )}
              {dlg.mode !== 'credit' && (
                <label className={`adminLabel ${styles.payField}`}>
                  Note (optional)
                  <input
                    type="text"
                    placeholder={dlg.mode === 'pay' ? 'e.g. Venmo 1/25 — deposit; paid by Patrick' : 'Why'}
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                  />
                </label>
              )}
              {dlg.mode === 'credit' && (
                <p className={styles.panelHint}>
                  Writes a scout-account credit for {dlg.person.name}; the overpayment stays visible here with a
                  &ldquo;credited&rdquo; note.
                </p>
              )}
            </DialogBody>
            <DialogActions>
              <button type="button" className={styles.rowEdit} onClick={() => setDlg(null)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className={styles.enableBtn} onClick={submitDlg} disabled={pending || payNeedsAck}>
                {pending ? 'Saving…' : dlg.mode === 'pay' ? 'Record payment' : dlg.mode === 'refund' ? 'Record refund' : 'Credit account'}
              </button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}

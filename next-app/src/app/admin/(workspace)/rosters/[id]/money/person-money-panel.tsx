'use client';

/**
 * The person panel beside the Money tab's ledger (Plans/Event-Money-Ledger-Redesign.md §5): everything a leader does
 * to ONE person's money — what they owe (Tier / Custom with a reason / Not paying), a payment (full or part, on any
 * past date, any method), a refund, a credit to their scout account, and their history with Void. It replaces the row
 * buttons, the inline history rows and the pay/refund/credit dialog. Rendered with key={entryId}, so switching
 * people starts every draft fresh.
 */
import { useEffect, useId, useRef, useState } from 'react';
import {
  creditOverpaymentAction,
  getScoutAccountBalanceForEntryAction,
  recordEventFeePaymentAction,
  refundEventFeeAction,
  setAmountOverrideAction,
  voidEventFeePaymentAction,
  type EventMoneyPerson
} from '../../../finance/actions';
import {
  AMOUNT_MODE_LABEL,
  amountMode,
  canRecordPayment,
  methodLabel,
  money,
  OTHER_PAY_METHODS,
  PRIMARY_PAY_METHODS,
  refundAccountDefault,
  uncreditedOverpayment,
  type AmountMode,
  type PayMethod
} from '@/lib/event-money';
import { fmtDate } from '@/lib/format-date';
import { instantToCentral } from '@/lib/dates';
import { PayFrom, PayGuard, factsFrom, needsAccountPick, wouldGoNegative, type AccountFacts } from '../../../events/pay-guard';
import { Badge } from '../../../_components/badge';
import { Notice } from '../../../_components/notice';
import { SegmentedControl } from '../../../_components/segmented-control';
import { DatePickerField } from '../../../_components/date-picker-field';
import { DiscardButton, SaveButton } from '../../../_components/save-state';
import saveStyles from '../../../_components/save-state.module.css';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../../_components/dialog';
import { Button } from '../../../../_components/button';
import styles from './money.module.css';

export type Act = (fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<{ ok: boolean; error?: string }>;

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined);
const short = (iso: string) => fmtDate(iso, { year: 'short' });
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const cents = (n: number) => Math.round(n * 100);

export function PersonMoneyPanel({
  person,
  signupId,
  today,
  busy,
  act,
  onClose
}: {
  person: EventMoneyPerson;
  signupId: number;
  today: string;
  busy: boolean;
  act: Act;
  onClose: () => void;
}) {
  const headingId = useId();
  const p = person;
  return (
    <section
      className={styles.panel}
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        // Esc closes the panel unless a dialog or a picker inside it took the key first.
        if (e.key === 'Escape' && !e.defaultPrevented) onClose();
      }}
    >
      <div className={styles.panelHead}>
        <h2 id={headingId}>{p.name}</h2>
        <button type="button" className={styles.close} aria-label={`Close ${p.name}`} onClick={onClose}>
          ×
        </button>
      </div>
      <p className={styles.status}>
        Owes {money(p.owed)} · paid {money(p.paid)} · <StandingWords person={p} />
      </p>
      <AmountCard person={p} signupId={signupId} busy={busy} act={act} />
      <PaymentCard person={p} signupId={signupId} today={today} busy={busy} act={act} />
      <HistoryCard person={p} signupId={signupId} busy={busy} act={act} />
    </section>
  );
}

function StandingWords({ person: p }: { person: EventMoneyPerson }) {
  if (cents(p.owed) === 0 && cents(p.balance) === 0) return <strong>{p.amountOverride != null ? 'Not paying' : 'Nothing owed'}</strong>;
  if (p.balance < 0) return <strong className={styles.danger}>({money(p.balance)}) overpaid</strong>;
  if (p.balance > 0) return <strong className={styles.gold}>{money(p.balance)} due</strong>;
  return <strong className={styles.forest}>✓ Paid in full</strong>;
}

// ── b. What they owe ──────────────────────────────────────────────────────────────────────────────────────────────

interface AmountDraft {
  mode: AmountMode;
  amount: string;
  reason: string;
}

function savedDraft(p: EventMoneyPerson): AmountDraft {
  const mode = amountMode(p.amountOverride);
  return { mode, amount: mode === 'custom' ? String(p.amountOverride) : '', reason: p.amountOverrideReason ?? '' };
}

function draftKey(d: AmountDraft): string {
  if (d.mode === 'tier') return 'tier';
  if (d.mode === 'none') return `none|${d.reason.trim()}`;
  if (d.amount.trim() === '') return `custom||${d.reason.trim()}`;
  // A custom $0 is what Not paying stores (override 0), so it compares as Not paying.
  const c = cents(Number(d.amount));
  return c === 0 ? `none|${d.reason.trim()}` : `custom|${c}|${d.reason.trim()}`;
}

function AmountCard({ person: p, signupId, busy, act }: { person: EventMoneyPerson; signupId: number; busy: boolean; act: Act }) {
  const saved = savedDraft(p);
  const [open, setOpen] = useState(saved.mode !== 'tier');
  const [draft, setDraft] = useState<AmountDraft>(saved);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const amountId = useId();
  const reasonId = useId();
  const noteId = useId();

  const dirty = draftKey(draft) !== draftKey(saved);
  const amountNum = Number(draft.amount);
  const problem =
    draft.mode === 'custom' && (draft.amount.trim() === '' || !Number.isFinite(amountNum) || amountNum < 0)
      ? 'Amount must be zero or more'
      : null;
  const showProblem = tried && problem != null;
  const tier = money(p.tierAmount);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  async function save() {
    setError(null);
    const amount = draft.mode === 'tier' ? null : draft.mode === 'none' ? 0 : amountNum;
    const res = await act(() => setAmountOverrideAction(p.entryId, amount, signupId, draft.mode === 'tier' ? null : draft.reason));
    if (!res.ok) setError(res.error ?? 'Couldn’t save the amount.');
    else {
      setTried(false);
      setFlash(true);
      if (draft.mode === 'tier') setOpen(false);
    }
  }

  if (!open) {
    return (
      <div className={styles.card}>
        <div className={styles.cardLine}>
          <span>
            Owes the tier, <strong>{tier}</strong>
          </span>
          <button type="button" className={styles.link} onClick={() => setOpen(true)}>
            Change amount
          </button>
        </div>
        {flash && <p className={styles.hint} role="status">Done</p>}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h3>What {firstName(p.name)} owes</h3>
      {error && <Notice>{error}</Notice>}
      <SegmentedControl<AmountMode>
        name={`amount-mode-${p.entryId}`}
        label={`What ${p.name} owes`}
        value={draft.mode}
        disabled={busy}
        options={[
          { value: 'tier', label: `Tier ${tier}` },
          { value: 'custom', label: AMOUNT_MODE_LABEL.custom },
          { value: 'none', label: AMOUNT_MODE_LABEL.none }
        ]}
        onChange={(mode) => setDraft((d) => ({ ...d, mode }))}
      />
      {draft.mode !== 'tier' && (
        <div className={styles.fields}>
          {draft.mode === 'custom' && (
            <label className={styles.field} htmlFor={amountId}>
              <span>Amount</span>
              <input
                id={amountId}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={draft.amount}
                disabled={busy}
                className={showProblem ? saveStyles.bad : undefined}
                aria-invalid={showProblem || undefined}
                aria-describedby={showProblem ? noteId : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
              />
            </label>
          )}
          {showProblem && (
            <p id={noteId} className={saveStyles.badNote}>
              {problem}
            </p>
          )}
          <label className={styles.field} htmlFor={reasonId}>
            <span>Reason (optional)</span>
            <input
              id={reasonId}
              maxLength={200}
              value={draft.reason}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
            />
          </label>
          {draft.mode === 'custom' && <p className={styles.hint}>The tier is {tier}. A custom amount stays put if the tier changes later.</p>}
        </div>
      )}
      <div className={styles.actions}>
        <SaveButton
          dirty={dirty}
          pending={busy}
          dirtyLabel="Save amount"
          pendingLabel="Saving changes…"
          blocked={problem != null}
          onBlocked={() => setTried(true)}
          onClick={() => void save()}
        />
        <DiscardButton
          dirty={dirty}
          pending={busy}
          onClick={() => {
            setDraft(saved);
            setTried(false);
          }}
        />
        {showProblem && (
          <span className={saveStyles.problem} role="alert">
            Can’t save yet: {problem}
          </span>
        )}
        {flash && !dirty && (
          <span className={styles.hint} role="status">
            Done
          </span>
        )}
      </div>
    </div>
  );
}

// ── c. Record a payment / refund / credit ─────────────────────────────────────────────────────────────────────────

type Mode = 'pay' | 'refund' | 'credit';
type TopMethod = (typeof PRIMARY_PAY_METHODS)[number] | 'more';

function defaultAmount(mode: Mode, p: EventMoneyPerson): string {
  if (mode === 'pay') return String(p.balance > 0 ? p.balance : p.owed);
  if (mode === 'credit') return String(uncreditedOverpayment(p.balance));
  return String(p.balance < 0 ? -p.balance : p.paid);
}

function PaymentCard({
  person: p,
  signupId,
  today,
  busy,
  act
}: {
  person: EventMoneyPerson;
  signupId: number;
  today: string;
  busy: boolean;
  act: Act;
}) {
  const startOpen: Mode | null = canRecordPayment(p) ? 'pay' : null;
  const [mode, setMode] = useState<Mode | null>(startOpen);
  const [amountText, setAmountText] = useState(() => (startOpen ? defaultAmount(startOpen, p) : ''));
  const [onDate, setOnDate] = useState(today);
  const [top, setTop] = useState<TopMethod>('venmo');
  const [other, setOther] = useState<PayMethod>('scout_account');
  const [memo, setMemo] = useState('');
  const [ackNegative, setAckNegative] = useState(false);
  const [payFrom, setPayFrom] = useState<number | null>(null);
  const [acctBalance, setAcctBalance] = useState<AccountFacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const amountId = useId();
  const dateId = useId();
  const dateNoteId = useId();
  const memoId = useId();
  const otherId = useId();

  const moneyKey = `${cents(p.owed)}|${cents(p.balance)}`;
  const [seenKey, setSeenKey] = useState(moneyKey);
  if (seenKey !== moneyKey) {
    setSeenKey(moneyKey);
    if (mode === 'pay' || mode == null) {
      const next: Mode | null = canRecordPayment(p) ? 'pay' : null;
      setMode(next);
      if (next) setAmountText(defaultAmount(next, p));
    }
  }

  const method: PayMethod = top === 'more' ? other : top;
  const dateProblem =
    mode === 'credit' || mode == null ? null : !onDate ? 'Pick the date it was paid' : onDate > today ? 'Pick a date that isn’t in the future' : null;
  const showDateProblem = tried && dateProblem != null;
  const amount = Number(amountText);
  const needsFacts = mode != null && mode !== 'credit' && (method === 'scout_account' || method === 'scholarship');

  // What the scout account or scholarship fund holds, fetched when that is the method (Patrick, 2026-08-22).
  useEffect(() => {
    if (!needsFacts) return;
    let live = true;
    getScoutAccountBalanceForEntryAction(p.entryId).then((r) => {
      if (live) setAcctBalance({ entryId: p.entryId, balance: r.balance, scholarshipBalance: r.scholarshipBalance, family: r.family });
    });
    return () => {
      live = false;
    };
  }, [needsFacts, p.entryId]);
  const ownFacts = acctBalance?.entryId === p.entryId ? acctBalance : null;
  const payFacts = factsFrom(ownFacts, payFrom);
  const payNeedsAck = mode === 'pay' && wouldGoNegative(method, payFacts, amount) && !ackNegative;
  const pickMissing = mode !== 'credit' && mode != null && needsAccountPick(method, ownFacts, payFrom);

  function begin(next: Mode) {
    setMode(next);
    setAmountText(defaultAmount(next, p));
    setOnDate(today);
    setTop('venmo');
    setOther('scout_account');
    setMemo('');
    setAckNegative(false);
    // A refund goes back to the account that paid (a family member's, if one did).
    setPayFrom(next === 'refund' ? refundAccountDefault(p.transactions) : null);
    setError(null);
    setDone(null);
    setTried(false);
    // The form mounts on this render; focus its Amount once it is there.
    requestAnimationFrame(() => amountRef.current?.focus());
  }

  async function submit() {
    if (!mode || !(amount > 0)) return;
    if (dateProblem) {
      setTried(true);
      return;
    }
    setError(null);
    const idempotencyKey = newKey();
    const scoutAccountPersonId = method === 'scout_account' ? payFrom : null;
    const res = await act(() =>
      mode === 'pay'
        ? recordEventFeePaymentAction({ signupEntryId: p.entryId, amount, method, memo, signupId, idempotencyKey, scoutAccountPersonId, occurredOn: onDate })
        : mode === 'refund'
          ? refundEventFeeAction({ signupEntryId: p.entryId, amount, method, memo, signupId, idempotencyKey, scoutAccountPersonId, occurredOn: onDate })
          : creditOverpaymentAction({ signupEntryId: p.entryId, amount, signupId, idempotencyKey })
    );
    if (!res.ok) {
      setError(res.error ?? 'Couldn’t record it.');
      return;
    }
    setDone(mode === 'pay' ? `Recorded ${money(amount)} ${methodLabel(method)} payment.` : mode === 'refund' ? `Recorded ${money(amount)} refund.` : `Credited ${money(amount)} to the scout account.`);
    // A part payment leaves the form open on what is still due; anything else collapses.
    const left = Math.max(0, cents(p.balance) - cents(amount)) / 100;
    if (mode === 'pay' && left > 0) {
      setAmountText(String(left));
      setMemo('');
    } else setMode(null);
  }

  const canCredit = uncreditedOverpayment(p.balance) > 0 && p.personId != null;
  const title = mode === 'pay' ? (canRecordPayment(p) ? 'Record a payment' : 'Record an extra payment') : mode === 'refund' ? 'Refund' : 'Credit to scout account';

  if (mode == null) {
    return (
      <div className={styles.card}>
        {done && <Notice variant="success">{done}</Notice>}
        <div className={styles.cardLine}>
          <span>
            {canRecordPayment(p)
              ? `${money(p.balance)} still due.`
              : cents(p.owed) === 0 && cents(p.paid) === 0
                ? 'Nothing to pay.'
                : 'Nothing left to pay.'}
          </span>
          <span className={styles.actions}>
            <Button size="sm" disabled={busy} onClick={() => begin('pay')}>
              Record a payment
            </Button>
            {p.paid > 0 && (
              <Button size="sm" variant="danger" disabled={busy} onClick={() => begin('refund')}>
                Refund
              </Button>
            )}
            {canCredit && (
              <Button size="sm" disabled={busy} onClick={() => begin('credit')}>
                Credit to account
              </Button>
            )}
          </span>
        </div>
      </div>
    );
  }

  const balance = p.balance;
  const partLeft = mode === 'pay' && balance > 0 && amount > 0 && cents(amount) < cents(balance) ? (cents(balance) - cents(amount)) / 100 : 0;
  const overBy = mode === 'pay' && amount > 0 && cents(amount) > cents(Math.max(balance, 0)) ? (cents(amount) - cents(Math.max(balance, 0))) / 100 : 0;
  const primaryLabel = busy
    ? 'Saving…'
    : mode === 'pay'
      ? `Record ${amount > 0 ? money(amount) : ''} ${methodLabel(method)} payment`.replace('  ', ' ')
      : mode === 'refund'
        ? `Record ${amount > 0 ? money(amount) : ''} refund`.replace('  ', ' ')
        : `Credit ${amount > 0 ? money(amount) : ''} to scout account`.replace('  ', ' ');
  const collapsible = mode !== 'pay' || !canRecordPayment(p);

  return (
    <div className={styles.card}>
      <h3>{title}</h3>
      {done && <Notice variant="success">{done}</Notice>}
      {error && <Notice>{error}</Notice>}
      <div className={styles.fields}>
        <label className={styles.field} htmlFor={amountId}>
          <span>Amount</span>
          <input
            id={amountId}
            ref={amountRef}
            type="number"
            min={0.01}
            step="0.01"
            inputMode="decimal"
            value={amountText}
            disabled={busy}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </label>
        {partLeft > 0 && (
          <Notice variant="info">
            Part payment: <strong>{money(partLeft)} will still be due</strong>.{' '}
            <button type="button" className={styles.link} onClick={() => setAmountText(String(balance))}>
              Pay the full {money(balance)}
            </button>
          </Notice>
        )}
        {overBy > 0 && (
          <Notice variant="warning">That’s {money(overBy)} more than owed; it will show as overpaid.</Notice>
        )}
        {mode !== 'credit' && (
          <>
            <label className={styles.field} htmlFor={dateId}>
              <span>{mode === 'refund' ? 'Refunded on' : 'Paid on'}</span>
              <div className={showDateProblem ? saveStyles.bad : undefined}>
                <DatePickerField
                  id={dateId}
                  value={onDate}
                  disabled={busy}
                  aria-describedby={showDateProblem ? dateNoteId : undefined}
                  onChange={setOnDate}
                />
              </div>
            </label>
            {showDateProblem && (
              <p id={dateNoteId} className={saveStyles.badNote} role="alert">
                Can’t record yet: {dateProblem}
              </p>
            )}
            <div className={styles.field}>
              <span>Method</span>
              <SegmentedControl<TopMethod>
                name={`method-${p.entryId}`}
                label="Method"
                value={top}
                disabled={busy}
                options={[...PRIMARY_PAY_METHODS.map((m) => ({ value: m as TopMethod, label: methodLabel(m) })), { value: 'more', label: 'Other ▾' }]}
                onChange={(v) => {
                  setTop(v);
                  setAckNegative(false);
                }}
              />
            </div>
            {top === 'more' && (
              <label className={styles.field} htmlFor={otherId}>
                <span>Other method</span>
                <select
                  id={otherId}
                  value={other}
                  disabled={busy}
                  onChange={(e) => {
                    setOther(e.target.value as PayMethod);
                    setAckNegative(false);
                  }}
                >
                  {OTHER_PAY_METHODS.filter((m) => m !== 'scholarship' || mode === 'pay').map((m) => (
                    <option key={m} value={m}>
                      {m === 'scout_account' ? 'Scout account balance' : methodLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <PayFrom
              method={method}
              facts={ownFacts}
              selfName={p.name}
              value={payFrom}
              onChange={(id) => {
                setPayFrom(id);
                setAckNegative(false);
              }}
            />
            {mode === 'pay' && (
              <PayGuard
                method={method}
                facts={payFacts}
                loading={payFacts == null}
                amount={amount}
                acknowledged={ackNegative}
                onAcknowledge={setAckNegative}
                onUseScholarship={() => {
                  setTop('more');
                  setOther('scholarship');
                  setAckNegative(false);
                }}
              />
            )}
            <label className={styles.field} htmlFor={memoId}>
              <span>Note (optional)</span>
              <input id={memoId} value={memo} disabled={busy} onChange={(e) => setMemo(e.target.value)} />
            </label>
          </>
        )}
        {mode === 'credit' && (
          <p className={styles.hint}>
            Writes a scout-account credit for {p.name}; the overpayment stays visible with a &ldquo;credited&rdquo; note.
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <Button variant="primary" disabled={busy || !(amount > 0) || payNeedsAck || pickMissing} onClick={() => void submit()}>
          {primaryLabel}
        </Button>
        {collapsible && (
          <Button disabled={busy} onClick={() => setMode(null)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

// ── d. History ────────────────────────────────────────────────────────────────────────────────────────────────────

type Txn = EventMoneyPerson['transactions'][number];
type Item =
  | { kind: 'txn'; day: string; at: string; t: Txn }
  | { kind: 'change'; day: string; at: string; c: EventMoneyPerson['amountChanges'][number] };

function txnTitle(t: Txn): string {
  if (t.kind === 'event_fee') return `${t.amount < 0 ? 'Refund' : 'Payment'} ${money(Math.abs(t.amount))} · ${methodLabel(t.method)}`;
  if (t.kind === 'adjustment') return `Credited ${money(Math.abs(t.amount))} to scout account`;
  return `${t.kind} ${money(t.amount)}`;
}

function HistoryCard({ person: p, signupId, busy, act }: { person: EventMoneyPerson; signupId: number; busy: boolean; act: Act }) {
  const [voiding, setVoiding] = useState<Txn | null>(null);
  const items: Item[] = [
    ...p.transactions.map((t): Item => ({ kind: 'txn', day: t.occurredOn, at: t.createdAt, t })),
    ...p.amountChanges.map((c): Item => ({ kind: 'change', day: instantToCentral(c.changedAt).date, at: c.changedAt, c }))
  ].sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <div className={styles.card}>
      <h3>History</h3>
      {items.length === 0 ? (
        <p className={styles.hint}>No payments yet.</p>
      ) : (
        <ul className={styles.history}>
          {items.map((it, i) =>
            it.kind === 'txn' ? (
              <li key={`t${it.t.id}`} className={it.t.voidedAt ? styles.voided : undefined}>
                <span className={styles.hDate}>{short(it.day)}</span>
                <span className={styles.hBody}>
                  <span className={styles.hMain}>{txnTitle(it.t)}</span>
                  {it.t.voidedAt && (
                    <>
                      {' '}
                      <Badge variant="neutral">Voided</Badge>
                    </>
                  )}
                  <span className={styles.hSub}>
                    {it.t.voidedAt
                      ? `Voided${it.t.voidedBy ? ` by ${it.t.voidedBy}` : ''}${it.t.voidReason ? `: “${it.t.voidReason}”` : ''}`
                      : [
                          it.t.enteredBy ? `Recorded by ${it.t.enteredBy}` : null,
                          it.t.accountOf ? `(${it.t.accountOf}’s scout account)` : null,
                          it.t.memo
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                </span>
                {!it.t.voidedAt && it.t.kind === 'event_fee' && (
                  <button type="button" className={styles.voidBtn} disabled={busy} onClick={() => setVoiding(it.t)}>
                    Void
                  </button>
                )}
              </li>
            ) : (
              <li key={`c${i}-${it.at}`}>
                <span className={styles.hDate}>{short(it.day)}</span>
                <span className={styles.hBody}>
                  <span className={styles.hMain}>
                    {it.c.oldMode === it.c.newMode && cents(it.c.oldAmount) === cents(it.c.newAmount)
                      ? `Reason changed (${money(it.c.newAmount)})`
                      : `Amount changed ${money(it.c.oldAmount)} → ${money(it.c.newAmount)}`}
                  </span>
                  <span className={styles.hSub}>
                    {[
                      `${AMOUNT_MODE_LABEL[it.c.oldMode]} → ${AMOUNT_MODE_LABEL[it.c.newMode]}`,
                      it.c.reason ? `“${it.c.reason}”` : null,
                      it.c.by ? `by ${it.c.by}` : null
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </li>
            )
          )}
        </ul>
      )}
      {voiding && (
        <VoidDialog
          t={voiding}
          name={firstName(p.name)}
          busy={busy}
          onCancel={() => setVoiding(null)}
          onVoid={async (reason) => {
            const res = await act(() => voidEventFeePaymentAction(voiding.id, signupId, reason));
            if (res.ok) setVoiding(null);
            return res;
          }}
        />
      )}
    </div>
  );
}

function VoidDialog({
  t,
  name,
  busy,
  onCancel,
  onVoid
}: {
  t: Txn;
  name: string;
  busy: boolean;
  onCancel: () => void;
  onVoid: (reason: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const what = `${money(Math.abs(t.amount))} ${methodLabel(t.method)} ${t.amount < 0 ? 'refund' : 'payment'}`;
  return (
    <Dialog ref={ref} danger aria-labelledby={titleId} onClose={onCancel}>
      <DialogHeader title={<span id={titleId}>Void the {what} from {short(t.occurredOn)}?</span>} />
      <DialogBody>
        <p>It stops counting toward {name}&rsquo;s paid total. It stays in the history, struck through.</p>
        <label className={styles.field} htmlFor={reasonId}>
          <span>Reason (optional)</span>
          <input id={reasonId} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <Notice>{error}</Notice>}
      </DialogBody>
      <DialogActions>
        <Button disabled={busy} onClick={() => ref.current?.close()}>
          Cancel
        </Button>
        <Button
          variant="dangerSolid"
          disabled={busy}
          onClick={async () => {
            const res = await onVoid(reason);
            if (!res.ok) setError(res.error ?? 'Couldn’t void it.');
          }}
        >
          {busy ? 'Voiding…' : `Void ${t.amount < 0 ? 'refund' : 'payment'}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

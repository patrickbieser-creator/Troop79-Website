'use client';

/**
 * Wreath sale › Orders: every order, filterable, with the treasurer's two jobs — Mark paid (Release A: customers pay
 * the treasurer by Venmo or PayPal) and Edit order (items, contact, credit and delivery, and a hand payment). An order opens
 * in place: items, the customer's contact, the audited changes. Customer contact is shown here and nowhere public.
 * A small, already-fetched list, so the search and filters run on the client (useTableSearch).
 */

import { Fragment, useMemo, useRef, useState, useTransition } from 'react';
import { Button } from '../../../_components/button';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { Badge } from '../../_components/badge';
import { DiscardButton, SaveButton, useDraftSnapshot, useSavedSnapshot } from '../../_components/save-state';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { fmtDateTime } from '@/lib/format-date';
import { DONATION_LABEL, FULFILLMENT_LABEL, PAID_METHODS, SOURCE_LABEL, acceptedShort, fmtMoney2, fromCents, paidPillText, toCents, type PaidMethod, type SaleRules } from '@/lib/wreaths/rules';
import { ORDER_NOTE_MAX, noteStamp } from '@/lib/wreaths/order-note';
import type { AdminItem, AdminOrder, AuditEntry } from '@/lib/wreaths/admin-data';
import { cancelOrder, markPaid, refundCardOrder, setOrderNote, setPaymentNote } from './actions';
import { EditOrderForm } from './edit-order-form';
import styles from './wreaths.module.css';

export interface SellerOption {
  personId: number;
  name: string;
}

const FULFILLMENT = FULFILLMENT_LABEL;
const SOURCE = SOURCE_LABEL;

export function OrdersPanel({ orders, history, sellers, items, rules, initialPay = '' }: { orders: AdminOrder[]; history: Record<number, AuditEntry[]>; sellers: SellerOption[]; items: AdminItem[]; rules: SaleRules; initialPay?: string }) {
  const [round, setRound] = useState('');
  const [credit, setCredit] = useState('');
  const [pay, setPay] = useState(initialPay);
  const [ful, setFul] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<AdminOrder | null>(null);
  const [cancelling, setCancelling] = useState<AdminOrder | null>(null);
  const editRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLDialogElement>(null);

  const fields = useMemo(() => (o: AdminOrder) => [o.customerName, o.customerEmail, o.orderNumber], []);
  const { q, setQ, visible: searched } = useTableSearch(orders, fields);
  const rows = searched.filter(
    (o) =>
      (!round || String(o.round) === round) &&
      (!credit || (credit === 'troop' ? o.creditedPersonId == null : String(o.creditedPersonId) === credit)) &&
      (!pay || (pay === 'cancelled' ? o.status === 'cancelled' : o.status === 'placed' && o.paymentStatus === pay)) &&
      (!ful || o.fulfillment === ful)
  );
  const filtered = !!(q || round || credit || pay || ful);

  return (
    <>
      <div className={styles.toolbar}>
        <SearchField value={q} onChange={setQ} label="Search orders" placeholder="Name, email, order number…" resultCount={rows.length} totalCount={orders.length} />
        <select aria-label="Round" value={round} onChange={(e) => setRound(e.target.value)}>
          <option value="">All rounds</option>
          <option value="1">Round 1</option>
          <option value="2">Round 2</option>
        </select>
        <select aria-label="Credited to" value={credit} onChange={(e) => setCredit(e.target.value)}>
          <option value="">Every seller</option>
          <option value="troop">Troop store</option>
          {sellers.map((s) => (
            <option key={s.personId} value={s.personId}>
              {s.name}
            </option>
          ))}
        </select>
        <select aria-label="Payment" value={pay} onChange={(e) => setPay(e.target.value)}>
          <option value="">Paid and unpaid</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Not paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select aria-label="Delivery" value={ful} onChange={(e) => setFul(e.target.value)}>
          <option value="">Every delivery</option>
          {Object.entries(FULFILLMENT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {filtered && (
          <Button
            variant="quiet"
            onClick={() => {
              setQ('');
              setRound('');
              setCredit('');
              setPay('');
              setFul('');
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Order</th>
              <th>Placed</th>
              <th>Customer</th>
              <th>Credited to</th>
              <th>Delivery</th>
              <th className={styles.numCell}>Total</th>
              <th>Payment</th>
              <th>Round</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  {orders.length === 0 ? 'No orders yet. They appear here as customers place them.' : 'No orders match these filters.'}
                </td>
              </tr>
            )}
            {rows.map((o) => {
              const isOpen = open === o.id;
              return (
                <Fragment key={o.id}>
                  <tr>
                    <td className={styles.nowrap}>
                      <button type="button" className={styles.link} aria-expanded={isOpen} aria-controls={`wo-${o.id}`} onClick={() => setOpen(isOpen ? null : o.id)}>
                        {o.orderNumber}
                      </button>
                    </td>
                    <td className={styles.nowrap}>{fmtDateTime(o.placedAt)}</td>
                    <td>
                      <span className={styles.badgeRow}>
                        {o.customerName}
                        {o.source === 'paper' && <Badge variant="info">Scout-entered</Badge>}
                      </span>
                      {o.orderNote && (
                        <span className={styles.noteExcerpt} title={o.orderNote}>
                          Note: {o.orderNote}
                        </span>
                      )}
                    </td>
                    <td>{o.creditedName}</td>
                    <td>
                      <span className={styles.badgeRow}>
                        {FULFILLMENT[o.fulfillment]}
                        {o.outsideAreaRelative && <Badge variant="info">Relative</Badge>}
                        {o.lines.some((l) => l.donated) && <Badge variant="info">Donated</Badge>}
                        {o.gift > 0 && <Badge variant="info">Donation</Badge>}
                      </span>
                    </td>
                    <td className={styles.numCell}>{fmtMoney2(o.total)}</td>
                    <td>
                      {o.status === 'cancelled' ? (
                        <Badge variant="muted">Cancelled</Badge>
                      ) : o.paymentStatus === 'paid' ? (
                        <Badge variant="success">{['Paid', paidPillText(o)].filter(Boolean).join(' · ')}</Badge>
                      ) : (
                        <span className={styles.badgeRow}>
                          <Badge variant="warning">Not paid</Badge>
                          {o.cardStarted && <Badge variant="info">Card not finished</Badge>}
                          {o.source === 'paper' && o.collectedByScout && <Badge variant="info">Collected by scout</Badge>}
                        </span>
                      )}
                    </td>
                    <td>{o.round}</td>
                  </tr>
                  {isOpen && (
                    <tr className={styles.detailRow} id={`wo-${o.id}`}>
                      <td colSpan={8}>
                        <OrderDetail
                          order={o}
                          history={history[o.id] ?? []}
                          sellers={sellers}
                          onEdit={() => {
                            setEditing(o);
                            requestAnimationFrame(() => editRef.current?.showModal());
                          }}
                          onCancel={() => {
                            setCancelling(o);
                            requestAnimationFrame(() => cancelRef.current?.showModal());
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog ref={editRef} className={styles.editDialog} onClose={() => setEditing(null)}>
        <DialogHeader title={editing ? `Edit ${editing.orderNumber}` : 'Edit order'} sub={editing?.customerName} />
        {editing && <EditOrderForm key={editing.id} order={editing} items={items} sellers={sellers} rules={rules} onClose={() => editRef.current?.close()} />}
      </Dialog>
      <Dialog ref={cancelRef} danger onClose={() => setCancelling(null)}>
        <DialogHeader title={cancelling ? `Cancel ${cancelling.orderNumber}?` : 'Cancel order'} />
        {cancelling && <CancelForm key={cancelling.id} order={cancelling} onClose={() => cancelRef.current?.close()} />}
      </Dialog>
    </>
  );
}

function OrderDetail({ order: o, history, sellers, onEdit, onCancel }: { order: AdminOrder; history: AuditEntry[]; sellers: SellerOption[]; onEdit: () => void; onCancel: () => void }) {
  const [method, setMethod] = useState<PaidMethod>('venmo');
  // Paid another way, an unpaid card-fee cover drops (markPaid), so the amount due is the total without it.
  const due = fromCents(toCents(o.total) - toCents(o.feeCovered));
  const [amount, setAmount] = useState(due.toFixed(2));
  const received = amount.trim() === '' ? Number.NaN : fromCents(toCents(Number(amount)));
  const short = Number.isFinite(received) && received > 0 && received < due ? fromCents(toCents(due) - toCents(received)) : 0;
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const live = o.status === 'placed';
  const address = [o.customerAddress, o.customerCity, o.customerZip].filter(Boolean).join(', ');

  function pay() {
    setError(null);
    start(async () => {
      const res = await markPaid(o.id, method, due > 0 ? received : undefined);
      if (!res.ok) setError({ text: res.error ?? 'Couldn’t mark it paid.', field: res.field });
    });
  }

  return (
    <div className={styles.detail}>
      <div>
        <h4>Items</h4>
        <ul className={styles.lineList}>
          {o.lines.map((l) => (
            <li key={`${l.catalogNumber}-${l.donated}`}>
              <span>
                {l.quantity} × {l.label} <span className={styles.muted}>(no. {l.catalogNumber})</span> {l.donated && <Badge variant="info">Donated</Badge>}
              </span>
              <span>{fmtMoney2(l.amount)}</span>
            </li>
          ))}
          {o.deliveryFee > 0 && (
            <li>
              <span>Delivery fee</span>
              <span>{fmtMoney2(o.deliveryFee)}</span>
            </li>
          )}
          {o.gift > 0 && (
            <li>
              <span>{DONATION_LABEL}</span>
              <span>{fmtMoney2(o.gift)}</span>
            </li>
          )}
          {o.feeCovered > 0 && (
            <li>
              <span>Processing fee</span>
              <span>{fmtMoney2(o.feeCovered)}</span>
            </li>
          )}
          <li>
            <strong>Total</strong>
            <strong>{fmtMoney2(o.total)}</strong>
          </li>
        </ul>
        <h4 className={styles.sectionGap}>Customer</h4>
        <dl>
          <dt>Name</dt>
          <dd>{o.customerName}</dd>
          <dt>Email</dt>
          <dd>{o.customerEmail || '—'}</dd>
          <dt>Phone</dt>
          <dd>{o.customerPhone || '—'}</dd>
          <dt>Address</dt>
          <dd>{address || '—'}</dd>
          <dt>Credited to</dt>
          <dd>{o.creditedName}</dd>
          <dt>Delivery</dt>
          <dd>
            {o.fulfillment === 'scout'
              ? `${FULFILLMENT.scout}: ${o.deliveringPersonId === o.creditedPersonId ? o.creditedName : (sellers.find((s) => s.personId === o.deliveringPersonId)?.name ?? 'another scout')}`
              : FULFILLMENT[o.fulfillment]}
            {o.outsideAreaRelative && ' (outside the area, a relative arranged it)'}
          </dd>
          <dt>Source</dt>
          <dd>
            {o.source === 'store' && o.creditedPersonId != null && o.deliveringPersonId == null
              ? 'Store, scout credited (not delivering)'
              : o.source === 'paper'
                ? `Scout-entered${o.enteredByName ? ` by ${o.enteredByName}` : ''}`
                : SOURCE[o.source]}
          </dd>
          {o.source === 'paper' && (
            <>
              <dt>Collected by scout</dt>
              <dd>{o.collectedByScout ? 'Yes' : 'Not yet'}</dd>
              {o.customerNote && (
                <>
                  <dt>Note</dt>
                  <dd>{o.customerNote}</dd>
                </>
              )}
            </>
          )}
        </dl>
      </div>
      <div>
        <h4>Payment</h4>
        {o.needsRefund && <RefundFlag order={o} />}
        {o.paymentStatus === 'refunded' ? (
          <p className={styles.muted}>
            Refunded {fmtMoney2(o.paidAmount ?? o.total)} to the card{o.refundedAt ? `, ${fmtDateTime(o.refundedAt)}` : ''}. This order is cancelled.
          </p>
        ) : o.status === 'cancelled' ? (
          <p className={styles.muted}>This order is cancelled.</p>
        ) : o.paymentStatus === 'paid' ? (
          <p>
            Paid {fmtMoney2(o.paidAmount ?? o.total)}
            {o.paidMethod ? ` by ${o.paidMethod}` : ''}
            {o.paidAt ? `, ${fmtDateTime(o.paidAt)}` : ''}.
            {o.paidMethod === 'card' && o.stripeFee != null && ` Stripe fee ${fmtMoney2(o.stripeFee)}.`}
            {acceptedShort(o) > 0 ? (
              <> Accepted {fmtMoney2(acceptedShort(o))} short of the {fmtMoney2(o.total)} total.</>
            ) : o.paidAmount != null && o.paidAmount !== o.total && (
              <>
                {' '}
                <strong>
                  Paid {fmtMoney2(o.paidAmount)}, total now {fmtMoney2(o.total)}
                </strong>
                {o.total > o.paidAmount ? `: ${fmtMoney2(o.total - o.paidAmount)} more is due.` : `: ${fmtMoney2(o.paidAmount - o.total)} is owed back.`}
              </>
            )}
          </p>
        ) : (
          <div className={styles.actionRow}>
            <select aria-label={`How ${o.orderNumber} was paid`} value={method} onChange={(e) => setMethod(e.target.value as PaidMethod)}>
              {PAID_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m === 'paypal' ? 'PayPal' : m.charAt(0).toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
            {due > 0 && (
              <label className={styles.amountLabel}>
                Amount received
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  className={`${styles.amountBox}${error?.field === 'amount' ? ` ${styles.bad}` : ''}`}
                  aria-invalid={error?.field === 'amount' || undefined}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            )}
            <Button variant="secondary" disabled={pending} onClick={pay}>
              {pending ? 'Marking…' : `Mark ${fmtMoney2(Number.isFinite(received) ? received : due)} paid`}
            </Button>
            {short > 0 && <span className={styles.muted}>{fmtMoney2(short)} short. The order still counts as paid.</span>}
          </div>
        )}
        {error && <p className={styles.badNote}>{error.text}</p>}
        {o.source === 'paper' && <PaymentNote key={`${o.id}-${o.paymentNote}`} order={o} />}
        <OrderNote key={`${o.id}-${o.orderNote}`} order={o} />
        {live && (
          <div className={styles.actionRow}>
            <Button variant="quiet" onClick={onEdit}>
              Edit order…
            </Button>
            <Button variant="quiet" onClick={onCancel}>
              Cancel order…
            </Button>
          </div>
        )}
        <h4 className={styles.sectionGap}>Changes</h4>
        {history.length === 0 ? (
          <p className={styles.muted}>No changes since it was placed.</p>
        ) : (
          <ul className={styles.history}>
            {history.map((h) => (
              <li key={h.id}>
                <strong>{h.summary}</strong> · {h.actor} · {fmtDateTime(h.occurredAt)}
                {h.changes.map((c) => (
                  <div key={c.field}>
                    {c.field}: {c.from} → {c.to}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A card payment that landed where it shouldn't (cancelled order, paid another way, wrong amount): the reason and
 *  the one action that fixes it. The order's own payment is untouched by this refund. */
function RefundFlag({ order: o }: { order: AdminOrder }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.badNote}>
      <p>{o.needsRefund}</p>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await refundCardOrder(o.id);
            if (!res.ok) setError(res.error ?? 'Couldn’t refund it.');
          })
        }
      >
        {pending ? 'Refunding…' : 'Refund the card payment'}
      </Button>
      {error && <p>{error}</p>}
    </div>
  );
}

/** The payment note on a scout-entered order: the scout types one, the treasurer may change it. Dirty-gated Save. */
function PaymentNote({ order: o }: { order: AdminOrder }) {
  const [note, setNote] = useState(o.paymentNote);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { dirty } = useSavedSnapshot(note);
  function save() {
    setProblem(null);
    start(async () => {
      const res = await setPaymentNote(o.id, note);
      if (!res.ok) setProblem(res.error ?? 'Couldn’t save the note.');
    });
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className={`${styles.field} ${problem ? styles.bad : ''}`}>
        <label htmlFor={`pn-${o.id}`}>Payment note</label>
        <input id={`pn-${o.id}`} type="text" autoComplete="off" maxLength={200} aria-invalid={problem ? true : undefined} value={note} onChange={(e) => setNote(e.target.value)} />
        {problem && <p className={styles.badNote}>{problem}</p>}
      </div>
      <div className={styles.actionRow}>
        <SaveButton dirty={dirty} pending={pending} onClick={save} />
      </div>
    </form>
  );
}

/**
 * The troop-only order note (W-1): the treasurer and the credited scout's family share one note, last edit wins. Any
 * order, paid or not, card included (it never touches the money). Dirty-gated Save + Discard changes.
 */
function OrderNote({ order: o }: { order: AdminOrder }) {
  const [note, setNote] = useState(o.orderNote);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { dirty, saved } = useDraftSnapshot(note);
  const tooLong = note.trim().length > ORDER_NOTE_MAX;
  function save() {
    setProblem(null);
    if (tooLong) {
      setProblem(`A note is ${ORDER_NOTE_MAX} characters at most.`);
      return;
    }
    start(async () => {
      const res = await setOrderNote(o.id, note);
      if (!res.ok) setProblem(res.error ?? 'Couldn’t save the note.');
    });
  }
  const stamp = o.orderNote ? noteStamp(o.orderNoteBy, o.orderNoteAt) : '';
  return (
    <form
      noValidate
      className={styles.sectionGapSm}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className={`${styles.field} ${problem ? styles.bad : ''}`}>
        <label htmlFor={`on-${o.id}`}>Order note</label>
        <textarea id={`on-${o.id}`} autoComplete="off" maxLength={ORDER_NOTE_MAX} aria-invalid={problem ? true : undefined} aria-describedby={`on-${o.id}-hint`} value={note} onChange={(e) => setNote(e.target.value)} />
        <p id={`on-${o.id}-hint`} className={styles.hint}>
          {stamp ? `${stamp}. ` : ''}The scout’s family sees it too; the customer never does.
        </p>
        {problem && <p className={styles.badNote}>{problem}</p>}
      </div>
      <div className={styles.actionRow}>
        <SaveButton dirty={dirty} pending={pending} onClick={save} />
        <DiscardButton
          dirty={dirty}
          pending={pending}
          onClick={() => {
            setNote(saved);
            setProblem(null);
          }}
        />
      </div>
    </form>
  );
}

function CancelForm({ order: o, onClose }: { order: AdminOrder; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const byCard = o.paymentStatus === 'paid' && o.paidMethod === 'card';
  if (byCard) {
    const amount = fmtMoney2(o.paidAmount ?? o.total);
    return (
      <>
        <DialogBody>
          <p>
            {o.orderNumber} for {o.customerName} was paid by card. Cancelling refunds {amount} to the card through Stripe, and the
            order will no longer count in the books or the Rose order. Stripe keeps its fee.
          </p>
          {error && <p className={styles.badNote}>{error}</p>}
        </DialogBody>
        <DialogActions>
          <Button
            variant="dangerSolid"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await refundCardOrder(o.id);
                if (res.ok) onClose();
                else setError(res.error ?? 'Couldn’t refund the order.');
              })
            }
          >
            {pending ? 'Refunding…' : `Refund ${amount} and cancel`}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
        </DialogActions>
      </>
    );
  }
  return (
    <>
      <DialogBody>
        <p>
          {o.orderNumber} for {o.customerName} ({fmtMoney2(o.total)}) will no longer count in the books or the Rose order.
          {o.paymentStatus === 'paid' ? ' It is marked paid, so its payment stays in the finance ledger: return the money by hand (Venmo or PayPal) and record the refund in Finance.' : ''}
        </p>
        {error && <p className={styles.badNote}>{error}</p>}
      </DialogBody>
      <DialogActions>
        <Button
          variant="dangerSolid"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await cancelOrder(o.id);
              if (res.ok) onClose();
              else setError(res.error ?? 'Couldn’t cancel the order.');
            })
          }
        >
          {pending ? 'Cancelling…' : 'Cancel this order'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Keep it
        </Button>
      </DialogActions>
    </>
  );
}

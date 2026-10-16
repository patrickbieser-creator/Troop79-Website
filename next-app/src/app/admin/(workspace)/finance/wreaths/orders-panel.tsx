'use client';

/**
 * Wreath sale › Orders: every order, filterable, with the treasurer's two jobs — Mark paid (Release A: customers pay
 * the treasurer by Venmo or PayPal) and Reassign (credit and delivery, scout ↔ scout or scout ↔ troop). An order opens
 * in place: items, the customer's contact, the audited changes. Customer contact is shown here and nowhere public.
 * A small, already-fetched list, so the search and filters run on the client (useTableSearch).
 */

import { Fragment, useMemo, useRef, useState, useTransition } from 'react';
import { Button } from '../../../_components/button';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { Badge } from '../../_components/badge';
import { SaveButton, SaveProblem, useSavedSnapshot } from '../../_components/save-state';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { fmtDateTime } from '@/lib/format-date';
import { FULFILLMENT_LABEL, PAID_METHODS, SOURCE_LABEL, fmtMoney2, inDeliveryArea, zipPrefixText, type PaidMethod } from '@/lib/wreaths/rules';
import type { AdminOrder, AuditEntry } from '@/lib/wreaths/admin-data';
import { cancelOrder, markPaid, reassignOrder, refundCardOrder, setPaymentNote } from './actions';
import styles from './wreaths.module.css';

export interface SellerOption {
  personId: number;
  name: string;
}

const FULFILLMENT = FULFILLMENT_LABEL;
const SOURCE = SOURCE_LABEL;

export function OrdersPanel({ orders, history, sellers, deliveryZipPrefix, initialPay = '' }: { orders: AdminOrder[]; history: Record<number, AuditEntry[]>; sellers: SellerOption[]; deliveryZipPrefix: string; initialPay?: string }) {
  const [round, setRound] = useState('');
  const [credit, setCredit] = useState('');
  const [pay, setPay] = useState(initialPay);
  const [ful, setFul] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [reassigning, setReassigning] = useState<AdminOrder | null>(null);
  const [cancelling, setCancelling] = useState<AdminOrder | null>(null);
  const reassignRef = useRef<HTMLDialogElement>(null);
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
                    </td>
                    <td>{o.creditedName}</td>
                    <td>
                      <span className={styles.badgeRow}>
                        {FULFILLMENT[o.fulfillment]}
                        {o.outsideAreaRelative && <Badge variant="info">Relative</Badge>}
                        {o.lines.some((l) => l.donated) && <Badge variant="info">Donated</Badge>}
                      </span>
                    </td>
                    <td className={styles.numCell}>{fmtMoney2(o.total)}</td>
                    <td>
                      {o.status === 'cancelled' ? (
                        <Badge variant="muted">Cancelled</Badge>
                      ) : o.paymentStatus === 'paid' ? (
                        <Badge variant="success">Paid{o.paidMethod ? ` · ${o.paidMethod}` : ''}</Badge>
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
                          onReassign={() => {
                            setReassigning(o);
                            requestAnimationFrame(() => reassignRef.current?.showModal());
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

      <Dialog ref={reassignRef} onClose={() => setReassigning(null)}>
        <DialogHeader title={reassigning ? `Reassign ${reassigning.orderNumber}` : 'Reassign'} sub="Credit and delivery" />
        {reassigning && <ReassignForm key={reassigning.id} order={reassigning} sellers={sellers} deliveryZipPrefix={deliveryZipPrefix} onClose={() => reassignRef.current?.close()} />}
      </Dialog>
      <Dialog ref={cancelRef} danger onClose={() => setCancelling(null)}>
        <DialogHeader title={cancelling ? `Cancel ${cancelling.orderNumber}?` : 'Cancel order'} />
        {cancelling && <CancelForm key={cancelling.id} order={cancelling} onClose={() => cancelRef.current?.close()} />}
      </Dialog>
    </>
  );
}

function OrderDetail({ order: o, history, onReassign, onCancel }: { order: AdminOrder; history: AuditEntry[]; onReassign: () => void; onCancel: () => void }) {
  const [method, setMethod] = useState<PaidMethod>('venmo');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const live = o.status === 'placed';
  const address = [o.customerAddress, o.customerCity, o.customerZip].filter(Boolean).join(', ');

  function pay() {
    setError(null);
    start(async () => {
      const res = await markPaid(o.id, method);
      if (!res.ok) setError(res.error ?? 'Couldn’t mark it paid.');
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
              <span>Gift to Troop 79</span>
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
            {o.paidAmount != null && o.paidAmount !== o.total && (
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
            <Button variant="secondary" disabled={pending} onClick={pay}>
              {pending ? 'Marking…' : `Mark ${fmtMoney2(o.total)} paid`}
            </Button>
          </div>
        )}
        {error && <p className={styles.badNote}>{error}</p>}
        {o.source === 'paper' && <PaymentNote key={`${o.id}-${o.paymentNote}`} order={o} />}
        {live && (
          <div className={styles.actionRow}>
            <Button variant="quiet" onClick={onReassign}>
              Reassign…
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

function ReassignForm({ order: o, sellers, deliveryZipPrefix, onClose }: { order: AdminOrder; sellers: SellerOption[]; deliveryZipPrefix: string; onClose: () => void }) {
  const [credit, setCredit] = useState(o.creditedPersonId == null ? '' : String(o.creditedPersonId));
  const [fulfillment, setFulfillment] = useState<'scout' | 'pickup' | 'delivery'>(o.fulfillment === 'none' ? 'pickup' : o.fulfillment);
  const [street, setStreet] = useState(o.customerAddress);
  const [city, setCity] = useState(o.customerCity);
  const [zip, setZip] = useState(o.customerZip);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const donatedOnly = o.fulfillment === 'none';
  // A scout can deliver only the order credited to them; a troop order handed to a scout takes their credit too.
  const effective = !credit && fulfillment === 'scout' ? 'pickup' : fulfillment;
  const { dirty } = useSavedSnapshot(JSON.stringify({ credit, effective, street, city, zip }));
  const needsAddress = !donatedOnly && (effective === 'scout' || effective === 'delivery');

  const p: Record<string, string> = {};
  if (tried && needsAddress) {
    if (!street.trim()) p.street = 'Enter the street address for delivery.';
    if (!city.trim()) p.city = 'Enter the city.';
    if (!/^\d{5}$/.test(zip.trim())) p.zip = 'Enter the 5-digit zip.';
    else if (effective === 'delivery' && !inDeliveryArea({ deliveryZipPrefix }, zip.trim())) p.zip = `Troop delivery covers zips starting with ${zipPrefixText(deliveryZipPrefix)}.`;
  }
  const keys = Object.keys(p);
  const problemFor = (k: string) => p[k] ?? (problem?.field === k ? problem.message : undefined);
  const cls = (k: string) => `${styles.field} ${problemFor(k) ? styles.bad : ''}`;

  function save() {
    setTried(true);
    setProblem(null);
    if (needsAddress && (!street.trim() || !city.trim() || !/^\d{5}$/.test(zip.trim()))) return;
    if (effective === 'delivery' && needsAddress && !inDeliveryArea({ deliveryZipPrefix }, zip.trim())) return;
    start(async () => {
      const res = await reassignOrder(o.id, {
        creditedPersonId: credit ? Number(credit) : null,
        fulfillment: effective,
        street: needsAddress ? street : undefined,
        city: needsAddress ? city : undefined,
        zip: needsAddress ? zip : undefined
      });
      if (res.ok) onClose();
      else setProblem({ field: res.field, message: res.error ?? 'Couldn’t reassign the order.' });
    });
  }

  const scoutName = sellers.find((s) => String(s.personId) === credit)?.name;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <DialogBody>
        <div className={styles.dialogBody}>
          <div className={cls('creditedPersonId')}>
            <label htmlFor="wr-credit">Credit to</label>
            <select id="wr-credit" value={credit} onChange={(e) => setCredit(e.target.value)}>
              <option value="">Troop store</option>
              {sellers.map((s) => (
                <option key={s.personId} value={s.personId}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className={styles.hint}>A scout who volunteers to deliver a troop order can be given its credit, and 30% of its profit. Money already collected stays with the troop.</p>
          </div>
          {donatedOnly ? (
            <p className={styles.hint}>Donated wreaths only: nothing to deliver, so only the credit changes.</p>
          ) : (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Delivered by</span>
              <label className={styles.check}>
                <input type="radio" name="wr-ful" checked={effective === 'scout'} disabled={!credit} onChange={() => setFulfillment('scout')} />
                {scoutName ? `${scoutName} delivers` : 'A scout delivers (credit a scout first)'}
              </label>
              <label className={styles.check}>
                <input type="radio" name="wr-ful" checked={effective === 'pickup'} onChange={() => setFulfillment('pickup')} />
                Pickup at distribution
              </label>
              <label className={styles.check}>
                <input type="radio" name="wr-ful" checked={effective === 'delivery'} onChange={() => setFulfillment('delivery')} />
                Troop delivery ({deliveryZipPrefix} zips)
              </label>
            </div>
          )}
          {needsAddress && (
            <div className={styles.grid2}>
              <div className={`${cls('street')} ${styles.span2}`}>
                <label htmlFor="wr-street">Street address</label>
                <input id="wr-street" type="text" aria-invalid={problemFor('street') ? true : undefined} value={street} onChange={(e) => setStreet(e.target.value)} />
                {problemFor('street') && <p className={styles.badNote}>{problemFor('street')}</p>}
              </div>
              <div className={cls('city')}>
                <label htmlFor="wr-city">City</label>
                <input id="wr-city" type="text" aria-invalid={problemFor('city') ? true : undefined} value={city} onChange={(e) => setCity(e.target.value)} />
                {problemFor('city') && <p className={styles.badNote}>{problemFor('city')}</p>}
              </div>
              <div className={cls('zip')}>
                <label htmlFor="wr-zip">Zip</label>
                <input id="wr-zip" type="text" inputMode="numeric" maxLength={5} aria-invalid={problemFor('zip') ? true : undefined} value={zip} onChange={(e) => setZip(e.target.value)} />
                {problemFor('zip') && <p className={styles.badNote}>{problemFor('zip')}</p>}
              </div>
            </div>
          )}
        </div>
      </DialogBody>
      <DialogActions>
        <SaveButton dirty={dirty} pending={pending} blocked={keys.length > 0} onBlocked={save} onClick={save} />
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {keys.length > 0 && <SaveProblem reason={p[keys[0]]} more={keys.length - 1} />}
        {keys.length === 0 && problem && <SaveProblem reason={problem.message} />}
      </DialogActions>
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

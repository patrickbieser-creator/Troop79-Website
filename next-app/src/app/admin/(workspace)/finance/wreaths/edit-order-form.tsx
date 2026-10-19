'use client';

/**
 * Orders › Edit order: the treasurer's full edit of one order (Patrick, 2026-10-18 — a customer ordered the wrong item,
 * then paid by Venmo for a different one). Items, gift, contact, credit and delivery (what Reassign used to do), and on
 * an order paid by hand, the payment itself. The totals here are a preview from the same repriceEdit the server runs;
 * the server decides. Numbered sections in a Dialog; Cancel is discard.
 */

import { useState, useTransition } from 'react';
import { Button } from '../../../_components/button';
import { FormSection } from '../../../_components/form-panel';
import { DialogActions, DialogBody } from '../../_components/dialog';
import { SaveButton, SaveProblem, useSavedSnapshot } from '../../_components/save-state';
import { fmtDay } from '@/lib/format-date';
import { EMAIL_RE, PAID_METHODS, fmtMoney2, fromCents, inDeliveryArea, itemLabel, phoneOk, repriceEdit, toCents, zipPrefixText, type PaidMethod, type SaleRules } from '@/lib/wreaths/rules';
import type { AdminItem, AdminOrder } from '@/lib/wreaths/admin-data';
import { editOrder } from './actions';
import type { SellerOption } from './orders-panel';
import styles from './wreaths.module.css';

interface DraftLine {
  key: number;
  itemId: string;
  quantity: string;
  donated: boolean;
}

const METHOD_WORD = (m: string) => (m === 'paypal' ? 'PayPal' : m.charAt(0).toUpperCase() + m.slice(1));

export function EditOrderForm({ order: o, items, sellers, rules, onClose }: { order: AdminOrder; items: AdminItem[]; sellers: SellerOption[]; rules: SaleRules; onClose: () => void }) {
  const [lines, setLines] = useState<DraftLine[]>(() => o.lines.map((l, i) => ({ key: i, itemId: String(l.itemId), quantity: String(l.quantity), donated: l.donated })));
  const [nextKey, setNextKey] = useState(o.lines.length);
  const [gift, setGift] = useState(o.gift ? o.gift.toFixed(2) : '');
  const [name, setName] = useState(o.customerName);
  const [email, setEmail] = useState(o.customerEmail);
  const [phone, setPhone] = useState(o.customerPhone);
  const [street, setStreet] = useState(o.customerAddress);
  const [city, setCity] = useState(o.customerCity);
  const [zip, setZip] = useState(o.customerZip);
  const [credit, setCredit] = useState(o.creditedPersonId == null ? '' : String(o.creditedPersonId));
  const [fulfillment, setFulfillment] = useState<'scout' | 'pickup' | 'delivery'>(o.fulfillment === 'none' ? 'pickup' : o.fulfillment);
  const byCard = o.paymentStatus === 'paid' && o.paidMethod === 'card';
  const byHand = o.paymentStatus === 'paid' && !byCard;
  const [method, setMethod] = useState<PaidMethod>((PAID_METHODS as readonly string[]).includes(o.paidMethod ?? '') ? (o.paidMethod as PaidMethod) : 'venmo');
  const [received, setReceived] = useState((o.paidAmount ?? o.total).toFixed(2));
  const [acceptShort, setAcceptShort] = useState(o.paidAmount != null && o.paidAmount < o.total);
  const [notify, setNotify] = useState(false);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  // Credit and delivery: a scout delivers only an order credited to them (Reassign's rule).
  const effective = !credit && fulfillment === 'scout' ? 'pickup' : fulfillment;
  const parsed = lines.map((l) => ({ itemId: Number(l.itemId), quantity: Number(l.quantity), donated: l.donated }));
  const allDonated = parsed.length > 0 && parsed.every((l) => l.donated);
  const giftN = gift.trim() === '' ? 0 : Number(gift);
  // A donation with no wreath (W-3): nothing to deliver.
  const nothingToDeliver = allDonated || parsed.length === 0;
  const preview = repriceEdit(
    rules,
    items.map((i) => ({ id: i.id, catalogNumber: i.catalogNumber, price: i.price, unitCost: i.unitCost, active: i.active, donatable: i.donatable })),
    o.lines.map((l) => ({ itemId: l.itemId, donated: l.donated, unitPrice: l.unitPrice, unitCost: l.unitCost })),
    parsed,
    { fulfillment: nothingToDeliver ? 'none' : effective, gift: giftN, coverFee: o.paymentStatus === 'unpaid' && o.feeCovered > 0, allowDonationOnly: true }
  );
  const total = preview.ok ? preview.order.total : null;
  const receivedN = received.trim() === '' ? Number.NaN : fromCents(toCents(Number(received)));
  const diffCents = total != null && Number.isFinite(receivedN) ? toCents(receivedN) - toCents(total) : 0;
  const needsAddress = !nothingToDeliver && (effective === 'scout' || effective === 'delivery');

  const draftKey = JSON.stringify({ lines: lines.map(({ itemId, quantity, donated }) => [itemId, quantity, donated]), gift, name, email, phone, street, city, zip, credit, effective, method, received, acceptShort });
  const { dirty } = useSavedSnapshot(draftKey);

  // Every problem with the draft; shown once a save has been tried (blocked Save stays enabled and says why).
  const all: Record<string, string> = {};
  if (lines.length === 0 && !(giftN > 0)) all.lines = 'An order needs at least one item or a donation. To drop them all, cancel the order instead.';
  else if (parsed.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 50)) all.lines = 'Each quantity is 1 to 50.';
  else if (byCard && total != null && toCents(total) !== toCents(o.total)) all.lines = 'Paid by card: the total has to stay the same.';
  if (!Number.isFinite(giftN) || giftN < 0 || giftN > 500) all.gift = 'A donation is $0 to $500.';
  else if (byCard && toCents(giftN) !== toCents(o.gift)) all.gift = 'Paid by card: the donation has to stay the same.';
  if (!name.trim()) all.name = 'Enter the customer’s name.';
  if (email.trim() && !EMAIL_RE.test(email.trim())) all.email = 'That email address doesn’t look right.';
  if (phone.trim() && !phoneOk(phone)) all.phone = 'Enter a 10-digit phone number.';
  if (needsAddress) {
    if (!street.trim()) all.street = 'Enter the street address for delivery.';
    if (!city.trim()) all.city = 'Enter the city.';
    if (!/^\d{5}$/.test(zip.trim())) all.zip = 'Enter the 5-digit zip.';
    else if (effective === 'delivery' && !inDeliveryArea(rules, zip.trim())) all.zip = `Troop delivery covers zips starting with ${zipPrefixText(rules.deliveryZipPrefix)}.`;
  }
  if (byHand) {
    if (!(receivedN > 0)) all.received = 'Enter the amount that came in.';
    else if (diffCents < 0 && !acceptShort) all.received = `${fmtMoney2(fromCents(-diffCents))} short of the new total. Accept the shortfall, or change the items.`;
  }
  const p: Record<string, string> = tried ? all : {};
  const keys = Object.keys(p);
  const problemFor = (k: string) => p[k] ?? (problem?.field === k ? problem.message : undefined);
  const cls = (k: string) => `${styles.field} ${problemFor(k) ? styles.bad : ''}`;
  const note = (k: string) => problemFor(k) && <p className={styles.badNote}>{problemFor(k)}</p>;

  function save() {
    setTried(true);
    setProblem(null);
    if (Object.keys(all).length) return;
    start(async () => {
      const res = await editOrder(o.id, {
        seen: { total: o.total, paymentStatus: o.paymentStatus },
        lines: parsed,
        gift: giftN,
        customer: { name, email, phone, street, city, zip },
        creditedPersonId: credit ? Number(credit) : null,
        fulfillment: effective,
        deliveringPersonId: effective === 'scout' ? Number(credit) : null,
        ...(byHand ? { payment: { method, received: receivedN, acceptShort: diffCents < 0 && acceptShort } } : {}),
        notifyCustomer: notify
      });
      if (res.ok) onClose();
      else setProblem({ field: res.field, message: res.error ?? 'Couldn’t save the order.' });
    });
  }

  const setLine = (key: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const cutoff = o.round === 1 ? rules.round1Cutoff : rules.round2Cutoff;
  const [roundClosed] = useState(() => Date.parse(cutoff) < Date.now());
  const scoutName = sellers.find((s) => String(s.personId) === credit)?.name;
  // A seller retired after the order still shows as its credit.
  const creditOptions = o.creditedPersonId != null && !sellers.some((s) => s.personId === o.creditedPersonId) ? [...sellers, { personId: o.creditedPersonId, name: o.creditedName }] : sellers;
  let sectionNum = 0;
  const num = () => ++sectionNum;

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
          <FormSection num={num()} title="Items">
            {roundClosed && <p className={styles.hint}>Round {o.round}’s order to Rose closed {fmtDay(cutoff)}. If the items change, tell Rose.</p>}
            {byCard && <p className={styles.hint}>Paid by card, so the total has to stay the same. To change it, refund the order and place a new one.</p>}
            <ul className={`${styles.editLines} ${problemFor('lines') ? styles.bad : ''}`}>
              {lines.map((l) => {
                const it = itemById.get(Number(l.itemId));
                return (
                  <li key={l.key}>
                    <select aria-label="Item" value={l.itemId} onChange={(e) => setLine(l.key, { itemId: e.target.value, donated: l.donated && !!itemById.get(Number(e.target.value))?.donatable })}>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.catalogNumber}. {itemLabel(i)} · {fmtMoney2(i.price)}
                          {i.active ? '' : ' (not on sale)'}
                        </option>
                      ))}
                    </select>
                    <input type="number" aria-label="Quantity" inputMode="numeric" min={1} max={50} step={1} className={styles.qtyBox} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                    {it?.donatable ? (
                      <label className={styles.checkInline}>
                        <input type="checkbox" checked={l.donated} onChange={(e) => setLine(l.key, { donated: e.target.checked })} />
                        Donated
                      </label>
                    ) : (
                      <span />
                    )}
                    <Button variant="quiet" size="sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove ${it ? itemLabel(it) : 'item'}`}>
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
            {note('lines')}
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setLines((ls) => [...ls, { key: nextKey, itemId: String(items.find((i) => i.active)?.id ?? items[0]?.id ?? ''), quantity: '1', donated: false }]);
                setNextKey((k) => k + 1);
              }}
            >
              + Item
            </Button>
            <div className={`${cls('gift')} ${styles.sectionGapSm}`}>
              <label htmlFor="we-gift">Donation to Troop 79</label>
              <input id="we-gift" type="number" inputMode="decimal" min="0" step="0.01" className={styles.amountBox} aria-invalid={problemFor('gift') ? true : undefined} value={gift} onChange={(e) => setGift(e.target.value)} />
              {note('gift')}
            </div>
            <dl className={styles.moneyList}>
              {preview.ok && preview.order.deliveryFee > 0 && (
                <>
                  <dt>Delivery fee</dt>
                  <dd>{fmtMoney2(preview.order.deliveryFee)}</dd>
                </>
              )}
              {preview.ok && preview.order.feeCovered > 0 && (
                <>
                  <dt>Processing fee</dt>
                  <dd>{fmtMoney2(preview.order.feeCovered)}</dd>
                </>
              )}
              <dt>
                <strong>Total</strong>
              </dt>
              <dd>
                <strong>{total == null ? '—' : fmtMoney2(total)}</strong>
                {total != null && toCents(total) !== toCents(o.total) && <span className={styles.muted}> (was {fmtMoney2(o.total)})</span>}
              </dd>
            </dl>
          </FormSection>

          {byHand && (
            <FormSection num={num()} title="Payment">
              <div className={styles.grid2}>
                <div className={cls('received')}>
                  <label htmlFor="we-received">Amount received</label>
                  <input id="we-received" type="number" inputMode="decimal" min="0.01" step="0.01" aria-invalid={problemFor('received') ? true : undefined} value={received} onChange={(e) => setReceived(e.target.value)} />
                  {note('received')}
                </div>
                <div className={styles.field}>
                  <label htmlFor="we-method">Paid by</label>
                  <select id="we-method" value={method} onChange={(e) => setMethod(e.target.value as PaidMethod)}>
                    {PAID_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {METHOD_WORD(m)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {total != null && diffCents < 0 && (
                <label className={styles.check}>
                  <input type="checkbox" checked={acceptShort} onChange={(e) => setAcceptShort(e.target.checked)} />
                  Accept {fmtMoney2(fromCents(-diffCents))} short. The order still counts as paid.
                </label>
              )}
              {total != null && diffCents > 0 && (
                <div className={styles.actionRow}>
                  <span>
                    {fmtMoney2(fromCents(diffCents))} more than the total came in. It is owed back unless it counts as a gift.
                  </span>
                  <Button variant="quiet" size="sm" onClick={() => setGift(fromCents(toCents(Number.isFinite(giftN) ? giftN : 0) + diffCents).toFixed(2))}>
                    Count the extra as a gift
                  </Button>
                </div>
              )}
              {(toCents(receivedN) !== toCents(o.paidAmount ?? o.total) || method !== o.paidMethod) && (
                <p className={styles.hint}>Saving voids the order’s finance ledger line and books {Number.isFinite(receivedN) ? fmtMoney2(receivedN) : 'the new amount'} by {METHOD_WORD(method)} in its place, on the same day.</p>
              )}
            </FormSection>
          )}

          <FormSection num={num()} title="Customer">
            <div className={styles.grid2}>
              <div className={`${cls('name')} ${styles.span2}`}>
                <label htmlFor="we-name">Name</label>
                <input id="we-name" type="text" maxLength={120} aria-invalid={problemFor('name') ? true : undefined} value={name} onChange={(e) => setName(e.target.value)} />
                {note('name')}
              </div>
              <div className={cls('email')}>
                <label htmlFor="we-email">Email</label>
                <input id="we-email" type="email" aria-invalid={problemFor('email') ? true : undefined} value={email} onChange={(e) => setEmail(e.target.value)} />
                {note('email')}
              </div>
              <div className={cls('phone')}>
                <label htmlFor="we-phone">Phone</label>
                <input id="we-phone" type="text" inputMode="tel" aria-invalid={problemFor('phone') ? true : undefined} value={phone} onChange={(e) => setPhone(e.target.value)} />
                {note('phone')}
              </div>
            </div>
          </FormSection>

          <FormSection num={num()} title="Credit and delivery">
            <div className={cls('creditedPersonId')}>
              <label htmlFor="we-credit">Credit to</label>
              <select id="we-credit" value={credit} onChange={(e) => setCredit(e.target.value)}>
                <option value="">Troop store</option>
                {creditOptions.map((s) => (
                  <option key={s.personId} value={s.personId}>
                    {s.name}
                  </option>
                ))}
              </select>
              {note('creditedPersonId')}
            </div>
            {allDonated ? (
              <p className={styles.hint}>Donated wreaths only: nothing to deliver.</p>
            ) : (
              <div className={cls('fulfillment')}>
                <span className={styles.fieldLabel}>Delivered by</span>
                <label className={styles.check}>
                  <input type="radio" name="we-ful" checked={effective === 'scout'} disabled={!credit} onChange={() => setFulfillment('scout')} />
                  {scoutName ? `${scoutName} delivers` : 'A scout delivers (credit a scout first)'}
                </label>
                <label className={styles.check}>
                  <input type="radio" name="we-ful" checked={effective === 'pickup'} onChange={() => setFulfillment('pickup')} />
                  Pickup at distribution
                </label>
                <label className={styles.check}>
                  <input type="radio" name="we-ful" checked={effective === 'delivery'} onChange={() => setFulfillment('delivery')} />
                  Troop delivery ({zipPrefixText(rules.deliveryZipPrefix)} zips)
                </label>
                {note('deliveringPersonId')}
              </div>
            )}
            <div className={styles.grid2}>
              <div className={`${cls('street')} ${styles.span2}`}>
                <label htmlFor="we-street">Street address{needsAddress ? '' : ' (optional)'}</label>
                <input id="we-street" type="text" aria-invalid={problemFor('street') ? true : undefined} value={street} onChange={(e) => setStreet(e.target.value)} />
                {note('street')}
              </div>
              <div className={cls('city')}>
                <label htmlFor="we-city">City</label>
                <input id="we-city" type="text" aria-invalid={problemFor('city') ? true : undefined} value={city} onChange={(e) => setCity(e.target.value)} />
                {note('city')}
              </div>
              <div className={cls('zip')}>
                <label htmlFor="we-zip">Zip</label>
                <input id="we-zip" type="text" inputMode="numeric" maxLength={5} aria-invalid={problemFor('zip') ? true : undefined} value={zip} onChange={(e) => setZip(e.target.value)} />
                {note('zip')}
              </div>
            </div>
          </FormSection>

          {o.source !== 'paper' && (
            <label className={styles.check}>
              <input type="checkbox" checked={notify} disabled={!email.trim()} onChange={(e) => setNotify(e.target.checked)} />
              Email the customer the updated order{email.trim() ? '' : ' (no email on file)'}
            </label>
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

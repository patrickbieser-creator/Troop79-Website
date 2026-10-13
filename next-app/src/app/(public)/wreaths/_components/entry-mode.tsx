'use client';

/**
 * "Order for someone I know" (Plans/Wreath-Scout-Entered-Orders.md): on a scout's own page, a signed-in scout or a parent
 * in the scout's household can turn the cart into a short customer form and enter an order they will collect the money
 * for. The page only OFFERS the mode (lib/wreaths/scout-entry entryOffered, decided on the server); the order action
 * re-derives the viewer from the session and refuses anyone else, so nothing here is authority. No address, no
 * delivery, no card fee, no payment instructions, and the customer is never emailed.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { Field, SaveProblem, TextArea, TextInput } from '@/app/_components/form';
import { MAX_GIFT, fmtMoney, fmtMoney2, itemLabel } from '@/lib/wreaths/rules';
import type { StoreItem } from '@/lib/wreaths/public';
import type { OrderField, PlaceOrderResult } from '@/lib/wreaths/place-order';
import styles from '../wreaths.module.css';

export interface EntryConfig {
  /** The signed-in server action (placeScoutOrderAction). */
  action: (raw: unknown) => Promise<PlaceOrderResult>;
  /** Open with the mode on (the Members page's "+ Order for someone I know" link). */
  initialOn: boolean;
}

interface EntryState {
  on: boolean;
  setOn: (v: boolean) => void;
}
const EntryContext = createContext<EntryState | null>(null);
export const EntryProvider = EntryContext.Provider;
/** Null on the public page: no provider, no switch. */
export const useEntryMode = () => useContext(EntryContext);

/** The calm switch that sits under the heading. Renders nothing unless the page offered the mode. */
export function EntrySwitch() {
  const entry = useEntryMode();
  if (!entry) return null;
  return (
    <div className={styles.switchRow}>
      <button type="button" role="switch" aria-checked={entry.on} className={styles.switchBtn} onClick={() => entry.setOn(!entry.on)}>
        <span className={styles.switchTrack} aria-hidden="true">
          <span className={styles.switchKnob} />
        </span>
        <span>Order for someone I know — I’ll collect the money</span>
      </button>
    </div>
  );
}

export interface EntryLine {
  key: string;
  qty: number;
  donated: boolean;
  itemId: number;
  item: StoreItem;
}

interface Done {
  orderNumber: string;
  customer: string;
  lines: { label: string; qty: number; donated: boolean; amount: number }[];
  gift: number;
  total: number;
  collected: boolean;
  paymentNote: string;
  confirmedTo: string[];
}

/** The cart column in entry mode: the cart, the customer form, and the confirmation. */
export function EntryAside({
  scout,
  lines,
  itemsTotal,
  action,
  onPlaced,
  formId
}: {
  scout: { slug: string; firstName: string };
  lines: EntryLine[];
  itemsTotal: number;
  action: EntryConfig['action'];
  /** Called with the confirmation; the store empties its cart and swaps to the done view. */
  onPlaced: (d: Done) => void;
  formId: string;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [giftText, setGiftText] = useState('');
  const [collected, setCollected] = useState(false);
  const [paymentNote, setPaymentNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<{ field?: OrderField; message: string } | null>(null);

  const gift = Math.round((parseFloat(giftText) || 0) * 100) / 100;
  const total = Math.round((itemsTotal + gift) * 100) / 100;
  const local: Partial<Record<OrderField, string>> = {};
  if (tried && !name.trim()) local.name = 'Add the customer’s name, like “Grandma Sue”.';
  if (tried && lines.length === 0) local.cart = 'The order is empty. Add at least one item.';
  if (giftText.trim() && !(gift >= 0 && gift <= MAX_GIFT)) local.gift = `A gift can be from $0 to $${MAX_GIFT}.`;
  const problemFor = (f: OrderField) => local[f] ?? (server?.field === f ? server.message : undefined);
  const first = Object.values(local)[0];

  const label = lines.length === 0 ? 'Place order' : collected ? `Place order · ${fmtMoney(total)} collected` : `Place order · you collect ${fmtMoney(total)} later`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setServer(null);
    if (!name.trim() || lines.length === 0 || local.gift) {
      requestAnimationFrame(() => document.getElementById(formId)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    try {
      const res = await action({
        idempotencyKey: key,
        sellerSlug: scout.slug,
        lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.qty, donated: l.donated })),
        gift,
        customer: { name, email, phone, note },
        collected,
        paymentNote
      });
      if (res.ok) {
        onPlaced({
          orderNumber: res.orderNumber,
          customer: name.trim(),
          lines: lines.map((l) => ({ label: itemLabel(l.item), qty: l.qty, donated: l.donated, amount: l.item.price * l.qty })),
          gift,
          total,
          collected,
          paymentNote: paymentNote.trim(),
          confirmedTo: res.confirmedTo ?? []
        });
        setKey(crypto.randomUUID());
        setName('');
        setPhone('');
        setEmail('');
        setNote('');
        setGiftText('');
        setCollected(false);
        setPaymentNote('');
        setTried(false);
        return;
      }
      setServer({ field: res.field, message: res.error });
    } catch {
      setServer({ message: 'Something went wrong sending the order. Nothing was saved. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {lines.length === 0 ? (
        <p className={styles.cartEmpty}>Nothing yet. Add a wreath to start.</p>
      ) : (
        <>
          <ul className={styles.cartList}>
            {lines.map((l) => (
              <li key={l.key}>
                <span>
                  {l.qty} × {itemLabel(l.item)} {l.donated && <span className={styles.tag}>Donated</span>}
                </span>
                <span className={styles.num}>{fmtMoney(l.item.price * l.qty)}</span>
              </li>
            ))}
          </ul>
          <div className={styles.cartTotal}>
            <span>Total</span>
            <span className={styles.num}>{fmtMoney2(total)}</span>
          </div>
        </>
      )}
      {problemFor('cart') && <Notice tone="error">{problemFor('cart')}</Notice>}
      <form id={formId} className={styles.entryForm} onSubmit={submit} noValidate>
        <Field label="Customer name" problem={problemFor('name')}>
          <TextInput type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={<>Phone <span className={styles.opt}>optional</span></>} problem={problemFor('phone')}>
          <TextInput type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={<>Email <span className={styles.opt}>optional</span></>} problem={problemFor('email')}>
          <TextInput type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={<>Note <span className={styles.opt}>optional</span></>} problem={problemFor('note')}>
          <TextArea autoComplete="off" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label={<>Gift to Troop 79 <span className={styles.opt}>optional</span></>} problem={problemFor('gift')}>
          <TextInput type="text" inputMode="decimal" autoComplete="off" value={giftText} onChange={(e) => setGiftText(e.target.value)} />
        </Field>
        <div>
          <div className={styles.fieldLabel} id={`${formId}-col`}>
            Money collected?
          </div>
          <div className={styles.seg} role="group" aria-labelledby={`${formId}-col`}>
            <button type="button" aria-pressed={!collected} onClick={() => setCollected(false)}>
              Not yet
            </button>
            <button type="button" aria-pressed={collected} onClick={() => setCollected(true)}>
              Collected
            </button>
          </div>
        </div>
        <Field label={<>Payment note <span className={styles.opt}>optional</span></>} problem={problemFor('paymentNote')}>
          <TextInput type="text" maxLength={200} placeholder="Cash at the 10/18 meeting" autoComplete="off" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} />
        </Field>
        {server && !server.field && <Notice tone="error">{server.message}</Notice>}
        <div>
          <Button type="submit" disabled={busy} className={styles.block}>
            {busy ? 'Placing order…' : label}
          </Button>
          {tried && first && <SaveProblem action="place the order" reason={first} />}
          {!first && server?.field && <SaveProblem action="place the order" reason={server.message} />}
          <p className={styles.meta}>The customer gets no email.</p>
        </div>
      </form>
    </>
  );
}

/** The confirmation after an entered order, with "Enter another order". */
export function EntryDone({ done, scoutFirstName, onAnother }: { done: Done; scoutFirstName: string; onAnother: () => void }): ReactNode {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    window.scrollTo(0, 0);
  }, []);
  return (
    <div className={styles.doneView}>
      <p className={styles.kicker}>Troop 79 Christmas wreaths</p>
      <h1 className={styles.title} tabIndex={-1} ref={heading}>
        Order {done.orderNumber} is in
      </h1>
      <Notice tone="success">
        <p>
          <strong>No email went to {done.customer}.</strong>
        </p>
        <p>
          {done.confirmedTo.length > 0
            ? `A confirmation went to ${done.confirmedTo.join(' and ')}.`
            : 'No confirmation email was sent: there is no email address on file for you or the family.'}
        </p>
      </Notice>
      <section className={`${styles.card} ${styles.pad}`} aria-label="Order summary">
        <h2 className={styles.doneHead}>{done.customer}</h2>
        <ul className={styles.doneList}>
          {done.lines.map((l) => (
            <li key={`${l.label}-${l.donated}`}>
              <span>
                {l.qty} × {l.label} {l.donated && <span className={styles.tag}>Donated</span>}
              </span>
              <span className={styles.num}>{fmtMoney(l.amount)}</span>
            </li>
          ))}
          {done.gift > 0 && (
            <li>
              <span>Gift to Troop 79</span>
              <span className={styles.num}>{fmtMoney2(done.gift)}</span>
            </li>
          )}
          <li className={styles.doneTotal}>
            <span>Total</span>
            <span className={styles.num}>{fmtMoney2(done.total)}</span>
          </li>
        </ul>
        <p className={styles.meta}>
          {done.collected ? 'Collected' : 'Not collected yet'}
          {done.paymentNote ? ` · ${done.paymentNote}` : ''}
        </p>
      </section>
      <p className={styles.meta}>
        {done.collected ? 'Turn the money in to the troop' : `Mark it collected when ${scoutFirstName} has the money`} in My wreath orders. You can change or cancel this order there until its round closes.
      </p>
      <div className={styles.btnRow}>
        <Button href="/member/wreaths">My wreath orders</Button>
        <Button variant="secondary" onClick={onAnother}>
          Enter another order
        </Button>
      </div>
    </div>
  );
}

export type EntryDoneData = Done;

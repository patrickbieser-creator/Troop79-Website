'use client';

/**
 * One scout-entered order on Members › Wreath sale, with inline edit (prototype my-orders-entry.html). A row is
 * read-only text until the family opens it: customer, notes, items, gift, "Money collected?" and the payment note,
 * under the save-button standard (Save is greyed until the draft differs from what is saved and then says "Save
 * changes"; Discard changes returns to the last saved state; a blocked Save stays enabled and marks what is wrong in
 * place). "Cancel order" asks first. A locked row says why (Paid, past its round's cutoff, Cancelled) and offers no
 * control. The server actions re-check everything; hiding a control here is only courtesy.
 */

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/app/_components/badge';
import { Button } from '@/app/_components/button';
import { Field, SaveProblem, TextArea, TextInput } from '@/app/_components/form';
import { Stepper } from '@/app/_components/stepper';
import surface from '@/app/_components/card.module.css';
import { fmtDate } from '@/lib/format-date';
import { MAX_GIFT, fmtMoney, fmtMoney2, itemLabel } from '@/lib/wreaths/rules';
import type { StoreItem } from '@/lib/wreaths/public';
import type { MyOrder } from '@/lib/wreaths/my-orders';
import { cancelScoutOrderAction, saveScoutOrderAction } from './actions';
import styles from './wreaths.module.css';

interface Draft {
  name: string;
  phone: string;
  email: string;
  note: string;
  gift: string;
  collected: boolean;
  paymentNote: string;
  lines: { itemId: number; quantity: number; donated: boolean }[];
}

const draftOf = (o: MyOrder): Draft => ({
  name: o.customerName,
  phone: o.entry?.phone ?? '',
  email: o.entry?.email ?? '',
  note: o.entry?.note ?? '',
  gift: o.entry && o.entry.gift > 0 ? String(o.entry.gift) : '',
  collected: o.collectedByScout,
  paymentNote: o.paymentNote,
  lines: (o.entry?.lines ?? []).map((l) => ({ ...l }))
});

function itemsText(o: MyOrder): string {
  return o.lines.map((l) => `${l.quantity} × ${l.label}${l.donated ? ' (donated to veterans)' : ''}`).join(', ');
}

function StateBadge({ o }: { o: MyOrder }) {
  if (o.status === 'cancelled') return <Badge tone="neutral">Cancelled</Badge>;
  if (o.paymentStatus === 'paid') return <Badge tone="success">Paid</Badge>;
  if (o.paymentStatus === 'refunded') return <Badge tone="neutral">Refunded</Badge>;
  return o.collectedByScout ? <Badge tone="info">Collected</Badge> : <Badge tone="warning">Not collected</Badge>;
}

export function ScoutOrderRow({ order: o, items, canEdit, scoutFirstName }: { order: MyOrder; items: StoreItem[]; canEdit: boolean; scoutFirstName: string }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<Draft>(() => draftOf(o));
  const [draft, setDraft] = useState<Draft>(saved);
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [server, setServer] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const root = useRef<HTMLLIElement>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const byId = new Map(items.map((i) => [i.id, i]));
  const labelOf = (id: number) => {
    const it = byId.get(id);
    return it ? itemLabel(it) : (o.lines.find((_, i) => o.entry?.lines[i]?.itemId === id)?.label ?? 'Item');
  };
  const priceOf = (id: number) => byId.get(id)?.price ?? 0;
  const gift = Math.round((parseFloat(draft.gift) || 0) * 100) / 100;
  const total = draft.lines.reduce((n, l) => n + priceOf(l.itemId) * l.quantity, 0) + gift;

  const problems: Record<string, string> = {};
  if (!draft.name.trim()) problems.name = 'Add the customer’s name, like “Grandma Sue”.';
  if (draft.lines.length === 0) problems.cart = 'The order is empty. Add an item, or cancel the order.';
  if (draft.gift.trim() && !(gift >= 0 && gift <= MAX_GIFT)) problems.gift = `A gift can be from $0 to $${MAX_GIFT}.`;
  const shown = (f: string) => (tried ? problems[f] : undefined) ?? (server?.field === f ? server.message : undefined);
  const firstProblem = tried ? Object.values(problems)[0] : undefined;

  function open(collect = false) {
    const base = draftOf(o);
    const next = collect ? { ...base, collected: true } : base;
    setSaved(base);
    setDraft(next);
    setTried(false);
    setServer(null);
    setConfirming(false);
    setEditing(true);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(collect ? '[data-pay]' : '[data-name]')?.focus());
  }
  function discard() {
    setDraft(saved);
    setTried(false);
    setServer(null);
  }
  function close() {
    setEditing(false);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-edit]')?.focus());
  }
  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setServer(null);
  }
  function setQty(i: number, q: number) {
    set('lines', draft.lines.map((l, j) => (j === i ? { ...l, quantity: Math.max(1, Math.min(50, q)) } : l)));
  }
  function addLine(itemId: number, donated: boolean) {
    const ex = draft.lines.findIndex((l) => l.itemId === itemId && l.donated === donated);
    set('lines', ex >= 0 ? draft.lines.map((l, j) => (j === ex ? { ...l, quantity: Math.min(50, l.quantity + 1) } : l)) : [...draft.lines, { itemId, quantity: 1, donated }]);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setServer(null);
    if (Object.keys(problems).length) {
      requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    start(async () => {
      const res = await saveScoutOrderAction({
        orderId: o.id,
        customer: { name: draft.name, email: draft.email, phone: draft.phone, note: draft.note },
        lines: draft.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, donated: l.donated })),
        gift,
        collected: draft.collected,
        paymentNote: draft.paymentNote
      });
      if (res.ok) {
        setSaved(draft);
        setTried(false);
        router.refresh();
        close();
      } else setServer({ field: res.field, message: res.error });
    });
  }
  function cancelOrder() {
    start(async () => {
      const res = await cancelScoutOrderAction(o.id);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setConfirming(false);
        setServer({ message: res.error });
      }
    });
  }

  const cls = `${surface.card} ${styles.order} ${o.status === 'cancelled' ? styles.cancelled : ''}`;

  if (!editing) {
    const lock = o.status === 'cancelled' ? null : o.lock;
    return (
      <li ref={root} className={cls}>
        <div className={styles.orderHead}>
          <span className={styles.orderNo}>{o.orderNumber}</span>
          <span className={styles.orderDate}>{fmtDate(o.placedAt)}</span>
          <StateBadge o={o} />
          <span className={styles.orderTotal}>{fmtMoney2(o.total)}</span>
        </div>
        <p className={styles.orderBody}>
          <strong>{o.customerName}</strong> &middot; {itemsText(o)}
        </p>
        {o.paymentNote && <p className={styles.orderMeta}>Payment: {o.paymentNote}</p>}
        {o.enteredByName && o.enteredByName.split(' ')[0] !== scoutFirstName && <p className={styles.orderMeta}>Entered by {o.enteredByName}</p>}
        {canEdit && o.status === 'placed' && (
          <div className={styles.rowActions}>
            {lock ? (
              <span className={styles.orderMeta}>{lock}</span>
            ) : (
              <>
                {!o.collectedByScout && (
                  <Button variant="ghost" onClick={() => open(true)}>
                    Mark collected
                  </Button>
                )}
                <Button variant="ghost" data-edit onClick={() => open()}>
                  Edit
                </Button>
              </>
            )}
          </div>
        )}
        {server && !editing && <p className={styles.badNote}>{server.message}</p>}
      </li>
    );
  }

  return (
    <li ref={root} className={`${cls} ${styles.editing}`}>
      <form onSubmit={save} noValidate aria-label={`Edit order ${o.orderNumber}`} className={styles.editForm}>
        <div className={styles.orderHead}>
          <span className={styles.orderNo}>{o.orderNumber}</span>
          <span className={styles.orderDate}>Entered {fmtDate(o.placedAt)}</span>
          <span className={styles.orderMeta}>{scoutFirstName}’s customer</span>
        </div>
        <div className={styles.editFields}>
          <Field label="Customer name" problem={shown('name')}>
            <TextInput data-name type="text" autoComplete="off" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={<>Phone <span className={styles.opt}>optional</span></>} problem={shown('phone')}>
            <TextInput type="tel" inputMode="tel" autoComplete="off" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label={<>Email <span className={styles.opt}>optional</span></>} problem={shown('email')}>
            <TextInput type="email" inputMode="email" autoComplete="off" value={draft.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label={<>Note <span className={styles.opt}>optional</span></>} problem={shown('note')} className={styles.editWide}>
            <TextArea autoComplete="off" maxLength={300} value={draft.note} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </div>

        <fieldset className={`${styles.itemsBox} ${shown('cart') ? styles.itemsBad : ''}`} aria-invalid={shown('cart') ? true : undefined}>
          <legend>Items</legend>
          {shown('cart') && <p className={styles.badNote}>{shown('cart')}</p>}
          <ul className={styles.editLines}>
            {draft.lines.map((l, i) => (
              <li key={`${l.itemId}-${l.donated}`}>
                <span className={styles.editLineName}>
                  {labelOf(l.itemId)} {l.donated && <Badge tone="info">Donated</Badge>}
                </span>
                <Stepper
                  id={`q-${o.id}-${i}`}
                  value={l.quantity}
                  min={1}
                  max={50}
                  groupLabel={`Quantity, ${labelOf(l.itemId)}`}
                  lessLabel={`One fewer ${labelOf(l.itemId)}`}
                  moreLabel={`One more ${labelOf(l.itemId)}`}
                  inputLabel={`Quantity, ${labelOf(l.itemId)}`}
                  onChange={(n) => setQty(i, n)}
                />
                <span className={styles.editLineAmt}>{fmtMoney(priceOf(l.itemId) * l.quantity)}</span>
                <Button variant="ghost" aria-label={`Remove ${labelOf(l.itemId)}`} onClick={() => set('lines', draft.lines.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <AddItem items={items} onAdd={addLine} />
        </fieldset>

        <div className={styles.editFields}>
          <Field label={<>Gift to Troop 79 <span className={styles.opt}>optional</span></>} problem={shown('gift')}>
            <TextInput type="text" inputMode="decimal" autoComplete="off" value={draft.gift} onChange={(e) => set('gift', e.target.value)} />
          </Field>
          <div>
            <div className={styles.fieldLabel} id={`col-${o.id}`}>
              Money collected?
            </div>
            <div className={styles.seg} role="group" aria-labelledby={`col-${o.id}`}>
              <button type="button" aria-pressed={!draft.collected} onClick={() => set('collected', false)}>
                Not yet
              </button>
              <button type="button" aria-pressed={draft.collected} onClick={() => set('collected', true)}>
                Collected
              </button>
            </div>
          </div>
          <Field label={<>Payment note <span className={styles.opt}>optional</span></>} problem={shown('paymentNote')} className={styles.editWide}>
            <TextInput data-pay type="text" maxLength={200} placeholder="Cash at the 10/18 meeting" autoComplete="off" value={draft.paymentNote} onChange={(e) => set('paymentNote', e.target.value)} />
          </Field>
        </div>
        <p className={styles.orderMeta}>Total {fmtMoney2(total)}</p>

        {confirming ? (
          <div className={styles.confirmCancel} role="alertdialog" aria-label="Cancel this order?">
            <span>Cancel this order for {saved.name || 'this customer'}?</span>
            <Button variant="danger" disabled={pending} onClick={cancelOrder}>
              {pending ? 'Cancelling…' : 'Yes, cancel the order'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        ) : (
          <div className={styles.editFoot}>
            <Button type="submit" disabled={!dirty || pending} title={dirty ? undefined : 'No changes to save yet'}>
              {pending ? 'Saving changes…' : dirty ? 'Save changes' : 'Saved'}
            </Button>
            <Button variant="secondary" disabled={!dirty || pending} onClick={discard}>
              Discard changes
            </Button>
            <Button variant="ghost" onClick={close} disabled={dirty || pending}>
              Close
            </Button>
            <span className={styles.spacer} />
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              Cancel order
            </Button>
            {firstProblem && <SaveProblem reason={firstProblem} more={Math.max(0, Object.keys(problems).length - 1)} />}
            {!firstProblem && server && <SaveProblem reason={server.message} />}
          </div>
        )}
      </form>
    </li>
  );
}

/** The "add an item" row: one select and a Donated tick, then Add. Donated shows only for donatable wreaths. */
function AddItem({ items, onAdd }: { items: StoreItem[]; onAdd: (itemId: number, donated: boolean) => void }) {
  const [id, setId] = useState(() => String(items[0]?.id ?? ''));
  const [donated, setDonated] = useState(false);
  const it = items.find((i) => String(i.id) === id);
  return (
    <div className={styles.addItem}>
      <label className={styles.srOnly} htmlFor="add-item">
        Item to add
      </label>
      <select
        id="add-item"
        className={styles.addSelect}
        value={id}
        onChange={(e) => {
          setId(e.target.value);
          setDonated(false);
        }}
      >
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {itemLabel(i)} · {fmtMoney(i.price)}
          </option>
        ))}
      </select>
      {it?.donatable && (
        <label className={styles.checkInline}>
          <input type="checkbox" checked={donated} onChange={(e) => setDonated(e.target.checked)} />
          <span>Donated</span>
        </label>
      )}
      <Button
        variant="secondary"
        onClick={() => {
          if (it) onAdd(it.id, donated && it.donatable);
          setDonated(false);
        }}
      >
        Add
      </Button>
    </div>
  );
}

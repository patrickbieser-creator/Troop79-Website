'use client';

/**
 * The store and a scout's page share this: the product grid, "Donate a wreath to veterans", and the cart (a sticky
 * aside on wide screens, a bar on phones). The server renders the heading (`head`) and passes the active items; the
 * cart itself lives in this browser (cart.ts). Prices shown here are a convenience — the order action reprices
 * everything from the catalog.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { Stepper } from '@/app/_components/stepper';
import { MAX_QTY, fmtMoney, itemLabel } from '@/lib/wreaths/rules';
import { STORE_SECTIONS, type StoreItem } from '@/lib/wreaths/public';
import { lineKey, parseLineKey, useCart, type CartState } from './cart';
import { EntryAside, EntryDone, EntryProvider, type EntryConfig, type EntryDoneData } from './entry-mode';
import styles from '../wreaths.module.css';

export interface StoreViewScout {
  slug: string;
  name: string;
  firstName: string;
}

export function ProductPhoto({ item, className }: { item: Pick<StoreItem, 'imageUrl' | 'name' | 'size'>; className?: string }) {
  if (!item.imageUrl) return <div className={styles.noPhoto}>Photo coming soon</div>;
  return (
    <span className={className ?? styles.photo}>
      <Image src={item.imageUrl} alt={itemLabel(item)} fill sizes="(min-width: 1100px) 280px, (min-width: 520px) 45vw, 112px" />
    </span>
  );
}

function AddLine({ itemKey, label, qty, onQty }: { itemKey: string; label: string; qty: number; onQty: (key: string, q: number) => void }) {
  const addId = `add-${itemKey}`;
  if (qty === 0) {
    return (
      <div className={styles.addLine}>
        <Button id={addId} variant="secondary" size="sm" aria-label={`Add ${label}`} onClick={() => onQty(itemKey, 1)}>
          Add
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.addLine}>
      <Stepper
        id={`qty-${itemKey}`}
        value={qty}
        min={0}
        max={MAX_QTY}
        groupLabel={`Quantity, ${label}`}
        lessLabel={`One fewer ${label}`}
        moreLabel={`One more ${label}`}
        inputLabel={`Quantity, ${label}`}
        onChange={(n) => {
          onQty(itemKey, n);
          if (n === 0) requestAnimationFrame(() => document.getElementById(addId)?.focus());
        }}
      />
      <span className={styles.inCart}>In cart</span>
    </div>
  );
}

export function StoreView({
  items,
  scout,
  head,
  linkFellBack = false,
  entry
}: {
  items: StoreItem[];
  scout: StoreViewScout | null;
  head: ReactNode;
  /** A typed link didn't resolve; its own notice says so, and naming another scout here would only confuse. */
  linkFellBack?: boolean;
  /** Present only when the server found a signed-in scout (or their parent) on this scout's page: the "Order for someone I know" mode. */
  entry?: EntryConfig;
}) {
  const { cart, setQty, setSeller, emptyLines, restore } = useCart();
  const [entryOn, setEntryOn] = useState(entry?.initialOn ?? false);
  const [done, setDone] = useState<EntryDoneData | null>(null);
  const inEntry = !!entry && !!scout && entryOn;
  const [announce, setAnnounce] = useState('');
  const [undo, setUndo] = useState<CartState | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Empty the cart": one click, no confirm (a cart is cheap to rebuild), with a ten-second Undo.
  function emptyCart() {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    // The scout credit stays on a scout page; on the general store an empty cart drops it too, so no stale
    // "opened from X's page" notice is left behind.
    setUndo(emptyLines(!scout));
    setAnnounce('Cart emptied');
    undoTimer.current = setTimeout(() => {
      setUndo(null);
      setAnnounce('');
    }, 10_000);
  }
  function undoEmpty() {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    restore(undo);
    setUndo(null);
    setAnnounce('Cart restored');
  }

  // Last scout link opened wins the credit for the next checkout.
  const scoutSlug = scout?.slug;
  const scoutName = scout?.name;
  useEffect(() => {
    if (scoutSlug && scoutName) setSeller({ slug: scoutSlug, name: scoutName });
  }, [scoutSlug, scoutName, setSeller]);

  const byId = new Map(items.map((i) => [i.id, i]));
  const lines = Object.entries(cart.lines)
    .map(([key, qty]) => ({ key, qty, ...parseLineKey(key) }))
    .filter((l) => byId.has(l.itemId))
    .map((l) => ({ ...l, item: byId.get(l.itemId)! }));
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((n, l) => n + l.item.price * l.qty, 0);
  const checkoutHref = scout ? `/wreaths/checkout?s=${encodeURIComponent(scout.slug)}` : '/wreaths/checkout';
  const credited = scout ? scout.name : 'Troop 79';
  // A cart credited to a scout whose page was opened earlier; the general store orders for the troop.
  const droppedFrom = !scout && !linkFellBack && count > 0 && cart.seller ? cart.seller : null;

  function onQty(key: string, q: number) {
    setQty(key, q);
    if (q === 1 && (cart.lines[key] ?? 0) === 0) {
      const l = parseLineKey(key);
      const it = byId.get(l.itemId);
      if (it) setAnnounce(`Added ${itemLabel(it)}${l.donated ? ', donated' : ''}`);
    }
  }

  const sections = STORE_SECTIONS.map((s) => ({ ...s, items: items.filter((i) => i.section === s.id) })).filter((s) => s.items.length > 0);
  const donatable = items.filter((i) => i.donatable);

  if (done && scout) {
    return (
      <EntryDone
        done={done}
        scoutFirstName={scout.firstName}
        onAnother={() => {
          setDone(null);
          window.scrollTo(0, 0);
        }}
      />
    );
  }

  return (
    <EntryProvider value={entry && scout ? { on: entryOn, setOn: setEntryOn } : null}>
      <div className={styles.storeGrid}>
        <div>
          {droppedFrom && (
            <Notice tone="warning" className={styles.stack}>
              Your cart was opened from {droppedFrom.name}’s page. Orders placed here go to Troop 79.{' '}
              <Link href={`/wreaths/${droppedFrom.slug}`}>Back to {droppedFrom.name.split(' ')[0]}’s page</Link> to keep the credit.
            </Notice>
          )}
          {head}
          {sections.map((s) => (
            <section key={s.id} aria-labelledby={`sec-${s.id}`}>
              <h2 id={`sec-${s.id}`} className={styles.groupTitle}>
                {s.title}
              </h2>
              <ul className={styles.products}>
                {s.items.map((item) => (
                  <li key={item.id} className={`${styles.card} ${styles.product}`}>
                    <ProductPhoto item={item} />
                    <div className={styles.body}>
                      <div className={styles.pHead}>
                        <span className={styles.pName}>
                          {item.name}
                          {item.size && <span className={styles.pSize}> {item.size}</span>}
                        </span>
                        <span className={styles.pPrice}>{fmtMoney(item.price)}</span>
                      </div>
                      <p className={styles.pDesc}>{item.description}</p>
                      <AddLine itemKey={lineKey(item.id, false)} label={itemLabel(item)} qty={cart.lines[lineKey(item.id, false)] ?? 0} onQty={onQty} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {donatable.length > 0 && (
            <section className={`${styles.card} ${styles.vets}`} aria-labelledby="vetsH" id="vets">
              <h2 id="vetsH">Donate a wreath to veterans</h2>
              <p className={styles.meta}>
                The troop delivers donated wreaths to veterans in December. No wreaths will be delivered to you
                {scout ? `, and ${scout.firstName} still gets credit for the sale` : ''}.
              </p>
              {donatable.map((item) => (
                <div key={item.id} className={styles.vetRow}>
                  <span className={styles.vetName}>
                    <strong>{itemLabel(item)}</strong>, donated · {fmtMoney(item.price)}
                  </span>
                  <AddLine
                    itemKey={lineKey(item.id, true)}
                    label={`${itemLabel(item)}, donated`}
                    qty={cart.lines[lineKey(item.id, true)] ?? 0}
                    onQty={onQty}
                  />
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className={`${styles.card} ${styles.pad} ${styles.cartAside} ${inEntry ? styles.cartAsideEntry : ''}`} aria-labelledby="cartH" id="entry-aside">
          <h2 id="cartH">{inEntry ? 'Order for a customer' : 'Your order'}</h2>
          {inEntry && entry && scout ? (
            <EntryAside
              scout={scout}
              lines={lines}
              itemsTotal={total}
              action={entry.action}
              formId="entry-form"
              onPlaced={(d) => {
                emptyLines(false);
                setDone(d);
              }}
            />
          ) : lines.length === 0 ? (
            <>
              <p className={styles.cartEmpty}>Nothing yet. Add a wreath to start.</p>
              {undo && (
                <p className={styles.meta}>
                  Cart emptied.{' '}
                  <Button variant="ghost" onClick={undoEmpty}>
                    Undo
                  </Button>
                </p>
              )}
            </>
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
                <span className={styles.num}>{fmtMoney(total)}</span>
              </div>
              <Button href={checkoutHref} className={styles.block}>
                Checkout
              </Button>
              <p className={styles.meta}>Credited to {credited}</p>
              <Button variant="ghost" onClick={emptyCart}>
                Empty the cart
              </Button>
            </>
          )}
        </aside>
      </div>

      <div className={styles.cartBar} hidden={lines.length === 0}>
        <div className={styles.cartBarSum}>
          <strong>{fmtMoney(total)}</strong>
          <span>
            {count} item{count === 1 ? '' : 's'}
            {scout ? ` · ${credited}` : ''}
          </span>
        </div>
        <Button href={inEntry ? '#entry-aside' : checkoutHref}>{inEntry ? 'Customer details' : 'Checkout'}</Button>
      </div>
      {lines.length > 0 && <div className={styles.cartBarSpace} aria-hidden="true" />}
      <p className={styles.srOnly} role="status" aria-live="polite">
        {announce}
      </p>
    </EntryProvider>
  );
}

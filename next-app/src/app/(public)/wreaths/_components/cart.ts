'use client';

/**
 * The shopper's cart, kept in this browser's localStorage so it survives store -> checkout -> back. Customers have no
 * accounts. It is an external store (useSyncExternalStore), so the server render shows an empty cart and the browser
 * fills it in after hydration without a mismatch.
 *
 * `lines` is keyed by item id, with a trailing "d" for a donated wreath ("12d"). `seller` is the last scout page the
 * shopper opened (last link wins); it only decides which scout a CHECKOUT is credited to when the shopper follows that
 * scout's own checkout link — the general store never carries it. `donation` is the "Donate to Troop 79" amount in
 * dollars (W-3; 0 = none): the same money as the checkout's donation (the order's `gift`), held once, so a cart can
 * check out with only a donation and a donation is never counted twice.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { MAX_GIFT, fromCents, toCents } from '@/lib/wreaths/rules';

export interface CartSeller {
  slug: string;
  name: string;
}

export interface CartState {
  lines: Record<string, number>;
  seller: CartSeller | null;
  /** Dollars; 0 = no donation. */
  donation: number;
}

const KEY = 'wreath-cart-v1';
const EVENT = 'wreath-cart-changed';
const EMPTY: CartState = { lines: {}, seller: null, donation: 0 };

/** A stored donation: a number of dollars over $0 and at most MAX_GIFT, whole cents; anything else is none. */
function cleanDonation(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_GIFT ? fromCents(toCents(v)) : 0;
}

let cachedRaw: string | null | undefined;
let cachedValue: CartState = EMPTY;

function parse(raw: string | null): CartState {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as Partial<CartState>;
    const lines: Record<string, number> = {};
    for (const [k, q] of Object.entries(v.lines ?? {})) {
      if (/^\d+d?$/.test(k) && Number.isInteger(q) && q > 0) lines[k] = Math.min(q, 50);
    }
    const s = v.seller;
    const seller = s && typeof s.slug === 'string' && typeof s.name === 'string' ? { slug: s.slug, name: s.name } : null;
    return { lines, seller, donation: cleanDonation(v.donation) };
  } catch {
    return EMPTY;
  }
}

function snapshot(): CartState {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Storage blocked (private mode): the cart works for this page view only.
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

function write(next: CartState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore: see snapshot()
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export const lineKey = (itemId: number, donated: boolean) => `${itemId}${donated ? 'd' : ''}`;
export const parseLineKey = (key: string) => ({ itemId: parseInt(key, 10), donated: key.endsWith('d') });

export function useCart() {
  const cart = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const setQty = useCallback((key: string, qty: number) => {
    const cur = snapshot();
    const lines = { ...cur.lines };
    const q = Math.max(0, Math.min(50, Math.trunc(qty) || 0));
    if (q === 0) delete lines[key];
    else lines[key] = q;
    write({ ...cur, lines });
  }, []);
  const setSeller = useCallback((seller: CartSeller | null) => {
    const cur = snapshot();
    if (cur.seller?.slug === seller?.slug) return;
    write({ ...cur, seller });
  }, []);
  /** Sets the donation (W-3); 0 removes it. */
  const setDonation = useCallback((dollars: number) => {
    const cur = snapshot();
    const donation = cleanDonation(dollars);
    if (cur.donation === donation) return;
    write({ ...cur, donation });
  }, []);
  const clear = useCallback(() => write(EMPTY), []);
  /** Puts the cart back exactly as given (Undo after "Empty the cart"). */
  const restore = useCallback((state: CartState) => write(state), []);
  /** Empties the lines and the donation; the scout credit stays unless `dropSeller`. Returns what was there, for Undo. */
  const emptyLines = useCallback((dropSeller: boolean): CartState => {
    const cur = snapshot();
    write({ lines: {}, seller: dropSeller ? null : cur.seller, donation: 0 });
    return cur;
  }, []);
  return { cart, setQty, setSeller, setDonation, clear, restore, emptyLines };
}

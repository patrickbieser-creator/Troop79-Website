/**
 * Leaving the checkout for Stripe (Patrick, 2026-10-16). The order is placed and the cart emptied BEFORE Stripe opens,
 * so the browser's Back used to land on an empty checkout and the order looked gone, while admin and the scout's page
 * showed it. Two fixes, both here so the checkout stays thin and they can be tested without a browser:
 *   - the checkout's own history entry becomes the order's receipt (`?card=cancelled`) before Stripe opens, so Back
 *     lands on the saved, unpaid order (Stripe's own back arrow, the session's cancel_url, lands there too);
 *   - the tab remembers the order it just placed for an hour, so a checkout opened again with an empty cart can point
 *     at it rather than looking like nothing happened.
 * Plain module (no 'use client'): the checkout imports it; nothing here touches the server.
 */

type HistoryLike = { replaceState: (state: unknown, unused: string, url: string) => void; state: unknown };
type LocationLike = { assign: (url: string) => void; reload: () => void; pathname: string };
type StorageLike = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };

export const receiptPath = (token: string) => `/wreaths/order/${token}`;

export function leaveForStripe(stripeUrl: string, token: string, w: { history: HistoryLike; location: LocationLike } = window) {
  // Keep the router's own state on the entry; only the URL changes.
  w.history.replaceState(w.history.state, '', `${receiptPath(token)}?card=cancelled`);
  w.location.assign(stripeUrl);
}

/**
 * A browser that restores the checkout from its back-forward cache shows the old page (busy, cart empty) under the
 * receipt's URL. Reloading fetches the receipt that URL names.
 */
export function reloadIfRestoredAway(e: { persisted: boolean }, w: { location: LocationLike } = window) {
  if (e.persisted && w.location.pathname.startsWith('/wreaths/order/')) w.location.reload();
}

const LAST_ORDER_KEY = 'wreath-last-order';
export const LAST_ORDER_MAX_AGE_MS = 3600_000;

export interface PlacedOrder {
  token: string;
  orderNumber: string;
}

export function rememberPlacedOrder(o: PlacedOrder, nowMs: number = Date.now(), w: { sessionStorage: StorageLike } = window) {
  try {
    w.sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ token: o.token, orderNumber: o.orderNumber, at: nowMs }));
  } catch {
    // no sessionStorage: Back still lands on the receipt (leaveForStripe)
  }
}

export function recentPlacedOrder(nowMs: number, w: { sessionStorage: StorageLike } = window): PlacedOrder | null {
  try {
    const raw = w.sessionStorage.getItem(LAST_ORDER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { token?: unknown; orderNumber?: unknown; at?: unknown };
    if (typeof v.token !== 'string' || typeof v.orderNumber !== 'string' || typeof v.at !== 'number') return null;
    if (nowMs - v.at > LAST_ORDER_MAX_AGE_MS) return null;
    return { token: v.token, orderNumber: v.orderNumber };
  } catch {
    return null;
  }
}

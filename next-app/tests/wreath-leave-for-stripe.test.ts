import { describe, it, expect, vi } from 'vitest';
import { LAST_ORDER_MAX_AGE_MS, leaveForStripe, recentPlacedOrder, reloadIfRestoredAway, rememberPlacedOrder } from '../src/lib/wreaths/leave-for-stripe';

/**
 * Leaving the checkout for Stripe (Patrick, 2026-10-16): the order is placed and the cart emptied before Stripe opens,
 * so the browser's Back used to land on an empty checkout and the order looked gone. Now the checkout's history entry
 * becomes the order's receipt before Stripe opens, and the tab remembers the order it just placed for an hour.
 */
function fakeWindow(pathname = '/wreaths/checkout') {
  const store = new Map<string, string>();
  return {
    history: { replaceState: vi.fn(), state: { __next: 1 } },
    location: { assign: vi.fn(), reload: vi.fn(), pathname },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    }
  };
}

describe('leaveForStripe', () => {
  it('Checkout_PointsBackAtTheReceipt_BeforeOpeningStripe', () => {
    const w = fakeWindow();
    const calls: string[] = [];
    w.history.replaceState.mockImplementation((_s: unknown, _t: string, url: string) => void calls.push(`replace ${url}`));
    w.location.assign.mockImplementation((url: string) => void calls.push(`assign ${url}`));
    leaveForStripe('https://checkout.stripe.com/c/pay/x', 'tok', w);
    expect(calls).toEqual(['replace /wreaths/order/tok?card=cancelled', 'assign https://checkout.stripe.com/c/pay/x']);
  });

  it('Checkout_KeepsTheRoutersHistoryState_WhenItRewritesTheEntry', () => {
    const w = fakeWindow();
    leaveForStripe('https://checkout.stripe.com/c/pay/x', 'tok', w);
    expect(w.history.replaceState.mock.calls[0][0]).toEqual({ __next: 1 });
  });
});

describe('reloadIfRestoredAway', () => {
  it('Checkout_RestoredFromTheBackForwardCache_OnTheReceiptUrl_Reloads', () => {
    const w = fakeWindow('/wreaths/order/tok');
    reloadIfRestoredAway({ persisted: true }, w);
    expect(w.location.reload).toHaveBeenCalled();
  });

  it('Checkout_ShownNormally_DoesNotReload', () => {
    const w = fakeWindow('/wreaths/order/tok');
    reloadIfRestoredAway({ persisted: false }, w);
    expect(w.location.reload).not.toHaveBeenCalled();
  });

  it('Checkout_RestoredOnItsOwnUrl_DoesNotReload', () => {
    const w = fakeWindow('/wreaths/checkout');
    reloadIfRestoredAway({ persisted: true }, w);
    expect(w.location.reload).not.toHaveBeenCalled();
  });
});

describe('recentPlacedOrder', () => {
  it('Checkout_RemembersTheOrderItJustPlaced', () => {
    const w = fakeWindow();
    rememberPlacedOrder({ token: 'tok', orderNumber: 'W-1006' }, 1_000, w);
    expect(recentPlacedOrder(2_000, w)).toEqual({ token: 'tok', orderNumber: 'W-1006' });
  });

  it('Checkout_ForgetsThePlacedOrder_AfterAnHour', () => {
    const w = fakeWindow();
    rememberPlacedOrder({ token: 'tok', orderNumber: 'W-1006' }, 1_000, w);
    expect(recentPlacedOrder(1_000 + LAST_ORDER_MAX_AGE_MS + 1, w)).toBeNull();
  });

  it('Checkout_IgnoresAGarbledMemory', () => {
    const w = fakeWindow();
    w.sessionStorage.setItem('wreath-last-order', '{nope');
    expect(recentPlacedOrder(1_000, w)).toBeNull();
  });

  it('Checkout_WorksWithoutSessionStorage', () => {
    const w = { ...fakeWindow(), sessionStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} } };
    rememberPlacedOrder({ token: 'tok', orderNumber: 'W-1006' }, 1_000, w);
    expect(recentPlacedOrder(1_000, w)).toBeNull();
  });
});

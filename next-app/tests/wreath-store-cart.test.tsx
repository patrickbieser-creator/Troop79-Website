import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoreView } from '../src/app/(public)/wreaths/_components/store-view';
import type { StoreItem } from '../src/lib/wreaths/public';

/** The store's cart callout: "Empty the cart" with a short Undo. */
const items: StoreItem[] = [
  { id: 11, catalogNumber: 1, name: 'Wreath', size: '20″', description: 'd', price: 26, imageUrl: null, section: 'wreaths', donatable: false },
  { id: 12, catalogNumber: 3, name: 'Wreath', size: '36″', description: 'd', price: 42, imageUrl: null, section: 'wreaths', donatable: false }
];
const read = () => JSON.parse(window.localStorage.getItem('wreath-cart-v1') ?? '{"lines":{},"seller":null}');

beforeEach(() => window.localStorage.clear());

describe('empty the cart', () => {
  it('EmptyCart_HiddenWhenCartEmpty', () => {
    render(<StoreView items={items} scout={null} head={null} />);
    expect(screen.queryByRole('button', { name: 'Empty the cart' })).toBeNull();
  });

  it('EmptyCart_ClearsLines_AndUndoRestoresThem', async () => {
    window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: { '11': 2, '12': 1 }, seller: null }));
    render(<StoreView items={items} scout={null} head={null} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Empty the cart' }));
    expect(read().lines).toEqual({});
    expect(screen.getByRole('status').textContent).toContain('Cart emptied');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(read().lines).toEqual({ '11': 2, '12': 1 });
    expect(screen.getByRole('button', { name: 'Empty the cart' })).toBeTruthy();
  });

  it('EmptyCart_KeepsTheScoutOnAScoutPage_AndDropsItOnTheGeneralStore', async () => {
    const seller = { slug: 'ben-b', name: 'Ben B.' };
    window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: { '11': 1 }, seller }));
    const { unmount } = render(<StoreView items={items} scout={{ slug: 'ben-b', name: 'Ben B.', firstName: 'Ben' }} head={null} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Empty the cart' }));
    expect(read().seller).toEqual(seller);
    unmount();

    window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: { '11': 1 }, seller }));
    render(<StoreView items={items} scout={null} head={null} />);
    await user.click(await screen.findByRole('button', { name: 'Empty the cart' }));
    expect(read().seller).toBeNull();
    // Undo brings the credit back with the lines.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(read()).toEqual({ lines: { '11': 1 }, seller, donation: 0 });
  });
});

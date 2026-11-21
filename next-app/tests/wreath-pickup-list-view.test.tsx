import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupListPanel } from '../src/app/admin/(workspace)/finance/wreaths/pickup-list-panel';
import type { PickupList } from '../src/lib/wreaths/pickup-list';

/** Admin › Wreath Sale › Pickup list renders the rollup from lib/wreaths/pickup-list (2026-11-21). */
const EMPTY: PickupList = { scouts: [], lotPickups: [], troopDelivery: [], donated: [], totals: [] };
const ORDER = { id: 1, orderNumber: 'W-1001', customerName: 'Jane Doe', customerPhone: '', address: '9 Elm St, Milwaukee 53202', items: [{ catalogNumber: 1, label: '20″ Wreath', quantity: 2 }], donated: 0, due: 52, note: '', how: null as string | null };
const FULL: PickupList = {
  scouts: [{ personId: 100, name: 'Anna Able', items: ORDER.items, donated: 0, orders: [ORDER, { ...ORDER, id: 4, orderNumber: 'W-1004', customerName: 'Tom Troop', due: 0, how: 'The troop delivers this one' }], due: 52 }],
  lotPickups: [{ ...ORDER, id: 2, orderNumber: 'W-1002', customerName: 'Pat Pickup', due: 0 }],
  troopDelivery: [{ ...ORDER, id: 3, orderNumber: 'W-1003', customerName: 'Del Ivery', address: '1 Main St, Milwaukee 53211', due: 0 }],
  donated: [{ catalogNumber: 1, label: '20″ Wreath', quantity: 1 }],
  totals: [{ catalogNumber: 1, label: '20″ Wreath', scouts: 2, pickup: 2, delivery: 2, donated: 1, total: 7 }]
};

describe('PickupListPanel', () => {
  it('says so when there are no orders', () => {
    render(<PickupListPanel p={EMPTY} year={2026} />);
    expect(screen.getByText(/No orders yet/)).toBeTruthy();
  });

  it('shows each scout’s card with their item count', () => {
    render(<PickupListPanel p={FULL} year={2026} />);
    expect(screen.getByRole('region', { name: 'Anna Able pickup' }).textContent).toContain('2 items');
  });

  it('flags what a scout still has to collect', () => {
    render(<PickupListPanel p={FULL} year={2026} />);
    expect(screen.getByRole('region', { name: 'Anna Able pickup' }).textContent).toContain('To collect: $52.00');
  });

  it('gives troop deliveries their address', () => {
    render(<PickupListPanel p={FULL} year={2026} />);
    expect(screen.getByRole('region', { name: 'Troop delivers' }).textContent).toContain('1 Main St, Milwaukee 53211');
  });

  it('lists lot pickups and donated wreaths', () => {
    render(<PickupListPanel p={FULL} year={2026} />);
    expect([screen.queryByRole('region', { name: 'Customer pickup at the lot' }), screen.queryByRole('region', { name: 'Donated to veterans' })].every(Boolean)).toBe(true);
  });

  it('says "1 item", not "1 items"', () => {
    render(<PickupListPanel p={{ ...FULL, donated: [{ catalogNumber: 1, label: '20″ Wreath', quantity: 1 }] }} year={2026} />);
    expect(screen.getByRole('region', { name: 'Donated to veterans' }).textContent).toMatch(/(^|\D)1 item(?!s)/);
  });

  it('gives a scout the delivery address on each order', () => {
    render(<PickupListPanel p={FULL} year={2026} />);
    expect(screen.getByRole('region', { name: 'Anna Able pickup' }).textContent).toContain('9 Elm St, Milwaukee 53202');
  });

  it('offers a one-scout-per-page print', () => {
    render(<PickupListPanel p={FULL} year={2026} />);
    expect(screen.getByRole('button', { name: 'Print scout pages' })).toBeTruthy();
  });

  it('heads each scout page with the sale', () => {
    render(<PickupListPanel p={FULL} year={2026} />);
    expect(screen.getByRole('region', { name: 'Anna Able pickup' }).textContent).toContain('Troop 79 Wreath Sale 2026');
  });

  it('says how an order goes out when the scout isn’t delivering it', () => {
    render(<PickupListPanel p={FULL} year={2026} />);
    expect(screen.getByRole('region', { name: 'Anna Able pickup' }).textContent).toContain('The troop delivers this one');
  });
});

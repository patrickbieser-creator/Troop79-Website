import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AdminSale } from '../src/lib/wreaths/admin-data';

/** Wreath Settings › Order copies: five address boxes, the event builder's per-field rule, saved as a list. */
const saveSettings = vi.fn(async () => ({ ok: true }));
vi.mock('../src/app/admin/(workspace)/finance/wreaths/actions', () => ({ saveSettings }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/admin/finance/wreaths' }));

const { SettingsForm } = await import('../src/app/admin/(workspace)/finance/wreaths/settings-form');

const sale: AdminSale = {
  id: 1,
  year: 2026,
  status: 'open',
  round1Cutoff: '2026-10-21T04:59:00.000Z',
  round2Cutoff: '2026-11-16T05:59:00.000Z',
  distributionDate: '2026-11-21',
  distributionWindow: '2:30 to 4:30 PM',
  distributionPlace: 'Lot',
  deliveryZipPrefix: '532',
  deliveryFee: 5,
  deliveryFreeAt: 50,
  feePercent: 1.99,
  feeFixed: 0.49,
  scoutShare: 0.3,
  orderCc: ['treasurer@example.test']
};

describe('Wreath settings › Order copies', () => {
  it('Treasurer_SeesFiveAddressBoxes_WithTheSavedOneFilledIn', () => {
    render(<SettingsForm sale={sale} />);
    const boxes = [1, 2, 3, 4, 5].map((i) => screen.getByLabelText(`Address ${i}`) as HTMLInputElement);
    expect(boxes.map((b) => b.value)).toEqual(['treasurer@example.test', '', '', '', '']);
  });

  it('Treasurer_SavesTheAddresses_WithBlanksDropped', async () => {
    saveSettings.mockClear();
    render(<SettingsForm sale={sale} />);
    fireEvent.change(screen.getByLabelText('Address 3'), { target: { value: 'cm@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect((saveSettings.mock.calls[0] as unknown as [number, { orderCc: string[] }])[1].orderCc).toEqual(['treasurer@example.test', 'cm@example.test']);
  });

  it('Treasurer_SeesABadAddressMarkedInPlace_AndNothingSaves', () => {
    saveSettings.mockClear();
    render(<SettingsForm sale={sale} />);
    fireEvent.change(screen.getByLabelText('Address 2'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    expect([screen.getByLabelText('Address 2').getAttribute('aria-invalid'), saveSettings.mock.calls.length]).toEqual(['true', 0]);
  });
});

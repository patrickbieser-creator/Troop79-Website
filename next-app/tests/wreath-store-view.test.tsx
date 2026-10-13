import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoreView } from '../src/app/(public)/wreaths/_components/store-view';
import type { StoreItem } from '../src/lib/wreaths/public';

/**
 * The store's notices about where a cart's credit goes. Found live 2026-10-12: a link that didn't resolve showed
 * "That scout link isn't active" AND "Your cart was opened from Damian's page", so a customer typing Anjali's
 * link saw Damian's name.
 */
const items: StoreItem[] = [
  { id: 11, catalogNumber: 1, name: 'Wreath', size: '20″', description: '', price: 26, imageUrl: null, section: 'wreaths', donatable: true }
];

function seedCart(seller: { slug: string; name: string } | null) {
  window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: { '11': 1 }, seller }));
}

beforeEach(() => window.localStorage.clear());

describe('store view notices', () => {
  it('GeneralStore_SaysCartCameFromAnotherScout_WhenOpenedDirectly', async () => {
    seedCart({ slug: 'damian-n', name: 'Damian N.' });
    render(<StoreView items={items} scout={null} head={null} />);
    expect(await screen.findByText(/opened from Damian N\.’s page/)).toBeTruthy();
  });

  it('FallbackStore_NamesNoOtherScout_WhenATypedLinkDidNotResolve', async () => {
    seedCart({ slug: 'damian-n', name: 'Damian N.' });
    render(<StoreView items={items} scout={null} head={null} linkFellBack />);
    await screen.findByText('Wreath');
    expect(screen.queryByText(/Damian/)).toBeNull();
  });
});

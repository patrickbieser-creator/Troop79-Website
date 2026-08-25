import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecentItemsList } from '../src/app/admin/(workspace)/_components/recent-items-list';
import { Badge } from '../src/app/admin/(workspace)/_components/badge';

/**
 * Wave 1 of the Data Tables consolidation (2026-08-25): the "Recent reports" /
 * "Recent ceremonies" sidebar is one shared RecentItemsList instead of two
 * byte-identical per-screen copies.
 */
const ITEMS = [
  { key: '1', href: '/admin/advancement/report?id=1', label: 'Jul 1 – Jul 31, 2026' },
  {
    key: '2',
    href: '/admin/advancement/report?id=2',
    label: 'Aug 1 – Aug 24, 2026',
    badge: <Badge variant="warning">Draft</Badge>
  }
];

describe('RecentItemsList', () => {
  it('renders one link per item with its href', () => {
    render(<RecentItemsList items={ITEMS} activeKey={null} ariaLabel="Recent reports" />);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(ITEMS.map((i) => i.href));
  });

  it('marks only the active item with aria-current="page"', () => {
    render(<RecentItemsList items={ITEMS} activeKey="2" ariaLabel="Recent reports" />);
    const current = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current.map((l) => l.textContent)).toEqual(['Aug 1 – Aug 24, 2026Draft']);
  });

  it('renders the badge inside the item link', () => {
    render(<RecentItemsList items={ITEMS} activeKey={null} ariaLabel="Recent reports" />);
    expect(screen.getByRole('link', { name: /Aug 1 – Aug 24, 2026/ }).textContent).toContain('Draft');
  });

  it('labels the list for assistive tech', () => {
    render(<RecentItemsList items={ITEMS} activeKey={null} ariaLabel="Recent ceremonies" />);
    expect(screen.getByRole('list', { name: 'Recent ceremonies' })).toBeTruthy();
  });
});

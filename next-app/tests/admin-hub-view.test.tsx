import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AdminHub } from '../src/app/admin/(workspace)/_components/admin-hub';
import type { HubGroup } from '../src/app/admin/(workspace)/_components/nav-data';

const GROUPS: HubGroup[] = [
  {
    title: 'Advancement',
    quiet: false,
    cards: [
      { key: 'a', title: 'Fast Entry', description: 'Sign off requirements for many scouts at once', href: '/admin/advancement/fast-entry' },
      {
        key: 'r',
        title: 'Reports',
        description: 'Audits, weekly report, Court of Honor, exports',
        href: '/admin/advancement/audits',
        links: [
          { label: 'Audits', href: '/admin/advancement/audits' },
          { label: 'Court of Honor', href: '/admin/advancement/court-of-honor' }
        ]
      }
    ]
  },
  {
    title: 'Money',
    quiet: false,
    cards: [{ key: 'w', title: 'Wreath Sale', description: 'Orders, sellers and the Rose order', href: '/admin/finance/wreaths', season: 'off' }]
  },
  {
    title: 'Troop admin tools',
    quiet: true,
    cards: [
      {
        key: 't',
        title: 'Troop admin tools',
        href: '/admin/audit',
        links: [
          { label: 'Audit Trail', href: '/admin/audit' },
          { label: 'Utilities', href: '/admin/utilities' }
        ]
      }
    ]
  }
];

describe('AdminHub view', () => {
  it('AdminHub_RendersACardPerEntry_WithTitleLinkAndOneLine', () => {
    render(<AdminHub groups={GROUPS} />);
    const link = screen.getByRole('link', { name: 'Fast Entry' });
    expect(link.getAttribute('href')).toBe('/admin/advancement/fast-entry');
    expect(screen.getByText('Sign off requirements for many scouts at once')).toBeTruthy();
  });

  it('AdminHub_ShowsOneReportsCard_WithItsReportsAsLinksInside', () => {
    render(<AdminHub groups={GROUPS} />);
    expect(screen.getAllByRole('link', { name: 'Reports' })).toHaveLength(1);
    const card = screen.getByRole('link', { name: 'Reports' }).parentElement!;
    expect(within(card).getByRole('link', { name: 'Court of Honor' }).getAttribute('href')).toBe('/admin/advancement/court-of-honor');
  });

  it('AdminHub_KeepsAnOffSeasonCardClickable_AndSaysTheSaleIsNotOpen', () => {
    render(<AdminHub groups={GROUPS} />);
    expect(screen.getByRole('link', { name: 'Wreath Sale' }).getAttribute('href')).toBe('/admin/finance/wreaths');
    expect(screen.getByText('Sale not open')).toBeTruthy();
  });

  it('AdminHub_RendersTheToolsGroupLast_AsPlainLinksUnderOneHeading', () => {
    render(<AdminHub groups={GROUPS} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[headings.length - 1]).toBe('Troop admin tools');
    expect(screen.getByRole('link', { name: 'Utilities' }).getAttribute('href')).toBe('/admin/utilities');
  });

  it('AdminHub_RendersNoCountBadges', () => {
    const { container } = render(<AdminHub groups={GROUPS} />);
    expect(container.textContent).not.toMatch(/\bwaiting\b/);
  });

  it('AdminHub_RendersNothing_WhenThereAreNoGroups', () => {
    const { container } = render(<AdminHub groups={[]} />);
    expect(container.innerHTML).toBe('');
  });
});

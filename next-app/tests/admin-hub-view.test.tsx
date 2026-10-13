import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AdminHub } from '../src/app/admin/(workspace)/_components/admin-hub';
import { ReportsLanding } from '../src/app/admin/(workspace)/_components/reports-landing';
import type { HubGroup } from '../src/app/admin/(workspace)/_components/nav-data';

const GROUPS: HubGroup[] = [
  {
    title: 'Advancement',
    quiet: false,
    tint: 'moss',
    cards: [
      { key: 'a', title: 'Fast Entry', description: 'Sign off requirements for many scouts at once', href: '/admin/advancement/fast-entry' }
    ]
  },
  {
    title: 'Reports',
    quiet: false,
    tint: 'clay',
    cards: [
      { key: 'r1', title: 'Audits', description: 'Data-quality checks', href: '/admin/advancement/audits' },
      { key: 'r2', title: 'Court of Honor', description: 'Awards earned in a range', href: '/admin/advancement/court-of-honor' }
    ]
  },
  {
    title: 'Money',
    quiet: false,
    tint: 'wheat',
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

  it('AdminHub_ShowsAReportsSection_WithOneCardPerReport', () => {
    render(<AdminHub groups={GROUPS} />);
    const section = screen.getByRole('heading', { level: 2, name: 'Reports' }).closest('section')!;
    expect(within(section).getAllByRole('link')).toHaveLength(2);
    expect(within(section).getByRole('link', { name: 'Court of Honor' }).getAttribute('href')).toBe('/admin/advancement/court-of-honor');
  });

  it('AdminHub_MarksEachGroupWithItsTint_AndLeavesTheToolsRowUntinted', () => {
    render(<AdminHub groups={GROUPS} />);
    const tintOf = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!.getAttribute('data-tint');
    expect(tintOf('Advancement')).toBe('moss');
    expect(tintOf('Reports')).toBe('clay');
    expect(tintOf('Money')).toBe('wheat');
    expect(tintOf('Troop admin tools')).toBeNull();
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

describe('ReportsLanding view', () => {
  const entries = [
    { label: 'Audits', href: '/admin/advancement/audits', description: 'Data-quality checks' },
    { label: 'Court of Honor', href: '/admin/advancement/court-of-honor', description: 'Awards earned in a range' }
  ];

  it('ReportsLanding_RendersATitleLinkAndOneLine_PerReport', () => {
    render(<ReportsLanding entries={entries} />);
    expect(screen.getByRole('link', { name: 'Court of Honor' }).getAttribute('href')).toBe('/admin/advancement/court-of-honor');
    expect(screen.getByText('Data-quality checks')).toBeTruthy();
  });

  it('ReportsLanding_SaysSoPlainly_WhenTheLeaderCanOpenNone', () => {
    render(<ReportsLanding entries={[]} />);
    expect(screen.getByText(/No reports are open to you/)).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  visibleNavSections,
  activeMatchPathFor,
  activeSectionTitleFor,
  navSections,
  SECTIONS as RAIL
} from '../src/app/admin/(workspace)/_components/nav-data';
import type { Capability } from '../src/lib/capabilities';

/**
 * Sub-nav filtering after the Advancement conversion
 * (Plans/Unified-Identity-And-Capabilities.md Phase B2).
 *
 * The nav is NOT the security boundary — each page's requireCapability() is.
 * What these guard is the thing that would otherwise be confusing rather than
 * unsafe: an unconverted section (no `capability` on its nav item) must stay
 * hidden from a partially-granted person, because its page still guards with
 * requireRole() and would throw if they followed the link.
 */

const SECTIONS = [
  {
    title: 'Entry',
    items: [
      { label: 'Fast Entry', href: '/a', capability: 'advancement.write' as Capability },
      { label: 'Event Rosters', href: '/b' } // unconverted
    ]
  },
  {
    title: 'Setup',
    items: [
      { label: 'Roster Import', href: '/c', capability: 'roster.manage' as Capability },
      { label: 'Utilities', href: '/d' }
    ]
  }
];

function labels(sections: { items: { label: string }[] }[]) {
  return sections.flatMap((s) => s.items.map((i) => i.label));
}

describe('admin sub-nav capability filtering', () => {
  it('FullAdmin_SeesEverySection_IncludingUnconvertedOnes', () => {
    const out = visibleNavSections(SECTIONS, {
      fullAdmin: true,
      capabilities: new Set<Capability>()
    });
    expect(labels(out)).toEqual(['Fast Entry', 'Event Rosters', 'Roster Import', 'Utilities']);
  });

  it('PartialActor_SeesOnlyConvertedSections_TheyHold', () => {
    const out = visibleNavSections(SECTIONS, {
      fullAdmin: false,
      capabilities: new Set<Capability>(['advancement.write'])
    });
    expect(labels(out)).toEqual(['Fast Entry']);
  });

  it('PartialActor_DoesNotSeeUnconvertedSections_EvenThoughTheyAreLeaderSurfaces', () => {
    // 'Event Rosters' and 'Utilities' have no capability yet. Showing them
    // would hand a partially-granted person a link that throws.
    const out = visibleNavSections(SECTIONS, {
      fullAdmin: false,
      capabilities: new Set<Capability>(['advancement.write', 'roster.manage'])
    });
    expect(labels(out)).toEqual(['Fast Entry', 'Roster Import']);
  });

  it('PartialActor_SeesNothing_WhenHoldingOnlyUnmappedCapabilities', () => {
    const out = visibleNavSections(SECTIONS, {
      fullAdmin: false,
      capabilities: new Set<Capability>(['library.proxy_view'])
    });
    expect(out).toEqual([]);
  });

  it('EmptySections_AreDropped_RatherThanRenderedAsHeadings', () => {
    const out = visibleNavSections(SECTIONS, {
      fullAdmin: false,
      capabilities: new Set<Capability>(['roster.manage'])
    });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Setup');
  });

  // Troop Finances (Plans/Troop-Finances.md) — qa-lead, 2026-08-18: a legacy
  // LEADER_PASSWORD session is fullAdmin but was never granted finance.manage
  // (see lib/admin-actor.ts's LEGACY_EXCLUDED). Without this exclusion the
  // nav would show a Ledger link that throws when a legacy leader clicks it.
  const FINANCE_SECTIONS = [
    {
      title: 'Finance',
      items: [{ label: 'Ledger', href: '/e', capability: 'finance.manage' as Capability }]
    },
    {
      title: 'Entry',
      items: [{ label: 'Fast Entry', href: '/a', capability: 'advancement.write' as Capability }]
    }
  ];

  it('FullAdmin_HidesFinanceLink_WhenActorLacksFinanceCapability', () => {
    const out = visibleNavSections(FINANCE_SECTIONS, {
      fullAdmin: true,
      capabilities: new Set<Capability>() // e.g. a legacy LEADER_PASSWORD actor
    });
    expect(labels(out)).toEqual(['Fast Entry']);
  });

  it('FullAdmin_ShowsFinanceLink_WhenActorGenuinelyHoldsFinanceCapability', () => {
    const out = visibleNavSections(FINANCE_SECTIONS, {
      fullAdmin: true,
      capabilities: new Set<Capability>(['finance.manage'])
    });
    expect(labels(out)).toEqual(['Ledger', 'Fast Entry']);
  });
});

/**
 * activeMatchPathFor (pure) — which single nav item lights up as "current".
 * A section root's matchPath is often a prefix of a sibling's (Finance's
 * "Ledger" -> /admin/finance, "Activity Report" -> /admin/finance/report);
 * a plain startsWith per item lit up both at once on the more specific page
 * (screenshot, 2026-08-20). Longest-match-wins picks exactly one.
 */
describe('activeMatchPathFor', () => {
  const FINANCE_NAV = [
    {
      items: [
        { label: 'Ledger', matchPath: '/admin/finance' },
        { label: 'Reimbursements', matchPath: '/admin/finance/reimbursements' },
        { label: 'Activity Report', matchPath: '/admin/finance/report' }
      ]
    }
  ];

  it('PicksTheLedgerRoot_WhenOnTheLedgerPageItself', () => {
    expect(activeMatchPathFor(FINANCE_NAV, '/admin/finance')).toBe('/admin/finance');
  });

  it('PicksTheMoreSpecificSibling_NotTheSectionRootItsAPrefixOf', () => {
    // The exact bug: /admin/finance/report starts with BOTH /admin/finance
    // (Ledger) and /admin/finance/report (Activity Report) — only the
    // longer, more specific one should win.
    expect(activeMatchPathFor(FINANCE_NAV, '/admin/finance/report')).toBe('/admin/finance/report');
    expect(activeMatchPathFor(FINANCE_NAV, '/admin/finance/reimbursements')).toBe('/admin/finance/reimbursements');
  });

  it('ReturnsNull_WhenNothingMatches', () => {
    expect(activeMatchPathFor(FINANCE_NAV, '/admin/library')).toBeNull();
  });

  it('IgnoresDisabledItems', () => {
    const withDisabled = [
      { items: [{ label: 'Soon', matchPath: '/admin/finance', disabled: true }] }
    ];
    expect(activeMatchPathFor(withDisabled, '/admin/finance')).toBeNull();
  });
});

/**
 * Rail cleanup (Plans/Admin-Home-And-Nav.md, Wave 1): Home replaces the
 * Dashboard link, Styleguides leaves the rail (navHidden: a tools-card link
 * only), and Ledger Audit is offered once, under Money (Wave 2 regroup).
 */
describe('admin nav contents', () => {
  const rail = navSections(visibleNavSections(RAIL, { fullAdmin: true, capabilities: new Set<Capability>(['finance.manage', 'finance.view']) }));
  const all = rail.flatMap((s) => s.items);

  it('Nav_DoesNotListStyleguides', () => {
    expect(all.map((i) => i.label)).not.toContain('Styleguides');
    expect(all.some((i) => i.href?.startsWith('/admin/styleguide'))).toBe(false);
  });

  it('Nav_ListsLedgerAuditExactlyOnce_UnderMoney', () => {
    const hits = RAIL.flatMap((s) => s.items.map((i) => ({ section: s.title, i }))).filter((x) => x.i.href === '/admin/utilities/ledger-audit');
    expect(hits.map((h) => h.section)).toEqual(['Money']);
  });

  it('Nav_CallsTheFirstItemHome_AndPointsItAtAdmin', () => {
    const home = RAIL[0].items[0];
    expect(home.label).toBe('Home');
    expect(home.href).toBe('/admin');
  });

  it('Home_LightsUpOnlyOnTheHomePages_NotOnEveryAdminPage', () => {
    const visible = visibleNavSections(RAIL, { fullAdmin: true, capabilities: new Set<Capability>(['finance.manage', 'finance.view']) });
    expect(activeMatchPathFor(visible, '/admin')).toBe('/admin');
    expect(activeMatchPathFor(visible, '/admin/advancement/dashboard')).toBe('/admin');
    expect(activeMatchPathFor(visible, '/admin/news/articles')).toBe('/admin/news/articles');
  });

  it('Home_IsOfferedToEveryLeader_EvenWithOnlyFinanceManage', () => {
    const out = visibleNavSections(RAIL, { fullAdmin: false, capabilities: new Set<Capability>(['finance.manage']) });
    expect(out[0].items[0].label).toBe('Home');
  });

  it('Nav_GroupsByJob_InThePlansOrder', () => {
    expect(RAIL.map((s) => s.title)).toEqual([
      'Overview',
      'Advancement',
      'Calendar & Content',
      'Money',
      'People & Setup',
      'Troop admin tools'
    ]);
  });

  it('AdminNav_LedgerAuditHighlightsMoney', () => {
    const visible = visibleNavSections(RAIL, { fullAdmin: true, capabilities: new Set<Capability>(['finance.manage', 'finance.view']) });
    expect(activeMatchPathFor(visible, '/admin/utilities/ledger-audit')).toBe('/admin/utilities/ledger-audit');
    expect(activeSectionTitleFor(visible, '/admin/utilities/ledger-audit')).toBe('Money');
    expect(activeSectionTitleFor(visible, '/admin/utilities')).toBe('Troop admin tools');
  });
});

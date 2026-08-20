import { describe, it, expect } from 'vitest';
import { visibleNavSections, activeMatchPathFor } from '../src/app/admin/(workspace)/_components/sub-nav';
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

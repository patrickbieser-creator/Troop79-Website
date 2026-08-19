import { describe, it, expect } from 'vitest';
import { visibleNavSections } from '../src/app/admin/(workspace)/_components/sub-nav';
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

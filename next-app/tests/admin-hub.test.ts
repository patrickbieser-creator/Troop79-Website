import { describe, it, expect } from 'vitest';
import { SECTIONS, visibleNavSections, railSections, hubGroups, folderEntries, railActiveMatchPathFor, type HubGroup } from '../src/app/admin/(workspace)/_components/nav-data';
import { BUNDLES, CAPABILITIES, type Capability } from '../src/lib/capabilities';

/**
 * Home's card grid and the rail render from the same SECTIONS data
 * (Plans/Admin-Home-And-Nav.md Wave 2).
 */

// The 30 hrefs the rail offered at v1.214.0 (before Wave 2), for the regression test.
const FORMER_RAIL_HREFS = [
  '/admin', '/admin/advancement/fast-entry', '/admin/advancement/meeting-plan', '/admin/advancement/has-needs',
  '/admin/advancement/ledger', '/admin/advancement/roster', '/admin/advancement/records', '/admin/advancement/mb-progress',
  '/admin/advancement/audits', '/admin/advancement/report', '/admin/advancement/court-of-honor',
  '/admin/advancement/scoutbook-export', '/admin/advancement/meetings/report', '/admin/news/articles', '/admin/news/pages',
  '/admin/calendar', '/admin/library', '/admin/library/menu-monster', '/admin/news/media-manager',
  '/admin/news/photo-albums', '/admin/finance', '/admin/finance/reimbursements', '/admin/finance/report',
  '/admin/utilities/ledger-audit', '/admin/finance/wreaths', '/admin/advancement/lookups',
  '/admin/advancement/roster-import', '/admin/access', '/admin/audit', '/admin/utilities'
];

const ALL = new Set<Capability>(CAPABILITIES);

function visible(caps: Iterable<Capability>, fullAdmin = false) {
  return visibleNavSections(SECTIONS, { fullAdmin, capabilities: new Set(caps) });
}
function hubHrefs(groups: HubGroup[]) {
  // A folder card (Reports) answers for its landing (the title link) AND its members; a plain card for its own href.
  return [...new Set(groups.flatMap((g) => g.cards.flatMap((c) => [c.href, ...(c.links ?? []).map((l) => l.href)])))];
}
function cardTitles(groups: HubGroup[]) {
  return groups.flatMap((g) => g.cards.map((c) => c.title));
}

describe('AdminHome card grid', () => {
  it('AdminHome_ShowsOnlyCardsTheLeaderCanOpen_WhenGrantedOneCapability', () => {
    const groups = hubGroups(visible(['calendar.write']), { wreathOpen: false });
    expect(cardTitles(groups)).toEqual(['Calendar']);
  });

  it('AdminHome_HidesAGroup_WhenNoneOfItsCardsAreVisible', () => {
    const groups = hubGroups(visible(['calendar.write']), { wreathOpen: false });
    expect(groups.map((g) => g.title)).toEqual(['Calendar & Content']);
  });

  it('AdminHome_ShowsNothing_WhenOnlyHomeIsOffered', () => {
    expect(hubGroups(visible(['library.proxy_view']), { wreathOpen: false })).toEqual([]);
  });

  it('AdminHome_FoldsTheFiveReportsIntoOneCard_WithQuietLinks', () => {
    const groups = hubGroups(visible(['advancement.write']), { wreathOpen: false });
    const reports = groups.flatMap((g) => g.cards).filter((c) => c.title === 'Reports');
    expect(reports).toHaveLength(1);
    expect(reports[0].links?.map((l) => l.label)).toEqual([
      'Audits', 'Advancement Report', 'Court of Honor', 'Scoutbook Export', 'Attendance Report'
    ]);
    expect(cardTitles(groups)).not.toContain('Audits');
  });

  it('AdminHome_LinksTheReportsCardTitleToTheReportsLanding_NotToAudits', () => {
    const groups = hubGroups(visible(['advancement.write']), { wreathOpen: false });
    const card = groups.flatMap((g) => g.cards).find((c) => c.title === 'Reports')!;
    expect(card.href).toBe('/admin/reports');
    expect(card.links?.map((l) => l.href)).not.toContain('/admin/reports');
  });

  it('AdminHome_CarriesADescriptionOnEveryNonToolsCard', () => {
    const groups = hubGroups(visible(ALL, true), { wreathOpen: true }).filter((g) => !g.quiet);
    for (const c of groups.flatMap((g) => g.cards)) expect(c.description, c.title).toBeTruthy();
  });

  it('AdminHome_ListsTroopAdminToolsLast_AsOneQuietCardOfLinks', () => {
    const groups = hubGroups(visible(ALL, true), { wreathOpen: true });
    const last = groups[groups.length - 1];
    expect(last.title).toBe('Troop admin tools');
    expect(last.quiet).toBe(true);
    expect(last.cards).toHaveLength(1);
    expect(last.cards[0].links?.map((l) => l.label)).toEqual(['Lookups & Admin', 'Roster Import', 'Audit Trail', 'Utilities', 'Styleguides']);
  });

  it('AdminHome_OffersStyleguidesToFullAdminsOnly', () => {
    expect(hubHrefs(hubGroups(visible(ALL, true), { wreathOpen: true }))).toContain('/admin/styleguide');
    expect(hubHrefs(hubGroups(visible(['advancement.write', 'roster.manage']), { wreathOpen: true }))).not.toContain('/admin/styleguide');
  });

  it('AdminHome_PutsWreathSaleFirstInMoney_WhenTheSaleIsOpen', () => {
    const money = hubGroups(visible(ALL, true), { wreathOpen: true }).find((g) => g.title === 'Money')!;
    expect(money.cards[0].title).toBe('Wreath Sale');
    expect(money.cards[0].season).toBe('open');
  });

  it('AdminHome_PutsWreathSaleLastAndGreyed_WhenTheSaleIsNotOpen', () => {
    const money = hubGroups(visible(ALL, true), { wreathOpen: false }).find((g) => g.title === 'Money')!;
    expect(money.cards[money.cards.length - 1].title).toBe('Wreath Sale');
    expect(money.cards[money.cards.length - 1].season).toBe('off');
    expect(money.cards[0].title).toBe('Financial Ledger');
  });
});

describe('AdminNav hub and rail agree', () => {
  const presets: [string, Capability[]][] = [
    ...Object.entries(BUNDLES).map(([k, b]) => [k, [...b.capabilities]] as [string, Capability[]]),
    ['finance_view_only', ['finance.view']],
    ['everything_but_finance', CAPABILITIES.filter((c) => !c.startsWith('finance.'))]
  ];

  for (const fullAdmin of [false, true]) {
    for (const [name, caps] of presets) {
      it(`AdminNav_HubAndRailAgree_ForEveryCapabilitySet [${name}${fullAdmin ? ', fullAdmin' : ''}]`, () => {
        const vis = visible(caps, fullAdmin);
        const expected = vis.flatMap((s) => s.items).filter((i) => !i.everyone).map((i) => i.href!);
        const hub = hubHrefs(hubGroups(vis, { wreathOpen: true }));
        // Every destination appears on the hub exactly once...
        expect([...hub].sort()).toEqual([...expected].sort());
        // ...and the rail offers the same set, bar the railHidden tools-card-only entries.
        const rail = railSections(vis).flatMap((s) => s.items).filter((i) => !i.everyone).map((i) => i.href!);
        const hidden = vis.flatMap((s) => s.items).filter((i) => i.railHidden).map((i) => i.href!);
        expect([...rail, ...hidden].sort()).toEqual([...expected].sort());
      });
    }
  }

  it('AdminNav_EveryFormerRailLinkIsReachable', () => {
    const vis = visible(ALL, true);
    const railHrefs = railSections(vis).flatMap((s) => s.items).map((i) => i.href);
    const reports = folderEntries(vis, 'Reports').map((e) => e.href);
    const hub = hubHrefs(hubGroups(vis, { wreathOpen: true }));
    for (const href of FORMER_RAIL_HREFS) {
      // Still on the rail, or collected on the Reports landing (the five reports left the rail for it).
      expect([...railHrefs, ...reports], `rail or Reports landing: ${href}`).toContain(href);
      if (href !== '/admin') expect(hub, `hub: ${href}`).toContain(href);
    }
  });
});

describe('Reports landing', () => {
  it('ReportsLanding_ListsEveryReportTheLeaderCanOpen_WithADescriptionEach', () => {
    const entries = folderEntries(visible(['advancement.write']), 'Reports');
    expect(entries.map((e) => e.label)).toEqual([
      'Audits', 'Advancement Report', 'Court of Honor', 'Scoutbook Export', 'Attendance Report'
    ]);
    for (const e of entries) expect(e.description, e.label).toBeTruthy();
  });

  it('ReportsLanding_ListsNothing_WhenTheLeaderHoldsNoReportCapability', () => {
    expect(folderEntries(visible(['calendar.write', 'finance.manage']), 'Reports')).toEqual([]);
  });

  it('ReportsLanding_IsOnTheRailOnlyWhileAReportIsOpenToTheLeader', () => {
    const rail = (caps: Capability[]) => railSections(visible(caps)).flatMap((s) => s.items).map((i) => i.href);
    expect(rail(['advancement.write'])).toContain('/admin/reports');
    expect(rail(['calendar.write'])).not.toContain('/admin/reports');
  });

  it('ReportsLanding_TakesTheFiveReportsOffTheRail', () => {
    const rail = railSections(visible(['advancement.write'])).flatMap((s) => s.items).map((i) => i.label);
    expect(rail).toContain('Reports');
    for (const l of ['Audits', 'Advancement Report', 'Court of Honor', 'Scoutbook Export', 'Attendance Report']) {
      expect(rail).not.toContain(l);
    }
  });

  it('ReportsLanding_ShowsANewNavDataReportAutomatically', () => {
    const extended = SECTIONS.map((s) =>
      s.title !== 'Advancement'
        ? s
        : {
            ...s,
            items: [
              ...s.items,
              {
                label: 'Camping Nights Report',
                href: '/admin/advancement/camping-nights',
                matchPath: '/admin/advancement/camping-nights',
                description: 'Nights camped per scout',
                folder: 'Reports',
                railHidden: true,
                capability: 'advancement.write' as Capability
              }
            ]
          }
    );
    const vis = visibleNavSections(extended, { fullAdmin: false, capabilities: new Set<Capability>(['advancement.write']) });
    expect(folderEntries(vis, 'Reports').map((e) => e.label)).toContain('Camping Nights Report');
    expect(hubHrefs(hubGroups(vis, { wreathOpen: false }))).toContain('/admin/advancement/camping-nights');
    expect(railActiveMatchPathFor(vis, '/admin/advancement/camping-nights')).toBe('/admin/reports');
  });

  it.each([
    '/admin/reports',
    '/admin/advancement/audits',
    '/admin/advancement/report',
    '/admin/advancement/court-of-honor',
    '/admin/advancement/scoutbook-export',
    '/admin/advancement/meetings/report'
  ])('ReportsLanding_LightsTheReportsRailEntry_On %s', (path) => {
    expect(railActiveMatchPathFor(visible(['advancement.write']), path)).toBe('/admin/reports');
  });

  it('ReportsLanding_LeavesOtherRailEntriesAlone_OnTheirOwnPages', () => {
    expect(railActiveMatchPathFor(visible(['advancement.write']), '/admin/advancement/ledger')).toBe('/admin/advancement/ledger');
  });
});

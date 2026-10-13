import { describe, it, expect } from 'vitest';
import { SECTIONS, visibleNavSections, railSections, hubGroups, type HubGroup } from '../src/app/admin/(workspace)/_components/nav-data';
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
  return groups.flatMap((g) => g.cards.flatMap((c) => (c.links ? c.links.map((l) => l.href) : [c.href])));
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
    const hub = hubHrefs(hubGroups(vis, { wreathOpen: true }));
    for (const href of FORMER_RAIL_HREFS) {
      expect(railHrefs, `rail: ${href}`).toContain(href);
      if (href !== '/admin') expect(hub, `hub: ${href}`).toContain(href);
    }
  });
});
